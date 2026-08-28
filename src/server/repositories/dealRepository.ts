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
import { SALES_TEAM_NAME_LIKE } from '@/server/domain/employees/roles'
import {
  SELLER_PIPELINE_ROLES,
  type SellerCloseEvent,
  type SellerWonStage,
} from '@/server/domain/analytics/sellerClose'
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

  /**
   * The people the leaderboard is allowed to rank: SELLERS ONLY.
   *
   * WHY THIS QUERY IS RAW SQL AND LIVES HERE
   * The rule itself is in `@/server/domain/employees/roles` and is documented
   * there. This is its Postgres mirror, and it has to be Postgres: the ranking
   * must be computed on the filtered set, so the filter has to happen before
   * a single row reaches the ranking code. Filtering afterwards is what leaves
   * a leaderboard reading 1, 3, 4, 7 — every removed ROP punching a hole in the
   * standings — and it is why the roster crosses the boundary already narrowed
   * rather than tagged.
   *
   * The two facts the rule needs are computed as columns rather than as a role
   * string, so the WHERE clause below reads as the rule itself:
   *   in_sales_team — the department name ends with the (ROP) suffix, matched
   *                   case- and whitespace-tolerantly (the names are hand-typed)
   *                   through `SALES_TEAM_NAME_LIKE`, never a literal here.
   *   is_head       — the employee heads SOME department. Broader than "heads
   *                   their own", deliberately: see EmployeeRoleInput.
   *
   * INACTIVE EMPLOYEES STAY IN, matching `findEmployees`. A seller who left in
   * March still closed March's deals, and hiding them makes March stop adding
   * up. The leaderboard's own zero-row disclosure handles the quiet ones.
   *
   * The excluded counts ride along from the same CTE so the page can state what
   * it left out — "203 sotuvchi; 17 rahbar hisobga olinmadi" is a fact the
   * reader needs, and a second round trip to learn it would be wasteful. They
   * are counted BEFORE the seller filter, which is why they cannot be a window
   * function over the result: windows run after WHERE. `counts` is a single row
   * LEFT JOINed to the sellers, so the counts survive even when the filters
   * leave no seller at all.
   */
  async findLeaderboardRoster(
    filters: {
      readonly departmentIds?: readonly string[]
      readonly employeeIds?: readonly string[]
    } = {},
  ): Promise<LeaderboardRoster> {
    // Scope narrowing lives in the CTE so the excluded counts describe what the
    // user asked for: pick one department and the footnote names that team's
    // ROP, not all seventeen managers in the company.
    const departmentIds = [...(filters.departmentIds ?? [])]
    const employeeIds = [...(filters.employeeIds ?? [])]

    const scope = Prisma.join(
      [
        Prisma.sql`TRUE`,
        ...(departmentIds.length > 0
          ? [Prisma.sql`e."departmentId" = ANY(${departmentIds}::text[])`]
          : []),
        ...(employeeIds.length > 0 ? [Prisma.sql`e."id" = ANY(${employeeIds}::text[])`] : []),
      ],
      ' AND ',
    )

    const rows = await this.prisma.$queryRaw<LeaderboardRosterQueryRow[]>`
      WITH classified AS (
        SELECT
          e."id"                AS employee_id,
          e."fullName"          AS full_name,
          e."departmentId"      AS department_id,
          d."name"              AS department_name,
          (d."name" IS NOT NULL AND lower(btrim(d."name")) LIKE ${SALES_TEAM_NAME_LIKE})
                                AS in_sales_team,
          EXISTS (SELECT 1 FROM "department" h WHERE h."headId" = e."id")
                                AS is_head
        FROM "employee" e
        LEFT JOIN "department" d ON d."id" = e."departmentId"
        WHERE ${scope}
      ),
      counts AS (
        SELECT
          count(*) FILTER (WHERE is_head)::int                          AS managers,
          count(*) FILTER (WHERE NOT is_head AND NOT in_sales_team)::int AS other
        FROM classified
      )
      SELECT
        c.employee_id     AS "employeeId",
        c.full_name       AS "fullName",
        c.department_id   AS "departmentId",
        c.department_name AS "departmentName",
        n.managers        AS "excludedManagers",
        n.other           AS "excludedOther"
      FROM counts n
      LEFT JOIN classified c ON c.in_sales_team AND NOT c.is_head
      ORDER BY c.full_name ASC
    `

    // The LEFT JOIN guarantees at least one row; when there are no sellers it
    // is a row of nulls carrying only the counts.
    const first = rows[0]

    return {
      sellers: rows
        .filter((row) => row.employeeId !== null)
        .map((row) => ({
          id: row.employeeId as string,
          fullName: row.fullName as string,
          departmentId: row.departmentId,
          departmentName: row.departmentName,
        })),
      excludedManagers: first?.excludedManagers ?? 0,
      excludedOther: first?.excludedOther ?? 0,
    }
  }

  /**
   * The WON stage(s) of the sellers' own pipeline, resolved from the schema.
   *
   * NOT `C12:WON`. The portal's stage id is read back and reported, never
   * matched on: the query asks for `category = 'WON'` inside the pipelines
   * whose `role` is in `SELLER_PIPELINE_ROLES`, both of which are OUR
   * normalisation and both of which survive a portal reconfiguration that
   * renames or renumbers the stage. When the portal genuinely stops having such
   * a stage this returns an empty list, and the caller reports the basis as
   * unresolved rather than reporting everybody's closes as zero.
   *
   * Inactive stages stay IN. A stage retired in June still holds June's
   * history, and excluding it would make June stop adding up — the same reason
   * `findLeaderboardRoster` keeps employees who have left.
   */
  async findSellerWonStages(): Promise<SellerWonStage[]> {
    const rows = await this.prisma.dealStage.findMany({
      where: {
        category: 'WON',
        pipeline: { role: { in: [...SELLER_PIPELINE_ROLES] } },
      },
      orderBy: [{ pipeline: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      select: {
        id: true,
        name: true,
        externalId: true,
        pipeline: { select: { name: true } },
      },
    })

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      externalId: row.externalId,
      pipelineName: row.pipeline?.name ?? null,
    }))
  }

  /**
   * Every entry into a seller-won stage across the given windows.
   *
   * WHY HISTORY AND NOT THE DEAL
   * The seller's won stage holds zero deals at rest — a robot moves the deal,
   * the SAME deal id, into Доставка within seconds. `deal_stage_history` is the
   * only surviving trace of the sale, so this reads the history table and joins
   * back to the deal for the assignee and the amount.
   *
   * WHY `revenueOnly` IS NOT DEFAULTED ON HERE
   * `findForAnalysis` forces `countsAsRevenue = true` because it feeds money
   * totals and the portal records every Доставка order a second time in База.
   * This basis counts a seller's ACT, deduplicated by deal id, so the
   * double-count that filter exists to stop cannot arise from the same deal
   * twice. Defaulting it on would instead silently drop any seller close whose
   * deal later landed outside a revenue pipeline — which is a real close, and
   * dropping it is the failure mode this whole module was written to remove.
   * A caller that wants the intersection can still pass `revenueOnly: true`.
   * UNVERIFIED (the local database was unreachable when this was written): that
   * no База deal carries a seller-won history row of its own. If one ever does,
   * its value would be counted here and again under its Доставка twin.
   *
   * WHY THE STAGE IDS ARE RESOLVED FIRST
   * Two round trips instead of one join, on purpose. `deal_stage_history` is
   * indexed on `(stageId, enteredAt)`, which is exactly this query once the ids
   * are literal; expressed as a join through `pipeline.role` the planner has to
   * discover that set first. The stage list is also what the response meta
   * needs, so the second trip is not spent solely on speed.
   *
   * Both the current and comparison windows arrive in one call, and the union
   * window is barely wider than either — the same trade `findForAnalysis`
   * makes. Bucketing each event into its own window is the domain layer's job
   * (`tallySellerCloses`), because that is where it can be unit tested.
   */
  async findSellerCloses(
    periods: readonly Period[],
    filters: DealFilters = {},
  ): Promise<{ stages: SellerWonStage[]; events: SellerCloseEvent[] }> {
    const stages = await this.findSellerWonStages()
    if (stages.length === 0 || periods.length === 0) return { stages, events: [] }

    const start = new Date(Math.min(...periods.map((p) => p.start.getTime())))
    const end = new Date(Math.max(...periods.map((p) => p.end.getTime())))

    const rows = await this.prisma.dealStageHistory.findMany({
      where: {
        stageId: { in: stages.map((s) => s.id) },
        // Half-open, matching `Period` and `containsInstant`. The instants are
        // already Asia/Tashkent boundaries — `resolvePeriod` did that.
        enteredAt: { gte: start, lt: end },
        // Every deal filter the rest of analytics honours, reused rather than
        // restated: employee, department, branch scope, the SALES caller's
        // `restrictToEmployeeId`, stage, source, pipeline, region, status, q.
        deal: this.where(filters),
      },
      select: {
        dealId: true,
        enteredAt: true,
        deal: { select: { employeeId: true, amountMinor: true, currency: true } },
      },
    })

    return {
      stages,
      events: rows.map((row) => ({
        dealId: row.dealId,
        employeeId: row.deal.employeeId,
        enteredAt: row.enteredAt,
        // The deal's CURRENT amount. History rows carry none; see the
        // limitation stated in `domain/analytics/sellerClose`.
        amountMinor: row.deal.amountMinor,
        currency: row.deal.currency,
      })),
    }
  }
}

/** One seller, as the leaderboard roster query returns them. */
export interface LeaderboardRosterEntry {
  readonly id: string
  readonly fullName: string
  readonly departmentId: string | null
  readonly departmentName: string | null
}

export interface LeaderboardRoster {
  /** Everyone the board may rank, in name order. */
  readonly sellers: readonly LeaderboardRosterEntry[]
  /** Department heads left out — ROPs and the heads of the other departments. */
  readonly excludedManagers: number
  /** Staff outside the sales teams left out: registration, operations, NEWGEN. */
  readonly excludedOther: number
}

/** The raw shape, before the null row of a seller-less result is dropped. */
interface LeaderboardRosterQueryRow {
  readonly employeeId: string | null
  readonly fullName: string | null
  readonly departmentId: string | null
  readonly departmentName: string | null
  readonly excludedManagers: number
  readonly excludedOther: number
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
