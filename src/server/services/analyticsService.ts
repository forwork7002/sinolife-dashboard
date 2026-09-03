/**
 * Analytics orchestration.
 *
 * Loads filtered data through the repositories, hands it to the pure domain
 * functions, and shapes the result into transport DTOs. No business rule lives
 * here — if a calculation appears in this file, it belongs in
 * `src/server/domain/analytics` where it can be unit tested.
 */

import { type MoneyDto, toMoneyDto } from '@/server/domain/money/money'
import {
  type Delta,
  type DeltaDto,
  growth,
  SHARE_DECIMALS,
  roundPercent,
  toDeltaDto,
} from '@/server/domain/analytics/metrics'
import {
  type AnalyticsDeal,
  type SalesSummary,
  groupRevenue,
  productRevenue,
  revenueTrend,
  stageFunnel,
  summarizeDeals,
} from '@/server/domain/analytics/sales'
import {
  type EmployeePerformance,
  type KpiEvaluation,
  buildLeaderboard,
  evaluateKpi,
  kpiWindow,
  overallAchievementPercent,
} from '@/server/domain/analytics/performance'
import {
  type AnyLeaderboardMetric,
  SELLER_PIPELINE_ROLES,
  type SellerWonStage,
  emptySellerCloseTotals,
  isSellerCloseMetric,
  rankBySellerClose,
  tallySellerCloses,
} from '@/server/domain/analytics/sellerClose'
import {
  type BranchScopeDto,
  type EmployeeScopeFilter,
  UnknownBranchError,
  branchRequestFrom,
  narrowEmployeeIds,
} from '@/server/domain/employees/branches'
import { type Period, previousEquivalent, toPeriodDto } from '@/server/domain/period/period'
import { DEFAULT_BRANCH } from '@/server/config/env'
import { ApiError } from '@/server/http/errors'
import type { DealRepository, DealFilters } from '@/server/repositories/dealRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'

/**
 * Deal filters plus the resolved FILIAL scope.
 *
 * `restrictToEmployeeIds` is branch ∩ authorisation, already intersected — one
 * list that carries both restrictions, so a repository honouring this single
 * field is automatically correct for a SALES caller too. Null means
 * unrestricted; it is never an empty array, because every repository tests id
 * lists with `?.length` and an empty one would read as "no filter" and widen
 * the query to the whole company. See `NO_EMPLOYEE_IN_SCOPE`.
 */
export interface AnalyticsFilters extends DealFilters, EmployeeScopeFilter {}

export interface AnalyticsContext {
  readonly period: Period
  readonly comparison: Period & { readonly isTruncated: boolean }
  readonly currency: string
  readonly filters: AnalyticsFilters
  readonly now: Date
}

/** A context together with the scope block its response must print. */
export interface ScopedAnalyticsContext {
  readonly context: AnalyticsContext
  readonly branchScope: BranchScopeDto
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** A SalesSummary with the money crossed into display form. */
export interface SalesSummaryDto {
  readonly revenue: MoneyDto
  readonly pipelineValue: MoneyDto
  readonly averageDeal: MoneyDto | null
  readonly dealsCreated: number
  readonly dealsWon: number
  readonly dealsLost: number
  readonly dealsOpen: number
  readonly conversionRatePercent: number | null
}

export interface KpiCardDto {
  readonly key: string

  /**
   * The number to DISPLAY, in the unit the card names.
   *
   * Money is in soʻm, not tiyin. That is worth stating because it used to be
   * the other way round — `value` carried minor units while `money.amount`
   * carried major, and the two overview tiles that formatted `value` rendered
   * every amount a hundred times too large. The average won deal read 158 mln
   * where the truth was 1.58 mln, and the open pipeline read 759 mlrd against
   * a real 7.59 mlrd. Both looked plausible enough to go unchallenged.
   *
   * One rule now: `value` is always what the reader should see. Anything that
   * needs exactness reads `money.amountMinor`, which is still a string of
   * minor units and still the only lossless form.
   */
  readonly value: number | null

  readonly money?: MoneyDto
  readonly unit: 'money' | 'count' | 'percent'
  readonly delta: DeltaDto
}

/**
 * One row of the standings.
 *
 * Named here rather than inferred so the sellers-only contract has a place to
 * be read: every row of this type is a salesperson, never a ROP.
 */
export interface LeaderboardRowDto {
  readonly rank: number
  readonly tied: boolean
  readonly employeeId: string
  readonly fullName: string
  readonly departmentName: string | null
  readonly revenue: MoneyDto
  readonly dealsWon: number
  readonly conversionPercent: number | null
  readonly kpiAchievementPercent: number | null
  /**
   * The SELLER-CLOSE basis, on EVERY row whichever metric is active.
   *
   * Deliberately not gated on `?metric=`: a reader comparing "5.7 mlrd
   * delivered" against "4.1 mlrd closed" learns something real about the month,
   * and a page that could only ever show one of the two would invite the reader
   * to assume they are the same number seen from two angles. They are not — see
   * `domain/analytics/sellerClose`.
   *
   * NULL means the seller pipeline's won stage could not be resolved, so
   * nothing was measured. It never means zero. `meta.sellerCloseBasis.resolved`
   * carries the same fact once, for the page as a whole.
   */
  readonly closedCount: number | null
  readonly closedValue: MoneyDto | null
  readonly delta: DeltaDto
  readonly value: number | null
}

/**
 * How the seller-close figures on this response were arrived at.
 *
 * Printed because the basis is a CHOICE, not a fact of the data: it counts
 * entries into a stage resolved by pipeline ROLE, and it values them at the
 * deal's amount as it stands today. Both of those can be wrong in ways a bare
 * number would hide — a reconfigured portal resolving to no stage at all, an
 * amount edited after the sale — so both are stated on every response instead
 * of living only in a comment.
 */
export interface SellerCloseBasisDto {
  /**
   * False when no WON stage exists in any seller pipeline. Every `closedCount`
   * and `closedValue` on the response is then null: unmeasured, not zero.
   */
  readonly resolved: boolean
  /** The pipeline roles searched — how the stage was found, in one field. */
  readonly pipelineRoles: readonly string[]
  /** The stages that matched. `externalId` is reported, never matched on. */
  readonly stages: readonly {
    readonly id: string
    readonly name: string
    readonly externalId: string | null
    readonly pipelineName: string | null
  }[]
  /**
   * Which amount `closedValue` sums. `deal_current_amount` is the deal's value
   * TODAY: `deal_stage_history` carries no amount, so an amount edited after
   * the seller closed the deal moves this figure. There is no column that would
   * let it be otherwise.
   */
  readonly amountBasis: 'deal_current_amount'
}

/**
 * What the board left out, so the page can say so instead of implying it ranks
 * everyone. A leaderboard that quietly drops 85 of 288 people and does not
 * mention it is not more honest than one that ranks the wrong people.
 */
export interface LeaderboardScopeDto {
  /** Literal, not a boolean: a future board may rank another population. */
  readonly scope: 'sellers'
  /** How many sellers were ranked, zeros included. */
  readonly sellers: number
  /** Department heads excluded — the ROPs and the other departments' heads. */
  readonly excludedManagers: number
  /** Everyone else excluded: registration, operations, NEWGEN, Тошкент онлайн. */
  readonly excludedOther: number
}

export interface OverviewDto {
  readonly cards: readonly KpiCardDto[]
  readonly trend: readonly {
    readonly date: string
    readonly revenue: number
    readonly dealsWon: number
    readonly dealsCreated: number
  }[]
  readonly kpiAchievementPercent: number | null
  readonly activeEmployees: number
  readonly lastSyncedAt: string | null
}

function moneyCard(
  key: string,
  current: SalesSummary,
  previous: SalesSummary,
  pick: (s: SalesSummary) => { amountMinor: bigint; currency: string } | null,
): KpiCardDto {
  const now = pick(current)
  const then = pick(previous)

  const dto = now ? toMoneyDto(now) : undefined

  return {
    key,
    // Major units — see the note on KpiCardDto.value. The delta below still
    // compares minor units, where the division is exact.
    value: dto ? dto.amount : null,
    money: dto,
    unit: 'money',
    delta: toDeltaDto(growth(now?.amountMinor ?? null, then?.amountMinor ?? null)),
  }
}

function countCard(
  key: string,
  current: number,
  previous: number,
): KpiCardDto {
  return {
    key,
    value: current,
    unit: 'count',
    delta: toDeltaDto(growth(current, previous)),
  }
}

function percentCard(
  key: string,
  current: number | null,
  previous: number | null,
): KpiCardDto {
  return {
    key,
    value: current === null ? null : roundPercent(current),
    unit: 'percent',
    delta: toDeltaDto(growth(current, previous)),
  }
}

/**
 * Describe the seller-close basis for the response meta.
 *
 * `resolved` is `stages.length > 0` and nothing subtler: the repository asked
 * for the WON stages of the pipelines carrying `SELLER_PIPELINE_ROLES`, and an
 * empty answer means the portal no longer has one — a reconfiguration, a role
 * reassigned, a funnel retired. Every closed figure on the response is null in
 * that state, so this flag is how a page knows to say "oʻlchab boʻlmadi"
 * instead of drawing a row of zeros.
 */
function toSellerCloseBasisDto(stages: readonly SellerWonStage[]): SellerCloseBasisDto {
  return {
    resolved: stages.length > 0,
    pipelineRoles: [...SELLER_PIPELINE_ROLES],
    stages: stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      externalId: stage.externalId,
      pipelineName: stage.pipelineName,
    })),
    amountBasis: 'deal_current_amount',
  }
}

// ---------------------------------------------------------------------------

export class AnalyticsService {
  constructor(
    private readonly deals: DealRepository,
    private readonly reference: ReferenceRepository,
  ) {}

  /** Build the context both periods share. */
  static context(
    period: Period,
    currency: string,
    filters: AnalyticsFilters,
    now: Date,
  ): AnalyticsContext {
    return { period, comparison: previousEquivalent(period), currency, filters, now }
  }

  /**
   * The same context, with the FILIAL scope resolved into it.
   *
   * This is what a route should call. It does three things a route must not be
   * trusted to remember:
   *
   *  1. Applies the DEFAULT branch when `?filial=` is absent. Absent is not
   *     "all" — see the schema note in `http/queryParams`.
   *  2. INTERSECTS the branch with the caller's authorisation scope. Two
   *     restrictions narrow; they never widen. A SALES user opening the Навоий
   *     view sees themselves inside Навоий, and a Тошкент salesperson opening
   *     it sees nothing — not their own numbers under someone else's heading.
   *     `scope` is still spread AFTER the query, so a hand-written query string
   *     cannot dislodge `restrictToEmployeeId` either.
   *  3. Turns an unknown branch name into a 400 that lists the real ones,
   *     rather than a full-company answer labelled with a branch that does not
   *     exist.
   */
  async scopedContext(
    period: Period,
    currency: string,
    query: DealFilters & { readonly filial?: string },
    scope: { readonly restrictToEmployeeId?: string },
    now: Date,
  ): Promise<ScopedAnalyticsContext> {
    const request = branchRequestFrom(query.filial, DEFAULT_BRANCH)

    const resolved = await this.reference
      .resolveBranchScope(request, scope.restrictToEmployeeId)
      .catch((error: unknown) => {
        if (error instanceof UnknownBranchError) {
          throw ApiError.validation('Bunday filial yoʻq.', [
            {
              path: 'filial',
              message: `Mavjud filiallar: ${error.known.join(', ')} yoki "all".`,
            },
          ])
        }
        throw error
      })

    return {
      context: AnalyticsService.context(
        period,
        currency,
        { ...query, ...scope, restrictToEmployeeIds: resolved.employeeIds },
        now,
      ),
      branchScope: resolved.meta,
    }
  }

  /**
   * One query covering the current and comparison windows.
   *
   * `extra` widens it to any further span the caller must summarise over —
   * today that is the KPI plan windows, which are not slices of the report
   * window and would otherwise be summed over deals that were never fetched.
   */
  private load(
    ctx: AnalyticsContext,
    extra: readonly Period[] = [],
  ): Promise<AnalyticsDeal[]> {
    return this.deals.findForAnalysis([ctx.period, ctx.comparison, ...extra], ctx.filters)
  }

  async overview(ctx: AnalyticsContext): Promise<OverviewDto> {
    /**
     * Targets follow the scope, or the headline scores one branch's results
     * against two branches' quotas. `findKpisForPeriod` narrows in SQL when
     * given ids; a company-wide target (`employeeId: null`) is not a branch
     * target and drops out with them. The table holds no rows at all today, so
     * this is the shape being right rather than a number changing.
     *
     * READ FIRST, because the deal query has to be wide enough to cover the
     * PLAN windows as well as the report window: a target is scored over its
     * own period, never over whatever the reader selected. See `kpiWindow`.
     */
    const kpis = await this.reference.findKpisForPeriod(
      ctx.period,
      ctx.filters.restrictToEmployeeIds ?? undefined,
    )
    const kpiWindows = kpis.map((kpi) => kpiWindow(kpi, ctx.period.timeZone))

    const [all, employees, lastSyncedAt] = await Promise.all([
      this.load(ctx, kpiWindows),
      this.reference.findEmployees(),
      this.reference.findLastSuccessfulSync(),
    ])

    const current = summarizeDeals(all, ctx.period, ctx.currency)
    const previous = summarizeDeals(all, ctx.comparison, ctx.currency)

    const evaluations = kpis.map((kpi, index) =>
      evaluateKpi(
        kpi,
        summarizeDeals(
          kpi.employeeId ? all.filter((d) => d.employeeId === kpi.employeeId) : all,
          kpiWindows[index]!,
          ctx.currency,
        ),
        ctx.period.timeZone,
        ctx.now,
      ),
    )

    const trend = revenueTrend(all, ctx.period, ctx.currency).map((point) => ({
      date: point.bucketStart.toISOString(),
      revenue: Number(point.revenue.amountMinor) / 100,
      dealsWon: point.dealsWon,
      dealsCreated: point.dealsCreated,
    }))

    return {
      cards: [
        moneyCard('revenue', current, previous, (s) => s.revenue),
        countCard('dealsWon', current.dealsWon, previous.dealsWon),
        countCard('dealsCreated', current.dealsCreated, previous.dealsCreated),
        moneyCard('averageDeal', current, previous, (s) => s.averageDeal),
        percentCard('conversion', current.conversionRatePercent, previous.conversionRatePercent),
        countCard('dealsOpen', current.dealsOpen, previous.dealsOpen),
        moneyCard('pipeline', current, previous, (s) => s.pipelineValue),
      ],
      trend,
      kpiAchievementPercent: overallAchievementPercent(evaluations),
      // In-scope headcount, not company headcount: this tile sits beside
      // branch-scoped revenue and would otherwise count 288 people against
      // 109 people's numbers.
      activeEmployees: employees.filter(
        (e) =>
          e.isActive &&
          (!ctx.filters.restrictToEmployeeIds ||
            ctx.filters.restrictToEmployeeIds.includes(e.id)),
      ).length,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    }
  }

  /**
   * The trend and the summary. Nothing else, because nothing else is read.
   *
   * It also returned `bySource` and `byProduct` — two more full passes over the
   * analysis set, and a `findItemsForDeals` for the second — while the caller's
   * own contract declares two keys: `interface SalesPayload { trend; summary }`
   * in SalesPage. Those two cuts are served by `/analytics/sources` and
   * `/analytics/products`, which the same screen already asks for separately
   * and does render. This endpoint was computing them a second time and putting
   * them in a payload nothing unpacked.
   *
   * The line-item read went with them. It is shared with `/analytics/products`
   * through the in-flight map, so the database saves nothing here — the saving
   * is a pass and an allocation on the one web core, which is the core the next
   * navigation's server render has to wait for.
   */
  async sales(ctx: AnalyticsContext) {
    const all = await this.load(ctx)

    return {
      trend: revenueTrend(all, ctx.period, ctx.currency).map((p) => ({
        date: p.bucketStart.toISOString(),
        revenue: Number(p.revenue.amountMinor) / 100,
        dealsWon: p.dealsWon,
        dealsCreated: p.dealsCreated,
      })),
      summary: summarizeDeals(all, ctx.period, ctx.currency),
    }
  }

  /**
   * Product performance, with names resolved.
   *
   * A LINE-ITEM basis, which is not the same number as the headline.
   *
   * Both count only deals won in the period, but they add up different things:
   * the headline sums `deal.amountMinor`, this sums `deal_item.totalMinor`.
   * Across one month they differ by 5.5 mln soʻm over 143 of 3,574 deals —
   * mostly one-tiyin roundings, plus six real Bitrix24 mismatches including a
   * 1.5 mln deal carrying no line items at all.
   *
   * Both compact-format to "5.7 mlrd", so the gap is invisible on screen and
   * appears the moment someone exports. Stating the basis is the fix; forcing
   * them equal would mean choosing which of the portal's two records to
   * disbelieve.
   */
  async products(ctx: AnalyticsContext) {
    const all = await this.load(ctx)
    const [items, catalogue] = await Promise.all([
      this.deals.findItemsForDeals(all.map((d) => d.id)),
      this.reference.findProducts({ includeInactive: true }),
    ])

    const nameById = new Map(catalogue.map((p) => [p.id, p.name]))

    /*
      NO COMPARISON PASS. `ProductRow` on the page carries productId, name,
      revenue, units and sharePercent — no delta, and the table renders exactly
      those. The second `productRevenue` over the same set, plus the map built
      from it, answered a column that does not exist.

      `/analytics/sources` beside this one is the contrast: `SourceRow` DOES
      declare a delta and the table draws it as the «growth» column, so that
      endpoint keeps its comparison. The cost is earned there and was not here.
    */
    const current = productRevenue(all, items, ctx.period, ctx.currency)

    const unitsById = new Map<string, number>()
    const wonIds = new Set(
      all
        .filter(
          (d) =>
            d.status === 'WON' &&
            d.closedAt !== undefined &&
            d.closedAt >= ctx.period.start &&
            d.closedAt < ctx.period.end,
        )
        .map((d) => d.id),
    )
    for (const item of items) {
      if (!wonIds.has(item.dealId)) continue
      unitsById.set(item.productId, (unitsById.get(item.productId) ?? 0) + item.quantity)
    }

    return current.map((row) => ({
      productId: row.key,
      // Never the raw id: an unresolvable product is stated as such rather
      // than leaking an internal identifier into a business report.
      name: nameById.get(row.key) ?? 'Oʻchirilgan mahsulot',
      revenue: toMoneyDto(row.revenue),
      dealsWon: row.dealsWon,
      units: unitsById.get(row.key) ?? 0,
      sharePercent:
        row.sharePercent === null ? null : roundPercent(row.sharePercent, SHARE_DECIMALS),
    }))
  }

  /** Revenue by lead source, with names resolved. */
  async sources(ctx: AnalyticsContext) {
    const [all, catalogue] = await Promise.all([this.load(ctx), this.reference.findSources()])
    const nameById = new Map(catalogue.map((s) => [s.id, s.name]))

    const current = groupRevenue(all, ctx.period, ctx.currency, (d) => d.sourceId)
    const previous = groupRevenue(all, ctx.comparison, ctx.currency, (d) => d.sourceId)
    const previousById = new Map(previous.map((row) => [row.key, row.revenue.amountMinor]))

    return current.map((row) => ({
      sourceId: row.key,
      name: row.key === 'unknown' ? 'Manba koʻrsatilmagan' : (nameById.get(row.key) ?? row.key),
      revenue: toMoneyDto(row.revenue),
      dealsWon: row.dealsWon,
      dealsTotal: row.dealsTotal,
      sharePercent:
        row.sharePercent === null ? null : roundPercent(row.sharePercent, SHARE_DECIMALS),
      conversionPercent:
        row.dealsTotal === 0 ? null : roundPercent((row.dealsWon / row.dealsTotal) * 100),
      delta: toDeltaDto(growth(row.revenue.amountMinor, previousById.get(row.key) ?? null)),
    }))
  }

  async funnel(ctx: AnalyticsContext) {
    const [all, stages] = await Promise.all([this.load(ctx), this.deals.findStages()])
    return stageFunnel(all, stages, ctx.period, ctx.currency)
  }

  /**
   * Per-employee performance, with KPI attainment attached.
   *
   * The roster comes from the employee table rather than from the deals, so a
   * salesperson who closed nothing still appears — with a zero, which is the
   * fact a manager needs, rather than being silently absent.
   */
  async employees(
    ctx: AnalyticsContext,
    restrictToEmployeeId?: string,
  ): Promise<{
    rows: readonly (Omit<EmployeePerformance, 'current' | 'previous' | 'revenueDelta'> & {
      current: SalesSummaryDto
      previous: SalesSummaryDto
      revenueDelta: DeltaDto
      fullName: string
      position: string | null
      departmentName: string | null
      isActive: boolean
      kpiAchievementPercent: number | null
      /**
       * Deals this employee CLOSED in the period, and their value.
       *
       * A second basis alongside `current.revenue`, never a replacement for it:
       * revenue is what was delivered, this is what the seller closed, and last
       * August the two sets overlapped in only 1 152 of 5 375 deals. Null means
       * the basis could not be resolved — see `sellerCloseBasis` below.
       *
       * Current period only, and top-level rather than inside `current`, because
       * `SalesSummary` is the delivered-revenue summary and folding a different
       * basis into it is exactly the silent blend this work exists to prevent.
       */
      closedCount: number | null
      closedValue: MoneyDto | null
    })[]
    /** How the two fields above were arrived at. Printed on every response. */
    sellerCloseBasis: SellerCloseBasisDto
  }> {
    const [all, roster, closes] = await Promise.all([
      this.load(ctx),
      this.reference.findEmployees(),
      /**
       * The seller-close basis rides the SAME filters as the deal load, so the
       * branch scope, the department filter and a SALES caller's own-row
       * restriction narrow both bases identically. A figure that honoured one
       * filter and not the other would be worse than no figure.
       */
      this.deals.findSellerCloses([ctx.period, ctx.comparison], ctx.filters),
    ])

    const sellerCloseBasis = toSellerCloseBasisDto(closes.stages)
    const closedByEmployee = tallySellerCloses(closes.events, ctx.period, ctx.currency)

    /**
     * Narrow the roster by BOTH filters the caller can set.
     *
     * The department filter was ignored here, and the leaderboard's only
     * filter is a department one: choosing a 27-person team still returned all
     * 288 employees, 276 of them zeros, with the podium and the ranking
     * computed against the whole company. The control appeared to do nothing,
     * which is worse than not offering it.
     *
     * Authorisation scope still wins over both: a SALES caller sees exactly
     * one row regardless of what they asked for.
     */
    const pickedEmployees = ctx.filters.employeeIds?.length
      ? roster.filter((e) => ctx.filters.employeeIds!.includes(e.id))
      : roster

    const requested = ctx.filters.departmentIds?.length
      ? pickedEmployees.filter(
          (e) => e.departmentId !== null && ctx.filters.departmentIds!.includes(e.departmentId),
        )
      : pickedEmployees

    /**
     * The FILIAL narrows the roster too, not only the deals.
     *
     * The deal query is scoped in SQL, so an out-of-branch person would already
     * carry no revenue — but they would still be a ROW, and a table of 288
     * people with 179 zeros under a heading that says "Навоий filiali" is a
     * different lie from the one the scope was built to stop. Null means
     * unrestricted; a non-null list is never empty.
     */
    const inBranch = ctx.filters.restrictToEmployeeIds
      ? requested.filter((e) => ctx.filters.restrictToEmployeeIds!.includes(e.id))
      : requested

    const scoped = restrictToEmployeeId
      ? inBranch.filter((e) => e.id === restrictToEmployeeId)
      : inBranch

    const { employeePerformance } = await import('@/server/domain/analytics/performance')
    const performance = employeePerformance(
      all,
      scoped.map((e) => e.id),
      ctx.period,
      ctx.comparison,
      ctx.currency,
    )

    const kpis = await this.reference.findKpisForPeriod(
      ctx.period,
      scoped.map((e) => e.id),
    )

    /*
      A target is scored over ITS OWN period, not the report window — see
      `kpiWindow`. That span is not necessarily inside `all`, which was fetched
      for the report and comparison windows, so the plan's deals are read
      separately rather than summed over rows that were never loaded.

      A second query only when there are targets to score. There are none in
      the portal today, so this normally costs nothing at all.
    */
    const kpiWindows = kpis.map((kpi) => kpiWindow(kpi, ctx.period.timeZone))
    const kpiDeals = kpiWindows.length
      ? await this.deals.findForAnalysis(kpiWindows, ctx.filters)
      : []

    const byEmployee = new Map<string, KpiEvaluation[]>()
    kpis.forEach((kpi, index) => {
      if (!kpi.employeeId) return
      const summary = summarizeDeals(
        kpiDeals.filter((d) => d.employeeId === kpi.employeeId),
        kpiWindows[index]!,
        ctx.currency,
      )
      const list = byEmployee.get(kpi.employeeId) ?? []
      list.push(evaluateKpi(kpi, summary, ctx.period.timeZone, ctx.now))
      byEmployee.set(kpi.employeeId, list)
    })

    const meta = new Map(scoped.map((e) => [e.id, e]))

    /**
     * Domain money crosses to the client HERE, or it does not cross at all.
     *
     * `SalesSummary` carries `Money` — a bigint in minor units — and the JSON
     * layer serialises that bigint as a string with no `amount` field. This
     * method used to spread the row as-is, so the employees table called
     * `formatCompactUzs(revenue.amount)` on undefined and printed a literal
     * "NaN" in every money cell of all 288 rows, in both themes, with all the
     * share bars at zero width. Structure and the leaderboard already mapped
     * through `toMoneyDto`; this was the one path that forgot.
     */
    const summaryDto = (s: SalesSummary) => ({
      revenue: toMoneyDto(s.revenue),
      pipelineValue: toMoneyDto(s.pipelineValue),
      averageDeal: s.averageDeal === null ? null : toMoneyDto(s.averageDeal),
      dealsCreated: s.dealsCreated,
      dealsWon: s.dealsWon,
      dealsLost: s.dealsLost,
      dealsOpen: s.dealsOpen,
      conversionRatePercent:
        s.conversionRatePercent === null ? null : roundPercent(s.conversionRatePercent),
    })

    return {
      rows: performance.map((row) => {
        const employee = meta.get(row.employeeId)!
        /**
         * Absent from the tally is a real zero — this seller closed nothing in
         * the window — but only once the basis resolved. An UNRESOLVED basis
         * measured nobody, and printing zero for all of them would read as a
         * company that stopped selling.
         */
        const closed = sellerCloseBasis.resolved
          ? (closedByEmployee.get(row.employeeId) ?? emptySellerCloseTotals(ctx.currency))
          : null

        return {
          ...row,
          current: summaryDto(row.current),
          previous: summaryDto(row.previous),
          revenueDelta: toDeltaDto(row.revenueDelta),
          fullName: employee.fullName,
          position: employee.position,
          departmentName: employee.departmentName,
          isActive: employee.isActive,
          kpiAchievementPercent: overallAchievementPercent(
            byEmployee.get(row.employeeId) ?? [],
          ),
          closedCount: closed === null ? null : closed.closedCount,
          closedValue: closed === null ? null : toMoneyDto(closed.closedValue),
        }
      }),
      sellerCloseBasis,
    }
  }

  /**
   * The standings — SELLERS ONLY.
   *
   * WHAT THIS FIXES
   * The board used to rank the entire 288-person roster, and the entire roster
   * is not a sales force. First place over the last thirty days was the head of
   * Операцион with 575.7 mln and second was a ROP with 235.3 mln; the best
   * seller on the page, 154 Marjona Xayrullayeva with 217.6 mln, was third on a
   * ranking that exists to find her. Managers carry their team's closed deals,
   * so on any revenue metric they will always outrank the people who did the
   * selling. The rule that excludes them is documented in
   * `@/server/domain/employees/roles`.
   *
   * WHY THE ROSTER IS FETCHED FIRST
   * `employees()` already narrows by `filters.employeeIds`, so handing it the
   * seller ids narrows both the roster AND the deal query — Postgres stops
   * loading deals belonging to people who cannot appear. Everything downstream
   * then works on sellers only: `buildLeaderboard` numbers 1..n with no holes,
   * ties keep sharing a rank, and `teamSharePercent` becomes a share of what
   * the SELLERS earned rather than of a total inflated by their managers.
   */
  async leaderboard(
    ctx: AnalyticsContext,
    metric: AnyLeaderboardMetric,
  ): Promise<{
    rows: readonly LeaderboardRowDto[]
    scope: LeaderboardScopeDto
    sellerCloseBasis: SellerCloseBasisDto
  }> {
    /**
     * The board ranks the BRANCH, not the company.
     *
     * The scope is folded into the roster's own id filter rather than applied
     * afterwards, for the same reason the seller rule is: rank after filtering,
     * or the standings read 1, 3, 4, 7 with a hole wherever an out-of-branch
     * name was removed. It also makes the excluded counts describe the branch —
     * "103 sotuvchi, 6 rahbar" is about Навоий, not about all seventeen ROPs.
     */
    const roster = await this.deals.findLeaderboardRoster({
      departmentIds: ctx.filters.departmentIds,
      employeeIds: narrowEmployeeIds(
        ctx.filters.employeeIds,
        ctx.filters.restrictToEmployeeIds ?? null,
      ),
    })

    const scope: LeaderboardScopeDto = {
      scope: 'sellers',
      sellers: roster.sellers.length,
      excludedManagers: roster.excludedManagers,
      excludedOther: roster.excludedOther,
    }

    // An empty id list would mean "no employee filter" to employees(), which
    // would rank the whole company — the exact bug this method removes. A
    // filter that matches nobody must produce nobody.
    //
    // The basis is still resolved and still reported on the empty board: "no
    // seller matched these filters" and "the seller stage no longer exists" are
    // different failures and the page has to be able to tell them apart.
    if (roster.sellers.length === 0) {
      return {
        rows: [],
        scope,
        sellerCloseBasis: toSellerCloseBasisDto(await this.deals.findSellerWonStages()),
      }
    }

    const { rows, sellerCloseBasis } = await this.employees({
      ...ctx,
      filters: { ...ctx.filters, employeeIds: roster.sellers.map((s) => s.id) },
    })

    const achievement = new Map<string, number | null>(
      rows.map((r) => [r.employeeId, r.kpiAchievementPercent]),
    )

    /**
     * ONE metric, and the two bases are ranked by their own code paths.
     *
     * `closed_deals` / `closed_value` rank what the SELLER CLOSED; the other
     * four rank what was DELIVERED. Nothing here averages, falls back or
     * substitutes: a request for a seller-close ranking that cannot be measured
     * comes back with null values and `sellerCloseBasis.resolved = false`,
     * never as a delivered-revenue board wearing the other label.
     */
    const board = isSellerCloseMetric(metric)
      ? rankBySellerClose(rows, metric)
      : buildLeaderboard(rows, metric, achievement)

    const names = new Map(rows.map((r) => [r.employeeId, r]))

    return {
      rows: board.map((entry) => {
        const row = names.get(entry.employeeId)!
        return {
          rank: entry.rank,
          tied: entry.tied,
          employeeId: entry.employeeId,
          fullName: row.fullName,
          departmentName: row.departmentName,
          // Already DTO form — employees() crossed it.
          revenue: row.current.revenue,
          dealsWon: row.current.dealsWon,
          conversionPercent:
            row.current.conversionRatePercent === null
              ? null
              : roundPercent(row.current.conversionRatePercent),
          kpiAchievementPercent:
            row.kpiAchievementPercent === null ? null : roundPercent(row.kpiAchievementPercent),
          // Both bases on every row, whichever one `metric` ranked by.
          closedCount: row.closedCount,
          closedValue: row.closedValue,
          // Still the DELIVERED-revenue delta, on every metric. The comparison
          // window has no seller-close delta yet; inventing one from a
          // different basis would be the blend this module refuses.
          delta: row.revenueDelta,
          value: entry.value,
        }
      }),
      scope,
      sellerCloseBasis,
    }
  }

  /**
   * The scope facts, shaped for `meta` rather than for `data`.
   *
   * `data` stays a bare array of rows because the overview page reads this same
   * endpoint as `LeaderboardRowDto[]` and slices it — wrapping the rows in an
   * object to make room for the scope would break that page at runtime while
   * typechecking cleanly. `meta` is where a response describes itself, and the
   * envelope already carries the period the same way.
   *
   * Returned as its own object so the route can SPREAD it into the handler's
   * `Partial<ResponseMeta>`: `ResponseMeta` in `server/http/envelope.ts` does
   * not yet declare `leaderboardScope`, and only a spread gets an undeclared
   * key past the excess-property check. The client mirror in `lib/api.ts` does
   * declare it, so the UI reads it typed. Adding the same optional line to the
   * server interface would close the gap and let this be a plain literal.
   */
  static leaderboardScopeMeta(scope: LeaderboardScopeDto) {
    return { leaderboardScope: scope }
  }

  /**
   * The FILIAL facts, shaped for `meta` — spread, for the same reason.
   *
   * Every scoped response carries this, because the scope removes ~59% of last
   * month's revenue from every total and a reader who does not know that will
   * conclude the dashboard is broken. `employees` plus the five `excluded`
   * buckets sum to the whole roster, so the block answers "where did the other
   * 179 people go" rather than merely asserting a branch.
   *
   * `ResponseMeta` in `server/http/envelope.ts` does not declare
   * `branchScope` — only a spread gets an undeclared key past the
   * excess-property check — while the client mirror in `lib/api.ts` does, so
   * the UI reads it typed. Adding the optional line to the server interface
   * would close the gap for both this and `leaderboardScope`.
   */
  static branchScopeMeta(scope: BranchScopeDto) {
    return { branchScope: scope }
  }

  /**
   * The seller-close basis, shaped for `meta` — spread, for the same reason.
   *
   * It belongs in meta rather than on the rows because it describes the whole
   * response: which stage was resolved, from which pipeline role, and which
   * amount was summed. A row can only say "null"; this says why.
   */
  static sellerCloseBasisMeta(basis: SellerCloseBasisDto) {
    return { sellerCloseBasis: basis }
  }

  /** Serialisable period metadata for the response envelope. */
  static periodMeta(ctx: AnalyticsContext) {
    return {
      period: toPeriodDto(ctx.period),
      comparisonPeriod: toPeriodDto(ctx.comparison),
      comparisonTruncated: ctx.comparison.isTruncated,
    }
  }
}

export type { Delta }
