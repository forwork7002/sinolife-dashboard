/**
 * KPI attainment.
 *
 * Pure and framework-free, like the rest of the domain layer.
 */

import type { Period } from '@/server/domain/period/period'
import type { KpiMetricValue, KpiStatusValue } from '@/server/domain/types'
import { toBasisPoints } from './metrics'
import type { SalesSummary } from './sales'

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

export interface KpiDefinition {
  readonly id: string
  readonly employeeId: string | null
  readonly metric: KpiMetricValue
  /** Interpretation depends on `metric`; see prisma/schema.prisma. */
  readonly targetValue: bigint
  /**
   * THE PLAN'S OWN WINDOW — the one a target means anything inside.
   *
   * A target is a contract for a stated span: 300M in September. It is not a
   * rate that can be sliced to whatever window the reader happens to have
   * selected, and it is not comparable to a different span's takings.
   *
   * These two fields travel with the definition so that no caller can score a
   * target against the report window by accident. They used to be dropped at
   * the repository, and every consumer then reached for the only window it
   * had — see `kpiWindow` below for what that cost.
   */
  readonly periodStart: Date
  /** Exclusive, like every other end instant in the application. */
  readonly periodEnd: Date
}

/**
 * The window a KPI is scored in, and the reason this function exists.
 *
 * EVERY figure on a KPI row — the actual, the attainment, the expected pace —
 * must be measured over the PLAN's period, never over the dashboard's. The two
 * are different questions and mixing them produced two wrong answers at once:
 *
 *  1. Pace. `periodElapsedFraction` was handed the report window, which for
 *     the default preset ("Shu oy") is TO-DATE — it ends at midnight tonight.
 *     A to-date window is by construction almost entirely elapsed, so on the
 *     2nd of a 30-day month the page announced "davrning 79% qismi oʻtdi" and
 *     graded every target BEHIND against a month that was 6% gone. On the 20th
 *     it said 95%. The number was wrong every day of every month.
 *
 *  2. Attainment. The target picked is the one live at the window's last
 *     instant, but the actual was summed over the window itself. "Bugun"
 *     therefore measured one day's takings against a whole month's target
 *     (~3%), and "Shu yil" measured eight months' takings against the same
 *     one month's target (~800%). Neither number meant anything.
 *
 * The preset still chooses WHICH plan is in view — that is what the window's
 * last instant is for. It does not change what the plan is measured over.
 */
export function kpiWindow(definition: KpiDefinition, timeZone: string): Period {
  return Object.freeze({
    start: definition.periodStart,
    end: definition.periodEnd,
    timeZone,
    // Not a dashboard preset: an explicit span, which is what 'custom' means.
    preset: 'custom' as const,
  })
}

export interface KpiEvaluation {
  readonly kpiId: string
  readonly employeeId: string | null
  readonly metric: KpiMetricValue
  readonly targetValue: bigint
  /**
   * Null when the metric cannot be measured over this window at all — today
   * only a conversion rate with nothing resolved. See `actualForMetric`: it is
   * an absence, not a zero, and the screen must print an em dash for it.
   */
  readonly actualValue: bigint | null
  /**
   * Attainment in basis points (10000 = 100.00%). Null when the target is zero
   * or the actual is unmeasurable.
   */
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

/**
 * Extract the actual value for a metric from a summary, in the KPI's units.
 *
 * NULL MEANS UNMEASURABLE, and only CONVERSION_RATE can be. `summarizeDeals`
 * returns `conversionRatePercent: null` when NOTHING resolved in the window —
 * a rate with no denominator — and `?? 0` used to flatten that into a measured
 * zero. It then scored as 0% attainment and a BEHIND badge, on a portal whose
 * median order takes 20-25 days to travel from the order clock to the money
 * clock: a seller with fourteen orders in the queue and none yet delivered
 * read «Haqiqiy 0% · Ortda» here while the very same conversion read «—» on
 * «Sotuvchilar reytingi». Two screens, one empty denominator, two facts.
 *
 * `tests/domain/rateHonesty.test.ts` pins the doctrine this restores: a rate
 * with no denominator is unknown, not zero — and it still returns 0 when there
 * genuinely were failures, which is the case that must keep working.
 *
 * THE OTHER FOUR STAY ZERO ON PURPOSE, and AVERAGE_DEAL is the one worth
 * saying out loud: `tests/domain/performance.test.ts` pins that it reports a
 * zero average deal rather than null, because "nothing was won" IS the
 * measurement there — the denominator is the window, and the window exists.
 */
export function actualForMetric(
  summary: SalesSummary,
  metric: KpiMetricValue,
): bigint | null {
  switch (metric) {
    case 'REVENUE':
      return summary.revenue.amountMinor
    case 'DEALS_CREATED':
      return BigInt(summary.dealsCreated)
    case 'DEALS_WON':
      return BigInt(summary.dealsWon)
    case 'AVERAGE_DEAL':
      return summary.averageDeal?.amountMinor ?? 0n
    case 'CONVERSION_RATE': {
      // Stored as basis points so the integer contract holds.
      const bp = toBasisPoints(summary.conversionRatePercent)
      return bp === null ? null : BigInt(bp)
    }
  }
}

/**
 * Score one target.
 *
 * `summary` MUST have been built over `kpiWindow(definition, ...)`. The window
 * is no longer a parameter precisely so that a caller cannot pass the report
 * period by mistake, which is what all three call sites used to do.
 */
export function evaluateKpi(
  definition: KpiDefinition,
  summary: SalesSummary,
  timeZone: string,
  now: Date,
): KpiEvaluation {
  const actualValue = actualForMetric(summary, definition.metric)

  /*
    Two ways a target cannot be scored, and both are null rather than zero.

    A zero target cannot be attained by any amount of work, so reporting
    infinite attainment would be meaningless. An unmeasurable ACTUAL — a
    conversion rate over a window in which nothing resolved — is the same kind
    of absence one step earlier. `overallAchievementPercent` already excludes a
    null from the headline average, and `classifyKpi` already reads a null as
    "no verdict", so both were waiting for this to be told the truth.
  */
  const achievementBp =
    actualValue === null || definition.targetValue === 0n
      ? null
      : Number((actualValue * 10_000n) / definition.targetValue)

  return {
    kpiId: definition.id,
    employeeId: definition.employeeId,
    metric: definition.metric,
    targetValue: definition.targetValue,
    actualValue,
    achievementBp,
    status: classifyKpi(
      achievementBp,
      periodElapsedFraction(kpiWindow(definition, timeZone), now),
    ),
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
