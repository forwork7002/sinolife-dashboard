/**
 * Marketing-specific presentation: two currencies, four graded metrics, and
 * the date labels the `days` dimension needs.
 *
 * Everything here is TEXT, never arithmetic on money that matters — the
 * amounts arrive exact from the API. The one calculation that does happen is
 * the currency conversion, and it is deliberately in one place: `mU` and `mS`
 * in logic.js are the single easiest thing in this module to get backwards,
 * and a converter spread over twenty call sites is a converter that will be.
 */

import type { DeltaDto } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent } from '@/lib/format'

export type CurrencyMode = 'uzs' | 'usd'

/**
 * How much precision a money cell needs.
 *
 * `unit` prints every soʻm: a CPL of 16 744 soʻm compacted to "16,7 ming"
 * throws away the digits the number exists for. `compact` is for the totals
 * that run to ten digits, where "4,2 mlrd" is read faster and the exact figure
 * is one hover away on the tiles and the JAMI row.
 */
export type MoneyScale = 'unit' | 'compact'

const usdUnitFormat = new Intl.NumberFormat('uz-UZ', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const usdRoundFormat = new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 })

/**
 * A dollar amount as text.
 *
 * Cents below a thousand, whole dollars above it: $1,42 is a CPL and the cents
 * are the point; $18 035,44 is a period's ad spend and the cents are noise in
 * a column the eye is scanning for magnitude.
 */
export function formatUsd(amount: number): string {
  return `$${Math.abs(amount) < 1000 ? usdUnitFormat.format(amount) : usdRoundFormat.format(amount)}`
}

function formatUzsAt(amount: number, scale: MoneyScale): string {
  return scale === 'compact'
    ? `${formatCompactUzs(amount)} soʻm`
    : `${formatNumber(Math.round(amount))} soʻm`
}

/**
 * A USD-NATIVE amount (`mU` in logic.js): ad spend and every cost-per-X.
 *
 * In soʻm mode it is MULTIPLIED by the rate. Getting this the wrong way round
 * turns a $1.42 lead into a 0.00012 soʻm lead, which is why the two converters
 * are named after the source unit rather than after the target.
 */
export function moneyFromUsd(
  amount: number | null,
  mode: CurrencyMode,
  rate: number,
  scale: MoneyScale = 'unit',
): string {
  if (amount === null) return NO_VALUE
  return mode === 'usd' ? formatUsd(amount) : formatUzsAt(amount * rate, scale)
}

/**
 * A UZS-NATIVE amount (`mS` in logic.js): ordered, revenue, cheque, ARPL.
 *
 * In dollar mode it is DIVIDED by the rate.
 */
export function moneyFromUzs(
  amount: number | null,
  mode: CurrencyMode,
  rate: number,
  scale: MoneyScale = 'compact',
): string {
  if (amount === null) return NO_VALUE
  return mode === 'usd' ? formatUsd(amount / rate) : formatUzsAt(amount, scale)
}

/** The exact figure, for the tooltip behind a compacted one. */
export function exactFromUsd(amount: number | null, mode: CurrencyMode, rate: number): string {
  return moneyFromUsd(amount, mode, rate, 'unit')
}

export function exactFromUzs(amount: number | null, mode: CurrencyMode, rate: number): string {
  return moneyFromUzs(amount, mode, rate, 'unit')
}

/** A count, or an em dash. Never a zero standing in for "unknown". */
export function count(value: number | null): string {
  return value === null ? NO_VALUE : formatNumber(Math.round(value))
}

/** A plain ratio with two decimals — frequency, ROAS. */
export function ratio(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return NO_VALUE
  return new Intl.NumberFormat('uz-UZ', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

// ---------------------------------------------------------------------------
// Grading — the numbers are theirs, the colours are ours
// ---------------------------------------------------------------------------

export type Grade = 'good' | 'warning' | 'critical'

export interface Thresholds {
  readonly good: number
  readonly warning: number
}

/** From `bd()` / `ro()` in logic.js. The thresholds are the client's, verbatim. */
export const QUALITY_THRESHOLDS: Thresholds = Object.freeze({ good: 80, warning: 60 })
export const QL_THRESHOLDS: Thresholds = Object.freeze({ good: 30, warning: 15 })
export const BUYOUT_THRESHOLDS: Thresholds = Object.freeze({ good: 80, warning: 60 })
export const ROAS_THRESHOLDS: Thresholds = Object.freeze({ good: 3, warning: 1.5 })

export function gradeOf(value: number | null, thresholds: Thresholds): Grade | null {
  if (value === null || !Number.isFinite(value)) return null
  if (value >= thresholds.good) return 'good'
  if (value >= thresholds.warning) return 'warning'
  return 'critical'
}

/**
 * The word that ships with the colour.
 *
 * Short on purpose — these ride in table cells beside their number, four
 * columns wide — but a word all the same: colour is never the only channel,
 * and a chip's glyph alone tells a reader "something about this is graded"
 * without saying which way.
 */
export const GRADE_WORDS: Readonly<Record<Grade, string>> = Object.freeze({
  good: 'yaxshi',
  warning: 'oʻrta',
  critical: 'past',
})

// ---------------------------------------------------------------------------
// Period-over-period change
// ---------------------------------------------------------------------------

/**
 * Two numbers -> the house DeltaDto.
 *
 * `dl()` in logic.js is: no previous, a zero previous or no current renders a
 * dash; a change under half a per cent renders flat; otherwise the signed
 * percentage. Our DeltaDto says all of that with more precision — `no_data`
 * versus `no_baseline` are different facts and the pill prints different words
 * for them — so the mapping is written out rather than collapsed.
 *
 * INVERSION IS NOT DONE HERE. Their page inverts CPL/CPO/CAC/DealTime by
 * swapping the arguments, which flips the arrow as well as the judgement, so a
 * FALLING cost draws an up arrow. Ours keeps the arrow pointing the way the
 * number actually moved and passes `inverted` to TrendIndicator, which colours
 * the fall green. Same verdict, honest arrow.
 */
export function deltaOf(current: number | null, previous: number | null): DeltaDto {
  if (current === null || previous === null) return { kind: 'no_data' }
  if (previous === 0) return current === 0 ? { kind: 'unchanged' } : { kind: 'no_baseline' }

  const percent = ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(percent) < 0.5) return { kind: 'unchanged' }

  return {
    kind: 'change',
    percent: Math.abs(percent),
    direction: percent > 0 ? 'up' : 'down',
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Uzbek month names, written out.
 *
 * The same reason `src/lib/format.ts` tabulates its short months: real
 * Chromium builds ship no Uzbek month names and fall back to the literal CLDR
 * pattern, so `Intl` renders "2026 M07" where a reader expects "Iyul".
 */
const UZ_MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
] as const

/** `2026-07-01` -> `Iyul 2026`. For the monthly buckets before `dailyFrom`. */
export function monthLabel(isoDate: string): string {
  const [year, month] = isoDate.split('-')
  const index = Number(month) - 1
  return `${UZ_MONTHS[index] ?? month} ${year}`
}

/** `2026-07-01` -> `01.07.2026`. The stamp format the source itself prints. */
export function dayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${day}.${month}.${year}`
}

/** `2026-07-01` -> `01.07`, for a dense axis. */
export function dayShortLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  return `${day}.${month}`
}

/** A percentage, or an em dash. Thin wrapper so cells read the same everywhere. */
export function percent(value: number | null, digits = 1): string {
  return formatPercent(value, digits)
}
