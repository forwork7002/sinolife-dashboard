/**
 * The Marketing module's client contract.
 *
 * This is the ONE place the screen's shape of the data is written down. Every
 * other file in `src/features/marketing/` reads these types and nothing else,
 * so when the `/api/v1/marketing/*` payloads move, exactly one file changes.
 *
 * Why it lives here rather than in `src/lib/api.ts`: that file is owned by the
 * API layer and mirrors DTOs the services declare. These interfaces are the
 * SAME contract stated from the consumer's side while the endpoints were being
 * built in parallel — if `api.ts` ends up exporting them verbatim, this module
 * should re-export from there and delete the duplicates. The field names below
 * follow `src/server/domain/analytics/marketing.ts` deliberately, minus the
 * `…MicroUsd` / `…Minor` suffixes that BigInt storage needs and MoneyDto does
 * not.
 *
 * The units are the single easiest thing to get wrong in this module and they
 * are therefore stated on every money field:
 *   spend, cpl, cpql, cpo, cac, cpm, cpc          -> USD-native  (Meta Ads)
 *   ordered, revenue, metaRevenue, averageCheque,
 *   arpl                                          -> UZS-native  (the sheet)
 * `roas` divides the UZS side by the rate FIRST; it is a pure ratio.
 */

import type { MoneyDto } from '@/lib/api'

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** The twelve slices the source publishes, in `D.tabs` order. */
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
 * Uzbek tab labels, with the source's own Russian in the comment.
 *
 * The published page is in Russian and the client reads it in Russian; these
 * are the names our readers use, and keeping the original beside each one is
 * what makes a mismatch findable when someone compares the two screens.
 */
export const DIMENSION_LABELS: Readonly<Record<MarketingDimension, string>> = Object.freeze({
  camp: 'Kampaniyalar', //     Кампании
  adset: 'Adsetlar', //        Адсеты
  creative: 'Reklamalar', //   Объявления
  targetolog: 'Targetolog', // Таргетолог
  form: 'Forma', //            Форма
  source: 'Manba', //          Источник
  product: 'Mahsulot', //      Товар
  region: 'Region', //         Регион
  rop: 'ROP', //               РОП
  seller: 'Sotuvchi', //       Продавец
  registrator: 'Registrator', // Регистратор
  days: 'Kunlar', //           Дни
})

/**
 * Singular column heading for the row-identity column of each dimension.
 *
 * "Kampaniyalar" heads a TAB (a set); the column beside a single row's numbers
 * names ONE thing. Using the plural in both places is how a table ends up
 * saying "Campaigns: EX - TOF - Collagen", which reads as a category error.
 */
export const DIMENSION_ROW_LABELS: Readonly<Record<MarketingDimension, string>> = Object.freeze({
  camp: 'Kampaniya',
  adset: 'Adset',
  creative: 'Reklama',
  targetolog: 'Targetolog',
  form: 'Forma',
  source: 'Manba',
  product: 'Mahsulot',
  region: 'Region',
  rop: 'ROP',
  seller: 'Sotuvchi',
  registrator: 'Registrator',
  days: 'Sana',
})

/**
 * Dimensions carrying Meta Ads delivery data (`META` in logic.js).
 *
 * Only the three that come from the ad account have impressions, reach, clicks
 * and Meta's own lead count. A region has no CTR, so the table does not offer
 * the column rather than printing a stripe of em dashes.
 */
export const META_DIMENSIONS: ReadonlySet<MarketingDimension> = new Set<MarketingDimension>([
  'camp',
  'adset',
  'creative',
])

/**
 * Dimensions carrying the lead funnel (`LEADD` in logic.js).
 *
 * Note which are missing: product, region and rop are recorded at ORDER time
 * in the client's sheet, so they know what was sold but not how many leads it
 * took to sell it.
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

/** camp -> adset -> creative is the only nesting the source has. */
export const DRILL_CHILD: Partial<Record<MarketingDimension, MarketingDimension>> = Object.freeze({
  camp: 'adset',
  adset: 'creative',
})

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * The imported blob's own provenance.
 *
 * `updatedLabel` is the stamp the PUBLISHED PAGE printed for itself
 * ("27.08.2026 14:11") and `importedAt` is when we pulled it. Neither is the
 * Bitrix24 sync time, and this module must never show that one: the numbers
 * here never touched the portal.
 */
export interface MarketingSnapshotDto {
  readonly sourceUrl: string
  /** UZS per USD used for every conversion on this screen. */
  readonly usdRate: number
  /** The rate's date, as the source printed it: `DD.MM.YYYY`. */
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
  /** When our importer last ran, ISO. */
  readonly importedAt: string
  readonly rowCount: number
}

/**
 * One summed aggregate plus every rate derived from it.
 *
 * Aggregation is plain summation of the sixteen raw counters; the rates are
 * derived from the SUM, never averaged across rows — a mean of daily CPLs is
 * not the period's CPL. Every derived field is null when its denominator is
 * zero, and null renders as an em dash, never as 0.
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
  /** Ad spend. USD-native. */
  readonly spend: MoneyDto
  /** `fact1` — ordered amount. UZS-native. */
  readonly ordered: MoneyDto
  /** `fact2` — collected amount; the revenue ROAS divides. UZS-native. */
  readonly revenue: MoneyDto
  /** Revenue attributed to Meta. UZS-native. */
  readonly metaRevenue: MoneyDto

  // --- derived ---
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

export interface MarketingWindowDto {
  readonly from: string
  readonly to: string
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

/** How far each dimension's data actually reaches. Gaps are real; we show them. */
export interface MarketingCoverageDto {
  readonly dimension: MarketingDimension
  readonly from: string
  readonly to: string
}

export interface MarketingOverviewDto {
  /**
   * Null means the importer has not run: the tables are empty.
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
  readonly parent: string | null
  readonly metrics: MarketingMetricsDto
}

export interface MarketingBreakdownDto {
  readonly dimension: MarketingDimension
  readonly parent: string | null
  readonly window: MarketingWindowDto
  readonly rows: readonly MarketingBreakdownRowDto[]
  /** The JAMI row: summed RAW fields, rates re-derived from that sum. */
  readonly total: MarketingMetricsDto
}

// ---------------------------------------------------------------------------
// The cross-check with Bitrix24
// ---------------------------------------------------------------------------

/** One side's figures for a matched key. */
export interface VerifyFactsDto {
  readonly orders: number
  readonly sold: number
  /** UZS-native. */
  readonly revenue: MoneyDto
}

export interface VerifyRowDto {
  readonly key: string
  readonly roistat: VerifyFactsDto | null
  readonly bitrix: VerifyFactsDto | null
  /** roistat - bitrix, per measure. Null where one side has no row at all. */
  readonly revenueDifference: MoneyDto | null
  /** Difference as a share of the Bitrix figure. Null when Bitrix has nothing. */
  readonly revenueDifferencePercent: number | null
}

export type VerifyCut = 'day' | 'region' | 'product' | 'rop' | 'seller'

export interface VerifyCutDto {
  readonly cut: VerifyCut
  readonly rows: readonly VerifyRowDto[]
  readonly roistatTotal: VerifyFactsDto
  readonly bitrixTotal: VerifyFactsDto
  /** Keys present on one side only — named, never quietly dropped. */
  readonly unmatchedRoistat: readonly string[]
  readonly unmatchedBitrix: readonly string[]
}

export interface MarketingVerifyDto {
  readonly window: MarketingWindowDto
  readonly cuts: readonly VerifyCutDto[]
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

/** MoneyDto -> a plain amount, or null. Keeps `?.amount ?? null` out of the JSX. */
export function amountOf(money: MoneyDto | null | undefined): number | null {
  return money ? money.amount : null
}
