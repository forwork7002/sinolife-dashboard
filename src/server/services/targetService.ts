/**
 * «Target tahlili» — the service behind `/target/overview` and `/target/leads`.
 *
 * TWO SOURCES, SIDE BY SIDE AND NEVER ADDED. The Bitrix24 half is the leads
 * the target pages brought in and what became of them. The ad half is Meta
 * Ads spend per targetolog per day, read from the Marketing API into
 * `meta_ad_daily` — the numbers the client's «Лид база» sheet is typed from.
 * Where one is divided by the other (a product's spend per Bitrix24 lead, its
 * ROAS) the screen names both sources on the figure.
 *
 * The Roistat page's own ad figures are NOT on this screen: they stop weeks
 * behind Meta (on 2026-09-19 September carried impressions and not a dollar),
 * and two spend figures for one day would contradict each other. Only its
 * UZS/USD rate is borrowed, for ROAS.
 */

import {
  TARGET_SOURCE_IDS,
  TARGET_SOURCE_PRODUCT,
} from '@/server/integrations/crm/bitrix24/mapping'
import { type MetaProduct, campaignChannel, isSiteCampaign, ownerOf } from '@/server/integrations/meta/accounts'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import { formFillBrand, formNameOf } from '@/server/domain/leads/leadSources'
import { fillsCover, isIntegrationForm } from '@/server/domain/leads/formFills'
import {
  NOT_STATED,
  type MetaCampaignTotalRow,
  type TargetCountersRow,
  type TargetFormFills,
  type TargetFormRow,
  type TargetGroupRow,
  type MetaSpendRow,
  type TargetLeadRow,
  type TargetRepository,
} from '@/server/repositories/targetRepository'
import { TARGET_PRODUCTS, type TargetProductFilter, type TargetScope } from '@/server/domain/types'

import type { MarketingRepository } from '@/server/repositories/marketingRepository'
import type { GeneratedLeadsByBrand } from './leadSourcesService'
import { leadBrand } from './rnpService'
import { processWide } from '@/server/processWide'

import { LIVE_CACHE, keyPart, ttlCache } from './ttlCache'

// ---------------------------------------------------------------------------
// DTOs — mirrored in `src/lib/api.ts`
// ---------------------------------------------------------------------------

/**
 * One group's leads and what they became.
 *
 * Rates travel unrounded and are NULL over an empty denominator: a source that
 * brought no leads has no pass rate, and 0% would say it brought a hundred
 * that all failed.
 */
export interface TargetCountersDto {
  readonly leads: number
  readonly leadCustomers: number
  readonly leadWon: number
  /** leadWon / leads — the registrar passed the lead on. */
  readonly passPercent: number | null
  readonly sales: number
  readonly orders: number
  readonly ordered: MoneyDto
  /** orders / leads — a lead that became an order. */
  readonly orderPercent: number | null
  readonly delivered: number
  readonly deliveredMoney: MoneyDto
  readonly returned: number
  readonly returnedMoney: MoneyDto
  /** delivered / (delivered + returned) — of the parcels that resolved. */
  readonly buyoutPercent: number | null
  /** deliveredMoney / delivered. */
  readonly averageCheque: MoneyDto | null
  /** deliveredMoney / leads — what one lead brought in, on average. */
  readonly revenuePerLead: MoneyDto | null
}

export interface TargetGroupDto extends TargetCountersDto {
  readonly key: string
}

export interface TargetStageDto {
  readonly kind: 'lead' | 'sale'
  readonly pipeline: string
  readonly stage: string
  readonly deals: number
  readonly amount: MoneyDto
}

export interface TargetOverviewDto {
  /** The ad pages' names, as the portal spells them — what «target» means. */
  readonly targetSources: readonly string[]
  readonly total: TargetCountersDto
  readonly bySource: readonly TargetGroupDto[]
  readonly byTargetolog: readonly TargetGroupDto[]
  readonly byCreative: readonly TargetGroupDto[]
  /** Every day of the window, zero-filled, oldest first. */
  readonly days: readonly TargetGroupDto[]
  readonly stages: readonly TargetStageDto[]
  /** What an empty targetolog / creative / source is filed under. */
  readonly notStated: string
  /** Meta Ads spend over the same calendar days — the «Лид база» sheet. */
  readonly meta: MetaBlockDto
}

/** One «Лид база» column: a targetolog's spend on one product. */
export interface MetaColumnDto {
  readonly key: string
  readonly product: MetaProduct
  readonly targetolog: string
}

/**
 * One day of the sheet, in dollars. `cells` lines up with `columns`; a
 * targetolog who spent nothing that day is 0, which is what the sheet shows.
 */
export interface MetaDayDto {
  readonly date: string
  readonly total: number
  readonly cells: readonly number[]
}

/** A targetolog on one product, over the window. */
/** Meta's delivery figures for any slice, with the rates derived from them. */
export interface MetaMetricsDto {
  readonly spendUsd: number
  readonly metaLeads: number
  /** spend ÷ Meta's leads. */
  readonly metaCplUsd: number | null
  readonly impressions: number
  readonly clicks: number
  /** clicks ÷ impressions. */
  readonly ctrPercent: number | null
  /** spend ÷ clicks. */
  readonly cpcUsd: number | null
  /** spend ÷ impressions × 1 000. */
  readonly cpmUsd: number | null
}

/** A targetolog on one product, over the window. */
export interface MetaOwnerDto extends MetaColumnDto, MetaMetricsDto {
  /** The ad accounts behind it, by name — so a reader can find them in Meta. */
  readonly accounts: readonly string[]
  /** Meta's lead-FORM leads of this column alone — the cards' «Facebook forma leadlari», per account. */
  readonly metaFormLeads: number
  /** Form-campaign spend ÷ `metaFormLeads`. */
  readonly metaFormCplUsd: number | null
}

/**
 * ONE PERSON, BOTH PRODUCTS — «this targetolog spent this much».
 *
 * The sheet splits a targetolog across two columns when they run both
 * products, and the question the client asks first is the person's own
 * total. `products` keeps the split underneath it.
 */
export interface MetaTargetologDto extends MetaMetricsDto {
  readonly targetolog: string
  /**
   * Meta's leads from this person's LEAD-FORM campaigns alone (`campaignChannel`
   * 'form', hiring out, «Sayt» in — «Lidlar»'s «Meta lid») — the funnel top the
   * card's «Bitrix лид» answers, so the two are the same cohort (the client,
   * 2026-10-22: «facebookdan tushgan lead va facebookdan bitrix24ga tushgan
   * lead»). `metaLeads` beside it is every campaign, DM included.
   */
  readonly metaFormLeads: number
  /** Form-campaign spend ÷ `metaFormLeads` — the price of one Facebook form lead. */
  readonly metaFormCplUsd: number | null
  readonly products: readonly {
    readonly product: MetaProduct
    readonly spendUsd: number
    readonly metaLeads: number
    /** This product's lead-form leads alone (`metaFormLeads`'s rule). */
    readonly metaFormLeads: number
  }[]
  readonly accounts: readonly string[]
  /** What this person's lead forms brought into Bitrix24 (`withTargetologLeads`); null = not read. */
  readonly bitrix: TargetologBitrixDto | null
}

/**
 * ONE TARGETOLOG'S LEADS IN BITRIX24 — «Lidlar» → «Targetologlar», to the
 * lead (the client, 2026-10-13: «1 klik narxi o'rniga 1 ta kval narxi, 1 ta
 * mijoz narxi, kval % hamma targetologlarga»). Meta names no deal, so a lead
 * is this person's when the CRM form that opened it carries their name
 * (`formOwner`) — the rule «Отчёт Т» and that tab already print, so the
 * screens cannot disagree. The money is the same tab's «Rasxod $»: the
 * lead-form campaigns less «Sayt», the only money whose leads arrive through
 * a form; the card's headline (DM, SMS, HR in it) would price a kval with
 * money that never could have produced one.
 */
export interface TargetologBitrixDto {
  /** «Rasxod $»: lead-form campaigns, «Sayt» out — what the two prices divide. */
  readonly formUsd: number
  /** Регистрация deals the person's CRM forms opened — «Bitrix лид». */
  readonly leads: number
  /** Of those, «Сделка успешна» now — «кв лид». */
  readonly qualified: number
  /** qualified ÷ leads — that tab's «%». */
  readonly qualifiedPercent: number | null
  /** formUsd ÷ qualified — «кв лид $». */
  readonly costPerQualifiedUsd: number | null
  /**
   * «Факт1 мижоз»: distinct clients (by phone) of those leads with a FAKT 1
   * order in the window. Null while the phone match is not read.
   */
  readonly clients: number | null
  /** formUsd ÷ clients. */
  readonly costPerClientUsd: number | null
  /**
   * «Qamrov»: the form leads that reached Bitrix24 ÷ Meta's form leads, «Lidlar»'s
   * `reachPercent` summed over the person's rows — the deals the «Таргетолог»
   * field alone filed here passed through no Meta form, so they are left out.
   */
  readonly reachPercent: number | null
}

/**
 * One product: its Meta spend beside the Bitrix24 leads and money its own
 * pages brought in over the same days. Two ledgers, one row, each figure
 * named for its source; the ratios between them are labelled as such.
 */
export interface MetaProductDto extends MetaProductTotalsDto {
  readonly product: MetaProduct
}

/**
 * Everything the Collagen-against-Zextra comparison needs for one product —
 * or for both, as the total. Meta's delivery on the left, the product's own
 * pages in Bitrix24 on the right, and the costs that divide one by the other.
 */
export interface MetaProductTotalsDto extends MetaMetricsDto {
  /**
   * Meta's leads from the LEAD-FORM campaigns alone (`campaignChannel`
   * 'form') — the figure a form fill in Bitrix24 answers. `metaLeads` beside
   * it is the accounts' whole `lead` action, hiring forms included.
   */
  readonly metaFormLeads: number
  /** Those campaigns' spend ÷ their leads. */
  readonly metaFormCplUsd: number | null
  /** Conversations Meta counted on the DM (message) campaigns. */
  readonly metaConversations: number
  /**
   * «Lidlar»'s «Ген лид» under the product's brand switch, since 2026-10-23
   * (`generatedLeadsByBrand`): on `formLeadsBasis` 'fills' every CRM-form
   * fill of the brand — the website form's too — the AI targetolog's deals
   * and the «Ген лид» typed in by hand. Only when that read failed, the
   * product's own form fills as before (2026-10-15), or on 'deals' the
   * Регистрация deals naming its forms.
   */
  readonly bitrixFormLeads: number
  /** What `bitrixFormLeads` counts — see there. */
  readonly formLeadsBasis: 'fills' | 'deals'
  /** Регистрация leads from this product's target pages (DM). */
  readonly bitrixPageLeads: number
  /** bitrixFormLeads ÷ metaFormLeads — how much of what Meta counted reached the portal. */
  readonly formReachPercent: number | null
  /** Every Регистрация lead of the product: its forms' plus its pages'. */
  readonly bitrixLeads: number
  /** …of which the registrar passed on («Сделка успешна»). */
  readonly bitrixLeadWon: number
  /** Sales deals from those pages that reached Тасдиклаш or Доставка. */
  readonly orders: number
  readonly ordered: MoneyDto
  readonly delivered: number
  /** Delivered money from those pages' sales deals, soʻm. */
  readonly deliveredMoney: MoneyDto
  readonly returned: number
  /** orders ÷ Bitrix24 leads. */
  readonly orderPercent: number | null
  /** delivered ÷ (delivered + returned). */
  readonly buyoutPercent: number | null
  /** Meta spend ÷ Bitrix24 leads — what one registered lead cost. */
  readonly costPerBitrixLeadUsd: number | null
  /** Meta spend ÷ orders. */
  readonly costPerOrderUsd: number | null
  /** Meta spend ÷ delivered orders. */
  readonly costPerDeliveredUsd: number | null
  /** deliveredMoney ÷ (spend × rate). Null without a rate or a spend. */
  readonly roas: number | null
}

export interface MetaBlockDto {
  /** When Meta was last read; null means never — the token is not set up. */
  readonly importedAt: string | null
  readonly window: { readonly from: string; readonly to: string }
  readonly columns: readonly MetaColumnDto[]
  readonly days: readonly MetaDayDto[]
  /** One row per person, biggest spender first. */
  readonly targetologs: readonly MetaTargetologDto[]
  readonly owners: readonly MetaOwnerDto[]
  readonly products: readonly MetaProductDto[]
  /** Every account, «Boshqa» included — the «Лид база» Jami row: no dollar dropped. */
  readonly total: MetaProductTotalsDto
  /**
   * The product columns drawn under the hero «Reklamaga ketgan pul — Collagen
   * va Zextra», summed: its «1 lead» their spend over their own pages' leads,
   * never HR's or Kosmetika's money over them. A product with no Meta row in
   * the window has no column, so its pages are left out too; with none, zero.
   */
  readonly productsTotal: MetaProductTotalsDto
  /**
   * «Lidlar»'s «Brendsiz» «Ген лид» — typed in by hand, no form and no brand:
   * the products' «Forma leadlari» and these are «Lidlar»'s «Ген лид». Null
   * when «Lidlar» was not read; 0 under one product.
   */
  readonly brandlessLeads: number | null
  /** UZS per USD used for ROAS — the ad ledger's rate. */
  readonly usdRate: number | null
}

export interface TargetLeadSaleDto {
  readonly bitrixId: string | null
  readonly role: string
  readonly stage: string
  readonly status: string
  readonly amount: MoneyDto
  readonly seller: string | null
}

export interface TargetLeadDto {
  readonly bitrixId: string | null
  readonly createdAt: string
  readonly title: string
  readonly customerName: string | null
  readonly phone: string | null
  readonly source: string
  readonly targetolog: string | null
  readonly creative: string | null
  readonly primarySource: string | null
  readonly stage: string
  readonly stageCategory: string
  readonly registrar: string | null
  readonly sale: TargetLeadSaleDto | null
}

// ---------------------------------------------------------------------------

const CURRENCY = 'UZS'

const uzs = (minor: bigint): MoneyDto => toMoneyDto(money(minor, CURRENCY))

/** Percentage, unrounded; null over an empty denominator. */
function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null
}

/** A per-unit money figure, rounded to the minor unit; null over nothing. */
function perUnit(minor: bigint, count: number): MoneyDto | null {
  return count > 0 ? uzs(minor / BigInt(count)) : null
}

export function countersDto(row: TargetCountersRow): TargetCountersDto {
  const resolved = row.delivered + row.returned
  return {
    leads: row.leads,
    leadCustomers: row.leadCustomers,
    leadWon: row.leadWon,
    passPercent: percent(row.leadWon, row.leads),
    sales: row.sales,
    orders: row.orders,
    ordered: uzs(row.orderedMinor),
    orderPercent: percent(row.orders, row.leads),
    delivered: row.delivered,
    deliveredMoney: uzs(row.deliveredMinor),
    returned: row.returned,
    returnedMoney: uzs(row.returnedMinor),
    buyoutPercent: percent(row.delivered, resolved),
    averageCheque: perUnit(row.deliveredMinor, row.delivered),
    revenuePerLead: perUnit(row.deliveredMinor, row.leads),
  }
}

const ZERO: TargetCountersRow = {
  leads: 0,
  leadCustomers: 0,
  leadWon: 0,
  sales: 0,
  orders: 0,
  orderedMinor: 0n,
  delivered: 0,
  deliveredMinor: 0n,
  returned: 0,
  returnedMinor: 0n,
}

/**
 * Every calendar day of the window, with the ones nothing happened on as zeros.
 *
 * A gap in a daily bar chart reads as «no data» on some screens and «zero» on
 * others; here a quiet Sunday is a real zero and must be drawn as one.
 */
export function fillDays(period: Period, rows: readonly TargetGroupRow[]): TargetGroupRow[] {
  const byDay = new Map(rows.map((r) => [r.key, r]))
  const first = zonedDateKey(period.start, period.timeZone)
  const last = zonedDateKey(new Date(period.end.getTime() - 1), period.timeZone)
  const out: TargetGroupRow[] = []
  // Walk calendar days as UTC dates: the keys are already zone-resolved.
  for (
    let day = new Date(`${first}T00:00:00Z`);
    day.toISOString().slice(0, 10) <= last;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    const key = day.toISOString().slice(0, 10)
    out.push(byDay.get(key) ?? { key, ...ZERO })
    // Bounded: the period schema caps a range at ten years.
    if (out.length > 4000) break
  }
  return out
}

const MICRO = 1_000_000

/** Micro-dollars summed exactly, then printed as dollars with cents. */
function usd(micro: bigint): number {
  return Math.round(Number(micro) / 10_000) / 100
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

const PRODUCT_ORDER: readonly MetaProduct[] = ['Collagen', 'Zextra', 'Boshqa']

/** The brand a fill's subject («Заполнена CRM-форма "<form>"») counts for, or null. */
function fillProduct(subject: string): MetaProduct | null {
  const name = formNameOf(subject)
  return name === null ? null : formFillBrand(name)
}


/** Spend, leads and delivery for one slice, with every rate null over nothing. */
function metrics(spend: bigint, leads: number, impressions: number, clicks: number): MetaMetricsDto {
  const dollars = Number(spend) / MICRO
  return {
    spendUsd: usd(spend),
    metaLeads: leads,
    metaCplUsd: ratio(dollars, leads),
    impressions,
    clicks,
    ctrPercent: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpcUsd: ratio(dollars, clicks),
    cpmUsd: impressions > 0 ? (dollars / impressions) * 1000 : null,
  }
}

/**
 * The «Лид база» block: Meta spend by day × targetolog × product, and each
 * product's spend beside the Bitrix24 leads and money its own pages produced.
 *
 * Exported for its test: every total here is summed from micro-dollars and
 * converted once, so the day totals, the column totals and the grand total
 * agree to the cent the way the sheet's «Итог» row does.
 */
export function metaBlock(input: {
  rows: readonly MetaSpendRow[]
  importedAt: Date | null
  window: { from: string; to: string }
  sources: readonly TargetGroupRow[]
  productOfSource: ReadonlyMap<string, MetaProduct | undefined>
  /** The lead-form leads and their sales (`TargetRepository.formLeads`). */
  forms?: readonly TargetFormRow[]
  /**
   * The window's CRM-form fills (`TargetRepository.formFills`) — what
   * «Forma leadlari» counts; null when the fills do not cover the window,
   * and then the form deals are counted instead.
   */
  fills?: TargetFormFills['rows'] | null
  /**
   * «Lidlar»'s «Ген лид» per brand (`LeadSourcesService.generatedLeads`) —
   * what «Forma leadlari» shows when read; null or absent, the fills above.
   */
  generated?: GeneratedLeadsByBrand | null
  /** Meta per campaign over the window (`TargetRepository.metaCampaigns`). */
  campaigns?: readonly MetaCampaignTotalRow[]
  usdRate: number | null
}): MetaBlockDto {
  interface Acc {
    column: MetaColumnDto
    spend: bigint
    leads: number
    impressions: number
    clicks: number
    accounts: Set<string>
  }
  const owners = new Map<string, Acc>()
  const byDay = new Map<string, Map<string, bigint>>()

  for (const row of input.rows) {
    const owner = ownerOf(row.accountId, row.accountName)
    const key = `${owner.product}|${owner.targetolog}`
    const acc =
      owners.get(key) ??
      ({
        column: { key, product: owner.product, targetolog: owner.targetolog },
        spend: 0n,
        leads: 0,
        impressions: 0,
        clicks: 0,
        accounts: new Set<string>(),
      } satisfies Acc)
    acc.spend += row.spendMicroUsd
    acc.leads += row.leads
    acc.impressions += row.impressions
    acc.clicks += row.clicks
    acc.accounts.add(row.accountName)
    owners.set(key, acc)

    const day = byDay.get(row.date) ?? new Map<string, bigint>()
    day.set(key, (day.get(key) ?? 0n) + row.spendMicroUsd)
    byDay.set(row.date, day)
  }

  // The sheet's order: product first, then the biggest spender first.
  const ordered = [...owners.values()].sort(
    (a, b) =>
      PRODUCT_ORDER.indexOf(a.column.product) - PRODUCT_ORDER.indexOf(b.column.product) ||
      Number(b.spend - a.spend),
  )
  const columns = ordered.map((a) => a.column)

  const days: MetaDayDto[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cells]) => {
      let total = 0n
      for (const v of cells.values()) total += v
      return { date, total: usd(total), cells: columns.map((c) => usd(cells.get(c.key) ?? 0n)) }
    })

  /*
    A form lead is the product its «Проект» / form says (`leadBrand`, as on
    «Lidlar»). A form wins over its source, as «Lidlar»'s `leadChannel` has
    it: a CRM-form deal filed under a target page is a FORM lead, so it is
    taken back out of that page's row in `sources` (`page`) — otherwise the
    targetolog cards' «Bitrix лид» and «Forma leadlari» could not agree.
  */
  const forms = (input.forms ?? []).flatMap((row) => {
    const product = leadBrand(row.sourceId, row.formTitle, row.productLine)
    if (product === null) return []
    const page = row.sourceId === null ? undefined : TARGET_SOURCE_PRODUCT[row.sourceId]
    return [{ row, product, page }]
  })
  /*
    THE FILLS, AS META COUNTS ITS LEADS (2026-10-15, the client: «facebookdagi
    leadlar … qanday kombinatsiya … bitrix24da ham huddi shu kombinatsiyada»).
    Meta counts every fill, on the day it was filled; the portal opens a deal
    for only some — a returning contact's fill lands on the old deal. Over
    01–15.10.2026 the deals were 83 % of Meta's Collagen leads, the fills
    99.8 %. A fill's brand is its form's (`formFillBrand`: a website, vacancy
    or cosmetics form answers no Meta form campaign). The AI targetolog's own
    integration files deals, never a CRM form, so its leads are its deals
    either way. «Leadlar · jami» and every per-lead rate on the card divide
    these: a lead is what Meta calls one.
  */
  const fills =
    input.fills === null || input.fills === undefined
      ? null
      : input.fills.flatMap((row) => {
          const product = fillProduct(row.subject)
          return product === null ? [] : [{ product, fills: row.fills }]
        })
  const aiForms = forms.filter((f) => {
    const name = formNameOf(f.row.formTitle)
    return name !== null && isIntegrationForm(name)
  })

  /*
    «Sayt» lead campaigns send people to the website, not to a Meta form, so
    their leads never arrive as a CRM form: they stay out of the form pair, as
    they stay out of the targetolog cards' `formUsd`.
  */
  const campaigns = (input.campaigns ?? []).map((c) => ({
    ...c,
    product: ownerOf(c.accountId, c.accountName).product,
    channel: campaignChannel(c.objective, c.campaignName, c.accountId),
    site: isSiteCampaign(c.campaignName),
  }))

  /*
    FACEBOOK FORM LEADS PER PERSON (and per product column), the funnel top the
    card's «Bitrix лид» answers. «Lidlar» → «Targetologlar»'s own rule, since
    «Bitrix лид» is that tab's figure: every `channel === 'form'` campaign,
    hiring out, «Sayt» IN — its leads arrive as the website form's fills, which
    «Bitrix лид» counts. Left out (as the hero does), Timur's card read 351
    Facebook against 468 Bitrix (2026-10-22). `metaLeads` (every campaign)
    stays on the row beside it.
  */
  const formLeadsByKey = new Map<string, number>()
  const formSpendByKey = new Map<string, bigint>()
  const formLeadsByPerson = new Map<string, number>()
  const formSpendByPerson = new Map<string, bigint>()
  for (const c of campaigns) {
    if (c.channel !== 'form') continue
    const owner = ownerOf(c.accountId, c.accountName)
    const key = `${owner.product}|${owner.targetolog}`
    formLeadsByKey.set(key, (formLeadsByKey.get(key) ?? 0) + c.leads)
    formSpendByKey.set(key, (formSpendByKey.get(key) ?? 0n) + c.spendMicroUsd)
    formLeadsByPerson.set(owner.targetolog, (formLeadsByPerson.get(owner.targetolog) ?? 0) + c.leads)
    formSpendByPerson.set(owner.targetolog, (formSpendByPerson.get(owner.targetolog) ?? 0n) + c.spendMicroUsd)
  }
  const formCpl = (key: string) => ratio(Number(formSpendByKey.get(key) ?? 0n) / MICRO, formLeadsByKey.get(key) ?? 0)

  /** The owners and pages of `products`; null is every owner, «Boshqa» included. */
  const productTotals = (products: readonly MetaProduct[] | null): MetaProductTotalsDto => {
    const accs = ordered.filter((a) => products === null || products.includes(a.column.product))
    const spend = accs.reduce((n, a) => n + a.spend, 0n)
    const sources = input.sources.filter((s) => {
      const p = input.productOfSource.get(s.key)
      return p !== undefined && (products === null || products.includes(p))
    })
    const inScope = (p: MetaProduct) => products === null || products.includes(p)
    const ownForms = forms.filter((f) => inScope(f.product)).map((f) => f.row)
    // The form deals filed under one of these pages, taken back out of the page's row.
    const pageForms = forms.filter((f) => f.page !== undefined && inScope(f.page)).map((f) => f.row)
    const ownCampaigns = campaigns.filter((c) => inScope(c.product))
    const formCampaigns = ownCampaigns.filter((c) => c.channel === 'form' && !c.site)
    const formSpend = formCampaigns.reduce((n, c) => n + c.spendMicroUsd, 0n)
    const metaFormLeads = formCampaigns.reduce((n, c) => n + c.leads, 0)
    const signed: readonly (readonly [TargetCountersRow, 1 | -1])[] = [
      ...sources.map((r) => [r, 1] as const),
      ...ownForms.map((r) => [r, 1] as const),
      ...pageForms.map((r) => [r, -1] as const),
    ]
    const sum = (pick: (s: TargetCountersRow) => number) => signed.reduce((n, [s, k]) => n + k * pick(s), 0)
    const sumMinor = (pick: (s: TargetCountersRow) => bigint) =>
      signed.reduce((n, [s, k]) => n + BigInt(k) * pick(s), 0n)
    /*
      «LIDLAR» IS THE COUNT (2026-10-23, the client: «leadlar bo'limi eng
      to'g'ri bo'lishi kerak umuman o'zgarmaydi … target tahlildagi leadlar bilan
      bir xil bo'lishi kerak»). Collagen + Zextra read 601 here beside «Ген лид»
      604 there: the website form no targetolog owns (its brand is the name's,
      yet `formFillBrand` leaves the website out) and the «Ген лид» typed in by
      hand. Each product is now «Ген лид» under its brand; the whole adds
      «Brendsiz», as «Hammasi» there does.
    */
    const generated = input.generated ?? null
    const bitrixFormLeads =
      generated !== null
        ? TARGET_PRODUCTS.filter(inScope).reduce((n, p) => n + generated[p], 0) + (products === null ? generated.none : 0)
        : fills === null
          ? ownForms.reduce((n, s) => n + s.leads, 0)
          : fills.filter((f) => inScope(f.product)).reduce((n, f) => n + f.fills, 0) +
            aiForms.filter((f) => inScope(f.product)).reduce((n, f) => n + f.row.leads, 0)
    const bitrixPageLeads =
      sources.reduce((n, s) => n + s.leads, 0) - pageForms.reduce((n, s) => n + s.leads, 0)
    const bitrixLeads = bitrixPageLeads + bitrixFormLeads
    const orders = sum((s) => s.orders)
    const delivered = sum((s) => s.delivered)
    const returned = sum((s) => s.returned)
    const deliveredMinor = sumMinor((s) => s.deliveredMinor)
    const orderedMinor = sumMinor((s) => s.orderedMinor)
    const dollars = Number(spend) / MICRO
    const spendUzs = input.usdRate !== null ? dollars * input.usdRate : 0
    return {
      ...metrics(
        spend,
        accs.reduce((n, a) => n + a.leads, 0),
        accs.reduce((n, a) => n + a.impressions, 0),
        accs.reduce((n, a) => n + a.clicks, 0),
      ),
      metaFormLeads,
      metaFormCplUsd: ratio(Number(formSpend) / MICRO, metaFormLeads),
      metaConversations: ownCampaigns.filter((c) => c.channel === 'dm').reduce((n, c) => n + c.conversations, 0),
      bitrixFormLeads,
      formLeadsBasis: fills === null ? 'deals' : 'fills',
      bitrixPageLeads,
      formReachPercent: percent(bitrixFormLeads, metaFormLeads),
      bitrixLeads,
      bitrixLeadWon: sum((s) => s.leadWon),
      orders,
      ordered: uzs(orderedMinor),
      delivered,
      deliveredMoney: uzs(deliveredMinor),
      returned,
      orderPercent: percent(orders, bitrixLeads),
      buyoutPercent: percent(delivered, delivered + returned),
      costPerBitrixLeadUsd: ratio(dollars, bitrixLeads),
      costPerOrderUsd: ratio(dollars, orders),
      costPerDeliveredUsd: ratio(dollars, delivered),
      roas: spendUzs > 0 ? Number(deliveredMinor) / 100 / spendUzs : null,
    }
  }

  /*
    The person across products. An unmapped account is its own «person» — its
    name — so it is never folded into somebody else's total.
  */
  const people = new Map<
    string,
    { targetolog: string; spend: bigint; leads: number; impressions: number; clicks: number; parts: Acc[] }
  >()
  for (const a of ordered) {
    const person =
      people.get(a.column.targetolog) ??
      { targetolog: a.column.targetolog, spend: 0n, leads: 0, impressions: 0, clicks: 0, parts: [] }
    person.spend += a.spend
    person.leads += a.leads
    person.impressions += a.impressions
    person.clicks += a.clicks
    person.parts.push(a)
    people.set(a.column.targetolog, person)
  }

  const products = PRODUCT_ORDER.filter((p) => ordered.some((a) => a.column.product === p)).map(
    (product) => ({ product, ...productTotals([product]) }),
  )
  /*
    The hero sums the product columns actually drawn under it. Read off both
    products' pages, a window before Zextra's first dollar («Bugun» in the
    early hours) headed «Reklamaga ketgan pul — Collagen» with Collagen's
    money over Collagen's and Zextra's leads, orders and tushum.
  */
  const drawn = TARGET_PRODUCTS.filter((p) => products.some((d) => d.product === p))

  return {
    importedAt: input.importedAt?.toISOString() ?? null,
    window: input.window,
    columns,
    days,
    targetologs: [...people.values()]
      .sort((a, b) => Number(b.spend - a.spend))
      .map((p) => {
        const formLeads = formLeadsByPerson.get(p.targetolog) ?? 0
        return {
          targetolog: p.targetolog,
          ...metrics(p.spend, p.leads, p.impressions, p.clicks),
          metaFormLeads: formLeads,
          metaFormCplUsd: ratio(Number(formSpendByPerson.get(p.targetolog) ?? 0n) / MICRO, formLeads),
          products: p.parts.map((a) => ({
            product: a.column.product,
            spendUsd: usd(a.spend),
            metaLeads: a.leads,
            metaFormLeads: formLeadsByKey.get(a.column.key) ?? 0,
          })),
          accounts: [...new Set(p.parts.flatMap((a) => [...a.accounts]))].sort(),
          bitrix: null,
        }
      }),
    owners: ordered.map((a) => ({
      ...a.column,
      ...metrics(a.spend, a.leads, a.impressions, a.clicks),
      accounts: [...a.accounts].sort(),
      metaFormLeads: formLeadsByKey.get(a.column.key) ?? 0,
      metaFormCplUsd: formCpl(a.column.key),
    })),
    products,
    total: productTotals(null),
    productsTotal: productTotals(drawn),
    brandlessLeads: input.generated?.none ?? null,
    usdRate: input.usdRate,
  }
}

/** The slice of «Lidlar»'s `forms` block the cards read — what `LeadSourcesService.targetologForms` answers. */
export interface TargetologFormsInput {
  readonly owners: readonly {
    readonly targetolog: string
    readonly product: MetaProduct
    readonly formUsd: number
    readonly outcome: { readonly leads: number; readonly success: number }
    /** The Bitrix24 count of Meta's form leads — the fills since 2026-10-15 (`FormOwnerDto.bitrixLeads`). */
    readonly bitrixLeads: number
    readonly fakt1Clients: number | null
    /** Meta's form leads on this row — what «Qamrov» divides by. */
    readonly metaLeads: number
    /** «Ген лид» the «Таргетолог» field alone filed here: in `bitrixLeads` on 'deals', never a form's. */
    readonly formlessLeads: number
    readonly leadsBasis: 'fills' | 'deals'
  }[]
  readonly fakt1Targetologs: readonly { readonly targetolog: string; readonly clients: number }[] | null
}

/**
 * Each card's `bitrix`, from «Lidlar»'s `forms` block over the same window,
 * met on the person's name — both sides take it from `ownerOf` /
 * `formOwner`, as `withFormKval` meets «Отчёт Т». Under one product only
 * that product's forms count, as only its accounts' money does. A person
 * with money and no form lead reads 0 leads and no price; `forms` null (the
 * scan failed) leaves every card's `bitrix` null — unread, never 0.
 */
export function withTargetologLeads(
  overview: TargetOverviewDto,
  forms: TargetologFormsInput | null,
  product: TargetProductFilter,
): TargetOverviewDto {
  if (forms === null) return overview
  type Person = { formUsd: number; leads: number; success: number; clients: number | null; metaLeads: number; formLeads: number }
  const empty = (): Person => ({ formUsd: 0, leads: 0, success: 0, clients: 0, metaLeads: 0, formLeads: 0 })
  const people = new Map<string, Person>()
  for (const o of forms.owners) {
    if (product !== 'all' && o.product !== product) continue
    const acc = people.get(o.targetolog) ?? empty()
    acc.formUsd += o.formUsd
    acc.leads += o.bitrixLeads
    acc.success += o.outcome.success
    acc.clients = acc.clients === null || o.fakt1Clients === null ? null : acc.clients + o.fakt1Clients
    acc.metaLeads += o.metaLeads
    // «Lidlar»'s `reachPercent` numerator: on the deals, the field-filed «Ген лид» are no form's.
    acc.formLeads += o.leadsBasis === 'deals' ? o.bitrixLeads - o.formlessLeads : o.bitrixLeads
    people.set(o.targetolog, acc)
  }
  // Both products: the distinct count, so a client of a Collagen and a Zextra form is one.
  const distinct =
    product === 'all' && forms.fakt1Targetologs !== null
      ? new Map(forms.fakt1Targetologs.map((t) => [t.targetolog, t.clients]))
      : null
  const cents = (n: number) => Math.round(n * 100) / 100
  return {
    ...overview,
    meta: {
      ...overview.meta,
      targetologs: overview.meta.targetologs.map((t) => {
        const acc = people.get(t.targetolog) ?? empty()
        const clients =
          forms.fakt1Targetologs === null ? null : distinct ? (distinct.get(t.targetolog) ?? 0) : acc.clients
        const formUsd = cents(acc.formUsd)
        return {
          ...t,
          bitrix: {
            formUsd,
            leads: acc.leads,
            qualified: acc.success,
            qualifiedPercent: percent(acc.success, acc.leads),
            costPerQualifiedUsd: formUsd > 0 ? ratio(formUsd, acc.success) : null,
            clients,
            costPerClientUsd: formUsd > 0 && clients !== null ? ratio(formUsd, clients) : null,
            reachPercent: percent(acc.formLeads, acc.metaLeads),
          },
        }
      }),
    },
  }
}

function leadDto(row: TargetLeadRow): TargetLeadDto {
  return {
    bitrixId: row.bitrixId,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    customerName: row.customerName,
    phone: row.phone,
    source: row.source,
    targetolog: row.targetolog,
    creative: row.creative,
    primarySource: row.primarySource,
    stage: row.stage,
    stageCategory: row.stageCategory,
    registrar: row.registrar,
    sale: row.sale
      ? {
          bitrixId: row.sale.bitrixId,
          role: row.sale.role,
          stage: row.sale.stage,
          status: row.sale.status,
          amount: uzs(row.sale.amountMinor),
          seller: row.sale.seller,
        }
      : null,
  }
}

/*
  A memo in front of the summary, keyed by the whole question: the window, the
  preset and the source scope. Company-wide by construction — the route refuses
  a narrowed account — so no employee scope reaches it.
*/
/*
  The three on `globalThis` (2026-10-28): the warm lane builds «Shu oy» /
  «Oʻtgan oy» of the screen's opening question into them (`warm`) — cold,
  /target/overview «Shu oy» took 15.2–16.0 s of the 20 s.
*/
const summaryCache = processWide('sinolife.target.summaryCache', () =>
  ttlCache<Awaited<ReturnType<TargetRepository['summary']>>>(120_000, LIVE_CACHE),
)
/** The lead-form scan, keyed by the window alone — it takes no source scope. */
const formCache = processWide('sinolife.target.formCache', () =>
  ttlCache<Awaited<ReturnType<TargetRepository['formLeads']>>>(120_000, LIVE_CACHE),
)
/** The window's CRM-form fills, keyed like the form scan. */
const fillCache = processWide('sinolife.target.fillCache', () => ttlCache<TargetFormFills>(120_000, LIVE_CACHE))

/** The summary's memo key: the window, the preset and the pages counted. */
const summaryKey = (period: Period, sourceIds: readonly string[] | null): string =>
  [period.preset, period.start.toISOString(), periodLengthInDays(period), keyPart(sourceIds ?? null)].join('|')

/** The form scan's and the fills' memo key: the window alone. */
const formKey = (period: Period): string => [period.preset, period.start.toISOString(), periodLengthInDays(period)].join('|')

/** Test seam: module-level, so shared between test files inside one worker. */
export function resetTargetCaches(): void {
  summaryCache.clear()
  formCache.clear()
  fillCache.clear()
}

/** What `/target/leads` narrows by, already validated by `targetLeadsQuerySchema`. */
export interface TargetLeadsQuery {
  readonly scope: TargetScope
  readonly product: TargetProductFilter
  readonly source?: string
  readonly targetolog?: string
  readonly stage?: string
  readonly q?: string
  readonly page: number
  readonly pageSize: number
}

export class TargetService {
  constructor(
    private readonly repository: TargetRepository,
    private readonly marketing: MarketingRepository,
  ) {}

  /**
   * Which pages the Bitrix24 half counts. A product is defined only on the
   * target pages, so choosing one overrides «Barcha manbalar».
   */
  private sourceIds(scope: TargetScope, product: TargetProductFilter): readonly string[] | null {
    if (product !== 'all') {
      return TARGET_SOURCE_IDS.filter((id) => TARGET_SOURCE_PRODUCT[id] === product)
    }
    return scope === 'target' ? TARGET_SOURCE_IDS : null
  }

  /**
   * The screen's opening question — the target pages, both products — built
   * by the warm lane (2026-10-28) and handed out for `ttlMs` (see
   * `OwnedRefresh`): its summary, form scan and fills. Another scope or one
   * product is a reader's question, memoised as before.
   */
  async warm(period: Period, ttlMs: number): Promise<void> {
    const sourceIds = this.sourceIds('target', 'all')
    await summaryCache.refresh(summaryKey(period, sourceIds), () => this.repository.summary({ period, sourceIds }), { ttlMs })
    await formCache.refresh(formKey(period), () => this.repository.formLeads(period), { ttlMs })
    await fillCache.refresh(formKey(period), () => this.repository.formFills(period), { ttlMs })
  }

  /** `lidlar`: «Lidlar»'s «Ген лид» per brand, read beside this (`LeadSourcesService.generatedLeads`); null, the fills. */
  async overview(
    period: Period,
    scope: TargetScope,
    product: TargetProductFilter,
    timeZone: string,
    lidlar: Promise<GeneratedLeadsByBrand | null> | null = null,
  ): Promise<TargetOverviewDto> {
    const sourceIds = this.sourceIds(scope, product)
    const key = summaryKey(period, sourceIds)

    const window = {
      from: zonedDateKey(period.start, timeZone),
      to: zonedDateKey(new Date(period.end.getTime() - 1), timeZone),
    }

    const [summary, formRows, formFills, targetSources, snapshot, metaRows, campaignRows, metaImportedAt, generated] = await Promise.all([
      summaryCache.get(key, () => this.repository.summary({ period, sourceIds })),
      formCache.get(formKey(period), () => this.repository.formLeads(period)),
      fillCache.get(formKey(period), () => this.repository.formFills(period)),
      this.repository.targetSources(TARGET_SOURCE_IDS),
      this.marketing.snapshot(),
      this.repository.metaSpend(window.from, window.to),
      this.repository.metaCampaigns(window.from, window.to),
      this.repository.metaImportedAt(),
      lidlar,
    ])

    const group = (rows: readonly TargetGroupRow[]): TargetGroupDto[] =>
      rows.map((row) => ({ key: row.key, ...countersDto(row) }))

    // Which product each of this window's source rows sells, by the page's id.
    const productOfSource = new Map(
      targetSources.map((s) => [s.name, TARGET_SOURCE_PRODUCT[s.externalId]] as const),
    )

    return {
      // The pages the screen is counting — one product's, when one is chosen.
      targetSources: targetSources
        .filter((s) => product === 'all' || TARGET_SOURCE_PRODUCT[s.externalId] === product)
        .map((s) => s.name),
      total: countersDto(summary.total),
      bySource: group(summary.sources),
      byTargetolog: group(summary.targetologs),
      byCreative: group(summary.creatives),
      days: group(fillDays(period, summary.days)),
      stages: summary.stages.map((s) => ({
        kind: s.kind,
        pipeline: s.pipeline,
        stage: s.stage,
        deals: s.deals,
        amount: uzs(s.amountMinor),
      })),
      notStated: NOT_STATED,
      meta: metaBlock({
        // One product's accounts only, when one product is asked for.
        rows:
          product === 'all'
            ? metaRows
            : metaRows.filter((r) => ownerOf(r.accountId, r.accountName).product === product),
        importedAt: metaImportedAt,
        window,
        sources: summary.sources,
        productOfSource,
        // The lead forms and their campaigns, one product's when one is asked for.
        forms:
          product === 'all'
            ? formRows
            : formRows.filter((f) => leadBrand(f.sourceId, f.formTitle, f.productLine) === product),
        // Fills only where they cover the window (`fillsCover`); else the deals, as before.
        fills: fillsCover(formFills.coverage, period, new Date())
          ? product === 'all'
            ? formFills.rows
            : formFills.rows.filter((r) => fillProduct(r.subject) === product)
          : null,
        // «Lidlar»'s «Ген лид», one product's when one is asked for — «Brendsiz» is no product's.
        generated:
          generated === null || product === 'all'
            ? generated
            : { Collagen: 0, Zextra: 0, none: 0, [product]: generated[product] },
        campaigns:
          product === 'all'
            ? campaignRows
            : campaignRows.filter((c) => ownerOf(c.accountId, c.accountName).product === product),
        // Micro-soʻm per dollar, as the ledger stores it.
        usdRate: snapshot ? Number(snapshot.usdRateMicro) / 1_000_000 : null,
      }),
    }
  }

  async leads(
    period: Period,
    query: TargetLeadsQuery,
  ): Promise<{ items: TargetLeadDto[]; totalItems: number }> {
    const { rows, total } = await this.repository.leads({
      period,
      sourceIds: this.sourceIds(query.scope, query.product),
      source: query.source,
      targetolog: query.targetolog,
      stage: query.stage,
      search: query.q,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })
    return { items: rows.map(leadDto), totalItems: total }
  }
}
