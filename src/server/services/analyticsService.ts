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
  type LeaderboardMetric,
  buildLeaderboard,
  evaluateKpi,
  overallAchievementPercent,
} from '@/server/domain/analytics/performance'
import { type Period, previousEquivalent, toPeriodDto } from '@/server/domain/period/period'
import type { DealRepository, DealFilters } from '@/server/repositories/dealRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'

export interface AnalyticsContext {
  readonly period: Period
  readonly comparison: Period & { readonly isTruncated: boolean }
  readonly currency: string
  readonly filters: DealFilters
  readonly now: Date
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
    filters: DealFilters,
    now: Date,
  ): AnalyticsContext {
    return { period, comparison: previousEquivalent(period), currency, filters, now }
  }

  /** One query covering both the current and comparison windows. */
  private load(ctx: AnalyticsContext): Promise<AnalyticsDeal[]> {
    return this.deals.findForAnalysis([ctx.period, ctx.comparison], ctx.filters)
  }

  async overview(ctx: AnalyticsContext): Promise<OverviewDto> {
    const [all, employees, lastSyncedAt] = await Promise.all([
      this.load(ctx),
      this.reference.findEmployees(),
      this.reference.findLastSuccessfulSync(),
    ])

    const current = summarizeDeals(all, ctx.period, ctx.currency)
    const previous = summarizeDeals(all, ctx.comparison, ctx.currency)

    const kpis = await this.reference.findKpisForPeriod(ctx.period)
    const evaluations = kpis.map((kpi) =>
      evaluateKpi(
        kpi,
        kpi.employeeId
          ? summarizeDeals(
              all.filter((d) => d.employeeId === kpi.employeeId),
              ctx.period,
              ctx.currency,
            )
          : current,
        ctx.period,
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
      activeEmployees: employees.filter((e) => e.isActive).length,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    }
  }

  async sales(ctx: AnalyticsContext) {
    const all = await this.load(ctx)
    const dealIds = all.map((d) => d.id)
    const items = await this.deals.findItemsForDeals(dealIds)

    return {
      trend: revenueTrend(all, ctx.period, ctx.currency).map((p) => ({
        date: p.bucketStart.toISOString(),
        revenue: Number(p.revenue.amountMinor) / 100,
        dealsWon: p.dealsWon,
        dealsCreated: p.dealsCreated,
      })),
      bySource: groupRevenue(all, ctx.period, ctx.currency, (d) => d.sourceId),
      byProduct: productRevenue(all, items, ctx.period, ctx.currency),
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

    const current = productRevenue(all, items, ctx.period, ctx.currency)
    const previous = productRevenue(all, items, ctx.comparison, ctx.currency)
    const previousById = new Map(previous.map((row) => [row.key, row.revenue.amountMinor]))

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
      sharePercent: row.sharePercent === null ? null : roundPercent(row.sharePercent),
      delta: toDeltaDto(growth(row.revenue.amountMinor, previousById.get(row.key) ?? null)),
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
      sharePercent: row.sharePercent === null ? null : roundPercent(row.sharePercent),
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
    })[]
  }> {
    const [all, roster] = await Promise.all([
      this.load(ctx),
      this.reference.findEmployees(),
    ])

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

    const scoped = restrictToEmployeeId
      ? requested.filter((e) => e.id === restrictToEmployeeId)
      : requested

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

    const byEmployee = new Map<string, KpiEvaluation[]>()
    for (const kpi of kpis) {
      if (!kpi.employeeId) continue
      const summary = summarizeDeals(
        all.filter((d) => d.employeeId === kpi.employeeId),
        ctx.period,
        ctx.currency,
      )
      const list = byEmployee.get(kpi.employeeId) ?? []
      list.push(evaluateKpi(kpi, summary, ctx.period, ctx.now))
      byEmployee.set(kpi.employeeId, list)
    }

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
        }
      }),
    }
  }

  async leaderboard(ctx: AnalyticsContext, metric: LeaderboardMetric) {
    const { rows } = await this.employees(ctx)

    const achievement = new Map<string, number | null>(
      rows.map((r) => [r.employeeId, r.kpiAchievementPercent]),
    )

    const board = buildLeaderboard(rows, metric, achievement)
    const names = new Map(rows.map((r) => [r.employeeId, r]))

    return board.map((entry) => {
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
        delta: row.revenueDelta,
        value: entry.value,
      }
    })
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
