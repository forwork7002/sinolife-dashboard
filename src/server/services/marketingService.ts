/**
 * Marketing (Roistat) module orchestration.
 *
 * Thin on purpose, like every other service here: the arithmetic lives in
 * `src/server/domain/analytics/marketing.ts` (a line-by-line port of `met()`
 * in the client's own published dashboard) and the reads live in
 * `MarketingRepository`. This layer's whole job is to pick the window, sum the
 * raw counters, hand them to `derive()`, and turn integers into the money DTOs
 * the screen renders.
 *
 * FOUR RULES THIS FILE EXISTS TO HOLD
 *
 * 1. TWO LEDGERS, NEVER ONE TOTAL. These numbers come from the client's Google
 *    Sheets plus Meta Ads, imported from their published Roistat page — not
 *    from Bitrix24. A live probe of the portal found no Roistat fields, users,
 *    sources, apps or smart processes at all. So every response from this
 *    service is stamped `dataSource: 'ROISTAT'` and none of it may ever be
 *    added to a Bitrix24 revenue figure. The one place the two systems meet is
 *    `verify()`, which reads both sides SEPARATELY and prints the divergence.
 *
 * 2. SUM RAW, THEN DERIVE. Every rate on every screen — the JAMI footer row
 *    included — comes from summing the sixteen additive counters and deriving
 *    afterwards. Averaging a column of percentages produces a "total buyout
 *    rate" weighted by nothing at all, and it is the single easiest way for
 *    this module to print a plausible lie.
 *
 * 3. THIS MODULE OWNS ITS OWN WINDOW. See `resolveWindow` — the dashboard-wide
 *    preset does not apply here.
 *
 * 4. FILIAL DOES NOT APPLY HERE. See the note above `resolveWindow`.
 */

import { z } from 'zod'

import {
  DIMENSION_PARENT,
  MARKETING_DIMENSIONS,
  type MarketingDimension,
  type MarketingRaw,
  ZERO_RAW,
  addRaw,
  clampDate,
  derive,
  funnel,
  previousWindow,
  roas,
  sumRaw,
} from '@/server/domain/analytics/marketing'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import type {
  DateRange,
  MarketingDayRow,
  MarketingKeyRow,
  MarketingRepository,
  MarketingSnapshotRow,
  VerifyCut,
  VerifyFacts,
} from '@/server/repositories/marketingRepository'

// ---------------------------------------------------------------------------
// The query contract
//
// `src/server/http/queryParams.ts` holds the schema every OTHER analytics
// endpoint shares — preset, from/to as instants, the filter ids, `filial`.
// This module's window is deliberately not one of those (it is clamped to the
// import's own coverage, not resolved from a preset in the app timezone), so
// its schema lives here, beside the clamp it feeds, and the two cannot drift.
//
// Unknown keys are stripped rather than rejected: a reader who arrives from
// another screen carries `?preset=this_month&filial=…` in the URL, and those
// parameters are meaningless here, not erroneous. See `resolveWindow` for why
// `filial` in particular is ignored rather than honoured.
// ---------------------------------------------------------------------------

/** A bare calendar date. Not converted to an instant — see `DateWindow`. */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')

export const marketingWindowSchema = z.object({
  from: isoDay.optional(),
  to: isoDay.optional(),
  /**
   * "Bugun", resolved HERE rather than by the browser.
   *
   * The source page has its own idea of today (`D.today`, the day it was last
   * rebuilt), which is what its own "Сегодня" button uses. A browser left open
   * since yesterday would ask for the wrong day, and a browser in another
   * timezone for a day the sheet has never heard of. So the client sends a
   * flag and the service answers it from the snapshot it has just read.
   * Ignored when an explicit range is given — a stated range always wins.
   */
  today: z.coerce.boolean().optional(),
})

export const marketingBreakdownSchema = marketingWindowSchema.extend({
  dimension: z.enum(MARKETING_DIMENSIONS).default('camp'),
  /**
   * The drill-down parent: a campaign name for adsets, an adset name for
   * creatives. Bounded because it reaches a WHERE clause; the source's longest
   * campaign name is well inside this.
   */
  parent: z.string().min(1).max(200).optional(),
})

export type MarketingWindowQuery = z.infer<typeof marketingWindowSchema>
export type MarketingBreakdownQuery = z.infer<typeof marketingBreakdownSchema>

// ---------------------------------------------------------------------------
// DTOs — mirrored verbatim in `src/lib/api.ts`
// ---------------------------------------------------------------------------

/**
 * The imported blob's own provenance.
 *
 * `updatedLabel` is the stamp THEIR page printed for itself and `importedAt`
 * is when we fetched it. Neither is the Bitrix24 sync time, and this module
 * must never show that one: none of these numbers ever touched the portal.
 */
export interface MarketingSnapshotDto {
  readonly sourceUrl: string
  /** UZS per USD used for every conversion on this screen. */
  readonly usdRate: number
  /** The rate's date as the source prints it: `DD.MM.YYYY`. */
  readonly rateDate: string
  /** The blob's own `updated` stamp, verbatim: `DD.MM.YYYY HH:mm`. */
  readonly updatedLabel: string
  readonly today: string
  readonly minDate: string
  readonly maxDate: string
  /** Rows before this date are MONTHLY buckets, not days. */
  readonly dailyFrom: string
  /** Rows on/after this date are still filling up — sales close later. */
  readonly freshFrom: string
  /** When our importer last ran, ISO instant. */
  readonly importedAt: string
  readonly rowCount: number
}

/** A closed, inclusive range of calendar days. */
export interface MarketingWindowDto {
  readonly from: string
  readonly to: string
}

/**
 * One summed aggregate plus every rate derived from it.
 *
 * Percentages travel UNROUNDED. They are not only printed: the client grades
 * four of them against the client's own thresholds (Sifat ≥ 80, QL ≥ 30 …) and
 * computes period-over-period deltas from them. Rounding to one decimal here
 * would turn a 79,96 % quality score into 80,0 and promote it from "oʻrta" to
 * "yaxshi" — presentation must happen at the last moment, in `formatPercent`.
 */
export interface MarketingMetricsDto {
  // --- raw counters (additive) ---
  readonly leads: number
  readonly clean: number
  readonly kval: number
  readonly orders: number
  /** Count of sales. The MONEY is `revenue`. */
  readonly sold: number
  readonly newCustomers: number
  readonly impressions: number
  readonly reach: number
  readonly clicks: number
  readonly metaLeads: number
  readonly dealDaysSum: number
  readonly dealCount: number

  // --- raw money ---
  /** Ad spend. USD-native (Meta Ads bills in dollars). */
  readonly spend: MoneyDto
  /** `fact1` — ordered amount ("Заказы"). UZS-native. */
  readonly ordered: MoneyDto
  /** `fact2` — collected amount ("Продажи"); the revenue ROAS divides. UZS-native. */
  readonly revenue: MoneyDto
  /** The slice of `revenue` Meta claims. UZS-native. */
  readonly metaRevenue: MoneyDto

  // --- derived; null on a zero denominator, always ---
  /** clean/leads. "Sifat". */
  readonly qualityPercent: number | null
  /** spend/leads. USD-native. */
  readonly cpl: MoneyDto | null
  /** kval/leads. */
  readonly qlPercent: number | null
  /** spend/kval. USD-native. */
  readonly cpql: MoneyDto | null
  /** revenue/ordered. "Sotib olish". */
  readonly buyoutPercent: number | null
  /** spend/sold. USD-native. */
  readonly cpo: MoneyDto | null
  /** spend/newCustomers. USD-native. */
  readonly cac: MoneyDto | null
  /** revenue/sold. UZS-native. */
  readonly averageCheque: MoneyDto | null
  /** revenue/leads. UZS-native. */
  readonly arpl: MoneyDto | null
  /** dealDaysSum/dealCount, in days. Zero in every row the source publishes today. */
  readonly dealTimeDays: number | null
  /** sold/leads. */
  readonly conversionPercent: number | null
  /** metaRevenue/revenue. */
  readonly metaSharePercent: number | null
  readonly ctrPercent: number | null
  /** spend/impressions x1000. USD-native. */
  readonly cpm: MoneyDto | null
  /** spend/clicks. USD-native. */
  readonly cpc: MoneyDto | null
  /** impressions/reach. "Chastota". */
  readonly frequency: number | null
  /** (revenue/rate)/spend. Null when nothing was spent. */
  readonly roas: number | null
}

/** One step of the lead funnel. `reachedPercent` is share of the FIRST step. */
export interface MarketingFunnelStepDto {
  readonly key: 'leads' | 'clean' | 'kval' | 'orders' | 'sold'
  readonly count: number
  readonly reachedPercent: number | null
}

/** One day of the `days` dimension, for the dynamics panels. */
export interface MarketingDayDto {
  readonly date: string
  /** USD-native. */
  readonly spend: MoneyDto
  /** UZS-native. */
  readonly revenue: MoneyDto
  readonly roas: number | null
}

/**
 * How far each dimension's data actually reaches.
 *
 * The ranges genuinely differ — camp/adset/creative/days run to 27 August
 * while the sheet-side dimensions stop on the 11th — and that gap is data, not
 * a defect to paper over. The screen states it rather than letting a reader
 * assume every tab covers the same fortnight.
 */
export interface MarketingCoverageDto {
  readonly dimension: MarketingDimension
  readonly from: string
  readonly to: string
}

export interface MarketingOverviewDto {
  /**
   * Null means the importer has never run: the tables are empty.
   *
   * Not an error and not a zero — the screen says how to populate it.
   */
  readonly snapshot: MarketingSnapshotDto | null
  readonly window: MarketingWindowDto
  /** The immediately-preceding window of the same length (`per()` in logic.js). */
  readonly previousWindow: MarketingWindowDto
  readonly current: MarketingMetricsDto
  readonly previous: MarketingMetricsDto
  readonly funnel: readonly MarketingFunnelStepDto[]
  /** Daily rows inside the window, oldest first, capped at the last 62. */
  readonly daily: readonly MarketingDayDto[]
  readonly coverage: readonly MarketingCoverageDto[]
}

export interface MarketingBreakdownRowDto {
  readonly key: string
  /** The row's campaign (for an adset) or adset (for a creative). Null when flat. */
  readonly parent: string | null
  readonly metrics: MarketingMetricsDto
}

export interface MarketingBreakdownDto {
  readonly dimension: MarketingDimension
  /** The parent actually applied — null when the dimension has no level above. */
  readonly parent: string | null
  readonly window: MarketingWindowDto
  readonly rows: readonly MarketingBreakdownRowDto[]
  /** The JAMI row: summed RAW fields, rates re-derived from that sum. */
  readonly total: MarketingMetricsDto
}

// ---------------------------------------------------------------------------
// The cross-check with Bitrix24
// ---------------------------------------------------------------------------

/** One side's figures for one key, in units the other side also uses. */
export interface VerifyFactsDto {
  readonly orders: number
  readonly sold: number
  /** UZS-native. */
  readonly revenue: MoneyDto
}

/**
 * One compared key.
 *
 * SIGN CONVENTION, STATED ONCE: every difference is ROISTAT MINUS BITRIX24, so
 * a positive number means Roistat reports more. The percentage is that
 * difference as a share of the Bitrix24 figure, and it is null when Bitrix24
 * reports nothing — there is no percentage difference from zero, and printing
 * one would be a claim we cannot support.
 */
export interface VerifyRowDto {
  readonly key: string
  /** Null when this key exists only on the Bitrix24 side. */
  readonly roistat: VerifyFactsDto | null
  /** Null when this key exists only on the Roistat side. */
  readonly bitrix: VerifyFactsDto | null
  readonly ordersDifference: number | null
  readonly ordersDifferencePercent: number | null
  readonly soldDifference: number | null
  readonly soldDifferencePercent: number | null
  readonly revenueDifference: MoneyDto | null
  readonly revenueDifferencePercent: number | null
  /**
   * How the two keys were paired: 'exact' after normalisation, 'tokens' with
   * the words re-sorted, 'code' on the employee number both sides carry. Null
   * on the day cut, where the key is a date and matching cannot be fuzzy.
   */
  readonly rule: MatchRule | null
}

export interface VerifyCutDto {
  readonly cut: VerifyCut
  /** The window actually compared — see `intersect` and the note it carries. */
  readonly window: MarketingWindowDto
  /** What this cut measures on each side, and where the two definitions part. */
  readonly note: string
  readonly rows: readonly VerifyRowDto[]
  /**
   * Each side's total over the WHOLE cut — matched and unmatched keys alike.
   *
   * This is the headline answer to "what does each system say about this
   * window", so it deliberately does not stop at the keys that paired up.
   * `unmatched…Total` below says how much of it never found a counterpart.
   */
  readonly roistatTotal: VerifyFactsDto
  readonly bitrixTotal: VerifyFactsDto
  /** Keys present on one side only — named, never quietly dropped. */
  readonly unmatchedRoistat: readonly string[]
  readonly unmatchedBitrix: readonly string[]
  /**
   * The money sitting in those unmatched keys.
   *
   * An unmatched key holding nothing is a naming curiosity; one holding 300
   * million soʻm is the reason the totals disagree, and the reader cannot tell
   * which from a list of names alone.
   */
  readonly unmatchedRoistatTotal: VerifyFactsDto
  readonly unmatchedBitrixTotal: VerifyFactsDto
}

export interface MarketingVerifyDto {
  /** The window asked for, after clamping. Each cut narrows it further. */
  readonly window: MarketingWindowDto
  readonly cuts: readonly VerifyCutDto[]
  /**
   * Bitrix24 on its OWN basis for the day window: won deals on their CLOSE
   * date, not their creation date.
   *
   * Printed beside the created-basis figure so the definitional gap between
   * the two systems is a number on the screen rather than a claim in a
   * footnote. `orders` is 0 here because the close basis does not measure
   * order creation at all. Never used to "correct" either side.
   */
  readonly bitrixCloseBasis: VerifyFactsDto | null
  /** Why a difference is legitimate. Named, never reconciled away. */
  readonly reasons: readonly string[]
}

// ---------------------------------------------------------------------------
// Units — converted once, at the very edge
// ---------------------------------------------------------------------------

/** Meta Ads bills in dollars; the sheet is kept in soʻm. Facts, not settings. */
const USD = 'USD'
const UZS = 'UZS'

/** Micro-USD per cent: 1e6 per dollar / 100 cents. */
const MICRO_PER_CENT = 10_000n

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

/**
 * USD micro units -> USD cents, rounding half away from zero.
 *
 * The import keeps spend at 1e6 per dollar so that summing two months of daily
 * rows cannot drift; `MoneyDto` is minor units, which for USD is cents. This
 * is the one rounding step, and it happens after ALL summation and division,
 * never between them. A sub-cent unit cost (a $0,004 click) therefore reaches
 * the screen as its nearest cent — the exact figure stays in the database.
 */
function centsFromMicroUsd(micro: bigint): bigint {
  const quotient = micro / MICRO_PER_CENT
  const remainder = micro % MICRO_PER_CENT
  if (abs(remainder) * 2n >= MICRO_PER_CENT) return quotient + (micro < 0n ? -1n : 1n)
  return quotient
}

function usdMoney(micro: bigint): MoneyDto {
  return toMoneyDto(money(centsFromMicroUsd(micro), USD))
}

function uzsMoney(minor: bigint): MoneyDto {
  return toMoneyDto(money(minor, UZS))
}

/** Null in, null out: an undefined cost is an em dash, never a zero. */
function usdMoneyOrNull(micro: bigint | null): MoneyDto | null {
  return micro === null ? null : usdMoney(micro)
}

function uzsMoneyOrNull(minor: bigint | null): MoneyDto | null {
  return minor === null ? null : uzsMoney(minor)
}

/**
 * A BigInt counter as a number.
 *
 * Impressions and reach are stored as BigInt because Meta returns them for ad
 * accounts that can exceed 2^31 over a lifetime. Every value this module has
 * ever seen is eight digits or fewer, so the conversion is exact; it is a
 * count, not money, and no arithmetic downstream depends on its exactness.
 */
function counter(value: bigint): number {
  return Number(value)
}

/** Everything `met()` computes, in transport shape. */
function metricsDto(raw: MarketingRaw, usdRateMicro: bigint): MarketingMetricsDto {
  const d = derive(raw, usdRateMicro)

  return {
    leads: raw.leads,
    clean: raw.clean,
    kval: raw.kval,
    orders: raw.orders,
    sold: raw.sold,
    newCustomers: raw.newCustomers,
    impressions: counter(raw.impressions),
    reach: counter(raw.reach),
    clicks: counter(raw.clicks),
    metaLeads: raw.metaLeads,
    dealDaysSum: raw.dealDaysSum,
    dealCount: raw.dealCount,

    spend: usdMoney(raw.spendMicroUsd),
    ordered: uzsMoney(raw.orderedMinor),
    revenue: uzsMoney(raw.soldMinor),
    metaRevenue: uzsMoney(raw.metaRevenueMinor),

    qualityPercent: d.qualityPercent,
    cpl: usdMoneyOrNull(d.cplMicroUsd),
    qlPercent: d.qlPercent,
    cpql: usdMoneyOrNull(d.cpqlMicroUsd),
    buyoutPercent: d.buyoutPercent,
    cpo: usdMoneyOrNull(d.cpoMicroUsd),
    cac: usdMoneyOrNull(d.cacMicroUsd),
    averageCheque: uzsMoneyOrNull(d.averageChequeMinor),
    arpl: uzsMoneyOrNull(d.arplMinor),
    dealTimeDays: d.dealTimeDays,
    conversionPercent: d.conversionPercent,
    metaSharePercent: d.metaSharePercent,
    ctrPercent: d.ctrPercent,
    cpm: usdMoneyOrNull(d.cpmMicroUsd),
    cpc: usdMoneyOrNull(d.cpcMicroUsd),
    frequency: d.frequency,
    roas: d.roas,
  }
}

/** `2026-08-27` -> `27.08.2026`, the form the source itself prints. */
function dottedDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

function snapshotDto(row: MarketingSnapshotRow): MarketingSnapshotDto {
  return {
    sourceUrl: row.sourceUrl,
    // The rate is a display figure (11 823,69 soʻm/$) and is never used as a
    // divisor here — `roas()` divides by the micro-unit integer in the domain,
    // so this float cannot enter a money calculation.
    usdRate: Number(row.usdRateMicro) / 1e6,
    rateDate: dottedDate(row.rateDate),
    updatedLabel: row.updatedLabel,
    today: row.today,
    minDate: row.minDate,
    maxDate: row.maxDate,
    dailyFrom: row.dailyFrom,
    freshFrom: row.freshFrom,
    importedAt: row.importedAt.toISOString(),
    rowCount: row.rowCount,
  }
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/**
 * Today in the application's timezone, as a calendar date.
 *
 * Only used when there is no snapshot at all, to give the empty response a
 * window that is a real day rather than an empty string. Assembled from parts
 * so no locale's date pattern can reorder it.
 */
function todayIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Resolve the requested window against what was actually imported.
 *
 * THIS MODULE TAKES ITS OWN from/to, NOT THE DASHBOARD PRESET, and the reason
 * is the data: the import covers 2026-07-01 … 2026-08-27 and nothing else.
 * The app-wide default preset is `this_month`, so a Marketing page wired to
 * the shared period control would open on an empty screen every month that is
 * not August 2026 and look broken. The published page has its own three-way
 * control (Bugun / Barcha sanalar / custom) for exactly this reason, and these
 * endpoints mirror it: no parameters means the whole covered range.
 *
 * THE BOUNDS, WHICH ARE NOT SYMMETRIC — this follows `cl()` and `per()` in
 * logic.js rather than the obvious reading of "clamp to [minDate, maxDate]":
 *   - the LOWER bound is `minDate`, because nothing exists before it;
 *   - the UPPER bound is `today`, NOT `maxDate`. `maxDate` (2026-08-11) tracks
 *     the SLOWEST dimension, while camp/adset/creative/days carry real rows
 *     through `today` (2026-08-27). Clamping the top to `maxDate` would put a
 *     fortnight of imported spend permanently out of reach and would make the
 *     "Bugun" button — which asks for `today` — return a silently empty
 *     window. Their own date inputs are bounded by `minDate` and `today` for
 *     the same reason. What DOES stop at `maxDate` is the default window,
 *     again like theirs: `{ f: minDate, to: maxDate }`.
 *
 * FILIAL IS IGNORED HERE, DELIBERATELY. The branch scope (`?filial=Навоий`)
 * narrows Bitrix24 reads to one branch's employees. Marketing rows have no
 * employee link at all — they are campaign, adset, region and seller NAMES
 * typed into a spreadsheet, with no Bitrix24 id anywhere in the table — so
 * there is nothing to narrow. Accepting the parameter and quietly returning
 * company-wide figures under a page that says "Навоий filiali" would be worse
 * than ignoring it, so the schema does not read it and this comment is the
 * record of that choice. The one Bitrix24 side that IS read here — `verify()`
 * — compares against the whole portal on purpose: Roistat covers every branch
 * the sheet covers, and scoping one side of a cross-check to a branch would
 * manufacture a divergence.
 */
function resolveWindow(query: MarketingWindowQuery, snapshot: MarketingSnapshotRow): MarketingWindowDto {
  const { from, to } = query

  // "Bugun" — the source's own today, clamped into the covered range so a day
  // with no rows yet renders as an honest empty window rather than an error.
  if (query.today && !from && !to) {
    const day = clampDate(snapshot.today, snapshot.minDate, snapshot.today)
    return { from: day, to: day }
  }

  // Neither bound given: the whole covered range, exactly like their default.
  if (!from && !to) return { from: snapshot.minDate, to: snapshot.maxDate }

  // One bound given: the other stays at its end of the covered range rather
  // than defaulting to "today", so `?from=2026-08-01` means "since August".
  const requestedFrom = from ?? snapshot.minDate
  const requestedTo = to ?? snapshot.maxDate

  // Reversed inputs are a slip of the hand, not an error worth a 400 — their
  // own "Qoʻllash" button swaps them too.
  const [low, high] =
    requestedFrom <= requestedTo ? [requestedFrom, requestedTo] : [requestedTo, requestedFrom]

  return {
    from: clampDate(low, snapshot.minDate, snapshot.today),
    to: clampDate(high, snapshot.minDate, snapshot.today),
  }
}

/** The overlap of two closed ranges, or null when they do not overlap. */
function intersect(a: MarketingWindowDto, b: MarketingWindowDto): MarketingWindowDto | null {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from <= to ? { from, to } : null
}

/** Their `dayCh()` keeps the last 62 days and so does ours. */
const MAX_DAILY_POINTS = 62

// ---------------------------------------------------------------------------
// Key matching for the cross-check
//
// A port of the matching rules in `scripts/verifyRoistat.ts`, which proved them
// against the real 24 541-row import. They are EXPORTED so the script can drop
// its private copy and import these instead — the script and the endpoint must
// not be able to disagree about what counts as the same seller. Until that
// extraction happens, the two copies are identical by construction: this block
// was moved, not rewritten.
// ---------------------------------------------------------------------------

/** ʻ U+02BB · ʼ U+02BC · ‘ U+2018 · ’ U+2019 · ` U+0060 · ´ U+00B4 · ' U+0027 */
const APOSTROPHES = /[ʻʼ‘’`´']/g

/** Trim, collapse whitespace, casefold, and settle the apostrophe question. */
export function normaliseKey(value: string): string {
  return value.replace(APOSTROPHES, "'").replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Words sorted, so surname-first and given-name-first collapse together. */
function tokenSignature(value: string): string {
  return normaliseKey(value).split(' ').filter(Boolean).sort().join(' ')
}

/** The standalone 2–4 digit employee number, when there is exactly one. */
function employeeCode(value: string): string | null {
  const codes = normaliseKey(value)
    .split(' ')
    .filter((token) => /^\d{2,4}$/.test(token))
  return codes.length === 1 ? codes[0] : null
}

export type MatchRule = 'exact' | 'tokens' | 'code'

export interface MatchedPair {
  readonly left: string
  readonly right: string
  readonly rule: MatchRule
}

export interface MatchResult {
  readonly matched: readonly MatchedPair[]
  readonly unmatchedLeft: readonly string[]
  readonly unmatchedRight: readonly string[]
}

/** Index one side by a derived signature, keeping only unambiguous entries. */
function indexBy(keys: readonly string[], of: (key: string) => string | null): Map<string, string> {
  const buckets = new Map<string, string[]>()
  for (const key of keys) {
    const signature = of(key)
    if (signature === null || signature === '') continue
    const bucket = buckets.get(signature)
    if (bucket) bucket.push(key)
    else buckets.set(signature, [key])
  }

  const unique = new Map<string, string>()
  for (const [signature, bucket] of buckets) {
    // Two keys sharing a signature is not a match, it is an ambiguity. Leaving
    // it out reports both as unmatched, which is the truth.
    if (bucket.length === 1) unique.set(signature, bucket[0])
  }
  return unique
}

/**
 * Pair up two lists of hand-typed names.
 *
 * Three rules, tried in order, each one looser than the last and each one
 * recorded on the row it matched. Nothing fuzzier than this: edit distance
 * would start inventing matches, and an invented match is worse than an honest
 * "unmatched" line.
 */
export function matchKeys(left: readonly string[], right: readonly string[]): MatchResult {
  const rules: ReadonlyArray<readonly [MatchRule, (key: string) => string | null]> = [
    ['exact', normaliseKey],
    ['tokens', tokenSignature],
    ['code', employeeCode],
  ]

  const matched: MatchedPair[] = []
  const takenRight = new Set<string>()
  let pending = [...left]

  for (const [rule, of] of rules) {
    const available = right.filter((key) => !takenRight.has(key))
    const rightIndex = indexBy(available, of)
    const leftIndex = indexBy(pending, of)
    const next: string[] = []

    for (const key of pending) {
      const signature = of(key)
      // The left side must be unambiguous too: two sheet rows normalising to
      // one name cannot both claim the same portal record.
      if (signature === null || leftIndex.get(signature) !== key) {
        next.push(key)
        continue
      }
      const hit = rightIndex.get(signature)
      if (hit === undefined) {
        next.push(key)
        continue
      }
      matched.push({ left: key, right: hit, rule })
      takenRight.add(hit)
    }

    pending = next
  }

  return {
    matched,
    unmatchedLeft: pending,
    unmatchedRight: right.filter((key) => !takenRight.has(key)),
  }
}

/**
 * The spellings the sheet uses for "no value".
 *
 * They are not keys, they are the sheet's own em dash, and they line up with a
 * NULL on the Bitrix24 side. Folding them together on both sides is what stops
 * one absence appearing as two unmatched rows.
 */
const UNSET = new Set(['— не указано —', '— не передан —', '', '-', '—'])
const UNATTRIBUTED = '(koʻrsatilmagan)'

const ZERO_FACTS: VerifyFacts = { key: '', orders: 0, sold: 0, revenueMinor: 0n }

/** Fold the "not stated" spellings together and sum any key that repeats. */
function collectFacts(rows: readonly VerifyFacts[]): Map<string, VerifyFacts> {
  const out = new Map<string, VerifyFacts>()
  for (const row of rows) {
    const key = UNSET.has(row.key.trim()) ? UNATTRIBUTED : row.key
    const current = out.get(key)
    out.set(key, {
      key,
      orders: (current?.orders ?? 0) + row.orders,
      sold: (current?.sold ?? 0) + row.sold,
      revenueMinor: (current?.revenueMinor ?? 0n) + row.revenueMinor,
    })
  }
  return out
}

function totalFacts(values: Iterable<VerifyFacts>): VerifyFacts {
  let orders = 0
  let sold = 0
  let revenueMinor = 0n
  for (const value of values) {
    orders += value.orders
    sold += value.sold
    revenueMinor += value.revenueMinor
  }
  return { key: '', orders, sold, revenueMinor }
}

function factsDto(facts: VerifyFacts): VerifyFactsDto {
  return { orders: facts.orders, sold: facts.sold, revenue: uzsMoney(facts.revenueMinor) }
}

/**
 * `(roistat - bitrix) / |bitrix|` as a percentage.
 *
 * Null when Bitrix24 reports nothing: a difference from zero has no
 * proportion, and both ∞ and 0 % would be inventions.
 */
function differencePercent(roistatValue: bigint | number, bitrixValue: bigint | number): number | null {
  const base = Number(bitrixValue)
  if (!Number.isFinite(base) || base === 0) return null
  return ((Number(roistatValue) - base) / Math.abs(base)) * 100
}

function verifyRow(
  key: string,
  roistatFacts: VerifyFacts | undefined,
  bitrixFacts: VerifyFacts | undefined,
  rule: MatchRule | null,
): VerifyRowDto {
  const both = roistatFacts !== undefined && bitrixFacts !== undefined
  const r = roistatFacts ?? ZERO_FACTS
  const b = bitrixFacts ?? ZERO_FACTS

  return {
    key,
    roistat: roistatFacts ? factsDto(roistatFacts) : null,
    bitrix: bitrixFacts ? factsDto(bitrixFacts) : null,
    // A one-sided key has no difference to state. Subtracting against an
    // absent row would report the present side's whole figure as a divergence,
    // when the honest reading is "this key exists in one system only" — which
    // the null side and the unmatched list already say.
    ordersDifference: both ? r.orders - b.orders : null,
    ordersDifferencePercent: both ? differencePercent(r.orders, b.orders) : null,
    soldDifference: both ? r.sold - b.sold : null,
    soldDifferencePercent: both ? differencePercent(r.sold, b.sold) : null,
    revenueDifference: both ? uzsMoney(r.revenueMinor - b.revenueMinor) : null,
    revenueDifferencePercent: both ? differencePercent(r.revenueMinor, b.revenueMinor) : null,
    rule,
  }
}

/**
 * The five cuts, and what each one is really comparing.
 *
 * `dimension` is the Roistat side; `cut` is the Bitrix24 query. The note is
 * printed with the section because a reader who does not know that Bitrix24
 * splits revenue across a deal's product lines will read the product section
 * as a Roistat defect.
 */
const VERIFY_CUTS: ReadonlyArray<{
  readonly cut: VerifyCut
  readonly dimension: MarketingDimension
  readonly note: string
}> = [
  {
    cut: 'day',
    dimension: 'days',
    note:
      'Bitrix24: bitim YARATILGAN kuni boʻyicha (countsAsRevenue) · Roistat: pul lid sanasiga ' +
      'bogʻlangan. Shuning uchun asosiy solishtirish "yaratilgan" asosida; yopilgan sana ' +
      'boʻyicha jami alohida koʻrsatilgan.',
  },
  {
    cut: 'region',
    dimension: 'region',
    note: 'Bitrix24: deal.region · Roistat: region kaliti. Ikkalasi ham qoʻlda toʻldiriladi.',
  },
  {
    cut: 'product',
    dimension: 'product',
    note:
      'Bitrix24: deal_item → product.name (buyurtma = alohida bitim, tushum = satr summasi) · ' +
      'Roistat: bitta bitim bitta mahsulotga yoziladi.',
  },
  {
    cut: 'rop',
    dimension: 'rop',
    note: 'Bitrix24: bitim egasining boʻlimi · Roistat: rop kaliti (boʻlim nomi bilan yoziladi).',
  },
  {
    cut: 'seller',
    dimension: 'seller',
    note: 'Bitrix24: employee.fullName · Roistat: sotuvchi ismi. Ism tartibi va raqam joyi har xil.',
  },
]

/**
 * Why the two systems differ — the six reasons, verbatim from the script.
 *
 * This list is the point of the whole panel. The requirement was "100 %
 * correct", and the only correct answer is that two systems measuring
 * different things by different rules will not agree: what we owe the reader
 * is the size of each gap and its cause. Nothing here is ever used to adjust a
 * number.
 */
const VERIFY_REASONS: readonly string[] = [
  'Tushum taʼrifi boshqa. Roistat fact2 = yigʻilgan pul, LID sanasiga bogʻlangan ' +
    '("Выручка привязана к дате лида" — ularning oʻz sahifasi izohi). Bitrix24 esa yutilgan ' +
    'bitimni YOPILGAN sanasiga yozadi. Ikkala asos ham yuqorida koʻrsatilgan.',
  'Voronkalar boshqa. Bu yerda faqat countsAsRevenue = true (Доставка + Ecommerce). База ' +
    'voronkasi oʻsha pulning nusxasi — hisobga kirmaydi, aks holda Bitrix24 ikki barobar koʻrinardi.',
  'Roistat faqat PULLIK trafikni qamraydi. Portalga boshqa yoʻldan kelgan bitimlar Bitrix24 da ' +
    'bor, Roistat da umuman yoʻq.',
  'Kalitlar qoʻlda yoziladi. Google Sheets dagi ism/region imlosi portal nomiga aynan teng emas; ' +
    '"mos kelmadi" roʻyxatlari aynan shu — moslashtirilmagan, koʻrsatilgan.',
  'Davrlar teng emas. Har bir oʻlchov oʻz sanasida tugaydi, va freshFrom dan keyingi kunlar hali ' +
    'yopilmagan — oʻsha kunlarda Roistat past koʻrinadi.',
  'Mahsulot boʻyicha asos boshqa. Bitrix24 da bitta bitimda bir nechta mahsulot boʻlishi mumkin ' +
    '(tushum satrlarga boʻlinadi), Roistat da bitim bitta mahsulotga yoziladi.',
]

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export class MarketingService {
  constructor(private readonly repository: MarketingRepository) {}

  /**
   * The KPI band, the funnel and the dynamics panels.
   *
   * All three read the DAYS dimension and only that one, exactly like `kpis()`
   * in logic.js: the band does not change when the reader switches tabs,
   * because "the period's spend" is a fact about the period, not about the
   * slice being examined. Reading it from the open tab instead would make the
   * hero figure jump between tabs that cover different date ranges.
   */
  async overview(query: MarketingWindowQuery, timeZone: string, now: Date): Promise<MarketingOverviewDto> {
    const snapshot = await this.repository.snapshot()

    if (!snapshot) {
      const today = todayIn(timeZone, now)
      const empty = { from: today, to: today }
      return {
        snapshot: null,
        window: empty,
        previousWindow: previousWindow(empty),
        current: metricsDto(ZERO_RAW, 0n),
        previous: metricsDto(ZERO_RAW, 0n),
        funnel: funnel(ZERO_RAW).map((step) => ({ ...step })),
        daily: [],
        coverage: [],
      }
    }

    const window = resolveWindow(query, snapshot)
    const previous = previousWindow(window)

    // ONE QUERY FOR THREE READS. The comparison window ends the day before the
    // current one starts, so the two are contiguous: asking for the whole span
    // and splitting it here gives the period totals, the comparison totals and
    // the daily series from the same rows read at the same instant. A second
    // round trip could straddle an import and disagree with the first.
    const [rows, coverage] = await Promise.all([
      this.repository.dailyRows({ from: previous.from, to: window.to }),
      this.repository.coverage(),
    ])

    const inWindow = (row: MarketingDayRow) => row.date >= window.from && row.date <= window.to
    const inPrevious = (row: MarketingDayRow) => row.date >= previous.from && row.date <= previous.to

    const currentRows = rows.filter(inWindow)
    const currentRaw = sumRaw(currentRows.map((row) => row.raw))
    const previousRaw = sumRaw(rows.filter(inPrevious).map((row) => row.raw))

    return {
      snapshot: snapshotDto(snapshot),
      window,
      previousWindow: previous,
      current: metricsDto(currentRaw, snapshot.usdRateMicro),
      previous: metricsDto(previousRaw, snapshot.usdRateMicro),
      funnel: funnel(currentRaw).map((step) => ({ ...step })),
      // Oldest first, last 62 points — their `dayCh()` slices the same way.
      // The cap is a legibility limit, not a data limit: the totals above are
      // computed from every row in the window, capped or not.
      daily: currentRows.slice(-MAX_DAILY_POINTS).map((row) => ({
        date: row.date,
        spend: usdMoney(row.raw.spendMicroUsd),
        revenue: uzsMoney(row.raw.soldMinor),
        roas: roas(row.raw.soldMinor, row.raw.spendMicroUsd, snapshot.usdRateMicro),
      })),
      coverage: coverage.flatMap((row) => {
        const dimension = row.dimension.toLowerCase() as MarketingDimension
        // A dimension the domain does not know about is a schema change we have
        // not caught up with; dropping it is better than typing it into the DTO.
        if (!MARKETING_DIMENSIONS.includes(dimension)) return []
        return [{ dimension, from: row.from, to: row.to }]
      }),
    }
  }

  /**
   * One dimension's rows plus the JAMI total.
   *
   * The total is the summed RAW counters re-derived, never the column of
   * printed percentages averaged — that is the difference between "the period
   * bought out 82 % of what it ordered" and "the mean of 339 campaigns' buyout
   * rates", which are different numbers and only the first one is true.
   */
  async breakdown(query: MarketingBreakdownQuery): Promise<MarketingBreakdownDto> {
    const snapshot = await this.repository.snapshot()
    const dimension = query.dimension

    // The drill-down parent only means something where there IS a level above:
    // camp → adset → creative and nothing else. Applying `?parent=` to a flat
    // dimension would filter against the empty string every row stores there
    // and return nothing at all, which reads as "no data" rather than as
    // "that question does not apply".
    const parent = DIMENSION_PARENT[dimension] === null ? null : (query.parent ?? null)

    if (!snapshot) {
      return {
        dimension,
        parent,
        window: { from: '', to: '' },
        rows: [],
        total: metricsDto(ZERO_RAW, 0n),
      }
    }

    const window = resolveWindow(query, snapshot)
    const rows = await this.repository.breakdownRows(dimension, parent, window)

    return {
      dimension,
      parent,
      window,
      rows: sortRows(rows, dimension).map((row) => ({
        key: row.key,
        // The source stores an empty string for a flat dimension; null is what
        // "there is no parent" means on the wire.
        parent: row.parent === '' ? null : row.parent,
        metrics: metricsDto(row.raw, snapshot.usdRateMicro),
      })),
      total: metricsDto(sumRaw(rows.map((row) => row.raw)), snapshot.usdRateMicro),
    }
  }

  /**
   * Roistat against Bitrix24, side by side, with every difference named.
   *
   * A port of `scripts/verifyRoistat.ts` onto the same repository queries the
   * script's SQL was copied into, so the panel and the CLI report cannot
   * disagree about what they measure. What the endpoint adds is a window
   * parameter; what it keeps is the discipline — no number is ever adjusted to
   * make the two sides meet, and every key that failed to pair up is named.
   */
  async verify(query: MarketingWindowQuery, timeZone: string, now: Date): Promise<MarketingVerifyDto> {
    const snapshot = await this.repository.snapshot()

    if (!snapshot) {
      const today = todayIn(timeZone, now)
      return {
        window: { from: today, to: today },
        cuts: [],
        bitrixCloseBasis: null,
        reasons: VERIFY_REASONS,
      }
    }

    const requested = resolveWindow(query, snapshot)

    const [coverage, activeDays, bitrixCoverage] = await Promise.all([
      this.repository.coverage(),
      this.repository.activeDayRange(),
      this.repository.bitrixCoverage(),
    ])

    // No Bitrix24 deals at all means there is nothing to compare against. The
    // reasons still travel: they are why this panel exists, and a reader who
    // opens it on an unsynced database should still learn what it would say.
    if (!bitrixCoverage) {
      return { window: requested, cuts: [], bitrixCloseBasis: null, reasons: VERIFY_REASONS }
    }

    const roistatCoverage = new Map(coverage.map((row) => [row.dimension.toLowerCase(), row]))

    const cuts: VerifyCutDto[] = []
    let dayWindow: MarketingWindowDto | null = null

    for (const spec of VERIFY_CUTS) {
      const covered = roistatCoverage.get(spec.dimension)
      if (!covered) continue

      /*
       * THE DAY CUT ENDS WHERE THE DATA DOES, NOT WHERE THE ROWS DO.
       *
       * The blob pads its day series out to its own `today` with rows that
       * carry impressions but no leads, no spend, no orders and no money.
       * Scoring that padding against real Bitrix24 days would report a Roistat
       * shortfall of several hundred orders — a reporting artefact dressed up
       * as a divergence — so the day comparison stops at the last day with any
       * activity. Every other cut uses its own coverage, which is honest
       * because those dimensions are not padded.
       */
      const roistatRange: DateRange =
        spec.cut === 'day' && activeDays ? activeDays : { from: covered.from, to: covered.to }

      const window =
        intersect(requested, roistatRange) === null
          ? null
          : intersect(intersect(requested, roistatRange)!, bitrixCoverage)

      // A cut whose windows do not overlap is left out entirely rather than
      // reported as two zeros, which would read as "both systems agree there
      // was nothing" when the truth is "nobody was asked".
      if (!window) continue
      if (spec.cut === 'day') dayWindow = window

      const [roistatRows, bitrixRows] = await Promise.all([
        this.repository.verifyRoistatFacts(spec.dimension, window),
        this.repository.verifyBitrixFacts(spec.cut, window),
      ])

      const roistatFacts = collectFacts(roistatRows)
      const bitrixFacts = collectFacts(bitrixRows)

      const paired = pairKeys(spec.cut, roistatFacts, bitrixFacts)

      cuts.push({
        cut: spec.cut,
        window,
        note: spec.note,
        rows: paired.rows,
        roistatTotal: factsDto(totalFacts(roistatFacts.values())),
        bitrixTotal: factsDto(totalFacts(bitrixFacts.values())),
        unmatchedRoistat: paired.unmatchedRoistat,
        unmatchedBitrix: paired.unmatchedBitrix,
        unmatchedRoistatTotal: factsDto(
          totalFacts(paired.unmatchedRoistat.map((key) => roistatFacts.get(key) ?? ZERO_FACTS)),
        ),
        unmatchedBitrixTotal: factsDto(
          totalFacts(paired.unmatchedBitrix.map((key) => bitrixFacts.get(key) ?? ZERO_FACTS)),
        ),
      })
    }

    const closeBasis = dayWindow
      ? factsDto(totalFacts(await this.repository.verifyBitrixByCloseDate(dayWindow)))
      : null

    return { window: requested, cuts, bitrixCloseBasis: closeBasis, reasons: VERIFY_REASONS }
  }
}

/**
 * Pair one cut's keys.
 *
 * The day cut is exact by construction — both sides are ISO dates — so every
 * date either side reports becomes a row, with a null where the other system
 * has nothing. A day Bitrix24 recorded and Roistat did not is a fact worth
 * seeing in the series, not a naming problem.
 *
 * The name cuts go through `matchKeys`, and their unmatched keys stay OUT of
 * the row list: a seller who failed to pair is not a seller with zero sales,
 * and rendering them as a row against an empty column would say exactly that.
 */
function pairKeys(
  cut: VerifyCut,
  roistatFacts: Map<string, VerifyFacts>,
  bitrixFacts: Map<string, VerifyFacts>,
): {
  rows: VerifyRowDto[]
  unmatchedRoistat: string[]
  unmatchedBitrix: string[]
} {
  if (cut === 'day') {
    const keys = [...new Set([...roistatFacts.keys(), ...bitrixFacts.keys()])].sort()
    return {
      rows: keys.map((key) => verifyRow(key, roistatFacts.get(key), bitrixFacts.get(key), null)),
      unmatchedRoistat: keys.filter((key) => roistatFacts.has(key) && !bitrixFacts.has(key)),
      unmatchedBitrix: keys.filter((key) => bitrixFacts.has(key) && !roistatFacts.has(key)),
    }
  }

  const match = matchKeys([...roistatFacts.keys()], [...bitrixFacts.keys()])

  const rows = match.matched
    .map((pair) =>
      verifyRow(pair.left, roistatFacts.get(pair.left), bitrixFacts.get(pair.right), pair.rule),
    )
    // Biggest money first: the rows that explain a total's divergence are the
    // ones the reader needs at the top, and the client can re-sort.
    .sort((a, b) => (b.roistat?.revenue.amount ?? 0) - (a.roistat?.revenue.amount ?? 0))

  return {
    rows,
    unmatchedRoistat: [...match.unmatchedLeft],
    unmatchedBitrix: [...match.unmatchedRight],
  }
}

/**
 * A default order for the breakdown payload.
 *
 * The table sorts itself — clicking a header is the reader's business — but a
 * payload still arrives in SOME order, and `groupBy` does not promise one.
 * Days ascend because they are a series; every other dimension leads with the
 * money, which is what their page sorts by out of the box (fact2 desc).
 */
function sortRows(rows: readonly MarketingKeyRow[], dimension: MarketingDimension): MarketingKeyRow[] {
  const sorted = [...rows]
  if (dimension === 'days') {
    sorted.sort((a, b) => a.key.localeCompare(b.key))
    return sorted
  }
  sorted.sort((a, b) => {
    if (b.raw.soldMinor !== a.raw.soldMinor) return b.raw.soldMinor > a.raw.soldMinor ? 1 : -1
    return b.raw.spendMicroUsd > a.raw.spendMicroUsd ? 1 : -1
  })
  return sorted
}

/** Kept for the unit tests and for any caller that needs to add two windows' rows. */
export const __internals = { addRaw }
