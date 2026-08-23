import { describe, expect, it } from 'vitest'

import {
  InvalidPeriodError,
  asOfInstant,
  calendarMonth,
  chooseGranularity,
  containsInstant,
  enumerateBuckets,
  periodLengthInDays,
  previousEquivalent,
  resolvePeriod,
  toPeriodDto,
} from '@/server/domain/period/period'

const TZ = 'Asia/Tashkent' // UTC+5, no daylight saving

/** 23 August 2026, 14:30 Tashkent == 09:30 UTC. */
const NOW = new Date('2026-08-23T09:30:00.000Z')

/** Render an instant as the wall-clock time a Tashkent user would see. */
function inTashkent(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(d)
}

describe('preset boundaries land on local midnight', () => {
  it('resolves today as local midnight to local midnight', () => {
    const period = resolvePeriod('today', { timeZone: TZ, now: NOW })
    expect(inTashkent(period.start)).toBe('2026-08-23 00:00:00')
    expect(inTashkent(period.end)).toBe('2026-08-24 00:00:00')
    // Tashkent is UTC+5, so local midnight is 19:00 UTC the day before.
    expect(period.start.toISOString()).toBe('2026-08-22T19:00:00.000Z')
  })

  it('resolves yesterday', () => {
    const period = resolvePeriod('yesterday', { timeZone: TZ, now: NOW })
    expect(inTashkent(period.start)).toBe('2026-08-22 00:00:00')
    expect(inTashkent(period.end)).toBe('2026-08-23 00:00:00')
  })

  it('resolves this_week from Monday, week-to-date', () => {
    // 23 Aug 2026 is a Sunday; the ISO week began Monday 17 Aug.
    const period = resolvePeriod('this_week', { timeZone: TZ, now: NOW })
    expect(inTashkent(period.start)).toBe('2026-08-17 00:00:00')
    expect(inTashkent(period.end)).toBe('2026-08-24 00:00:00')
  })

  it('resolves this_month as month-to-date, not the whole month', () => {
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    expect(inTashkent(period.start)).toBe('2026-08-01 00:00:00')
    expect(inTashkent(period.end)).toBe('2026-08-24 00:00:00')
    expect(periodLengthInDays(period)).toBe(23)
  })

  it('resolves previous_month as a whole calendar month', () => {
    const period = resolvePeriod('previous_month', { timeZone: TZ, now: NOW })
    expect(inTashkent(period.start)).toBe('2026-07-01 00:00:00')
    expect(inTashkent(period.end)).toBe('2026-08-01 00:00:00')
    expect(periodLengthInDays(period)).toBe(31)
  })

  it('resolves this_year as year-to-date', () => {
    const period = resolvePeriod('this_year', { timeZone: TZ, now: NOW })
    expect(inTashkent(period.start)).toBe('2026-01-01 00:00:00')
    expect(inTashkent(period.end)).toBe('2026-08-24 00:00:00')
  })
})

describe('timezone correctness', () => {
  it('puts a late-evening local instant in the correct local day', () => {
    // 23:30 on 23 Aug in Tashkent is 18:30 UTC — still the 23rd locally.
    const lateEvening = new Date('2026-08-23T18:30:00.000Z')
    const period = resolvePeriod('today', { timeZone: TZ, now: lateEvening })
    expect(inTashkent(period.start)).toBe('2026-08-23 00:00:00')
  })

  it('rolls to the next local day once UTC crosses 19:00', () => {
    // 19:30 UTC is already 00:30 on the 24th in Tashkent.
    const justAfterLocalMidnight = new Date('2026-08-23T19:30:00.000Z')
    const period = resolvePeriod('today', { timeZone: TZ, now: justAfterLocalMidnight })
    expect(inTashkent(period.start)).toBe('2026-08-24 00:00:00')
  })

  it('produces different boundaries for different timezones', () => {
    const tashkent = resolvePeriod('today', { timeZone: TZ, now: NOW })
    const utc = resolvePeriod('today', { timeZone: 'UTC', now: NOW })
    expect(tashkent.start.toISOString()).not.toBe(utc.start.toISOString())
  })
})

describe('half-open interval contract', () => {
  it('includes the start instant and excludes the end instant', () => {
    const period = resolvePeriod('today', { timeZone: TZ, now: NOW })
    expect(containsInstant(period, period.start)).toBe(true)
    expect(containsInstant(period, period.end)).toBe(false)
    expect(containsInstant(period, new Date(period.end.getTime() - 1))).toBe(true)
  })

  it('tiles consecutive periods with no gap and no overlap', () => {
    const today = resolvePeriod('today', { timeZone: TZ, now: NOW })
    const yesterday = resolvePeriod('yesterday', { timeZone: TZ, now: NOW })
    expect(yesterday.end.getTime()).toBe(today.start.getTime())
  })
})

describe('custom ranges', () => {
  it('expands an inclusive end date to the following midnight', () => {
    const period = resolvePeriod('custom', {
      timeZone: TZ,
      now: NOW,
      customStart: new Date('2026-08-01T00:00:00.000Z'),
      customEnd: new Date('2026-08-23T00:00:00.000Z'),
    })
    expect(inTashkent(period.start)).toBe('2026-08-01 00:00:00')
    expect(inTashkent(period.end)).toBe('2026-08-24 00:00:00')
    expect(periodLengthInDays(period)).toBe(23)
  })

  it('accepts a single-day range', () => {
    const period = resolvePeriod('custom', {
      timeZone: TZ,
      now: NOW,
      customStart: new Date('2026-08-10T00:00:00.000Z'),
      customEnd: new Date('2026-08-10T00:00:00.000Z'),
    })
    expect(periodLengthInDays(period)).toBe(1)
  })

  it('rejects a missing bound', () => {
    expect(() => resolvePeriod('custom', { timeZone: TZ, now: NOW })).toThrow(
      InvalidPeriodError,
    )
  })

  it('rejects an inverted range', () => {
    expect(() =>
      resolvePeriod('custom', {
        timeZone: TZ,
        now: NOW,
        customStart: new Date('2026-08-23T00:00:00.000Z'),
        customEnd: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).toThrow(InvalidPeriodError)
  })

  it('rejects an invalid date', () => {
    expect(() =>
      resolvePeriod('custom', {
        timeZone: TZ,
        now: NOW,
        customStart: new Date('nonsense'),
        customEnd: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).toThrow(InvalidPeriodError)
  })
})

describe('previousEquivalent', () => {
  it('compares month-to-date against the same days of the previous month', () => {
    // This is the exact comparison the business specified: Aug 1-23 vs Jul 1-23.
    const current = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const previous = previousEquivalent(current)

    expect(inTashkent(previous.start)).toBe('2026-07-01 00:00:00')
    expect(inTashkent(previous.end)).toBe('2026-07-24 00:00:00')
    expect(periodLengthInDays(previous)).toBe(23)
    expect(previous.isTruncated).toBe(false)
  })

  it('gives the two periods equal length so the comparison is fair', () => {
    const current = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const previous = previousEquivalent(current)
    expect(periodLengthInDays(previous)).toBe(periodLengthInDays(current))
  })

  it('caps at the month end when the previous month is shorter', () => {
    // Whole of March (31 days) has no 31-day counterpart in February.
    const march = resolvePeriod('previous_month', {
      timeZone: TZ,
      now: new Date('2026-04-15T09:00:00.000Z'),
    })
    expect(periodLengthInDays(march)).toBe(31)

    const february = previousEquivalent(march)
    expect(inTashkent(february.start)).toBe('2026-02-01 00:00:00')
    expect(inTashkent(february.end)).toBe('2026-03-01 00:00:00')
    expect(periodLengthInDays(february)).toBe(28)
    // Flagged, so the UI can disclose that the windows differ in length.
    expect(february.isTruncated).toBe(true)
  })

  it('shifts today back exactly one day', () => {
    const today = resolvePeriod('today', { timeZone: TZ, now: NOW })
    const previous = previousEquivalent(today)
    expect(inTashkent(previous.start)).toBe('2026-08-22 00:00:00')
    expect(inTashkent(previous.end)).toBe('2026-08-23 00:00:00')
  })

  it('shifts a week back by exactly seven days', () => {
    const week = resolvePeriod('this_week', { timeZone: TZ, now: NOW })
    const previous = previousEquivalent(week)
    expect(inTashkent(previous.start)).toBe('2026-08-10 00:00:00')
    expect(inTashkent(previous.end)).toBe('2026-08-17 00:00:00')
  })

  it('compares year-to-date against the same days of the previous year', () => {
    const year = resolvePeriod('this_year', { timeZone: TZ, now: NOW })
    const previous = previousEquivalent(year)
    expect(inTashkent(previous.start)).toBe('2025-01-01 00:00:00')
    expect(periodLengthInDays(previous)).toBe(periodLengthInDays(year))
  })

  it('uses the immediately preceding window for a custom range', () => {
    const custom = resolvePeriod('custom', {
      timeZone: TZ,
      now: NOW,
      customStart: new Date('2026-08-10T00:00:00.000Z'),
      customEnd: new Date('2026-08-19T00:00:00.000Z'),
    })
    const previous = previousEquivalent(custom)
    expect(periodLengthInDays(previous)).toBe(10)
    expect(previous.end.getTime()).toBe(custom.start.getTime())
    expect(inTashkent(previous.start)).toBe('2026-07-31 00:00:00')
  })
})

describe('bucketing', () => {
  it('picks day granularity for short periods', () => {
    expect(
      chooseGranularity(resolvePeriod('this_month', { timeZone: TZ, now: NOW })),
    ).toBe('day')
  })

  it('picks week granularity for a year-to-date period', () => {
    expect(
      chooseGranularity(resolvePeriod('this_year', { timeZone: TZ, now: NOW })),
    ).toBe('week')
  })

  it('produces one bucket per day and tiles the period exactly', () => {
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const buckets = enumerateBuckets(period, 'day')

    expect(buckets).toHaveLength(23)
    expect(buckets[0]!.start.getTime()).toBe(period.start.getTime())
    expect(buckets.at(-1)!.end.getTime()).toBe(period.end.getTime())

    // No gaps, no overlaps.
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]!.start.getTime()).toBe(buckets[i - 1]!.end.getTime())
    }
  })

  it('clips the first and last buckets to the period', () => {
    const period = resolvePeriod('custom', {
      timeZone: TZ,
      now: NOW,
      customStart: new Date('2026-01-15T00:00:00.000Z'),
      customEnd: new Date('2026-03-20T00:00:00.000Z'),
    })
    const buckets = enumerateBuckets(period, 'month')

    expect(buckets).toHaveLength(3)
    // A month bucket would start on 1 January; it is clipped to the 15th.
    expect(buckets[0]!.start.getTime()).toBe(period.start.getTime())
    expect(buckets.at(-1)!.end.getTime()).toBe(period.end.getTime())
  })

  it('returns a single bucket for a one-day period', () => {
    const period = resolvePeriod('today', { timeZone: TZ, now: NOW })
    expect(enumerateBuckets(period, 'day')).toHaveLength(1)
  })
})

describe('calendarMonth and asOfInstant', () => {
  it('builds a month on local midnight boundaries, not UTC ones', () => {
    // REGRESSION: KPI windows were built with Date.UTC, so an "August" window
    // began five hours before the Tashkent month did. A this-month report then
    // overlapped July's window by that sliver, and the dashboard scored August
    // results against July targets — headline attainment read 246%.
    const month = calendarMonth(NOW, TZ, 0)
    expect(inTashkent(month.start)).toBe('2026-08-01 00:00:00')
    expect(inTashkent(month.end)).toBe('2026-09-01 00:00:00')
    expect(month.start.toISOString()).toBe('2026-07-31T19:00:00.000Z')
  })

  it('offsets backwards by whole months', () => {
    const july = calendarMonth(NOW, TZ, -1)
    expect(inTashkent(july.start)).toBe('2026-07-01 00:00:00')
    expect(inTashkent(july.end)).toBe('2026-08-01 00:00:00')
  })

  it('crosses a year boundary correctly', () => {
    const december = calendarMonth(new Date('2026-02-10T00:00:00.000Z'), TZ, -2)
    expect(inTashkent(december.start)).toBe('2025-12-01 00:00:00')
  })

  it('aligns exactly with the month-to-date reporting period', () => {
    // The two must share a start instant, or containment checks misfire.
    const reporting = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    expect(calendarMonth(NOW, TZ, 0).start.getTime()).toBe(reporting.start.getTime())
  })

  it('places the as-of instant inside its own month, never the next', () => {
    const reporting = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const asOf = asOfInstant(reporting)
    const august = calendarMonth(NOW, TZ, 0)
    const july = calendarMonth(NOW, TZ, -1)

    expect(asOf.getTime()).toBeGreaterThanOrEqual(august.start.getTime())
    expect(asOf.getTime()).toBeLessThan(august.end.getTime())
    // ...and crucially, NOT inside July.
    expect(asOf.getTime()).toBeGreaterThanOrEqual(july.end.getTime())
  })

  it('places a previous-month report inside the previous month', () => {
    const reporting = resolvePeriod('previous_month', { timeZone: TZ, now: NOW })
    const asOf = asOfInstant(reporting)
    const july = calendarMonth(NOW, TZ, -1)

    expect(asOf.getTime()).toBeGreaterThanOrEqual(july.start.getTime())
    expect(asOf.getTime()).toBeLessThan(july.end.getTime())
  })

  it('selects exactly one month for every preset', () => {
    // The containment rule must never match two KPI windows at once.
    const windows = [-2, -1, 0].map((offset) => calendarMonth(NOW, TZ, offset))

    for (const preset of ['today', 'yesterday', 'this_week', 'this_month', 'previous_month'] as const) {
      const asOf = asOfInstant(resolvePeriod(preset, { timeZone: TZ, now: NOW })).getTime()
      const matches = windows.filter(
        (w) => asOf >= w.start.getTime() && asOf < w.end.getTime(),
      )
      expect(matches).toHaveLength(1)
    }
  })
})

describe('toPeriodDto', () => {
  it('serialises with an exclusive end and a day count', () => {
    const dto = toPeriodDto(resolvePeriod('this_month', { timeZone: TZ, now: NOW }))
    expect(dto).toEqual({
      preset: 'this_month',
      start: '2026-07-31T19:00:00.000Z',
      end: '2026-08-23T19:00:00.000Z',
      timeZone: TZ,
      days: 23,
    })
  })
})
