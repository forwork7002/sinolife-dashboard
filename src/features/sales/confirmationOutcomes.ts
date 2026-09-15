import type { ConfirmationOutcome, FaktTrendPointDto } from '@/lib/api'
import { formatDateShort, formatNumber, formatPercent } from '@/lib/format'

/**
 * The five states of the confirmation queue, as Savdo dinamikasi prints them.
 *
 * WHAT THIS BLOCK IS FOR. FAKT 1 folds Тасдиқланди and Тасдиқланмай чиқди into
 * one figure on purpose — both left the queue as an order and both moved the
 * goods. On 2026-09-15 the client asked to see the fold undone beside it:
 * «tasdiqlanganlar, tasdiqlanmay chiqdilar bilan tasdiqlanmaganlar nisbati».
 * So this is the queue's five-state partition, in the Тасдиқлаш board's own
 * vocabulary, on the screen where a manager reads what the floor sold.
 *
 * ORDER: the three DECIDED states first, in the order the client named them,
 * then the two the queue is still holding. The confirmation page orders them
 * as a process (waiting, stalled, then outcomes) because that page is worked
 * from; this one is read, and the question it answers is "of what came in,
 * how much was confirmed, how much went out unconfirmed, how much was
 * refused" — so those three lead.
 *
 * COLOURS ARE MIRRORED BY HAND from `confirmation/ConfirmationPage` (its
 * `OUTCOMES`): the same token per state, so a colour means one thing on both
 * screens — «colour follows the entity». Nothing checks the mirror; edit both.
 */
export interface OutcomeSpec {
  readonly key: ConfirmationOutcome
  readonly label: string
  readonly colour: string
}

export const OUTCOME_SPECS: readonly OutcomeSpec[] = [
  { key: 'CONFIRMED', label: 'Тасдиқланди', colour: 'var(--status-good)' },
  { key: 'UNCONFIRMED_SHIPPED', label: 'Тасдиқланмай чиқди', colour: 'var(--series-7)' },
  { key: 'REJECTED', label: 'Тасдиқланмади', colour: 'var(--status-critical)' },
  { key: 'NO_ANSWER', label: 'Кутармади (нд)', colour: 'var(--status-warning)' },
  { key: 'CONFIRM_NEW', label: 'Кутилмоқда', colour: 'var(--series-1)' },
]

/**
 * «Тасдиқланиш %» — Тасдиқланди over everything that entered the queue.
 *
 * THE QUEUE BOARD'S OWN ARITHMETIC, digit for digit: `confirmedRate` in
 * `insightsService` rounds `Math.round(x * 1000) / 10`, and so does this, so
 * the tile here and the panel there cannot print two rates for one month.
 * Тасдиқланди ALONE — an order shipped without reaching the customer earns
 * FAKT 1 money but is not a confirmation. Null over nothing: a rate with no
 * denominator is not 0%.
 */
export function confirmedRate(confirmed: number, cohort: number): number | null {
  if (cohort <= 0) return null
  return Math.round((confirmed / cohort) * 1000) / 10
}

export interface RatePoint {
  readonly date: string
  /** Null for a bucket nothing entered — no reading, not a 0% one. */
  readonly rate: number | null
  readonly cohortOrders: number
  readonly byOutcome: FaktTrendPointDto['byOutcome']
}

export interface ConfirmedRateSeries {
  readonly points: readonly RatePoint[]
  /**
   * The period's rate over ALL its orders — the reference drawn across the
   * line, and the same figure the tile above prints.
   *
   * NOT THE MEAN OF THE DAYS. The client asked for the «oʻrtachasi», and the
   * average of thirty daily rates is a different number from the month's
   * rate whenever quiet days are unusual days: a Sunday with three orders at
   * 100% weighs a thirtieth of the month in the first and a thousandth in the
   * second. One screen carries one figure under that name, and it is the one
   * the Тасдиқлаш board calls «тасдиқланиш %».
   */
  readonly pooledRate: number | null
  /** The lowest and highest bucket among those that carried orders; null under two. */
  readonly low: RatePoint | null
  readonly high: RatePoint | null
}

export function confirmedRateSeries(points: readonly FaktTrendPointDto[]): ConfirmedRateSeries {
  const rated: RatePoint[] = points.map((p) => ({
    date: p.date,
    rate: confirmedRate(p.byOutcome.CONFIRMED, p.cohortOrders),
    cohortOrders: p.cohortOrders,
    byOutcome: p.byOutcome,
  }))

  const confirmed = points.reduce((a, p) => a + p.byOutcome.CONFIRMED, 0)
  const cohort = points.reduce((a, p) => a + p.cohortOrders, 0)

  const busy = rated.filter((p): p is RatePoint & { rate: number } => p.rate !== null)
  // Under two buckets with orders there is nothing to spread between — the
  // one reading IS the period's rate. First occurrence wins a tie, so the
  // caption does not jump between two equal days on a refetch.
  const low = busy.length >= 2 ? busy.reduce((l, p) => (p.rate < l.rate ? p : l)) : null
  const high = busy.length >= 2 ? busy.reduce((h, p) => (p.rate > h.rate ? p : h)) : null

  return { points: rated, pooledRate: confirmedRate(confirmed, cohort), low, high }
}

/**
 * The worst and best bucket in one line, each with the orders behind it.
 *
 * The count is the half that stops a misreading: 0% of three orders on a
 * Sunday is not the floor's worst day, and a reader who is shown only the
 * percentage has no way to know that.
 */
export function describeRateSpread(series: ConfirmedRateSeries): string | null {
  const { low, high } = series
  if (!low || !high || low.rate === null || high.rate === null) return null
  // Every bucket at one rate is no spread: the line already says it, and a
  // caption naming the same day twice as both worst and best reads as a bug.
  if (low.rate === high.rate) return null
  const at = (p: RatePoint) => `${formatDateShort(p.date)}, ${formatNumber(p.cohortOrders)} ta buyurtma`
  return `Eng past: ${formatPercent(low.rate)} (${at(low)}) · eng yuqori: ${formatPercent(high.rate)} (${at(high)})`
}
