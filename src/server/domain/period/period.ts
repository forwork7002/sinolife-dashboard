/**
 * Reporting periods.
 *
 * Framework-free. Every date boundary in the application is produced here, so
 * "this month" means exactly one thing across the dashboard, the API and the
 * KPI engine.
 *
 * TWO DECISIONS WORTH KNOWING ABOUT
 *
 * 1. Intervals are HALF-OPEN: [start, end). The end instant is excluded.
 *    The common alternative is an inclusive end pinned to 23:59:59.999, which
 *    silently drops any row landing in that final millisecond and breaks the
 *    moment a column stores microseconds. Half-open intervals tile perfectly:
 *    one period's end is the next one's start, with no gap and no overlap.
 *
 * 2. "This week/month/year" mean TO-DATE, not the whole calendar unit.
 *    On 23 August, "this month" is 1–23 August, not 1–31. Comparing a
 *    third-of-a-month against a full previous month would show a fake collapse
 *    in revenue every time someone opened the dashboard mid-month. This also
 *    matches the comparison the business asked for: August 1–23 vs July 1–23.
 *
 * All arithmetic happens in the configured IANA timezone via TZDate, so the
 * boundaries stay correct across DST transitions even though the default zone
 * (Asia/Tashkent, UTC+5) has none.
 */

import { TZDate } from '@date-fns/tz'
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns'

export const PERIOD_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'previous_month',
  'this_year',
  'custom',
] as const

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

/** A half-open instant range, [start, end). */
export interface Period {
  /** Inclusive lower bound, as a UTC instant. */
  readonly start: Date
  /** EXCLUSIVE upper bound, as a UTC instant. */
  readonly end: Date
  readonly timeZone: string
  readonly preset: PeriodPreset
}

export interface ResolvePeriodOptions {
  readonly timeZone: string
  /** Injected for determinism in tests. Defaults to the current instant. */
  readonly now?: Date
  /** Required when preset is 'custom'. Interpreted as a calendar date in `timeZone`. */
  readonly customStart?: Date
  /** Required when preset is 'custom'. INCLUSIVE calendar date; expanded to end-of-day. */
  readonly customEnd?: Date
  /** ISO weeks start on Monday, which is also the Uzbek convention. */
  readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
}

export class InvalidPeriodError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPeriodError'
  }
}

/** Strip the timezone wrapper back to a plain UTC instant. */
function toInstant(value: Date): Date {
  return new Date(value.getTime())
}

function assertValidDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidPeriodError(`${label} is not a valid date`)
  }
}

/**
 * Resolve a preset into concrete instants.
 *
 * @throws InvalidPeriodError when a custom range is missing or inverted.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  options: ResolvePeriodOptions,
): Period {
  const { timeZone, now = new Date(), weekStartsOn = 1 } = options

  assertValidDate(now, 'now')

  const zonedNow = new TZDate(now.getTime(), timeZone)
  const todayStart = startOfDay(zonedNow)
  /** Exclusive end of today — i.e. midnight tonight. */
  const tomorrowStart = addDays(todayStart, 1)

  const build = (start: Date, end: Date): Period =>
    Object.freeze({
      start: toInstant(start),
      end: toInstant(end),
      timeZone,
      preset,
    })

  switch (preset) {
    case 'today':
      return build(todayStart, tomorrowStart)

    case 'yesterday':
      return build(addDays(todayStart, -1), todayStart)

    case 'this_week':
      return build(startOfWeek(zonedNow, { weekStartsOn }), tomorrowStart)

    case 'this_month':
      return build(startOfMonth(zonedNow), tomorrowStart)

    case 'previous_month': {
      const thisMonthStart = startOfMonth(zonedNow)
      return build(startOfMonth(addMonths(thisMonthStart, -1)), thisMonthStart)
    }

    case 'this_year':
      return build(startOfYear(zonedNow), tomorrowStart)

    case 'custom': {
      const { customStart, customEnd } = options
      if (!customStart || !customEnd) {
        throw new InvalidPeriodError(
          "preset 'custom' requires both customStart and customEnd",
        )
      }
      assertValidDate(customStart, 'customStart')
      assertValidDate(customEnd, 'customEnd')

      const start = startOfDay(new TZDate(customStart.getTime(), timeZone))
      // customEnd is an inclusive calendar date, so the exclusive bound is the
      // following midnight.
      const end = addDays(startOfDay(new TZDate(customEnd.getTime(), timeZone)), 1)

      if (end.getTime() <= start.getTime()) {
        throw new InvalidPeriodError(
          'customEnd must be on or after customStart',
        )
      }

      return build(start, end)
    }
  }
}

/**
 * The period this one should be compared against.
 *
 * Not simply "the preceding window of equal length". For calendar-anchored
 * presets the previous period is anchored to the equivalent calendar unit, so
 * 1–23 August compares against 1–23 July rather than against 9–31 July.
 *
 * Where the anchored window would overflow its own calendar unit — 1–31 March
 * has no counterpart in February — it is capped at that unit's end. The
 * comparison then covers all of February, which is the honest maximum, and
 * `isTruncated` flags it so the UI can say so.
 */
export function previousEquivalent(period: Period): Period & { readonly isTruncated: boolean } {
  const { timeZone, preset, start, end } = period

  const zonedStart = new TZDate(start.getTime(), timeZone)
  const zonedEnd = new TZDate(end.getTime(), timeZone)
  const dayCount = differenceInCalendarDays(zonedEnd, zonedStart)

  const build = (
    prevStart: Date,
    prevEnd: Date,
    isTruncated: boolean,
  ): Period & { readonly isTruncated: boolean } =>
    Object.freeze({
      start: toInstant(prevStart),
      end: toInstant(prevEnd),
      timeZone,
      preset,
      isTruncated,
    })

  /**
   * Anchor the previous window to the start of the preceding calendar unit and
   * give it the same number of days, capped so it cannot spill past the unit.
   */
  const anchored = (prevAnchor: Date, cap: Date) => {
    const candidate = addDays(prevAnchor, dayCount)
    const truncated = candidate.getTime() > cap.getTime()
    return build(prevAnchor, truncated ? cap : candidate, truncated)
  }

  switch (preset) {
    case 'today':
    case 'yesterday':
      return build(addDays(zonedStart, -1), addDays(zonedEnd, -1), false)

    case 'this_week':
      return build(addWeeks(zonedStart, -1), addWeeks(zonedEnd, -1), false)

    case 'this_month': {
      /*
        A COMPLETE UNIT COMPARES AGAINST A COMPLETE UNIT; a to-date one does not.

        On most days this window is month-to-date and `anchored` is exactly
        right — 1–23 August against 1–23 July. On the last day of the month it
        covers the whole month, and so must its counterpart: giving September
        (30 days) the first 30 days of August drops the 31st.

        The pulse forecast leans on this directly. It widens the window to the
        full calendar unit before asking for a reference, because "August is
        projected to finish at X" has to be read against ALL of July — and it
        was being read against 30 or 29 days of it, which is the fake growth
        the widening exists to prevent.
      */
      const unitEnd = startOfMonth(addMonths(zonedStart, 1))
      const previousUnitStart = startOfMonth(addMonths(zonedStart, -1))

      return zonedEnd.getTime() >= unitEnd.getTime()
        ? build(previousUnitStart, zonedStart, false)
        : // cap = this window's own start, which is the previous month's end.
          anchored(previousUnitStart, zonedStart)
    }

    case 'previous_month':
      /*
        A WHOLE MONTH IS COMPARED AGAINST A WHOLE MONTH.

        Unlike `this_month`, this preset is not to-date: its window is an
        entire calendar month, so its counterpart is the entire month before
        it — 1–28 February against ALL of January, not against 1–28 January.

        It used to share the `anchored` branch above, which gives the previous
        window the same NUMBER OF DAYS as the current one. That is exactly
        right for a to-date window and wrong here. February (28 days) was
        measured against the first 28 days of January, so three days of
        January's revenue were missing from the denominator and every
        "Oʻtgan oy" delta on every screen read about ten per cent too high.
        Five month pairs a year are affected — Feb/Jan worst, then Apr, Jun,
        Sep and Nov, each short by one day.

        The reverse case was already right, but by accident: March against
        February hit the cap, came back as the whole of February, and was
        flagged truncated. It is no longer flagged, because nothing was
        shortened — months differ in length by the calendar's own doing, and
        that is what a month-over-month comparison means. `isTruncated` is for
        "we could not give you the window you asked for"; here we can.
      */
      return build(startOfMonth(addMonths(zonedStart, -1)), zonedStart, false)

    case 'this_year': {
      // Same rule as this_month: a year-to-date window is anchored to the same
      // days a year earlier, a window covering the whole year to the whole
      // year before it — which is what keeps a leap day from going missing.
      const unitEnd = startOfYear(addYears(zonedStart, 1))
      const previousUnitStart = startOfYear(addYears(zonedStart, -1))

      return zonedEnd.getTime() >= unitEnd.getTime()
        ? build(previousUnitStart, zonedStart, false)
        : anchored(previousUnitStart, zonedStart)
    }

    case 'custom': {
      // No calendar anchor to honour, so use the window immediately before.
      const durationMs = end.getTime() - start.getTime()
      return build(new Date(start.getTime() - durationMs), start, false)
    }
  }
}

/**
 * A span that excludes nothing.
 *
 * For the readings that are NOT about a reporting period — the confirmation
 * backlog is chosen by state, not by date — but whose queries still bind two
 * date parameters. Giving them a real all-time span keeps one query shape for
 * both modes rather than two that could drift apart in how they classify a
 * row. 1970 precedes the portal's first record and 2100 outlasts anything it
 * will hold.
 *
 * Not a preset, and deliberately not offered as one: nothing on a dashboard
 * should quietly report on all of history under a date control.
 */
export function allTime(timeZone: string): Period {
  return Object.freeze({
    start: new Date(0),
    end: new Date(Date.UTC(2100, 0, 1)),
    timeZone,
    preset: 'custom',
  })
}

/** Whether an instant falls inside the half-open period. */
export function containsInstant(period: Period, instant: Date): boolean {
  const t = instant.getTime()
  return t >= period.start.getTime() && t < period.end.getTime()
}

export function periodLengthInDays(period: Period): number {
  return differenceInCalendarDays(
    new TZDate(period.end.getTime(), period.timeZone),
    new TZDate(period.start.getTime(), period.timeZone),
  )
}

/**
 * A whole calendar month in the given timezone, offset from a reference date.
 *
 * `offsetMonths: 0` is the reference month, `-1` the month before it.
 *
 * KPI windows MUST be built with this rather than with `Date.UTC`. A UTC month
 * starts five hours before a Tashkent month, and that sliver is enough for a
 * "this month" report to overlap the previous month's targets — which is how a
 * dashboard ends up scoring August's results against July's goals.
 */
export function calendarMonth(
  reference: Date,
  timeZone: string,
  offsetMonths = 0,
): { readonly start: Date; readonly end: Date } {
  const zoned = new TZDate(reference.getTime(), timeZone)
  const start = startOfMonth(addMonths(zoned, offsetMonths))
  const end = startOfMonth(addMonths(start, 1))

  return { start: toInstant(start), end: toInstant(end) }
}

/**
 * The instant a period is measured "as of" — its last representable moment.
 *
 * Because periods are half-open, `end` itself belongs to the NEXT period. Using
 * it to ask "which month is this?" would answer with the following month.
 */
export function asOfInstant(period: Period): Date {
  return new Date(period.end.getTime() - 1)
}

// ---------------------------------------------------------------------------
// Trend bucketing
// ---------------------------------------------------------------------------

export const GRANULARITIES = ['day', 'week', 'month'] as const
export type Granularity = (typeof GRANULARITIES)[number]

/**
 * Pick a sensible bucket size for a trend chart.
 *
 * Thresholds are chosen to keep a chart between roughly 7 and 60 points:
 * fewer looks empty, more turns into noise on a laptop-width card.
 */
export function chooseGranularity(period: Period): Granularity {
  const days = periodLengthInDays(period)
  if (days <= 62) return 'day'
  if (days <= 365) return 'week'
  return 'month'
}

/**
 * Enumerate the half-open buckets tiling a period.
 *
 * The first and last buckets are clipped to the period, so a month-granularity
 * chart of 15 Jan – 20 Mar starts on 15 Jan rather than 1 Jan. Every deal in
 * the period therefore lands in exactly one bucket, and the bucket totals sum
 * to the period total.
 */
export function enumerateBuckets(
  period: Period,
  granularity: Granularity = chooseGranularity(period),
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1,
): readonly { readonly start: Date; readonly end: Date }[] {
  const { timeZone } = period
  const buckets: { start: Date; end: Date }[] = []

  const periodStart = new TZDate(period.start.getTime(), timeZone)
  const periodEnd = period.end.getTime()

  const alignToBucket = (d: Date): Date => {
    switch (granularity) {
      case 'day':
        return startOfDay(d)
      case 'week':
        return startOfWeek(d, { weekStartsOn })
      case 'month':
        return startOfMonth(d)
    }
  }

  const advance = (d: Date): Date => {
    switch (granularity) {
      case 'day':
        return addDays(d, 1)
      case 'week':
        return addWeeks(d, 1)
      case 'month':
        return addMonths(d, 1)
    }
  }

  let cursor = alignToBucket(periodStart)

  // Guard against a pathological loop if arithmetic ever fails to advance.
  let iterations = 0
  const maxIterations = 10_000

  while (cursor.getTime() < periodEnd) {
    const next = advance(cursor)

    const clippedStart = Math.max(cursor.getTime(), period.start.getTime())
    const clippedEnd = Math.min(next.getTime(), periodEnd)

    if (clippedEnd > clippedStart) {
      buckets.push({ start: new Date(clippedStart), end: new Date(clippedEnd) })
    }

    cursor = next

    if (++iterations > maxIterations) {
      throw new InvalidPeriodError(
        `enumerateBuckets exceeded ${maxIterations} iterations; period is implausibly long`,
      )
    }
  }

  return buckets
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface PeriodDto {
  readonly preset: PeriodPreset
  readonly start: string
  /** Exclusive, matching the domain contract. */
  readonly end: string
  readonly timeZone: string
  readonly days: number
}

export function toPeriodDto(period: Period): PeriodDto {
  return {
    preset: period.preset,
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    timeZone: period.timeZone,
    days: periodLengthInDays(period),
  }
}
