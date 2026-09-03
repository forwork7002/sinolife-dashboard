/**
 * Synchronisation engine.
 *
 * Provider-agnostic orchestration: paging, incremental watermarks, per-record
 * error isolation, retry, counting and audit logging. It knows nothing about
 * Bitrix24 and nothing about Prisma — both sit behind the seams below, which
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
 * finishes as PARTIAL, never SUCCESS — a green light over incomplete data is
 * worse than a visible warning.
 */

import type {
  SyncEntityValue,
  SyncModeValue,
  SyncStatusValue,
} from '@/server/domain/types'
import type { CrmProvider, FetchOptions, Page } from '@/server/integrations/crm/CrmProvider'

/**
 * How far back an entity re-reads after a run that SKIPPED something.
 *
 * NOT EVERY SKIP IS PERMANENT, and treating them all as if they were lost
 * orders off the Тасдиклаш board. The watermark deliberately advances past a
 * skipped record — see `setCursor` at the end of `runEntity` — because most
 * skips can never resolve: a transition belonging to a deal outside the
 * imported pipelines, or naming a stage the portal has since deleted. One kind
 * resolves within a minute, and it was being thrown away with the rest.
 *
 * THE RACE IS INSIDE A SINGLE TICK. The worker runs the hot entities in
 * sequence — CUSTOMERS, DEALS, DEAL_ITEMS, STAGE_HISTORY, CALLS — and each
 * captures its own `startedAt` when its own run begins, twenty or thirty
 * seconds apart. A deal created between the DEALS read and the STAGE_HISTORY
 * read is therefore not in our database yet, while its arrival in `C4:NEW`
 * already exists in the portal's history. That row is skipped for an
 * unresolvable `dealId`, the watermark moves past it, and the next run asks
 * for `>CREATED_TIME` — so the arrival is never read again. The deal lands a
 * minute later carrying its LATER transitions and no arrival, which is exactly
 * the row the confirmation queue is cohorted by: the order is not on the board
 * at all, and nothing anywhere reports a gap.
 *
 * Measured on production, 2026-09-03: the portal and the client's own bot
 * board both held 44 orders for the day and this database held 43. The missing
 * one was deal 935632 — arrival at 11:28:30, skipped in the tick that read
 * history at 11:28:4x, deal row imported at 11:29:39 — and the same gap ran at
 * one to four orders a day over the four days before it.
 *
 * DEALS HAS THE SAME SHAPE against a different reference: it drops a deal whose
 * employee or stage it cannot resolve, and reference data reloads only every 30
 * TICKS. A tick is at least the interval and has no ceiling — a slow one runs
 * long and the next starts immediately — so "thirty ticks" is not thirty
 * minutes and a lookback sized to the clock has to allow for that. Ninety-five
 * minutes covers thirty ticks averaging three, and it costs nothing to be
 * generous here: over five hours of production, DEALS skipped on none of its
 * 293 runs, so this is insurance that almost never fires. STAGE_HISTORY, which
 * fires on about one run in ten, keeps the tighter window its race actually
 * needs — the deal it is waiting for lands in the very next tick.
 *
 * DEAL_ITEMS is absent on purpose: it reads the in-process state the DEALS pass
 * just left behind rather than a watermark, so it cannot lose this race. CALLS
 * is absent because it LINKS its deal optionally instead of skipping.
 *
 * The cost is paid only by a run that actually skipped something, and it is
 * minutes of changes rather than the whole table — not the 191 000-row re-read
 * that blocking the watermark on skips produced. Re-reading is cheap in the
 * first place only because the upsert no longer rewrites a row's primary key;
 * see `identityColumns` in handlers.ts.
 */
const SKIP_LOOKBACK_MS: Partial<Record<SyncEntityValue, number>> = {
  DEALS: 95 * 60_000,
  STAGE_HISTORY: 35 * 60_000,
}

/**
 * Where the next incremental run starts reading.
 *
 * `startedAt`, moved back by this entity's lookback when the run dropped
 * anything — and only then, so a clean run costs nothing and the common case
 * is unchanged. It can never stall: the value is always derived from THIS
 * run's start, so it advances by a whole tick every tick however many records
 * keep being skipped, which is the property blocking on skips did not have.
 */
export function nextWatermark(
  entity: SyncEntityValue,
  startedAt: Date,
  skipped: number,
): Date {
  const lookback = SKIP_LOOKBACK_MS[entity] ?? 0
  if (skipped === 0 || lookback === 0) return startedAt
  return new Date(startedAt.getTime() - lookback)
}

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
   * Optional, and only ever called after a CLEAN full sync — see
   * `runEntity`. A handler that omits it keeps every row it has ever seen.
   *
   * BITRIX24_INTEGRATION_PENDING: whether a deal deleted in Bitrix24 should
   * disappear from the dashboard or be retained for historical accuracy is an
   * open business question (docs/BITRIX24.md §10). Sweeping is therefore
   * opt-in per run rather than automatic.
   */
  deleteMissing?(seenExternalIds: ReadonlySet<string>): Promise<number>

  /**
   * Derive whatever can only be computed once every page has landed.
   *
   * Optional, and called only when the run read everything without a fatal
   * error — a derivation over half the rows would be worse than none.
   *
   * Stage history is the reason this exists: the portal reports when a deal
   * ENTERED a stage and never when it left, so the duration of each stay is
   * the gap to the next entry. That is a window function over the finished
   * table, not something a page-at-a-time writer can know.
   */
  finalize?(): Promise<void>
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

    /**
     * Derive what only the finished table can answer.
     *
     * Skipped when the read failed: a window function over half the rows would
     * produce confidently wrong durations, which is worse than none at all.
     *
     * A failure here degrades the run to PARTIAL rather than FAILED. The rows
     * are written and correct; one computed column is stale, and the log says
     * which — so the next run fixes it without re-reading the portal.
     */
    let derivationFailed = false
    if (!fatal && handler.finalize) {
      try {
        await handler.finalize()
      } catch (error) {
        derivationFailed = true
        this.log.warn({ entity, error: String(error) }, 'finalize failed')
      }
    }

    const status: SyncStatusValue = fatal
      ? 'FAILED'
      : failed > 0 || skipped > 0 || derivationFailed
        ? 'PARTIAL'
        : 'SUCCESS'

    /**
     * Sweep upstream deletions — but ONLY after a completely clean run.
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

    /**
     * Advance the watermark when nothing FAILED — skips do not block it.
     *
     * The distinction matters more than it looks. A failure is a record we
     * wanted and did not get, so the next run must see it again. A skip is a
     * record we deliberately dropped: a stage transition belonging to a deal
     * outside the imported pipelines, or naming a stage the portal has since
     * deleted. Those never resolve, however many times they are re-read.
     *
     * Blocking on skips made the watermark permanently stuck. Stage history
     * finishes PARTIAL on every run — 2 346 of its 193 344 rows point at
     * things that no longer exist — so the minute-by-minute sync re-read all
     * 191 000 transitions every tick, taking ninety seconds to change nothing.
     *
     * A fatal error still blocks it, and so does any record that genuinely
     * failed to write.
     */
    if (!fatal && failed === 0) {
      await this.store.setCursor(
        this.provider.source,
        entity,
        nextWatermark(entity, startedAt, skipped),
      )
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
   * database. Throughput is not the constraint here — correctness is.
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
