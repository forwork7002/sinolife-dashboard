/**
 * Marketing (Roistat) metrics.
 *
 * A faithful port of `met()` in the client's published dashboard
 * (scratchpad/roistat/logic.js). That file is the specification, not a hint:
 * every formula, every threshold and every null case below is theirs, and the
 * numbers this module produces have to match what their page prints.
 *
 * Pure and framework-free like the rest of the domain layer — no Prisma, no
 * transport types — so the whole metric surface can be unit tested without a
 * database, which is the only way to be sure a currency direction has not
 * quietly flipped.
 *
 * TWO THINGS THIS FILE EXISTS TO GET RIGHT
 *
 * 1. NULL ON A ZERO DENOMINATOR, ALWAYS. Every derived figure returns null
 *    when the thing it divides by is zero or absent. Their page renders that
 *    as an em dash and so do we. A CPL of 0 would read as "leads are free";
 *    the truth is "no leads, so there is no cost per lead".
 *
 * 2. THE CURRENCY DIRECTION. The source mixes two currencies in one row and we
 *    keep them apart rather than converting on import (see the Marketing block
 *    in prisma/schema.prisma):
 *      - `spendMicroUsd` is USD, in micro units (1e6 per dollar);
 *      - `orderedMinor`, `soldMinor`, `metaRevenueMinor` are UZS minor units.
 *    So CPL / CPQL / CPO / CAC / CPM / CPC come out in USD, and average
 *    cheque / ARPL come out in UZS, and ROAS — the one metric that spans both
 *    — divides the UZS revenue BY THE RATE FIRST and only then by the USD
 *    spend. Doing it the other way round multiplies the answer by the square
 *    of the rate, which at 11 823.69 soʻm/$ is a factor of 140 million, and
 *    the resulting number is large enough to look like success.
 *
 * WHY THE ARITHMETIC IS INTEGER WHERE THEIR PAGE USED FLOATS
 * `met()` works in JavaScript numbers throughout. We keep money in the exact
 * units it was stored in and divide once, at the end, rounding half away from
 * zero — the same discipline as `divideMoney`. The results agree with theirs
 * to display precision; the difference is that ours cannot drift as windows
 * grow. Rates and ratios (percentages, CTR, frequency, ROAS) stay in floats,
 * because they are not money and are rounded for display anyway.
 */

import { ratePercent } from './metrics'

// ---------------------------------------------------------------------------
// The dimensions
// ---------------------------------------------------------------------------

/**
 * The twelve slices the source publishes, in `D.tabs` order.
 *
 * Lowercase on purpose: these are the source's own tab ids, they are what the
 * `?dimension=` query parameter carries, and the Prisma enum is the same list
 * upper-cased (the repository holds the explicit mapping so a change on either
 * side fails to compile).
 */
export const MARKETING_DIMENSIONS = [
  'camp',
  'adset',
  'creative',
  'targetolog',
  'form',
  'source',
  'product',
  'region',
  'rop',
  'seller',
  'registrator',
  'days',
] as const

export type MarketingDimension = (typeof MARKETING_DIMENSIONS)[number]

/**
 * The drill-down chain, from `D.tabs[].parent`.
 *
 * Campaign → adset → creative is the only nesting the source has. A row's
 * `parent` holds its campaign (for an adset) or its adset (for a creative);
 * every other dimension is flat and stores an empty string.
 */
export const DIMENSION_PARENT: Readonly<Record<MarketingDimension, MarketingDimension | null>> =
  Object.freeze({
    camp: null,
    adset: 'camp',
    creative: 'adset',
    targetolog: null,
    form: null,
    source: null,
    product: null,
    region: null,
    rop: null,
    seller: null,
    registrator: null,
    days: null,
  })

/**
 * Dimensions carrying Meta Ads delivery data (`META` in logic.js).
 *
 * Only the three that come from the ad account have impressions, reach, clicks
 * and Meta's own lead count. Asking a region for its CTR would print a column
 * of em dashes, so the table does not offer the column at all.
 */
export const META_DIMENSIONS: ReadonlySet<MarketingDimension> = new Set<MarketingDimension>([
  'camp',
  'adset',
  'creative',
])

/**
 * Dimensions carrying the lead funnel (`LEADD` in logic.js).
 *
 * Note which ones are missing: product, region and rop are recorded at ORDER
 * time in the client's sheet, so they know what was sold but not how many
 * leads it took. Their page hides the lead columns there rather than showing
 * zeros, and so do we.
 */
export const LEAD_DIMENSIONS: ReadonlySet<MarketingDimension> = new Set<MarketingDimension>([
  'camp',
  'adset',
  'creative',
  'targetolog',
  'form',
  'source',
  'seller',
  'registrator',
  'days',
])

// ---------------------------------------------------------------------------
// The sixteen additive counters
// ---------------------------------------------------------------------------

/**
 * One aggregate of the sixteen raw fields (`FL` in logic.js).
 *
 * EVERY field here is additive, and that is the whole aggregation strategy:
 * sum the raws over whatever window and grouping is asked for, then derive the
 * rates from the sum. Never average an average — a mean of daily CPLs is not
 * the period's CPL, it is a number weighted by nothing in particular.
 */
export interface MarketingRaw {
  /** `leads` — leads received. */
  readonly leads: number
  /** `clean` — "чистые": what is left after junk is removed. */
  readonly clean: number
  /** `kval` — qualified leads. */
  readonly kval: number
  /** `orders` — order count. */
  readonly orders: number
  /** `sold` — completed sale count. */
  readonly sold: number
  /** `newc` — new customers, the CAC denominator. */
  readonly newCustomers: number
  /** `spend` — ad spend in USD micro units (1e6 per dollar). */
  readonly spendMicroUsd: bigint
  /** `fact1` — amount ORDERED ("Заказы"), UZS minor units. */
  readonly orderedMinor: bigint
  /** `fact2` — amount SOLD/collected ("Продажи"), UZS minor units. */
  readonly soldMinor: bigint
  /** `mrev` — the slice of `soldMinor` Meta claims, UZS minor units. */
  readonly metaRevenueMinor: bigint
  /** `dsum` / `dcnt` — day-sum and count behind Deal Time. */
  readonly dealDaysSum: number
  readonly dealCount: number
  readonly impressions: bigint
  readonly reach: bigint
  readonly clicks: bigint
  /** `mleads` — leads as META counts them, which is not what `leads` counts. */
  readonly metaLeads: number
}

export const ZERO_RAW: MarketingRaw = Object.freeze({
  leads: 0,
  clean: 0,
  kval: 0,
  orders: 0,
  sold: 0,
  newCustomers: 0,
  spendMicroUsd: 0n,
  orderedMinor: 0n,
  soldMinor: 0n,
  metaRevenueMinor: 0n,
  dealDaysSum: 0,
  dealCount: 0,
  impressions: 0n,
  reach: 0n,
  clicks: 0n,
  metaLeads: 0,
})

export function addRaw(a: MarketingRaw, b: MarketingRaw): MarketingRaw {
  return {
    leads: a.leads + b.leads,
    clean: a.clean + b.clean,
    kval: a.kval + b.kval,
    orders: a.orders + b.orders,
    sold: a.sold + b.sold,
    newCustomers: a.newCustomers + b.newCustomers,
    spendMicroUsd: a.spendMicroUsd + b.spendMicroUsd,
    orderedMinor: a.orderedMinor + b.orderedMinor,
    soldMinor: a.soldMinor + b.soldMinor,
    metaRevenueMinor: a.metaRevenueMinor + b.metaRevenueMinor,
    dealDaysSum: a.dealDaysSum + b.dealDaysSum,
    dealCount: a.dealCount + b.dealCount,
    impressions: a.impressions + b.impressions,
    reach: a.reach + b.reach,
    clicks: a.clicks + b.clicks,
    metaLeads: a.metaLeads + b.metaLeads,
  }
}

/**
 * Sum an aggregate (`sum()` in logic.js).
 *
 * This is also how the JAMI footer is built: total the RAW fields of every row
 * and derive afterwards. Summing the rendered percentages instead would give a
 * "total buyout rate" that is the mean of sixteen unrelated denominators.
 */
export function sumRaw(rows: Iterable<MarketingRaw>): MarketingRaw {
  let total = ZERO_RAW
  for (const row of rows) total = addRaw(total, row)
  return total
}

// ---------------------------------------------------------------------------
// Exact division
// ---------------------------------------------------------------------------

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

/**
 * Integer division rounding half away from zero, null on a zero divisor.
 *
 * BigInt division truncates toward zero, which would bias every per-unit cost
 * downward by up to one minor unit — the same correction `divideMoney` makes,
 * repeated here because this module must not depend on the money module (its
 * USD side is in micro units, not minor).
 */
function divideOrNull(numerator: bigint, divisor: bigint): bigint | null {
  if (divisor === 0n) return null

  const quotient = numerator / divisor
  const remainder = numerator % divisor
  if (abs(remainder) * 2n >= abs(divisor)) {
    const sign = (numerator < 0n) !== (divisor < 0n) ? -1n : 1n
    return quotient + sign
  }
  return quotient
}

/** A plain ratio of two counters. Null when the denominator is zero. */
function ratioOrNull(numerator: bigint | number, denominator: bigint | number): number | null {
  const d = Number(denominator)
  if (!Number.isFinite(d) || d === 0) return null
  const n = Number(numerator)
  if (!Number.isFinite(n)) return null
  return n / d
}

// ---------------------------------------------------------------------------
// The derived metrics
// ---------------------------------------------------------------------------

/**
 * Everything `met()` computes, in the units the inputs were stored in.
 *
 * Money-valued results keep their integer unit and their unit in their NAME:
 * `…MicroUsd` for the USD-native costs, `…Minor` for the UZS-native amounts.
 * A field whose name does not say which currency it is in would be the exact
 * mistake this module is built to prevent.
 */
export interface MarketingDerived {
  /** `qual` — clean/leads, per cent. "Sifat". */
  readonly qualityPercent: number | null
  /** `cpl` — spend/leads, USD micro. */
  readonly cplMicroUsd: bigint | null
  /** `ql` — kval/leads, per cent. */
  readonly qlPercent: number | null
  /** `cpql` — spend/kval, USD micro. */
  readonly cpqlMicroUsd: bigint | null
  /** `buy` — fact2/fact1, per cent. "Sotib olish" (buyout). */
  readonly buyoutPercent: number | null
  /** `cpo` — spend/sold, USD micro. */
  readonly cpoMicroUsd: bigint | null
  /** `cac` — spend/newc, USD micro. */
  readonly cacMicroUsd: bigint | null
  /** `avg` — fact2/sold, UZS minor. "Oʻrtacha chek". */
  readonly averageChequeMinor: bigint | null
  /** `arpl` — fact2/leads, UZS minor. */
  readonly arplMinor: bigint | null
  /** `deal` — dsum/dcnt, days. Zero in every row the source publishes today. */
  readonly dealTimeDays: number | null
  /** `conv` — sold/leads, per cent. */
  readonly conversionPercent: number | null
  /** `mshare` — mrev/fact2, per cent. "Meta ulushi". */
  readonly metaSharePercent: number | null
  /** `ctr` — clicks/impr, per cent. */
  readonly ctrPercent: number | null
  /** `cpm` — spend/impr x 1000, USD micro. */
  readonly cpmMicroUsd: bigint | null
  /** `cpc` — spend/clicks, USD micro. */
  readonly cpcMicroUsd: bigint | null
  /** `freq` — impr/reach. "Chastota". */
  readonly frequency: number | null
  /**
   * `roas` — (fact2 in UZS / rate) / spend in USD. A pure ratio.
   *
   * Null when there was no spend. Their page paints that case red and writes
   * "нет расхода" rather than an em dash, because revenue with no recorded
   * spend means the attribution is broken, not unknown — see `gradeRoas`.
   */
  readonly roas: number | null
}

/** Micro units per dollar. The scale `spendMicroUsd` and the rate are stored in. */
const MICRO = 1_000_000n

/** Minor units per soʻm. */
const MINOR = 100n

/**
 * Derive every rate from one summed aggregate.
 *
 * @param raw   The summed counters for a window/key. Additive, always.
 * @param usdRateMicro UZS per USD in micro units, from the snapshot
 *                     (11 823.69 is stored as 11 823 690 000).
 */
export function derive(raw: MarketingRaw, usdRateMicro: bigint): MarketingDerived {
  const leads = BigInt(raw.leads)
  const kval = BigInt(raw.kval)
  const sold = BigInt(raw.sold)
  const newCustomers = BigInt(raw.newCustomers)

  return {
    qualityPercent: ratePercent(raw.clean, raw.leads),
    cplMicroUsd: divideOrNull(raw.spendMicroUsd, leads),
    qlPercent: ratePercent(raw.kval, raw.leads),
    cpqlMicroUsd: divideOrNull(raw.spendMicroUsd, kval),
    buyoutPercent: ratePercent(raw.soldMinor, raw.orderedMinor),
    cpoMicroUsd: divideOrNull(raw.spendMicroUsd, sold),
    cacMicroUsd: divideOrNull(raw.spendMicroUsd, newCustomers),
    averageChequeMinor: divideOrNull(raw.soldMinor, sold),
    arplMinor: divideOrNull(raw.soldMinor, leads),
    dealTimeDays: ratioOrNull(raw.dealDaysSum, raw.dealCount),
    conversionPercent: ratePercent(raw.sold, raw.leads),
    metaSharePercent: ratePercent(raw.metaRevenueMinor, raw.soldMinor),
    ctrPercent: ratePercent(raw.clicks, raw.impressions),
    // x1000 BEFORE the division, so a sub-cent CPM does not truncate to zero.
    cpmMicroUsd: divideOrNull(raw.spendMicroUsd * 1000n, raw.impressions),
    cpcMicroUsd: divideOrNull(raw.spendMicroUsd, raw.clicks),
    frequency: ratioOrNull(raw.impressions, raw.reach),
    roas: roas(raw.soldMinor, raw.spendMicroUsd, usdRateMicro),
  }
}

/**
 * ROAS: revenue over ad spend, both sides brought to USD first.
 *
 *     roas = (soldMinor / 100 / rate) / (spendMicroUsd / 1e6)
 *
 * with `rate = usdRateMicro / 1e6`. Substituting and cancelling gives
 *
 *     roas = soldMinor x 1e12 / (100 x usdRateMicro x spendMicroUsd)
 *
 * which is evaluated in BigInt at 1e-6 resolution and only then converted to a
 * number — so the rate never multiplies a float and the answer cannot drift
 * with the size of the window.
 *
 * THE DIRECTION IS THE POINT. `soldMinor` is UZS and is DIVIDED by the rate;
 * `spendMicroUsd` is already USD and is not touched by the rate at all. There
 * is a unit test whose only job is to fail if those two ever swap.
 */
export function roas(
  soldMinor: bigint,
  spendMicroUsd: bigint,
  usdRateMicro: bigint,
): number | null {
  if (spendMicroUsd <= 0n) return null
  if (usdRateMicro <= 0n) return null

  const scaled = divideOrNull(
    soldMinor * MICRO * MICRO * MICRO,
    MINOR * usdRateMicro * spendMicroUsd,
  )
  if (scaled === null) return null
  return Number(scaled) / 1e6
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * A graded cell's verdict. Rendered with `--status-*` AND a word or glyph —
 * colour is never the only channel (docs/DESIGN.md).
 */
export type MarketingGrade = 'good' | 'warning' | 'critical'

export interface GradeThresholds {
  /** At or above this, 'good'. */
  readonly good: number
  /** At or above this (but below `good`), 'warning'. Below it, 'critical'. */
  readonly warning: number
}

/**
 * The four graded metrics and their cut-offs, from `bd()` and `ro()` in
 * logic.js. The NUMBERS are the client's — they are how this business reads
 * its own funnel — and only the colours are ours.
 */
export const QUALITY_THRESHOLDS: GradeThresholds = Object.freeze({ good: 80, warning: 60 })
export const QL_THRESHOLDS: GradeThresholds = Object.freeze({ good: 30, warning: 15 })
export const BUYOUT_THRESHOLDS: GradeThresholds = Object.freeze({ good: 80, warning: 60 })
export const ROAS_THRESHOLDS: GradeThresholds = Object.freeze({ good: 3, warning: 1.5 })

/**
 * Grade one value. Null in, null out — an unknown is not a failing grade, and
 * painting a missing number red is how a dashboard invents bad news.
 */
export function grade(value: number | null, thresholds: GradeThresholds): MarketingGrade | null {
  if (value === null || !Number.isFinite(value)) return null
  if (value >= thresholds.good) return 'good'
  if (value >= thresholds.warning) return 'warning'
  return 'critical'
}

/**
 * ROAS grading, with the source's one deliberate exception.
 *
 * `ro()` in logic.js paints a null ROAS red and writes "нет расхода" instead of
 * an em dash — but only when there is revenue to explain. Money collected
 * against no recorded spend is broken attribution, which is a problem; a row
 * that neither spent nor sold is simply empty, and grading it critical would
 * fill the table with red rows that mean nothing.
 *
 * The caller prints "xarajat yoʻq" for the `critical` verdict on a null ROAS.
 */
export function gradeRoas(
  roasValue: number | null,
  soldMinor: bigint,
): MarketingGrade | null {
  if (roasValue === null) return soldMinor > 0n ? 'critical' : null
  return grade(roasValue, ROAS_THRESHOLDS)
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/**
 * A closed, inclusive range of calendar DAYS as `YYYY-MM-DD` strings.
 *
 * Not a `Period`. The rest of the application works in half-open instant
 * ranges bucketed in Asia/Tashkent, because it measures events that happened
 * at a time. This module measures rows the source stamped with a bare date and
 * no timezone; turning those into instants would invent an hour and then let a
 * timezone shift it onto the wrong day. So the window stays what the data is:
 * two dates, both included.
 */
export interface DateWindow {
  readonly from: string
  readonly to: string
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function assertDate(value: string): void {
  if (!DATE_PATTERN.test(value)) {
    throw new TypeError(`Expected a YYYY-MM-DD date, got "${value}"`)
  }
}

/** Shift an ISO date by whole days. UTC arithmetic — no zone can shift it. */
export function addDays(date: string, days: number): string {
  assertDate(date)
  const shifted = new Date(`${date}T00:00:00.000Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

/** Length of an inclusive window in days. `dif()+1` in logic.js. */
export function windowLengthDays(window: DateWindow): number {
  assertDate(window.from)
  assertDate(window.to)
  const from = Date.parse(`${window.from}T00:00:00.000Z`)
  const to = Date.parse(`${window.to}T00:00:00.000Z`)
  return Math.round((to - from) / 86_400_000) + 1
}

/**
 * The comparison window: the same number of days, ending the day before.
 *
 * `per()` in logic.js: `pf = f - n`, `pt = f - 1`. It is deliberately NOT
 * clamped to the data's start — a window with nothing before it produces zeros,
 * the deltas come back as "no baseline", and the tiles say "yangi" rather than
 * inventing a percentage against a shortened period nobody asked for.
 */
export function previousWindow(window: DateWindow): DateWindow {
  const length = windowLengthDays(window)
  return { from: addDays(window.from, -length), to: addDays(window.from, -1) }
}

/** Clamp a date into `[min, max]`. `cl()` in logic.js, with an upper bound. */
export function clampDate(value: string, min: string, max: string): string {
  assertDate(value)
  if (value < min) return min
  if (value > max) return max
  return value
}

// ---------------------------------------------------------------------------
// The funnel
// ---------------------------------------------------------------------------

/** One step of the lead funnel (`funnel()` in logic.js). */
export interface FunnelStep {
  readonly key: 'leads' | 'clean' | 'kval' | 'orders' | 'sold'
  readonly count: number
  /** Share of the FIRST step, per cent. Null when there were no leads at all. */
  readonly reachedPercent: number | null
}

/**
 * Lidlar → Toza → Kval → Buyurtmalar → Sotuvlar.
 *
 * The steps are not strictly nested — an order can exist for a lead that was
 * never marked qualified — so `reachedPercent` is measured against the first
 * step rather than the previous one, and may legitimately exceed the step
 * above it. That is a finding about the sheet's bookkeeping, not something to
 * clamp away.
 */
export function funnel(raw: MarketingRaw): readonly FunnelStep[] {
  const steps: readonly { key: FunnelStep['key']; count: number }[] = [
    { key: 'leads', count: raw.leads },
    { key: 'clean', count: raw.clean },
    { key: 'kval', count: raw.kval },
    { key: 'orders', count: raw.orders },
    { key: 'sold', count: raw.sold },
  ]

  return steps.map((step) => ({
    key: step.key,
    count: step.count,
    reachedPercent: ratePercent(step.count, raw.leads),
  }))
}
