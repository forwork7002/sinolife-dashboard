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

import type { Prisma, PrismaClient } from '@/generated/prisma/client'
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
   * Authorisation scope. When set, only this employee's deals are visible.
   * Applied HERE rather than in the UI so it cannot be bypassed by calling the
   * API directly.
   */
  readonly restrictToEmployeeId?: string
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

    if (filters.restrictToEmployeeId) {
      and.push({ employeeId: filters.restrictToEmployeeId })
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

    const rows = await this.prisma.deal.findMany({
      // Revenue-only unless the caller says otherwise. Analysis is what feeds
      // every money figure, so this is the default that has to be safe.
      where: this.where({ revenueOnly: true, ...filters }, { start, end }),
      select: ANALYTICS_SELECT,
    })

    return rows.map(toAnalyticsDeal)
  }

  /** Line items for the given deals. Used by product analytics. */
  async findItemsForDeals(dealIds: readonly string[]): Promise<AnalyticsDealItem[]> {
    if (dealIds.length === 0) return []

    const rows = await this.prisma.dealItem.findMany({
      where: { dealId: { in: [...dealIds] } },
      select: { dealId: true, productId: true, quantity: true, totalMinor: true },
    })

    return rows
  }

  /**
   * Paginated deal list for the table.
   *
   * Pagination and sorting execute in SQL. Loading thousands of rows into the
   * browser to slice them there would be both slow and a data-exposure
   * problem — the client would receive rows the user may not be allowed to see.
   */
  async findPage(options: {
    filters: DealFilters
    window?: { start: Date; end: Date }
    page: number
    pageSize: number
    sort: 'createdAtSource' | 'closedAt' | 'amountMinor' | 'title' | 'status'
    order: 'asc' | 'desc'
  }) {
    const where = this.where(options.filters, options.window)

    const [totalItems, rows] = await Promise.all([
      this.prisma.deal.count({ where }),
      this.prisma.deal.findMany({
        where,
        // Secondary key on id keeps paging stable when the sort column ties;
        // without it, rows can repeat or vanish between pages.
        orderBy: [{ [options.sort]: options.order }, { id: 'asc' }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        select: {
          id: true,
          title: true,
          amountMinor: true,
          currency: true,
          status: true,
          createdAtSource: true,
          closedAt: true,
          employee: { select: { id: true, fullName: true } },
          stage: { select: { id: true, name: true, category: true } },
          customer: { select: { id: true, name: true } },
          source: { select: { id: true, name: true } },
          items: {
            select: { product: { select: { id: true, name: true } } },
            take: 3,
          },
        },
      }),
    ])

    return { totalItems, rows }
  }

  async findById(id: string, filters: DealFilters = {}) {
    return this.prisma.deal.findFirst({
      where: { AND: [{ id }, this.where(filters)] },
      include: {
        employee: { select: { id: true, fullName: true, position: true } },
        stage: true,
        customer: true,
        source: true,
        items: { include: { product: { select: { id: true, name: true } } } },
        payments: { orderBy: { paidAt: 'asc' } },
      },
    })
  }

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
