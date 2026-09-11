/**
 * Deal access.
 *
 * The only layer that queries deals. Everything above it receives domain types.
 *
 * WHERE THE WORK HAPPENS
 * Filtering is pushed into SQL — a period filter, an employee filter and a
 * stage filter all become WHERE clauses, so Postgres uses the composite indexes
 * rather than the application scanning rows it will discard.
 *
 * Aggregation, by contrast, happens in the domain layer on the filtered set.
 * That is a deliberate trade: it keeps every calculation in the pure, tested
 * functions instead of duplicating the rules in SQL where they cannot be unit
 * tested. It is safe because a period query is bounded — one month of deals,
 * not the whole table.
 *
 * The ceiling: roughly 50 000 deals in a single analysis window, at which point
 * the summary aggregations should move into SQL `GROUP BY` while the domain
 * functions stay as the reference implementation the SQL is tested against.
 * At the current scale (1 600 deals over 18 months) that is far off.
 */

import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import type { AnalyticsDeal, AnalyticsDealItem } from '@/server/domain/analytics/sales'
import type { FunnelStageDefinition } from '@/server/domain/analytics/sales'
import type { Period } from '@/server/domain/period/period'
import type { DealStatusValue, PipelineRoleValue } from '@/server/domain/types'

export interface DealFilters {
  readonly employeeIds?: readonly string[]
  readonly departmentIds?: readonly string[]
  readonly stageIds?: readonly string[]
  readonly sourceIds?: readonly string[]
  readonly productIds?: readonly string[]
  readonly pipelineIds?: readonly string[]
  readonly regions?: readonly string[]
  readonly status?: DealStatusValue
  readonly q?: string
  /**
   * Restrict to deals that may contribute money.
   *
   * Defaults to TRUE for every analysis query and FALSE for the browsable
   * deal list. The portal records the same order twice — once in Доставка,
   * once in База ten days later, same code, same amount, 97% of the time — so
   * an unfiltered revenue total is roughly double the truth and looks
   * entirely plausible. The browsable list still shows both, because a user
   * looking up an order needs to find it wherever it lives.
   */
  readonly revenueOnly?: boolean
  /**
   * Authorisation scope — whose rows this caller may read at all.
   *
   * A LIST, because a scope can be a team. Null (or absent) is the whole
   * company; a non-null list is exhaustive and never empty, so an account that
   * narrows to nobody reads nothing rather than everything. Applied HERE
   * rather than in the UI so it cannot be bypassed by calling the API
   * directly, and ANDed with `employeeIds` above rather than replacing it: the
   * caller's own pick narrows the scope, it never widens it.
   */
  readonly restrictToEmployeeIds?: readonly string[] | null
}

/** Columns the analytics layer needs. Selecting less keeps the payload small. */
const ANALYTICS_SELECT = {
  id: true,
  amountMinor: true,
  currency: true,
  status: true,
  stageId: true,
  employeeId: true,
  customerId: true,
  sourceId: true,
  createdAtSource: true,
  closedAt: true,
  stage: { select: { category: true } },
} satisfies Prisma.DealSelect

export class DealRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Build the WHERE clause shared by every deal query.
   *
   * `q` searches the deal title and the customer name — the two fields a user
   * would actually type. Case-insensitive; `contains` rather than full-text
   * because the dataset is small and an index-backed FTS column would be
   * premature here.
   */
  private where(filters: DealFilters, window?: { start: Date; end: Date }): Prisma.DealWhereInput {
    const and: Prisma.DealWhereInput[] = []

    if (window) {
      // Everything that could touch the window: created before it ends, and
      // either still open or closed at/after it starts. Covers deals created
      // in it, closed in it, and spanning it.
      and.push({ createdAtSource: { lt: window.end } })
      and.push({
        OR: [{ closedAt: null }, { closedAt: { gte: window.start } }],
      })
    }

    if (filters.restrictToEmployeeIds?.length) {
      and.push({ employeeId: { in: [...filters.restrictToEmployeeIds] } })
    }
    if (filters.employeeIds?.length) {
      and.push({ employeeId: { in: [...filters.employeeIds] } })
    }
    if (filters.departmentIds?.length) {
      and.push({ employee: { departmentId: { in: [...filters.departmentIds] } } })
    }
    if (filters.stageIds?.length) {
      and.push({ stageId: { in: [...filters.stageIds] } })
    }
    if (filters.sourceIds?.length) {
      and.push({ sourceId: { in: [...filters.sourceIds] } })
    }
    if (filters.pipelineIds?.length) {
      and.push({ pipelineId: { in: [...filters.pipelineIds] } })
    }
    if (filters.regions?.length) {
      and.push({ region: { in: [...filters.regions] } })
    }
    if (filters.revenueOnly) {
      and.push({ countsAsRevenue: true })
    }
    if (filters.productIds?.length) {
      and.push({ items: { some: { productId: { in: [...filters.productIds] } } } })
    }
    if (filters.status) {
      and.push({ status: filters.status })
    }
    if (filters.q) {
      and.push({
        OR: [
          { title: { contains: filters.q, mode: 'insensitive' } },
          { customer: { name: { contains: filters.q, mode: 'insensitive' } } },
        ],
      })
    }

    return and.length > 0 ? { AND: and } : {}
  }

  /**
   * Load the deals relevant to one or more periods.
   *
   * Pass both the current and comparison periods so a single query covers both
   * — two round trips for one dashboard render would be wasteful, and the
   * union window is barely larger than either alone.
   */
  async findForAnalysis(
    periods: readonly Period[],
    filters: DealFilters = {},
  ): Promise<AnalyticsDeal[]> {
    if (periods.length === 0) return []

    const start = new Date(Math.min(...periods.map((p) => p.start.getTime())))
    const end = new Date(Math.max(...periods.map((p) => p.end.getTime())))

    // Revenue-only unless the caller says otherwise. Analysis is what feeds
    // every money figure, so this is the default that has to be safe.
    const where = this.where({ revenueOnly: true, ...filters }, { start, end })

    /*
      IDENTICAL CONCURRENT READS SHARE ONE QUERY.

      Opening the sales screen fires five endpoints at once, and three of them
      — sales, products, sources — need exactly this fetch with exactly these
      arguments. Three separate HTTP requests land in the same Node process
      within milliseconds, and each one walked the same tens of thousands of
      rows on a database with one vCPU. Under this map the first builds the
      promise and the other two await it.

      IN-FLIGHT ONLY, NOT A CACHE. The entry is deleted the moment the promise
      settles, so nothing is ever served stale — the sharing window is the
      query's own duration. And the KEY IS THE WHERE CLAUSE ITSELF, serialised:
      whatever narrows the SQL — the window, the filters, the caller's
      authorisation scope — narrows the key with it, so two differently-scoped
      callers can never share a result by construction rather than by a list
      of fields somebody has to keep complete.

      Each caller gets its own top-level array (`slice`), because a shared
      array handed to independent consumers is a mutation race waiting for the
      first `.sort` without a spread. The elements are readonly-typed and
      shared deliberately.
    */
    const key = JSON.stringify(where)
    const inFlight = this.analysisInFlight.get(key)
    if (inFlight) return inFlight.then((rows) => rows.slice())

    const load = this.prisma.deal
      .findMany({ where, select: ANALYTICS_SELECT })
      .then((rows) => rows.map(toAnalyticsDeal))
      .finally(() => this.analysisInFlight.delete(key))

    this.analysisInFlight.set(key, load)
    return load.then((rows) => rows.slice())
  }

  /** See findForAnalysis. Keyed by the serialised where clause. */
  private readonly analysisInFlight = new Map<string, Promise<AnalyticsDeal[]>>()

  /** See findItemsForDeals. */
  private readonly itemsInFlight = new Map<string, Promise<AnalyticsDealItem[]>>()

  /**
   * Stage definitions for the funnel, in pipeline order.
   *
   * Scoped to revenue pipelines by default. The portal defines 108 stages
   * across nine pipelines, and a funnel listing all of them is not a funnel —
   * it is a five-thousand-pixel column in which the twelve rows that matter
   * are invisible. Registration, triage and HR have their own stages and no
   * business being on a sales funnel.
   */
  async findStages(
    options: { pipelineRoles?: readonly PipelineRoleValue[] } = {},
  ): Promise<FunnelStageDefinition[]> {
    const roles = options.pipelineRoles ?? ['REVENUE']

    const rows = await this.prisma.dealStage.findMany({
      where: { isActive: true, pipeline: { role: { in: [...roles] } } },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, sortOrder: true, category: true },
    })
    return rows
  }

}

function toAnalyticsDeal(row: {
  id: string
  amountMinor: bigint
  currency: string
  status: DealStatusValue
  stageId: string
  employeeId: string
  customerId: string | null
  sourceId: string | null
  createdAtSource: Date
  closedAt: Date | null
  stage: { category: 'NEW' | 'IN_PROGRESS' | 'WON' | 'LOST' }
}): AnalyticsDeal {
  return {
    id: row.id,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    stageId: row.stageId,
    stageCategory: row.stage.category,
    employeeId: row.employeeId,
    customerId: row.customerId ?? undefined,
    sourceId: row.sourceId ?? undefined,
    createdAtSource: row.createdAtSource,
    closedAt: row.closedAt ?? undefined,
  }
}
