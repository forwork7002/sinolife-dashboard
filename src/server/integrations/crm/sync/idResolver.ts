/**
 * External-to-internal id resolution.
 *
 * Providers relate records by the SOURCE system's ids — a deal points at
 * `employeeExternalId`, not at our cuid. Turning those into foreign keys means
 * a lookup per reference, which would be one query per field per record if done
 * naively: for 1 600 deals with four references each, over 6 000 round trips.
 *
 * This loads each entity's id map once per sync run and keeps it in memory.
 * Most maps are small and the run is short-lived. The two that are not —
 * `deal` at 415 591 rows and `customer` at ~250 000 — cost roughly 60 MB of
 * strings together, which is the right trade against a quarter of a million
 * extra round trips.
 *
 * Unresolvable references are reported, not silently nulled. A deal whose
 * employee cannot be found is a data problem worth surfacing — quietly dropping
 * the link would remove that deal's revenue from every per-employee figure.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'

export type Entity =
  | 'department'
  | 'employee'
  | 'productCategory'
  | 'product'
  | 'pipeline'
  | 'dealStage'
  | 'salesSource'
  | 'customer'
  | 'deal'
  | 'store'

export class IdResolver {
  private readonly cache = new Map<Entity, Map<string, string>>()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly source: ExternalSourceValue,
  ) {}

  /** Load (or return the cached) externalId -> internal id map for an entity. */
  async map(entity: Entity): Promise<Map<string, string>> {
    const cached = this.cache.get(entity)
    if (cached) return cached

    const rows = await this.query(entity)
    const map = new Map<string, string>()
    for (const row of rows) {
      if (row.externalId) map.set(row.externalId, row.id)
    }

    this.cache.set(entity, map)
    return map
  }

  /**
   * Resolve one reference, or throw.
   *
   * Throwing is intentional: the sync engine isolates the failing record,
   * counts it, and marks the run PARTIAL so the gap is visible.
   */
  async require(entity: Entity, externalId: string): Promise<string> {
    const map = await this.map(entity)
    const id = map.get(externalId)

    if (!id) {
      throw new Error(
        `Unresolved ${entity} reference "${externalId}" from ${this.source}. ` +
          `Sync ${entity} before the entity that references it.`,
      )
    }

    return id
  }

  /** Resolve an optional reference. Absent input yields undefined, not an error. */
  async optional(entity: Entity, externalId?: string): Promise<string | undefined> {
    if (!externalId) return undefined
    const map = await this.map(entity)
    return map.get(externalId)
  }

  /**
   * Resolve only the ids a batch actually references.
   *
   * WHY THIS EXISTS. `map()` loads an entity's WHOLE externalId -> id table and
   * keeps it, which is right for the small reference tables and fatal for the
   * large ones. Stage history references deals, and there are 426 000 of them;
   * building that Map costs roughly 200 MB, and the sync worker runs in a
   * 512 MB container whose Node heap tops out near 258 MB. It died with
   * "Ineffective mark-compacts near heap limit" sixty seconds into every run,
   * restarted, and died again — so stage history never imported at all, and
   * two whole modules were empty in production while the deals table looked
   * fine.
   *
   * A page carries at most a few thousand records, so the lookup it actually
   * needs is a few thousand rows, not the table.
   *
   * IT DELIBERATELY DOES NOT CACHE. The result is a PARTIAL view, and caching
   * it under the same key as the full map would make a later `map()` call
   * return a map that is missing almost everything — a silent wrong answer,
   * which is worse than the slow one. A full map already loaded is reused,
   * because it is complete and strictly better.
   */
  async mapFor(
    entity: Entity,
    externalIds: readonly (string | null | undefined)[],
  ): Promise<Map<string, string>> {
    const cached = this.cache.get(entity)
    if (cached) return cached

    const wanted = [
      ...new Set(externalIds.filter((id): id is string => typeof id === 'string' && id !== '')),
    ]
    if (wanted.length === 0) return new Map()

    const rows = await this.queryIn(entity, wanted)
    const map = new Map<string, string>()
    for (const row of rows) {
      if (row.externalId) map.set(row.externalId, row.id)
    }
    return map
  }

  /**
   * Discard a cached map.
   *
   * Called after writing an entity so that records created in this run are
   * visible to the entities that reference them.
   *
   * Prefer `merge` on the hot path. Discarding the deal map costs a 420 000-row
   * reload, which is nothing in a one-off import and everything in a worker
   * that ticks every sixty seconds.
   */
  invalidate(entity: Entity): void {
    this.cache.delete(entity)
  }

  /**
   * Fold newly-written ids into the cached map instead of reloading it.
   *
   * The long-running sync worker re-reads a handful of changed records per
   * tick. Invalidating after each write made it reload 318 000 contacts and
   * 420 000 deals every minute to learn about six new rows — fifty seconds of
   * a sixty-second budget spent on rows that had not changed.
   *
   * Only ever ADDS entries. A cache that has never seen an id resolves it to
   * undefined, which callers already handle; one that holds a stale id would
   * write a broken foreign key, so nothing here removes or rewrites.
   */
  merge(entity: Entity, rows: readonly { id: string; externalId: string | null }[]): void {
    const cached = this.cache.get(entity)
    if (!cached) return

    for (const row of rows) {
      if (row.externalId) cached.set(row.externalId, row.id)
    }
  }

  /** True when a map is already loaded, so a caller can pick merge over reload. */
  isCached(entity: Entity): boolean {
    return this.cache.has(entity)
  }

  /** `query`, narrowed to a list of external ids. Indexed by the unique key. */
  private async queryIn(
    entity: Entity,
    externalIds: readonly string[],
  ): Promise<{ id: string; externalId: string | null }[]> {
    const where = { externalSource: this.source, externalId: { in: [...externalIds] } }
    const select = { id: true, externalId: true }

    switch (entity) {
      case 'department':
        return this.prisma.department.findMany({ where, select })
      case 'employee':
        return this.prisma.employee.findMany({ where, select })
      case 'productCategory':
        return this.prisma.productCategory.findMany({ where, select })
      case 'product':
        return this.prisma.product.findMany({ where, select })
      case 'pipeline':
        return this.prisma.pipeline.findMany({ where, select })
      case 'dealStage':
        return this.prisma.dealStage.findMany({ where, select })
      case 'salesSource':
        return this.prisma.salesSource.findMany({ where, select })
      case 'customer':
        return this.prisma.customer.findMany({ where, select })
      case 'deal':
        return this.prisma.deal.findMany({ where, select })
      case 'store':
        return this.prisma.store.findMany({ where, select })
      default:
        // Anything not listed falls back to the full map rather than silently
        // resolving nothing — a new entity must not lose its references.
        return this.query(entity)
    }
  }

  private async query(
    entity: Entity,
  ): Promise<{ id: string; externalId: string | null }[]> {
    const where = { externalSource: this.source }
    const select = { id: true, externalId: true }

    switch (entity) {
      case 'department':
        return this.prisma.department.findMany({ where, select })
      case 'employee':
        return this.prisma.employee.findMany({ where, select })
      case 'productCategory':
        return this.prisma.productCategory.findMany({ where, select })
      case 'product':
        return this.prisma.product.findMany({ where, select })
      case 'pipeline':
        return this.prisma.pipeline.findMany({ where, select })
      case 'store':
        return this.prisma.store.findMany({ where, select })
      case 'dealStage':
        return this.prisma.dealStage.findMany({ where, select })
      case 'salesSource':
        return this.prisma.salesSource.findMany({ where, select })
      case 'customer':
        return this.prisma.customer.findMany({ where, select })
      case 'deal':
        return this.prisma.deal.findMany({ where, select })
    }
  }
}
