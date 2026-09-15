import { describe, expect, it } from 'vitest'

import type { FaktTrendPointDto } from '@/lib/api'
import {
  confirmedRate,
  confirmedRateSeries,
  describeRateSpread,
} from '@/features/sales/confirmationOutcomes'

/**
 * The confirmation-rate line under the hero on Savdo dinamikasi, and the
 * «davr oʻrtachasi» drawn across it.
 *
 * Two readings of one series are easy to conflate, and the client asked for
 * the second by name («oʻrtachasi»): the average of the DAYS' rates, and the
 * period's rate over ALL its orders. They differ whenever quiet days are
 * unusual days — a Sunday with three orders at 100% weighs a thirtieth of the
 * month in the first and a thousandth in the second. The line's reference is
 * the second, because it is the figure the tile above prints and the figure
 * the Тасдиқлаш board calls «тасдиқланиш %», and one screen may not carry two
 * averages under one name.
 */

const point = (
  date: string,
  states: Partial<Record<'CONFIRMED' | 'REJECTED' | 'UNCONFIRMED_SHIPPED' | 'NO_ANSWER' | 'CONFIRM_NEW', number>>,
): FaktTrendPointDto => {
  const byOutcome = { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 0, REJECTED: 0, UNCONFIRMED_SHIPPED: 0, ...states }
  return {
    date,
    fakt1: 0,
    fakt2: 0,
    orders: byOutcome.CONFIRMED + byOutcome.UNCONFIRMED_SHIPPED,
    byOutcome,
    cohortOrders: Object.values(byOutcome).reduce((a, n) => a + n, 0),
  }
}

describe('confirmedRate', () => {
  it('is Тасдиқланди over the whole cohort, to one decimal, the way the queue board rounds it', () => {
    // August 2026 on production: 2 873 of 3 222.
    expect(confirmedRate(2873, 3222)).toBe(89.2)
  })

  it('is null over nothing, never 0 or NaN', () => {
    expect(confirmedRate(0, 0)).toBeNull()
  })
})

describe('confirmedRateSeries', () => {
  it('rates every bucket that carried orders, and leaves an empty bucket without a rate', () => {
    const series = confirmedRateSeries([
      point('2026-09-01T00:00:00Z', { CONFIRMED: 8, REJECTED: 2 }),
      point('2026-09-02T00:00:00Z', {}),
    ])

    expect(series.points[0]!.rate).toBe(80)
    // No orders is not a 0% day: nothing was confirmed because nothing came in.
    expect(series.points[1]!.rate).toBeNull()
    expect(series.points[1]!.cohortOrders).toBe(0)
  })

  it('rates a day of pure refusals at 0, which IS a reading', () => {
    const series = confirmedRateSeries([point('2026-09-01T00:00:00Z', { REJECTED: 5 })])
    expect(series.points[0]!.rate).toBe(0)
  })

  it('pools the period over its orders rather than averaging the days', () => {
    const series = confirmedRateSeries([
      point('2026-09-01T00:00:00Z', { CONFIRMED: 80, REJECTED: 20 }), // 80% of 100
      point('2026-09-02T00:00:00Z', { CONFIRMED: 10 }), // 100% of 10
    ])

    // 90 of 110, not the 90.0 a mean of the two days would print.
    expect(series.pooledRate).toBe(81.8)
  })

  it('counts Тасдиқланди alone as a confirmation — not the FAKT 1 pair', () => {
    const series = confirmedRateSeries([
      point('2026-09-01T00:00:00Z', { CONFIRMED: 6, UNCONFIRMED_SHIPPED: 4 }),
    ])
    expect(series.points[0]!.rate).toBe(60)
    expect(series.pooledRate).toBe(60)
  })

  it('names the lowest and highest bucket among those that carried orders', () => {
    const series = confirmedRateSeries([
      point('2026-09-01T00:00:00Z', { CONFIRMED: 9, REJECTED: 1 }),
      point('2026-09-02T00:00:00Z', {}),
      point('2026-09-03T00:00:00Z', { CONFIRMED: 5, REJECTED: 5 }),
      point('2026-09-04T00:00:00Z', { CONFIRMED: 10 }),
    ])

    expect(series.low?.date).toBe('2026-09-03T00:00:00Z')
    expect(series.low?.rate).toBe(50)
    expect(series.high?.date).toBe('2026-09-04T00:00:00Z')
    expect(series.high?.rate).toBe(100)
  })

  it('has no spread to report under two buckets with orders', () => {
    const series = confirmedRateSeries([
      point('2026-09-01T00:00:00Z', { CONFIRMED: 9, REJECTED: 1 }),
      point('2026-09-02T00:00:00Z', {}),
    ])

    expect(series.pooledRate).toBe(90)
    expect(series.low).toBeNull()
    expect(series.high).toBeNull()
    expect(describeRateSpread(series)).toBeNull()
  })

  it('is empty, with no rate at all, over no points', () => {
    const series = confirmedRateSeries([])
    expect(series.points).toHaveLength(0)
    expect(series.pooledRate).toBeNull()
  })
})

describe('describeRateSpread', () => {
  it('says nothing when every bucket sits at one rate — the same day is not both worst and best', () => {
    const series = confirmedRateSeries([
      point('2026-09-03T00:00:00Z', { CONFIRMED: 6 }),
      point('2026-09-04T00:00:00Z', { CONFIRMED: 3 }),
    ])
    expect(series.low).not.toBeNull()
    expect(describeRateSpread(series)).toBeNull()
  })

  it('states the worst and best bucket with the orders behind each, so a 0% of three orders is readable as noise', () => {
    const series = confirmedRateSeries([
      point('2026-09-01T00:00:00Z', { CONFIRMED: 96, REJECTED: 4 }),
      point('2026-09-07T00:00:00Z', { CONFIRMED: 2, REJECTED: 1 }),
    ])

    const text = describeRateSpread(series)!
    expect(text).toContain('66.7%')
    expect(text).toContain('7-sen')
    expect(text).toContain('3 ta')
    expect(text).toContain('96.0%')
    expect(text).toContain('1-sen')
  })
})
