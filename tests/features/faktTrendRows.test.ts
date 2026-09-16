import { describe, expect, it } from 'vitest'

import { chartRows } from '@/components/charts/FaktTrendChart'
import type { FaktForecastPointDto, FaktTrendPointDto } from '@/lib/api'

/**
 * WHERE THE MEASUREMENT STOPS AND THE PROJECTION STARTS.
 *
 * Savdo dinamikasi's trend runs past today since 2026-09-16 — solid to the
 * last bucket the queue has actually filled, dashed to the end of the period.
 * Recharts draws ONE dataset, so both halves ride one array and each row nulls
 * the keys the other half owns.
 *
 * EVERY WAY THIS BREAKS STILL DRAWS A CHART, which is why it is pinned here
 * rather than left to the eye:
 *
 *  · no junction — the dashed line starts a bucket right of where the solid
 *    one ends, and the hole between them reads as missing data
 *  · junction on every point — the dashed stroke is laid over the whole
 *    measured line, and the reader is shown a month of forecast
 *  · measured keys left set on a projected row — the solid line runs to the
 *    30th, asserting delivery that has not happened
 */

const day = (date: string, fakt1: number, fakt2: number): FaktTrendPointDto =>
  ({ date, fakt1, fakt2, orders: 3 }) as unknown as FaktTrendPointDto

const projected = (date: string, fakt1: number, fakt2: number): FaktForecastPointDto => ({
  date,
  fakt1,
  fakt2,
})

const MEASURED = [
  day('2026-09-08T00:00:00.000Z', 100, 40),
  day('2026-09-09T00:00:00.000Z', 120, 50),
]
const FORECAST = [
  projected('2026-09-10T00:00:00.000Z', 110, 45),
  projected('2026-09-11T00:00:00.000Z', 110, 45),
]

describe('weaving the forecast into the trend Recharts draws', () => {
  it('joins the two strokes on the last measured bucket', () => {
    const rows = chartRows(MEASURED, FORECAST)
    const junction = rows[MEASURED.length - 1]!

    // The same value on both keys: one point drawn twice, so the dashed line
    // leaves exactly where the solid one arrives.
    expect(junction.fakt1).toBe(120)
    expect(junction.fakt1Projected).toBe(120)
    expect(junction.fakt2Projected).toBe(50)
    expect(junction.projected).toBe(false)
  })

  it('seeds ONLY the last measured bucket, never the ones before it', () => {
    const rows = chartRows(MEASURED, FORECAST)

    // Recharts breaks a line at a null, and these nulls are the only thing
    // keeping the dashed stroke off the measured half of the chart.
    expect(rows[0]!.fakt1Projected).toBeNull()
    expect(rows[0]!.fakt2Projected).toBeNull()
  })

  it('nulls the measured keys on every projected bucket', () => {
    const rows = chartRows(MEASURED, FORECAST)
    const future = rows.filter((row) => row.projected)

    expect(future).toHaveLength(2)
    for (const row of future) {
      expect(row.fakt1).toBeNull()
      expect(row.fakt2).toBeNull()
      /* An order count is never projected — a run-rate projects money, and a
         projected count printed in a tooltip beside measured ones is a number
         a reader will quote. */
      expect(row.orders).toBeNull()
    }
  })

  it('keeps the measured points first and in order, so the x scale is one calendar', () => {
    const rows = chartRows(MEASURED, FORECAST)

    expect(rows.map((row) => row.date)).toEqual([
      '2026-09-08T00:00:00.000Z',
      '2026-09-09T00:00:00.000Z',
      '2026-09-10T00:00:00.000Z',
      '2026-09-11T00:00:00.000Z',
    ])
  })

  it('opens no junction at all when there is nothing to project', () => {
    /*
      A finished period, and the last day of a month, both arrive here with an
      empty forecast. The chart must then be exactly what it was before this
      feature — no dashed keys set anywhere, so nothing is drawn and the
      endpoint figures keep the right edge to themselves.
    */
    const rows = chartRows(MEASURED, [])

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.fakt1Projected).toBeNull()
      expect(row.fakt2Projected).toBeNull()
      expect(row.projected).toBe(false)
    }
  })

  it('draws the forecast alone rather than throwing when nothing has landed yet', () => {
    // The first morning of a month reaches this with an empty cohort. There is
    // no last measured bucket to seed, and `data.length - 1` is -1 — an index
    // that must simply match nothing.
    const rows = chartRows([], FORECAST)

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.projected)).toBe(true)
  })
})
