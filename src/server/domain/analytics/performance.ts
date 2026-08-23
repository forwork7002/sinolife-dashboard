/**
 * Employee performance, leaderboard and KPI attainment.
 *
 * Pure and framework-free, like the rest of the domain layer.
 */

import { type Money, divideMoney, money, toMajorNumber } from '@/server/domain/money/money'
import type { Period } from '@/server/domain/period/period'
import type { KpiMetricValue, KpiStatusValue } from '@/server/domain/types'
import { type Delta, growth, toBasisPoints } from './metrics'
import { type AnalyticsDeal, type SalesSummary, summarizeDeals } from './sales'

// ---------------------------------------------------------------------------
// Per-employee performance
// ---------------------------------------------------------------------------

export interface EmployeePerformance {
  readonly employeeId: string
  readonly current: SalesSummary
  readonly previous: SalesSummary
  readonly revenueDelta: Delta
  readonly dealsWonDelta: Delta
  /** Employee revenue as a share of the team's, 0-100. Null when the team earned nothing. */
  readonly teamSharePercent: number | null
  /** Employee revenue relative to the team mean, where 100 is exactly average. */
  readonly versusTeamAveragePercent: number | null
}

export function employeePerformance(
  deals: readonly AnalyticsDeal[],
  employeeIds: readonly string[],
  currentPeriod: Period,
  previousPeriod: Period,
  currency: string,
): EmployeePerformance[] {
  const byEmployee = new Map<string, AnalyticsDeal[]>()
  for (const id of employeeIds) byEmployee.set(id, [])
  for (const deal of deals) {
    // Deals belonging to employees outside the requested set are ignored
    // rather than bucketed under "unknown": the caller has already decided
    // which employees are in scope, e.g. one department.
    byEmployee.get(deal.employeeId)?.push(deal)
  }

  const rows = employeeIds.map((employeeId) => {
    const own = byEmployee.get(employeeId) ?? []
    const current = summarizeDeals(own, currentPeriod, currency)
    const previous = summarizeDeals(own, previousPeriod, currency)

    return {
      employeeId,
      current,
      previous,
      revenueDelta: growth(current.revenue.amountMinor, previous.revenue.amountMinor),
      dealsWonDelta: growth(current.dealsWon, previous.dealsWon),
      teamSharePercent: null as number | null,
      versusTeamAveragePercent: null as number | null,
    }
  })

  const teamTotal = rows.reduce((sum, row) => sum + row.current.revenue.amountMinor, 0n)
  const teamAverage =
    rows.length === 0 ? 0n : divideMoney(money(teamTotal, currency), rows.length).amountMinor

  return rows.map((row) => ({
    ...row,
    teamSharePercent:
      teamTotal === 0n
        ? null
        : (Number(row.current.revenue.amountMinor) / Number(teamTotal)) * 100,
    versusTeamAveragePercent:
      teamAverage === 0n
        ? null
        : (Number(row.current.revenue.amountMinor) / Number(teamAverage)) * 100,
  }))
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export const LEADERBOARD_METRICS = [
  'revenue',
  'deals_won',
  'conversion',
  'kpi_achievement',
] as const

export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number]

export interface LeaderboardEntry {
  readonly rank: number
  readonly employeeId: string
  readonly value: number | null
  readonly display: Money | number | null
  /** True when this entry ties with the one above it. */
  readonly tied: boolean
}

/**
 * Rank employees by ONE metric.
 *
 * Single-metric by design. Blending revenue, conversion and KPI into a
 * composite "score" is the classic leaderboard mistake: the weights are
 * arbitrary, nobody can explain why they placed where they did, and the ranking
 * stops being actionable. If a composite is ever wanted, it needs a documented
 * formula agreed with the business — not an average invented here.
 *
 * Employees with no measurable value (null) are sorted last regardless of
 * direction: "no data" is not an achievement and must not top the board.
 * Equal values receive the SAME rank, standard competition style (1, 2, 2, 4).
 */
export function buildLeaderboard(
  performance: readonly EmployeePerformance[],
  metric: LeaderboardMetric,
  kpiAchievementByEmployee?: ReadonlyMap<string, number | null>,
): LeaderboardEntry[] {
  const valueOf = (row: EmployeePerformance): number | null => {
    switch (metric) {
      case 'revenue':
        return Number(row.current.revenue.amountMinor)
      case 'deals_won':
        return row.current.dealsWon
      case 'conversion':
        return row.current.conversionRatePercent
      case 'kpi_achievement':
        return kpiAchievementByEmployee?.get(row.employeeId) ?? null
    }
  }

  const displayOf = (row: EmployeePerformance, value: number | null): Money | number | null => {
    if (metric === 'revenue') return row.current.revenue
    return value
  }

  const scored = performance.map((row) => {
    const value = valueOf(row)
    return { row, value, display: displayOf(row, value) }
  })

  scored.sort((a, b) => {
    if (a.value === null && b.value === null) return a.row.employeeId.localeCompare(b.row.employeeId)
    if (a.value === null) return 1
    if (b.value === null) return -1
    if (a.value !== b.value) return b.value - a.value
    // Stable, explainable tie-break so the order never shuffles between loads.
    return a.row.employeeId.localeCompare(b.row.employeeId)
  })

  const entries: LeaderboardEntry[] = []
  let previousValue: number | null | undefined
  let previousRank = 0

  scored.forEach((item, index) => {
    const tied = index > 0 && item.value !== null && item.value === previousValue
    const rank = tied ? previousRank : index + 1

    entries.push({
      rank,
      employeeId: item.row.employeeId,
      value: item.value,
      display: item.display,
      tied,
    })

    previousValue = item.value
    previousRank = rank
  })

  return entries
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

export interface KpiDefinition {
  readonly id: string
  readonly employeeId: string | null
  readonly metric: KpiMetricValue
  /** Interpretation depends on `metric`; see prisma/schema.prisma. */
  readonly targetValue: bigint
}

export interface KpiEvaluation {
  readonly kpiId: string
  readonly employeeId: string | null
  readonly metric: KpiMetricValue
  readonly targetValue: bigint
  readonly actualValue: bigint
  /** Attainment in basis points (10000 = 100.00%). Null when the target is zero. */
  readonly achievementBp: number | null
  readonly status: KpiStatusValue
}

/**
 * Progress expected by this point in the period.
 *
 * A monthly revenue target should not read as "behind" on the 2nd of the month
 * just because 6% of it is done. Attainment is therefore judged against the
 * fraction of the period elapsed, not against 100%.
 */
export function periodElapsedFraction(period: Period, now: Date): number {
  const total = period.end.getTime() - period.start.getTime()
  if (total <= 0) return 1

  const elapsed = now.getTime() - period.start.getTime()
  return Math.min(1, Math.max(0, elapsed / total))
}

/**
 * Classify attainment.
 *
 * Thresholds are relative to expected pace: at or above pace is on track,
 * within 15% of pace is at risk, further behind is behind. A completed target
 * is ACHIEVED regardless of pace.
 */
export function classifyKpi(
  achievementBp: number | null,
  expectedFraction: number,
): KpiStatusValue {
  if (achievementBp === null) return 'AT_RISK'
  if (achievementBp >= 10_000) return 'ACHIEVED'

  const expectedBp = expectedFraction * 10_000
  if (expectedBp <= 0) return 'ON_TRACK'

  const paceRatio = achievementBp / expectedBp
  if (paceRatio >= 1) return 'ON_TRACK'
  if (paceRatio >= 0.85) return 'AT_RISK'
  return 'BEHIND'
}

/** Extract the actual value for a metric from a summary, in the KPI's units. */
export function actualForMetric(summary: SalesSummary, metric: KpiMetricValue): bigint {
  switch (metric) {
    case 'REVENUE':
      return summary.revenue.amountMinor
    case 'DEALS_CREATED':
      return BigInt(summary.dealsCreated)
    case 'DEALS_WON':
      return BigInt(summary.dealsWon)
    case 'AVERAGE_DEAL':
      return summary.averageDeal?.amountMinor ?? 0n
    case 'CONVERSION_RATE':
      // Stored as basis points so the integer contract holds.
      return BigInt(toBasisPoints(summary.conversionRatePercent) ?? 0)
  }
}

export function evaluateKpi(
  definition: KpiDefinition,
  summary: SalesSummary,
  period: Period,
  now: Date,
): KpiEvaluation {
  const actualValue = actualForMetric(summary, definition.metric)

  // A zero target cannot be attained by any amount of work; reporting infinite
  // attainment would be meaningless, so it is explicitly undefined.
  const achievementBp =
    definition.targetValue === 0n
      ? null
      : Number((actualValue * 10_000n) / definition.targetValue)

  return {
    kpiId: definition.id,
    employeeId: definition.employeeId,
    metric: definition.metric,
    targetValue: definition.targetValue,
    actualValue,
    achievementBp,
    status: classifyKpi(achievementBp, periodElapsedFraction(period, now)),
  }
}

/** Aggregate attainment across many KPIs, for a single headline figure. */
export function overallAchievementPercent(
  evaluations: readonly KpiEvaluation[],
): number | null {
  const measurable = evaluations.filter((e) => e.achievementBp !== null)
  if (measurable.length === 0) return null

  const total = measurable.reduce((sum, e) => sum + (e.achievementBp ?? 0), 0)
  return total / measurable.length / 100
}

/** Convenience: money formatting boundary for leaderboard display values. */
export function leaderboardDisplayNumber(display: Money | number | null): number | null {
  if (display === null) return null
  return typeof display === 'number' ? display : toMajorNumber(display)
}
