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
   * Discard a cached map.
   *
   * Called after writing an entity so that records created in this run are
   * visible to the entities that reference them.
   */
  invalidate(entity: Entity): void {
    this.cache.delete(entity)
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
