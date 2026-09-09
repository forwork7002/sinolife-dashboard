import { describe, expect, it } from 'vitest'

import { mergeFaktSeries } from '@/components/charts/faktSeries'
import type { FaktTrendPointDto, TrendPointDto } from '@/lib/api'

/**
 * Zipping the FAKT lines onto the revenue area's own x axis.
 *
 * TWO ENDPOINTS, ONE CHART. The area comes from `/analytics/sales` and the two
 * lines from `/analytics/sellers?include=faktTrend`; both bucket the same
 * period through `enumerateBuckets`, so in practice their dates are equal
 * strings. This function is what happens when they are NOT — a filter one
 * endpoint honours and the other does not, one response a poll older than the
 * other, an empty window.
 *
 * THE RULE IS THAT THE AREA OWNS THE AXIS. A FAKT point with no revenue point
 * to sit on is DROPPED rather than appended: Recharts draws from the array it
 * is given, so an extra row would extend the x axis past the revenue the chart
 * is headlined with, and the reader would see the money stop while the lines
 * carried on. A revenue point with no FAKT point gets a null, which breaks the
 * line there instead of drawing a zero the queue never reported.
 */

const trendPoint = (date: string, revenue: number): TrendPointDto => ({
  date,
  revenue,
  dealsWon: 1,
  dealsCreated: 1,
})

const faktPoint = (date: string, fakt1: number, fakt2: number): FaktTrendPointDto => ({
  date,
  fakt1,
  fakt2,
  orders: 3,
})

describe('merging the FAKT lines onto the revenue axis', () => {
  it('leaves the trend untouched when there is nothing to merge', () => {
    const trend = [trendPoint('2026-09-01T00:00:00.000Z', 100)]

    expect(mergeFaktSeries(trend, undefined)).toEqual([
      { ...trend[0], fakt1: null, fakt2: null, faktOrders: null },
    ])
    expect(mergeFaktSeries(trend, [])).toEqual([
      { ...trend[0], fakt1: null, fakt2: null, faktOrders: null },
    ])
  })

  it('zips on the bucket start, which both endpoints write identically', () => {
    const merged = mergeFaktSeries(
      [trendPoint('2026-09-01T00:00:00.000Z', 100), trendPoint('2026-09-02T00:00:00.000Z', 200)],
      [faktPoint('2026-09-02T00:00:00.000Z', 55, 40)],
    )

    expect(merged.map((p) => p.fakt1)).toEqual([null, 55])
    expect(merged.map((p) => p.fakt2)).toEqual([null, 40])
    expect(merged.map((p) => p.faktOrders)).toEqual([null, 3])
    // The revenue it was drawn from is carried through unchanged.
    expect(merged.map((p) => p.revenue)).toEqual([100, 200])
  })

  it('never lengthens the axis with a FAKT point the revenue has no bucket for', () => {
    const merged = mergeFaktSeries(
      [trendPoint('2026-09-01T00:00:00.000Z', 100)],
      [faktPoint('2026-09-01T00:00:00.000Z', 10, 5), faktPoint('2026-09-02T00:00:00.000Z', 20, 9)],
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ fakt1: 10, fakt2: 5 })
  })

  it('breaks the line rather than drawing a zero where the queue said nothing', () => {
    // A null and a zero are different claims, and the difference is visible:
    // Recharts draws a gap for the first and a point on the floor for the
    // second. A day the queue reported as empty IS a zero and arrives as one.
    const merged = mergeFaktSeries(
      [trendPoint('2026-09-01T00:00:00.000Z', 100), trendPoint('2026-09-02T00:00:00.000Z', 200)],
      [faktPoint('2026-09-01T00:00:00.000Z', 0, 0)],
    )

    expect(merged[0]).toMatchObject({ fakt1: 0, fakt2: 0 })
    expect(merged[1]).toMatchObject({ fakt1: null, fakt2: null })
  })

  it('reports whether anything was actually matched', () => {
    // The chart uses this to decide whether to print a legend and a second
    // basis line at all: a legend naming two series that are entirely null is
    // chrome describing nothing.
    expect(mergeFaktSeries([trendPoint('2026-09-01T00:00:00.000Z', 1)], []).some(
      (p) => p.fakt1 !== null,
    )).toBe(false)
    expect(
      mergeFaktSeries(
        [trendPoint('2026-09-01T00:00:00.000Z', 1)],
        [faktPoint('2026-09-01T00:00:00.000Z', 0, 0)],
      ).some((p) => p.fakt1 !== null),
    ).toBe(true)
  })
})
