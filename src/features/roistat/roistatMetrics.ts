/**
 * «Roistat» — every ratio on the screen, derived from raw counters.
 *
 * The server sends additive counters only (see `roistatApi.ts`), and this file
 * is the ONE place they become ratios — the tiles, the table, its ИТОГО row and
 * the chart all read `deriveMetrics`. A total's ratio is therefore the ratio of
 * its sums, never an average of the rows' ratios.
 *
 * The definitions are the reference dashboard's `met()`, kept term for term:
 * quality and QL % over Регистрация leads, buyout by MONEY (sold ÷ ordered
 * so'm, not deal counts), ROAS as revenue converted at the CBU rate over the
 * dollar spend. Every ratio is null when its divisor is zero — «no answer» is
 * not «zero», and the UI prints an em dash for it.
 *
 * UNITS STAY NATIVE HERE. Spend-based figures (CPL, CPQL, CPO, CAC, CPM, CPC)
 * are dollars because spend is; revenue-based ones (average cheque, ARPL) are
 * so'm because revenue is. `fromUsd` / `fromUzs` turn either into the
 * currency the reader picked, at the moment it is printed.
 */

import type { DeltaDto } from '@/lib/api'

import type { RoistatCountersDto } from './roistatApi'

export type RoistatCurrency = 'uzs' | 'usd'

export interface RoistatMetrics {
  /** Clean leads ÷ leads, %. «Качество». */
  readonly qual: number | null
  /** Spend ÷ leads, $. */
  readonly cpl: number | null
  /** Kval ÷ leads, %. «QL %». */
  readonly ql: number | null
  /** Spend ÷ kval, $. */
  readonly cpql: number | null
  /** Sold so'm ÷ ordered so'm, %. «Выкуп». */
  readonly buy: number | null
  /** Spend ÷ sales, $. */
  readonly cpo: number | null
  /** Spend ÷ new customers, $. */
  readonly cac: number | null
  /** Sold so'm ÷ sales, so'm. «Средний чек». */
  readonly avg: number | null
  /** Sold so'm ÷ leads, so'm. */
  readonly arpl: number | null
  /** Mean days from lead to closed sale. */
  readonly dealDays: number | null
  /** Sales ÷ leads, %. */
  readonly conv: number | null
  /** Clicks ÷ impressions, %. */
  readonly ctr: number | null
  /** Spend per 1 000 impressions, $. */
  readonly cpm: number | null
  /** Spend ÷ clicks, $. */
  readonly cpc: number | null
  /** Impressions ÷ reach. */
  readonly freq: number | null
  /** Revenue in dollars ÷ spend in dollars. */
  readonly roas: number | null
}

/** `a ÷ b`, or null when there is nothing to divide by. */
function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null
}

function percent(a: number, b: number): number | null {
  const r = ratio(a, b)
  return r === null ? null : r * 100
}

/** A usable CBU rate, or null — a zero or negative rate is as good as none. */
function usableRate(uzsPerUsd: number | null | undefined): number | null {
  return uzsPerUsd !== null && uzsPerUsd !== undefined && uzsPerUsd > 0 ? uzsPerUsd : null
}

/** Revenue (so'm) over spend (dollars), at the window's CBU rate. */
export function roasOf(soldUzs: number, spendUsd: number, uzsPerUsd: number | null): number | null {
  const rate = usableRate(uzsPerUsd)
  if (rate === null || spendUsd <= 0) return null
  return soldUzs / rate / spendUsd
}

/**
 * A cost per unit, or null when no dollar was placed on the row. A row the
 * spend cannot reach («— не указано —», a page no account pays for) would
 * otherwise read «CPL 0» — leads that cost nothing — which is the one thing
 * it does not mean.
 */
function cost(spendUsd: number, units: number): number | null {
  return spendUsd > 0 ? ratio(spendUsd, units) : null
}

export function deriveMetrics(c: RoistatCountersDto, uzsPerUsd: number | null): RoistatMetrics {
  return {
    qual: percent(c.clean, c.leads),
    cpl: cost(c.spendUsd, c.leads),
    ql: percent(c.kval, c.leads),
    cpql: cost(c.spendUsd, c.kval),
    buy: percent(c.soldUzs, c.orderedUzs),
    cpo: cost(c.spendUsd, c.sold),
    cac: cost(c.spendUsd, c.newCustomers),
    avg: ratio(c.soldUzs, c.sold),
    arpl: ratio(c.soldUzs, c.leads),
    dealDays: ratio(c.dealDaysSum, c.dealCount),
    conv: percent(c.sold, c.leads),
    ctr: percent(c.clicks, c.impressions),
    cpm: c.spendUsd > 0 && c.impressions > 0 ? (c.spendUsd / c.impressions) * 1000 : null,
    cpc: cost(c.spendUsd, c.clicks),
    freq: ratio(c.impressions, c.reach),
    roas: roasOf(c.soldUzs, c.spendUsd, uzsPerUsd),
  }
}

/** A dollar figure in the reader's currency; null in so'm when there is no rate. */
export function fromUsd(
  valueUsd: number | null,
  currency: RoistatCurrency,
  uzsPerUsd: number | null,
): number | null {
  if (valueUsd === null) return null
  if (currency === 'usd') return valueUsd
  const rate = usableRate(uzsPerUsd)
  return rate === null ? null : valueUsd * rate
}

/** A so'm figure in the reader's currency; null in dollars when there is no rate. */
export function fromUzs(
  valueUzs: number | null,
  currency: RoistatCurrency,
  uzsPerUsd: number | null,
): number | null {
  if (valueUzs === null) return null
  if (currency === 'uzs') return valueUzs
  const rate = usableRate(uzsPerUsd)
  return rate === null ? null : valueUzs / rate
}

const COUNTER_KEYS = [
  'spendUsd',
  'impressions',
  'reach',
  'clicks',
  'metaLeads',
  'leads',
  'clean',
  'kval',
  'orders',
  'orderedUzs',
  'sold',
  'soldUzs',
  'newCustomers',
  'dealDaysSum',
  'dealCount',
] as const satisfies readonly (keyof RoistatCountersDto)[]

export const ZERO_COUNTERS: RoistatCountersDto = Object.freeze(
  Object.fromEntries(COUNTER_KEYS.map((k) => [k, 0])) as Record<
    (typeof COUNTER_KEYS)[number],
    number
  >,
)

/** Field-by-field sum. Extra fields on the inputs (a row's key and label) are ignored. */
export function sumCounters(rows: readonly RoistatCountersDto[]): RoistatCountersDto {
  const out: Record<(typeof COUNTER_KEYS)[number], number> = { ...ZERO_COUNTERS }
  for (const row of rows) for (const k of COUNTER_KEYS) out[k] += row[k]
  return out
}

/**
 * Signed change from `prev` to `cur`, in percent of `prev` — or null when
 * either side is missing or `prev` is zero (a percentage of nothing).
 */
export function deltaPercent(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

/**
 * The same change in the shape `TrendIndicator` draws.
 *
 * Mirrors the server's `growth()` for the cases a client-side pair can hit,
 * plus the reference's dead band: under half a percent either way reads as
 * «unchanged», because «↑0.2%» on a CPL is noise dressed as a signal. Whether
 * a fall is GOOD (a cost metric) is the indicator's `inverted`, not a swapped
 * pair here — the arrow keeps pointing the way the number actually moved.
 */
export function toDelta(cur: number | null, prev: number | null): DeltaDto {
  if (cur === null || !Number.isFinite(cur)) return { kind: 'no_data' }
  if (prev === null || !Number.isFinite(prev)) return { kind: 'no_baseline' }
  if (prev === 0) return cur === 0 ? { kind: 'unchanged' } : { kind: 'no_baseline' }
  const change = deltaPercent(cur, prev)
  if (change === null || Math.abs(change) < 0.5) return { kind: 'unchanged' }
  return { kind: 'change', percent: change, direction: change > 0 ? 'up' : 'down' }
}
