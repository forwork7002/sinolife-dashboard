/**
 * Pulse and flow: pipeline-health arithmetic.
 *
 * Pure and framework-free, like the rest of the domain layer. The heavy
 * aggregation for these indicators runs in SQL (`PulseRepository`), but every
 * rule that COMBINES the aggregates lives here, where it can be unit tested
 * without a database: how four figures compose into a velocity, how a
 * part-month projects to a full month, and when a dwelling deal counts as
 * stuck.
 */

import { TZDate } from '@date-fns/tz'
import { addMonths, addWeeks, addYears } from 'date-fns'

import type { Period } from '@/server/domain/period/period'
import { ratePercent } from './metrics'
import { periodElapsedFraction } from './performance'

// ---------------------------------------------------------------------------
// Sales velocity
// ---------------------------------------------------------------------------

export interface VelocityComponents {
  /** Open revenue deals right now, point-in-time. */
  readonly openDeals: number
  /** Count-based win rate over deals CLOSED in the period, 0-100. */
  readonly winRatePercent: number | null
  /** Average won amount over the same closed cohort, minor units. */
  readonly avgWonAmountMinor: bigint | null
  /** Median closedAt - createdAtSource of WON revenue deals, in days. */
  readonly medianCycleDays: number | null
}

/**
 * The classic pipeline-velocity formula, in minor units per day:
 *
 *   (open deals x win rate x average won amount) / median cycle days
 *
 * NULL-SAFETY IS THE CONTRACT. Any missing component makes the composite
 * meaningless, so the result is null rather than a number computed with a
 * silent zero — a velocity of 0 soʻm/kun is a real claim ("nothing will
 * close") and must only appear when the pipeline is genuinely empty.
 *
 * The arithmetic stays in BigInt. Win rate is carried as basis points and the
 * cycle as milli-days, so the one lossy step — rounding two float inputs to
 * fixed point — happens before the money is touched, never after.
 */
export function salesVelocityPerDayMinor(c: VelocityComponents): bigint | null {
  if (c.winRatePercent === null || c.avgWonAmountMinor === null || c.medianCycleDays === null) {
    return null
  }
  if (!Number.isFinite(c.winRatePercent) || !Number.isFinite(c.medianCycleDays)) return null
  if (c.winRatePercent < 0 || c.openDeals < 0) return null

  const cycleMilliDays = BigInt(Math.round(c.medianCycleDays * 1000))
  if (cycleMilliDays <= 0n) return null

  const winRateBp = BigInt(Math.round(c.winRatePercent * 100))

  // velocity = open x (bp/10000) x avgWon / (milliDays/1000)
  //          = open x bp x avgWon x 1000 / (10000 x milliDays)
  // One division, last, so BigInt truncation costs at most one minor unit.
  return (
    (BigInt(c.openDeals) * winRateBp * c.avgWonAmountMinor * 1000n) /
    (10_000n * cycleMilliDays)
  )
}

// ---------------------------------------------------------------------------
// Run-rate forecast
// ---------------------------------------------------------------------------

/**
 * Below this fraction of the period, no projection is published.
 *
 * At 00:30 on the 1st, dividing half an hour of revenue by 0.07% of the month
 * "projects" whatever the night shift happened to close, multiplied by 1400.
 * The floor is 2% — roughly the first 14 hours of a month — under which the
 * honest answer is "too early to say", rendered as an em dash.
 */
export const PROJECTION_ELAPSED_FLOOR = 0.02

/**
 * Expand a TO-DATE period to the full calendar unit it belongs to.
 *
 * `resolvePeriod` deliberately ends "this month" at tonight's midnight — the
 * right window for measuring what HAS happened. A projection asks the other
 * question, "where does this land by the end of the month?", and dividing
 * month-to-date revenue by the fraction of the TO-DATE window elapsed would
 * always answer ~100% and project nothing. So the elapsed fraction is taken
 * against the whole unit: this_week → its 7 days, this_month → its month,
 * this_year → its year. Already-complete presets (yesterday, previous_month)
 * and custom ranges pass through unchanged — their elapsed fraction is 1 and
 * the "projection" is simply what actually happened, which is correct.
 */
export function fullUnitWindow(period: Period): Period {
  const zonedStart = new TZDate(period.start.getTime(), period.timeZone)

  const fullEnd = (() => {
    switch (period.preset) {
      case 'this_week':
        return addWeeks(zonedStart, 1)
      case 'this_month':
        return addMonths(zonedStart, 1)
      case 'this_year':
        return addYears(zonedStart, 1)
      default:
        // today is already its own full unit; the rest are complete or custom.
        return null
    }
  })()

  if (fullEnd === null) return period

  return Object.freeze({
    start: new Date(period.start.getTime()),
    end: new Date(fullEnd.getTime()),
    timeZone: period.timeZone,
    preset: period.preset,
  })
}

/** Fraction of the FULL calendar unit elapsed at `now`, clamped to [0, 1]. */
export function projectionElapsedFraction(period: Period, now: Date): number {
  return periodElapsedFraction(fullUnitWindow(period), now)
}

/**
 * Straight-line run-rate projection: period-to-date / elapsed fraction.
 *
 * Null below the floor (see above). Once the period is complete the projection
 * IS the actual — returned exactly, not re-derived through the division, so a
 * finished month never shows a projection differing from its own total by a
 * rounding step.
 */
export function projectRevenueMinor(
  periodToDateMinor: bigint,
  elapsedFraction: number,
): bigint | null {
  if (!Number.isFinite(elapsedFraction)) return null
  if (elapsedFraction < PROJECTION_ELAPSED_FLOOR) return null
  if (elapsedFraction >= 1) return periodToDateMinor

  // Fixed-point at 1e-6 so the division itself never touches floating point.
  const scaled = BigInt(Math.round(elapsedFraction * 1_000_000))
  if (scaled <= 0n) return null
  return (periodToDateMinor * 1_000_000n) / scaled
}

// ---------------------------------------------------------------------------
// Stage conversion (ever-reached basis)
// ---------------------------------------------------------------------------

export interface StageReach {
  readonly pipelineId: string
  readonly sortOrder: number
  /** Distinct deals with a history row EVER entering this stage. */
  readonly dealCount: number
}

/**
 * Conversion from the previous stage, per pipeline.
 *
 * Input must be ordered by (pipeline, sortOrder) — the repository's ORDER BY.
 * The first stage of each pipeline has no predecessor and reports null, as
 * does any stage whose predecessor saw zero deals: "100% of nothing" is not a
 * conversion. Percentages may legitimately exceed 100 — a deal can enter a
 * pipeline mid-way and skip earlier stages — and that is reported as measured
 * rather than clamped, because a >100% step is exactly how skipped stages
 * become visible.
 */
export function conversionFromPrevious<T extends StageReach>(
  rows: readonly T[],
): readonly (T & { readonly conversionFromPreviousPercent: number | null })[] {
  let previous: StageReach | null = null

  return rows.map((row) => {
    const samePipeline = previous !== null && previous.pipelineId === row.pipelineId
    const percent =
      samePipeline && previous !== null ? ratePercent(row.dealCount, previous.dealCount) : null

    previous = row
    return { ...row, conversionFromPreviousPercent: percent }
  })
}

// ---------------------------------------------------------------------------
// Stuck deals (WIP aging)
// ---------------------------------------------------------------------------

/**
 * A deal is stuck when it has dwelt more than TWICE the stage's historical
 * median. One multiplier, named once — the repository passes it into SQL so
 * the rule cannot drift between the query and the domain.
 *
 * Why 2x the p50 and not a fixed hour count: stages have wildly different
 * normal speeds (confirmation moves in minutes, regional transit in days), so
 * any absolute threshold flags an entire slow stage or none of a fast one.
 * Doubling the stage's own median flags the tail of THAT stage's distribution.
 */
export const STUCK_DWELL_MULTIPLIER = 2

export function stuckThresholdHours(historicalP50Hours: number | null): number | null {
  if (historicalP50Hours === null) return null
  if (!Number.isFinite(historicalP50Hours) || historicalP50Hours <= 0) return null
  return historicalP50Hours * STUCK_DWELL_MULTIPLIER
}

/**
 * Whether one dwell counts as stuck. A stage with no completed history has no
 * baseline, and without a baseline nothing can be called stuck — null
 * threshold means false, never "assume the worst".
 */
export function isStuck(dwellHours: number, historicalP50Hours: number | null): boolean {
  const threshold = stuckThresholdHours(historicalP50Hours)
  return threshold !== null && dwellHours > threshold
}

export interface AgingTotals {
  readonly openCount: number
  readonly openValueMinor: bigint
  readonly stuckCount: number
  readonly stuckValueMinor: bigint
}

/** Sum per-stage aging rows into the panel's headline totals. */
export function aggregateAging(rows: readonly AgingTotals[]): AgingTotals {
  return rows.reduce<AgingTotals>(
    (acc, row) => ({
      openCount: acc.openCount + row.openCount,
      openValueMinor: acc.openValueMinor + row.openValueMinor,
      stuckCount: acc.stuckCount + row.stuckCount,
      stuckValueMinor: acc.stuckValueMinor + row.stuckValueMinor,
    }),
    { openCount: 0, openValueMinor: 0n, stuckCount: 0, stuckValueMinor: 0n },
  )
}
