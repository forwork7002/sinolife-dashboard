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
import { type MetaProduct, ownerOf } from '@/server/integrations/meta/accounts'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import {
  NOT_STATED,
  type TargetCountersRow,
  type TargetGroupRow,
  type MetaSpendRow,
  type TargetLeadRow,
  type TargetRepository,
} from '@/server/repositories/targetRepository'
import type { TargetScope } from '@/server/domain/types'

import type { MarketingRepository } from '@/server/repositories/marketingRepository'
import { keyPart, ttlCache } from './ttlCache'

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
  /** The seven ad pages' names, as the portal spells them — what «target» means. */
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
  readonly products: readonly {
    readonly product: MetaProduct
    readonly spendUsd: number
    readonly metaLeads: number
  }[]
  readonly accounts: readonly string[]
}

/**
 * One product: its Meta spend beside the Bitrix24 leads and money its own
 * pages brought in over the same days. Two ledgers, one row, each figure
 * named for its source; the ratios between them are labelled as such.
 */
export interface MetaProductDto {
  readonly product: MetaProduct
  readonly spendUsd: number
  readonly metaLeads: number
  readonly metaCplUsd: number | null
  /** Регистрация leads from this product's target pages. */
  readonly bitrixLeads: number
  /** Meta spend ÷ Bitrix24 leads — what one registered lead cost. */
  readonly costPerBitrixLeadUsd: number | null
  /** Delivered money from those pages' sales deals, soʻm. */
  readonly deliveredMoney: MoneyDto
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
  readonly total: Omit<MetaProductDto, 'product'>
  /** UZS per USD used for ROAS — the ad ledger's rate, with its date. */
  readonly usdRate: number | null
  readonly usdRateDate: string | null
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
  usdRate: number | null
  usdRateDate: string | null
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

  const productTotals = (product: MetaProduct | null) => {
    const accs = ordered.filter((a) => product === null || a.column.product === product)
    const spend = accs.reduce((n, a) => n + a.spend, 0n)
    const leads = accs.reduce((n, a) => n + a.leads, 0)
    const sources = input.sources.filter((s) => {
      const p = input.productOfSource.get(s.key)
      return p !== undefined && (product === null || p === product)
    })
    const bitrixLeads = sources.reduce((n, s) => n + s.leads, 0)
    const delivered = sources.reduce((n, s) => n + s.deliveredMinor, 0n)
    const spendUsd = usd(spend)
    const spendUzs = input.usdRate !== null ? spendUsd * input.usdRate : 0
    return {
      spendUsd,
      metaLeads: leads,
      metaCplUsd: ratio(Number(spend) / MICRO, leads),
      bitrixLeads,
      costPerBitrixLeadUsd: ratio(Number(spend) / MICRO, bitrixLeads),
      deliveredMoney: uzs(delivered),
      roas: spendUzs > 0 ? Number(delivered) / 100 / spendUzs : null,
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
    (product) => ({ product, ...productTotals(product) }),
  )

  return {
    importedAt: input.importedAt?.toISOString() ?? null,
    window: input.window,
    columns,
    days,
    targetologs: [...people.values()]
      .sort((a, b) => Number(b.spend - a.spend))
      .map((p) => ({
        targetolog: p.targetolog,
        ...metrics(p.spend, p.leads, p.impressions, p.clicks),
        products: p.parts.map((a) => ({
          product: a.column.product,
          spendUsd: usd(a.spend),
          metaLeads: a.leads,
        })),
        accounts: [...new Set(p.parts.flatMap((a) => [...a.accounts]))].sort(),
      })),
    owners: ordered.map((a) => ({
      ...a.column,
      ...metrics(a.spend, a.leads, a.impressions, a.clicks),
      accounts: [...a.accounts].sort(),
    })),
    products,
    total: productTotals(null),
    usdRate: input.usdRate,
    usdRateDate: input.usdRateDate,
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
const summaryCache = ttlCache<Awaited<ReturnType<TargetRepository['summary']>>>(60_000)

/** Test seam: module-level, so shared between test files inside one worker. */
export function resetTargetCaches(): void {
  summaryCache.clear()
}

/** What `/target/leads` narrows by, already validated by `targetLeadsQuerySchema`. */
export interface TargetLeadsQuery {
  readonly scope: TargetScope
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

  private sourceIds(scope: TargetScope): readonly string[] | null {
    return scope === 'target' ? TARGET_SOURCE_IDS : null
  }

  async overview(
    period: Period,
    scope: TargetScope,
    timeZone: string,
  ): Promise<TargetOverviewDto> {
    const sourceIds = this.sourceIds(scope)
    const key = [
      period.preset,
      period.start.toISOString(),
      periodLengthInDays(period),
      keyPart(sourceIds ?? null),
    ].join('|')

    const window = {
      from: zonedDateKey(period.start, timeZone),
      to: zonedDateKey(new Date(period.end.getTime() - 1), timeZone),
    }

    const [summary, targetSources, snapshot, metaRows, metaImportedAt] = await Promise.all([
      summaryCache.get(key, () => this.repository.summary({ period, sourceIds })),
      this.repository.targetSources(TARGET_SOURCE_IDS),
      this.marketing.snapshot(),
      this.repository.metaSpend(window.from, window.to),
      this.repository.metaImportedAt(),
    ])

    const group = (rows: readonly TargetGroupRow[]): TargetGroupDto[] =>
      rows.map((row) => ({ key: row.key, ...countersDto(row) }))

    // Which product each of this window's source rows sells, by the page's id.
    const productOfSource = new Map(
      targetSources.map((s) => [s.name, TARGET_SOURCE_PRODUCT[s.externalId]] as const),
    )

    return {
      targetSources: targetSources.map((s) => s.name),
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
        rows: metaRows,
        importedAt: metaImportedAt,
        window,
        sources: summary.sources,
        productOfSource,
        // Micro-soʻm per dollar, as the ledger stores it.
        usdRate: snapshot ? Number(snapshot.usdRateMicro) / 1_000_000 : null,
        usdRateDate: snapshot?.rateDate ?? null,
      }),
    }
  }

  async leads(
    period: Period,
    query: TargetLeadsQuery,
  ): Promise<{ items: TargetLeadDto[]; totalItems: number }> {
    const { rows, total } = await this.repository.leads({
      period,
      sourceIds: this.sourceIds(query.scope),
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
