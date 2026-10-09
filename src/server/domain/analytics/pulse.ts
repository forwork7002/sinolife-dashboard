/**
 * Pulse and flow: pipeline-health arithmetic.
 *
 * Pure and framework-free, like the rest of the domain layer. The heavy
 * aggregation for these indicators runs in SQL (`PulseRepository`), but every
 * rule that COMBINES the aggregates lives here, where it can be unit tested
 * without a database: how a part-month projects to a full month.
 */

import { TZDate } from '@date-fns/tz'
import { addDays, addMonths, addWeeks, addYears, startOfDay } from 'date-fns'

import type { Period } from '@/server/domain/period/period'
import { periodElapsedFraction } from './performance'

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

/**
 * The floor's working day, in minutes after local midnight: 08:30–18:00.
 *
 * The client, 2026-10-09: «bizda ish 8:30 dan 18:00 gacha». Every day of the
 * week counts — the client named hours, not days off.
 */
export const WORKDAY_START_MINUTES = 8 * 60 + 30
export const WORKDAY_END_MINUTES = 18 * 60

/**
 * Fraction of the window's WORKING time elapsed at `now`, in [0, 1].
 *
 * A run-rate divides money by the share of the period already worked. Taken
 * against the 24-hour clock, «Bugun» at 13:15 read 55% elapsed while half the
 * working day (08:30–18:00) was still ahead, and at 18:00 it still projected
 * a third more money from six hours in which nobody sells. Here only working
 * minutes count: zero before 08:30, 50% at 13:15, 100% from 18:00 on — at
 * which point the day's total IS the result and no projection is made.
 *
 * Walked day by day in the period's own time zone, each day's 08:30–18:00
 * clipped to the window. A window holding no working time at all falls back
 * to the plain clock rather than dividing by zero.
 */
export function workingElapsedFraction(period: Period, now: Date): number {
  const startMs = period.start.getTime()
  const endMs = period.end.getTime()
  if (endMs <= startMs) return 1

  const nowMs = now.getTime()
  let total = 0
  let elapsed = 0

  for (
    let day = startOfDay(new TZDate(startMs, period.timeZone));
    day.getTime() < endMs;
    day = addDays(day, 1)
  ) {
    const at = (minutes: number) =>
      new TZDate(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        Math.floor(minutes / 60),
        minutes % 60,
        period.timeZone,
      ).getTime()

    const from = Math.max(at(WORKDAY_START_MINUTES), startMs)
    const to = Math.min(at(WORKDAY_END_MINUTES), endMs)
    if (to <= from) continue

    total += to - from
    elapsed += Math.min(to - from, Math.max(0, nowMs - from))
  }

  if (total <= 0) return periodElapsedFraction(period, now)
  return elapsed / total
}

/**
 * Fraction of the FULL calendar unit's working time elapsed at `now`, in
 * [0, 1] — see `workingElapsedFraction` for why working time and not the clock.
 */
export function projectionElapsedFraction(period: Period, now: Date): number {
  return workingElapsedFraction(fullUnitWindow(period), now)
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

/**
 * Split what the run-rate says is still to come across the buckets it has
 * left, so a dashed continuation drawn from these sums to EXACTLY the
 * projection printed above it.
 *
 * THE REMAINDER IS DISTRIBUTED, NEVER TRUNCATED AWAY. `remaining / count` in
 * BigInt rounds towards zero, and eleven remaining days each losing up to a
 * minor unit is a dashed line that stops short of the figure it is drawing
 * towards — a chart and a headline disagreeing by an amount too small to
 * notice on any one day and too persistent to explain. The first `remainder`
 * buckets carry one extra minor unit each, which is the only split that keeps
 * the sum exact.
 *
 * FLAT, AND THAT IS THE CLAIM BEING MADE. A straight-line run-rate says
 * nothing about which of the remaining days is the busy one; shaping these
 * buckets — by weekday, by last week's curve — would draw a forecast the
 * projection above it does not make. The reader is told «shu surʼatda davom
 * etsa», and a flat line is what that sentence looks like.
 *
 * Nothing to draw for a finished period (no buckets) or a projection that is
 * not ahead of what has already landed: a downward dashed line reads as money
 * coming back.
 */
export function spreadRemainingMinor(
  remainingMinor: bigint,
  buckets: number,
): readonly bigint[] {
  if (!Number.isInteger(buckets) || buckets <= 0) return []
  if (remainingMinor <= 0n) return []

  const count = BigInt(buckets)
  const each = remainingMinor / count
  const remainder = Number(remainingMinor - each * count)

  return Array.from({ length: buckets }, (_, index) => (index < remainder ? each + 1n : each))
}
