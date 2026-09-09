import type { FaktTrendPointDto, TrendPointDto } from '@/lib/api'

/**
 * One row of the hero chart on Savdo dinamikasi, once the two answers are
 * merged: revenue from `/analytics/sales`, FAKT 1 / FAKT 2 from
 * `/analytics/sellers?include=faktTrend`.
 *
 * The three money fields are all plain soʻm numbers on ONE y axis. No second
 * axis, deliberately — a dual-axis chart lets the author imply any correlation
 * they like by rescaling, and this chart's whole purpose is that the reader
 * compares the magnitudes themselves.
 */
export interface FaktChartPoint extends TrendPointDto {
  readonly fakt1: number | null
  readonly fakt2: number | null
  readonly faktOrders: number | null
}

/**
 * Zip the FAKT series onto the revenue trend's own x axis.
 *
 * THE AREA OWNS THE AXIS. Both endpoints bucket the same period through
 * `enumerateBuckets`, so their dates are equal strings in the ordinary case —
 * but they are two responses, and one can be a poll older than the other, or
 * narrowed by a filter the other does not honour. A FAKT point with no revenue
 * point to sit on is therefore DROPPED rather than appended: Recharts draws
 * the array it is given, so an extra row would run the x axis past the revenue
 * the chart is headlined with, and the money would appear to stop while the
 * lines carried on.
 *
 * A revenue bucket with no FAKT point gets `null`, not `0`. The service
 * zero-fills every bucket it was asked for, so a missing one means "not
 * answered", and Recharts draws a gap for a null and a point on the floor for
 * a zero — two different claims about the same day.
 */
export function mergeFaktSeries(
  trend: readonly TrendPointDto[],
  fakt: readonly FaktTrendPointDto[] | undefined,
): FaktChartPoint[] {
  const byDate = new Map((fakt ?? []).map((point) => [point.date, point]))

  return trend.map((point) => {
    const match = byDate.get(point.date)
    return {
      ...point,
      fakt1: match?.fakt1 ?? null,
      fakt2: match?.fakt2 ?? null,
      faktOrders: match?.orders ?? null,
    }
  })
}
