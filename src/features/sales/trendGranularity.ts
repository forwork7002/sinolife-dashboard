/**
 * What one point of the queue-cohort trend is — a day, a week or a month.
 *
 * The server widens the bucket as the window grows (`chooseGranularity`:
 * daily to 62 days, weekly to 365, monthly past that) and the payload carries
 * no granularity field, so the screen reads it off the points. Three captions
 * on Savdo dinamikasi say it: the FAKT chart's, and the rate chart's heading
 * and legend.
 *
 * THE WIDEST GAP, NEVER THE FIRST. `enumerateBuckets` clips the first bucket
 * to the window's start, so a weekly range opening on a Sunday starts with a
 * one-day bucket and a monthly one opening mid-month with a short one. Read
 * off the first gap, a 115-day range of weeks was captioned «kunlik» and a
 * year and a half of months «haftalik», and «Yil → 2026» printed forty-one
 * weekly points under «har bir kun uchun» (measured 2026-10-06). Every bucket
 * between the first and the last is whole, and `faktTrend` emits every bucket
 * — quiet ones included — so the widest gap IS the stride.
 *
 * Null under two points, where there is nothing to measure — and the captions
 * then make no claim rather than guess one.
 */
export type TrendGranularity = 'day' | 'week' | 'month'

export function trendGranularity(
  points: readonly { readonly date: string }[],
): TrendGranularity | null {
  if (points.length < 2) return null

  let widest = 0
  for (let i = 1; i < points.length; i++) {
    widest = Math.max(widest, Date.parse(points[i]!.date) - Date.parse(points[i - 1]!.date))
  }

  const days = widest / 86_400_000
  if (days <= 2) return 'day'
  if (days <= 10) return 'week'
  return 'month'
}
