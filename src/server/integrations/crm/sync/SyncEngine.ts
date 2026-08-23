/**
 * Synchronisation engine.
 *
 * Provider-agnostic orchestration: paging, incremental watermarks, per-record
 * error isolation, retry, counting and audit logging. It knows nothing about
 * Bitrix24 and nothing about Prisma â€” both sit behind the seams below, which
 * is what lets the whole engine be tested with in-memory fakes.
 *
 * IDEMPOTENCE IS THE WHOLE POINT
 * Every write is an upsert keyed on `(externalSource, externalId)`, backed by a
 * unique index. Running a full sync twice must leave the database in exactly
 * the state one run would. Without that, a retried or overlapping sync silently
 * doubles revenue, and nobody notices until the numbers are challenged.
 *
 * FAILURE POLICY
 * One malformed record must not abandon the run. Records are persisted in
 * batches; a batch that fails is retried once record-by-record so the bad row
 * is isolated and counted, and the rest still land. A run that skipped records
 * finishes as PARTIAL, never SUCCESS â€” a green light over incomplete data is
 * worse than a visible warning.
 */

import type {
  SyncEntityValue,
  SyncModeValue,
  SyncStatusValue,
} from '@/server/domain/types'
import type { CrmProvider, FetchOptions, Page } from '@/server/integrations/crm/CrmProvider'

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

export interface BatchOutcome {
  readonly created: number
  readonly updated: number
  /** Records deliberately ignored, e.g. an unresolvable foreign key. */
  readonly skipped: number
}

/**
 * Persists one entity type.
 *
 * `persist` MUST be idempotent: calling it twice with the same batch must
 * produce the same database state. Implementations upsert on
 * `(externalSource, externalId)`.
 */
export interface EntitySyncHandler<T = unknown> {
  readonly entity: SyncEntityValue
  fetch(provider: CrmProvider, options: FetchOptions): Promise<Page<T>>
  persist(batch: readonly T[]): Promise<BatchOutcome>

  /** The source-side id of a record. Used to detect upstream deletions. */
  externalIdOf(item: T): string

  /**
   * Remove rows whose source record no longer exists.
   *
   * Optional, and only ever called after a CLEAN full sync â€” see
   * `runEntity`. A handler that omits it keeps every row it has ever seen.
   *
   * BITRIX24_INTEGRATION_PENDING: whether a deal deleted in Bitrix24 should
   * disappear from the dashboard or be retained for historical accuracy is an
   * open business question (docs/BITRIX24.md Â§10). Sweeping is therefore
   * opt-in per run rather than automatic.
   */
  deleteMissing?(seenExternalIds: ReadonlySet<string>): Promise<number>
}

export interface SyncRunRecord {
  readonly id: string
  readonly entity: SyncEntityValue
  readonly mode: SyncModeValue
}

/** Audit trail and incremental bookmarks. Backed by Prisma in production. */
export interface SyncStore {
  beginRun(input: {
    provider: string
    entity: SyncEntityValue
    mode: SyncModeValue
  }): Promise<SyncRunRecord>

  finishRun(input: {
    id: string
    status: SyncStatusValue
    recordsRead: number
    recordsCreated: number
    recordsUpdated: number
    recordsSkipped: number
    recordsFailed: number
    errorMessage?: string
  }): Promise<void>

  getCursor(provider: string, entity: SyncEntityValue): Promise<Date | undefined>
  setCursor(provider: string, entity: SyncEntityValue, watermark: Date): Promise<void>
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface SyncResult {
  readonly entity: SyncEntityValue
  readonly mode: SyncModeValue
  readonly status: SyncStatusValue
  readonly recordsRead: number
  readonly recordsCreated: number
  readonly recordsUpdated: number
  readonly recordsSkipped: number
  readonly recordsFailed: number
  /** Rows removed because the source record no longer exists. */
  readonly recordsDeleted: number
  readonly errorMessage?: string
  readonly skippedUnsupported: boolean
}

export interface SyncEngineOptions {
  readonly provider: CrmProvider
  readonly store: SyncStore
  readonly handlers: readonly EntitySyncHandler[]
  readonly pageSize?: number
  /** Injected for deterministic tests. */
  readonly now?: () => Date
  readonly logger?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }
}

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} }

export class SyncEngine {
  private readonly provider: CrmProvider
  private readonly store: SyncStore
  private readonly handlers: Map<SyncEntityValue, EntitySyncHandler>
  private readonly pageSize: number
  private readonly now: () => Date
  private readonly log: NonNullable<SyncEngineOptions['logger']>

  constructor(options: SyncEngineOptions) {
    this.provider = options.provider
    this.store = options.store
    this.pageSize = options.pageSize ?? 200
    this.now = options.now ?? (() => new Date())
    this.log = options.logger ?? noopLogger
    this.handlers = new Map(options.handlers.map((h) => [h.entity, h]))
  }

  /**
   * Synchronise one entity.
   *
   * Never throws for ordinary failures: the outcome is reported in the result
   * and recorded in the log, so a scheduled sync of ten entities does not stop
   * at the first problem.
   */
  async runEntity(
    entity: SyncEntityValue,
    mode: SyncModeValue,
    options: { sweepDeleted?: boolean } = {},
  ): Promise<SyncResult> {
    const handler = this.handlers.get(entity)

    if (!handler) {
      return this.unsupported(entity, mode, `No handler registered for ${entity}`)
    }

    if (this.provider.capabilities[entity] !== true) {
      // Not a failure. The provider genuinely does not expose this data, and
      // the API will report it as unavailable rather than as zero.
      return this.unsupported(
        entity,
        mode,
        `Provider ${this.provider.source} does not supply ${entity}`,
      )
    }

    const run = await this.store.beginRun({
      provider: this.provider.source,
      entity,
      mode,
    })

    // Captured BEFORE reading, so records changed mid-run are picked up next
    // time instead of being skipped. Re-importing a record is harmless
    // (upsert); missing one is not.
    const startedAt = this.now()

    const watermark =
      mode === 'INCREMENTAL'
        ? await this.store.getCursor(this.provider.source, entity)
        : undefined

    let read = 0
    let created = 0
    let updated = 0
    let skipped = 0
    let failed = 0
    let cursor: string | undefined
    let fatal: string | undefined
    let pages = 0
    let deleted = 0

    // Only meaningful for a FULL run: an incremental run sees just the changed
    // records, so "not seen" says nothing about whether a row still exists.
    const sweeping = options.sweepDeleted === true && mode === 'FULL'
    const seen = new Set<string>()

    try {
      do {
        const page = await handler.fetch(this.provider, {
          cursor,
          pageSize: this.pageSize,
          updatedSince: watermark,
        })

        read += page.items.length

        if (sweeping) {
          for (const item of page.items) seen.add(handler.externalIdOf(item))
        }

        if (page.items.length > 0) {
          const outcome = await this.persistBatch(handler, page.items)
          created += outcome.created
          updated += outcome.updated
          skipped += outcome.skipped
          failed += outcome.failed
        }

        cursor = page.nextCursor

        // Backstop against a provider that returns a non-advancing cursor.
        if (++pages > 10_000) {
          throw new Error(`Pagination did not terminate after ${pages} pages`)
        }
      } while (cursor)
    } catch (error) {
      fatal = error instanceof Error ? error.message : String(error)
      this.log.error({ entity, error: fatal }, 'sync failed')
    }

    const status: SyncStatusValue = fatal
      ? 'FAILED'
      : failed > 0 || skipped > 0
        ? 'PARTIAL'
        : 'SUCCESS'

    /**
     * Sweep upstream deletions â€” but ONLY after a completely clean run.
     *
     * If any page failed to fetch, `seen` is missing records that do exist
     * upstream, and deleting on that basis would destroy live data because of
     * a transient network error. A partial read must never drive a delete.
     */
    if (sweeping && status === 'SUCCESS' && handler.deleteMissing) {
      try {
        deleted = await handler.deleteMissing(seen)
        if (deleted > 0) {
          this.log.info({ entity, deleted }, 'removed records deleted upstream')
        }
      } catch (error) {
        this.log.warn({ entity, error: String(error) }, 'sweep failed')
      }
    }

    // Only advance the watermark when nothing was lost. Advancing past a
    // failed record would make the next incremental run skip it forever.
    if (status === 'SUCCESS') {
      await this.store.setCursor(this.provider.source, entity, startedAt)
    }

    await this.store.finishRun({
      id: run.id,
      status,
      recordsRead: read,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      recordsFailed: failed,
      errorMessage: fatal,
    })

    return {
      entity,
      mode,
      status,
      recordsRead: read,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      recordsFailed: failed,
      recordsDeleted: deleted,
      errorMessage: fatal,
      skippedUnsupported: false,
    }
  }

  /**
   * Persist one page, isolating bad records.
   *
   * The batch is tried whole first, because that is one round trip instead of
   * N. Only if it fails does the engine fall back to per-record writes, so the
   * expensive path is reserved for the rare case.
   */
  private async persistBatch(
    handler: EntitySyncHandler,
    items: readonly unknown[],
  ): Promise<BatchOutcome & { failed: number }> {
    try {
      const outcome = await handler.persist(items)
      return { ...outcome, failed: 0 }
    } catch (error) {
      this.log.warn(
        { entity: handler.entity, size: items.length, error: String(error) },
        'batch failed; retrying record by record',
      )
    }

    let created = 0
    let updated = 0
    let skipped = 0
    let failed = 0

    for (const item of items) {
      try {
        const outcome = await handler.persist([item])
        created += outcome.created
        updated += outcome.updated
        skipped += outcome.skipped
      } catch (error) {
        failed += 1
        this.log.warn(
          { entity: handler.entity, error: String(error) },
          'record rejected during sync',
        )
      }
    }

    return { created, updated, skipped, failed }
  }

  /**
   * Synchronise many entities in dependency order.
   *
   * Sequential on purpose: deals reference employees, stages and customers, so
   * running them concurrently would produce unresolvable foreign keys on a cold
   * database. Throughput is not the constraint here â€” correctness is.
   */
  async runAll(
    entities: readonly SyncEntityValue[],
    mode: SyncModeValue,
    options: { sweepDeleted?: boolean } = {},
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []
    for (const entity of entities) {
      results.push(await this.runEntity(entity, mode, options))
    }
    return results
  }

  private unsupported(
    entity: SyncEntityValue,
    mode: SyncModeValue,
    reason: string,
  ): SyncResult {
    this.log.info({ entity, reason }, 'sync skipped')
    return {
      entity,
      mode,
      status: 'SUCCESS',
      recordsRead: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      recordsDeleted: 0,
      errorMessage: reason,
      skippedUnsupported: true,
    }
  }
}

/** Convenience: did every entity in a run come back clean? */
export function isCleanRun(results: readonly SyncResult[]): boolean {
  return results.every((r) => r.status === 'SUCCESS')
}
