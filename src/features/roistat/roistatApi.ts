/**
 * «Roistat» — the wire shapes, restated for the client.
 *
 * Mirrors `src/server/services/roistatService.ts`. Client code may not import
 * from `@/server/*`, so the DTOs are written out again here, the way
 * `targetApi.ts` does. Nothing checks the mirror — edit both sides.
 *
 * Every row carries RAW COUNTERS only; every ratio (CPL, QL %, ROAS, …) is
 * derived on the client by `roistatMetrics.ts`, so a total row is the sum of
 * its rows and its ratios are the ratios of those sums, never an average of
 * ratios.
 */

import type { PeriodDto } from '@/lib/api'

/**
 * The table's cut. `camp` → `adset` → `ad` drill into each other through
 * `parent`; the rest are flat.
 */
export type RoistatDim =
  | 'camp'
  | 'adset'
  | 'ad'
  | 'targetolog'
  | 'form'
  | 'source'
  | 'product'
  | 'region'
  | 'rop'
  | 'seller'
  | 'registrator'

export const ROISTAT_DIMS: readonly RoistatDim[] = Object.freeze([
  'camp',
  'adset',
  'ad',
  'targetolog',
  'form',
  'source',
  'product',
  'region',
  'rop',
  'seller',
  'registrator',
])

/** Additive counters for one row, one total, or one day. */
export interface RoistatCountersDto {
  /** Meta Ads spend, dollars (cents precision) — the ad budget: Collagen and Zextra, hiring excluded. */
  readonly spendUsd: number
  readonly impressions: number
  /** Summed daily reach — an upper bound on unique people, as Meta's daily rows give it. */
  readonly reach: number
  readonly clicks: number
  /** Leads as Meta counts them (the `lead` action). */
  readonly metaLeads: number

  /** Регистрация deals created in the window. */
  readonly leads: number
  /** …less «Дубликат (лид)». */
  readonly clean: number
  /** …that the registrar passed on («Сделка успешна»). */
  readonly kval: number
  /** Sales deals that reached Тасдиклаш or Доставка — «Заказы». */
  readonly orders: number
  /** Their amount, whole so'm. */
  readonly orderedUzs: number
  /** Delivered and paid (Доставка, WON) — «Продажи». */
  readonly sold: number
  /** Their amount, whole so'm — the revenue ROAS divides. */
  readonly soldUzs: number
  /** Sold deals that were the customer's first ever paid order. */
  readonly newCustomers: number
  /** Days from the lead's creation to the sale's close, summed over `dealCount` sold deals. */
  readonly dealDaysSum: number
  readonly dealCount: number
}

export interface RoistatRowDto extends RoistatCountersDto {
  /** Stable id: the Meta id on `camp`/`adset`/`ad`, `YYYY-MM-DD` on `days`, else the label. */
  readonly key: string
  readonly label: string
  /** The Meta ad account (cabinet) name — set on `ad` only, else null. */
  readonly account: string | null
}

/** Which column groups the table shows for this cut. */
export interface RoistatColumnsDto {
  /** Impressions, frequency, clicks, CTR, CPM, CPC, Meta leads. */
  readonly meta: boolean
  /** Leads, clean, quality, CPL, kval, QL %, CPQL. */
  readonly leads: boolean
  /** Spend (and with it CPL, CPO, ROAS) — false where no dollar can be attributed. */
  readonly spend: boolean
  /** Orders, sales, buyout, CPO, average cheque, ROAS. */
  readonly sales: boolean
}

export interface RoistatDayDto {
  /** `YYYY-MM-DD`, Tashkent. */
  readonly date: string
  readonly spendUsd: number
  readonly soldUzs: number
}

export interface RoistatOverviewDto {
  readonly dim: RoistatDim
  /** The campaign (for `adset`) or adset (for `ad`) being drilled into, or null. */
  readonly parent: { readonly key: string; readonly label: string } | null
  /** The campaign above `parent` when `dim` is `ad`, for the breadcrumb. */
  readonly grandParent: { readonly key: string; readonly label: string } | null
  readonly columns: RoistatColumnsDto
  readonly rows: readonly RoistatRowDto[]
  /** Sum of `rows` — the table's ИТОГО. */
  readonly total: RoistatCountersDto
  /** The whole window, every source — the KPI tiles. Independent of `dim`. */
  readonly kpi: RoistatCountersDto
  /** The same, over the equal-length window just before — the tiles' deltas. */
  readonly kpiPrevious: RoistatCountersDto
  readonly previousPeriod: PeriodDto
  /** Oldest first, every day of the window — the spend / ROAS chart. */
  readonly daily: readonly RoistatDayDto[]
  /** CBU so'm per dollar, for the window's last day; null when CBU could not be read. */
  readonly rate: { readonly uzsPerUsd: number; readonly date: string } | null
  /** Days on or after this (`YYYY-MM-DD`) are still settling — sales close later. */
  readonly freshFrom: string
  /** When Meta rows were last imported (ISO), or null. */
  readonly metaImportedAt: string | null
  /**
   * The window's ad-budget spend from Meta's CAMPAIGN grain — the tiles'
   * Расход. The Meta cuts read the ad grain, imported separately; a ИТОГО
   * below this means that grain is still filling.
   */
  readonly campaignSpendUsd: number
}
