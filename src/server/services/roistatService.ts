/**
 * «Roistat» — Meta Ads spend through to Bitrix24 sales, one cut at a time.
 *
 * Asked for on 2026-10-05: the client's own Roistat page
 * (rustamov0277-cmd.github.io/roistat — Google Sheets plus Meta) rebuilt from
 * Meta and Bitrix24 alone. Its layout is kept: twelve tiles against the
 * previous window, twelve cuts with Кампании → Адсеты → Объявления drilling
 * into each other, a funnel and a spend / ROAS chart.
 *
 * What it cannot keep is a lead per campaign: the sheets carried that and the
 * portal does not (no UTM — see roistatRepository.ts). So the Meta cuts carry
 * Meta's own figures, and spend sits beside leads only on the day, the
 * targetolog and the product (`columnsOf` in domain/roistat/roistatCuts.ts).
 *
 * THE RATE is the Central Bank's for the window's last day — the same source
 * «RNP jadvali» converts with — and only ROAS and the сум/$ switch read it.
 * The DTO carries dollars as dollars and so'm as so'm; nothing is converted
 * on the server.
 */

import { type Period, previousEquivalent, toPeriodDto, zonedDateKey } from '@/server/domain/period/period'
import type { PeriodDto } from '@/server/domain/period/period'
import {
  type RoistatColumns,
  type RoistatCounters,
  type RoistatDim,
  type SpendDay,
  addCounters,
  bitrixCut,
  bitrixTotal,
  columnsOf,
  daysBetween,
  emptyCounters,
  mergeCuts,
  narrowBitrix,
  spendCut,
  spendTotal,
} from '@/server/domain/roistat/roistatCuts'
import { teamBrand } from '@/server/domain/rnp/rnpSheet'
import type { TargetProductFilter } from '@/server/domain/types'
import type { CbuUsdRates } from '@/server/integrations/cbu/cbuRates'
import { adBudgetProduct, campaignChannel, ownerOf } from '@/server/integrations/meta/accounts'
import type { ReklamaRepository } from '@/server/repositories/reklamaRepository'
import type { RoistatBitrixRow, RoistatMetaRow, RoistatRepository } from '@/server/repositories/roistatRepository'

import { leadBrand } from './rnpService'
import { LIVE_CACHE, ttlCache } from './ttlCache'

/** How many trailing days are still settling: sales and returns close later. */
const FRESH_DAYS = 7

export interface RoistatCountersDto {
  readonly spendUsd: number
  readonly impressions: number
  readonly reach: number
  readonly clicks: number
  readonly metaLeads: number
  readonly leads: number
  readonly clean: number
  readonly kval: number
  readonly orders: number
  readonly orderedUzs: number
  readonly sold: number
  readonly soldUzs: number
  readonly newCustomers: number
  readonly dealDaysSum: number
  readonly dealCount: number
}

export interface RoistatRowDto extends RoistatCountersDto {
  readonly key: string
  readonly label: string
  /** The Meta ad account (cabinet) name — set on `ad` only, else null. */
  readonly account: string | null
}

export interface RoistatOverviewDto {
  readonly dim: RoistatDim
  readonly parent: { readonly key: string; readonly label: string } | null
  readonly grandParent: { readonly key: string; readonly label: string } | null
  readonly columns: RoistatColumns
  readonly rows: readonly RoistatRowDto[]
  readonly total: RoistatCountersDto
  readonly kpi: RoistatCountersDto
  readonly kpiPrevious: RoistatCountersDto
  readonly previousPeriod: PeriodDto
  readonly daily: readonly { readonly date: string; readonly spendUsd: number; readonly soldUzs: number }[]
  readonly rate: { readonly uzsPerUsd: number; readonly date: string } | null
  readonly freshFrom: string
  readonly metaImportedAt: string | null
  /**
   * The window's ad-budget spend from the CAMPAIGN grain — what the tiles
   * show. The three Meta cuts read the ad grain, imported later and
   * separately; when their ИТОГО falls short of this, the ad grain is
   * still filling (the first hour after a deploy, an account refused).
   */
  readonly campaignSpendUsd: number
}

/**
 * The «Дни» cut alone — «Kunlar boʻyicha» on Savdo dinamikasi (2026-10-05:
 * «dashboarddagi Дни qanday boʻlsa, shunday»). The overview's `days` table,
 * row for row, without its tiles, chart or previous window.
 */
export type RoistatDaysDto = Pick<RoistatOverviewDto, 'dim' | 'columns' | 'rows' | 'total' | 'rate' | 'freshFrom'>

/** Micro-dollars to dollars, cents kept. */
function dollars(micro: bigint): number {
  return Number(micro / 10_000n) / 100
}

/** Minor units (tiyin) to whole so'm. */
function soms(minor: bigint): number {
  return Math.round(Number(minor) / 100)
}

export function toCountersDto(c: RoistatCounters): RoistatCountersDto {
  return {
    spendUsd: dollars(c.spendMicroUsd),
    impressions: c.impressions,
    reach: c.reach,
    clicks: c.clicks,
    metaLeads: c.metaLeads,
    leads: c.leads,
    clean: c.clean,
    kval: c.kval,
    orders: c.orders,
    orderedUzs: soms(c.orderedMinor),
    sold: c.sold,
    soldUzs: soms(c.soldMinor),
    newCustomers: c.newCustomers,
    dealDaysSum: Math.round(c.dealDaysSum * 10) / 10,
    dealCount: c.dealCount,
  }
}

/** The first and last Tashkent day a period covers. */
function dayRange(period: Period): { from: string; to: string } {
  return {
    from: zonedDateKey(period.start, period.timeZone),
    to: zonedDateKey(new Date(period.end.getTime() - 1), period.timeZone),
  }
}

/** `YYYY-MM-DD` shifted by `days`. */
function shiftDay(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}


export interface RoistatQuery {
  readonly dim: RoistatDim
  /** Campaign id under `adset`, adset id under `ad`. */
  readonly parent?: string
  /** The Collagen / Zextra switch; both when absent. */
  readonly brand?: TargetProductFilter
}

/**
 * The Bitrix scan narrowed to one brand: a lead by RNP's `leadBrand` (its
 * source, then its form), a sale by the team that sold it (`teamBrand`) — the
 * P&L's split, so the switch and RNP's «Коллаген / Зехтра проект» agree.
 * Rows of a brand-keyed scan only (`RoistatRepository.bitrix`'s `brandKeys`).
 */
function bitrixOfBrand(rows: readonly RoistatBitrixRow[], brand: TargetProductFilter): Parameters<typeof bitrixCut>[1] {
  if (brand === 'all') return rows
  return narrowBitrix(rows, (row) =>
    (row.brandTeam !== null ? teamBrand(row.brandTeam) : leadBrand(row.brandSource, row.brandForm)) === brand,
  )
}

/** Meta money narrowed to one brand's ad budget. */
function spendOfBrand(days: readonly SpendDay[], brand: TargetProductFilter): readonly SpendDay[] {
  return brand === 'all' ? days : days.filter((d) => d.product === brand)
}

const overviewCache = ttlCache<RoistatOverviewDto>(120_000, LIVE_CACHE)
const daysCache = ttlCache<RoistatDaysDto>(120_000, LIVE_CACHE)

/** Test seam: each case builds its own answer, and the memo would hand the first one to the rest. */
export function resetRoistatCaches(): void {
  overviewCache.clear()
  daysCache.clear()
}

export class RoistatService {
  constructor(
    private readonly repository: RoistatRepository,
    private readonly reklama: Pick<ReklamaRepository, 'campaignDays'>,
    private readonly usd: Pick<CbuUsdRates, 'forDays'>,
  ) {}

  /*
    Both memoised (2026-10-05): each build runs the lead cohort with a LATERAL
    origin-lead probe per sales deal (the overview twice — this window and the
    previous one), and «Kunlar boʻyicha» is polled on Savdo dinamikasi with no
    memo. Company-wide (no scope reaches the SQL), so the key is the question:
    the window, the cut, its parent and the brand. `now` moves the «today» cells and the
    previous cohort's age, which two minutes cannot change in substance.
  */
  async overview(period: Period, query: RoistatQuery, now: Date): Promise<RoistatOverviewDto> {
    const key = [period.preset, period.start.toISOString(), period.end.toISOString(), query.dim, query.parent ?? '', query.brand ?? 'all'].join('|')
    return overviewCache.get(key, () => this.buildOverview(period, query, now))
  }

  async days(period: Period, now: Date, brand: TargetProductFilter = 'all'): Promise<RoistatDaysDto> {
    const key = [period.preset, period.start.toISOString(), period.end.toISOString(), brand].join('|')
    return daysCache.get(key, () => this.buildDays(period, now, brand))
  }

  private async buildOverview(period: Period, query: RoistatQuery, now: Date): Promise<RoistatOverviewDto> {
    const { dim } = query
    const brand = query.brand ?? 'all'
    const keyed = brand !== 'all'
    const parent = dim === 'adset' || dim === 'ad' ? (query.parent ?? null) : null
    const today = zonedDateKey(now, period.timeZone)
    const window = dayRange(period)
    const previous = previousEquivalent(period)
    const previousWindow = dayRange(previous)
    const rateDay = window.to < today ? window.to : today

    const [bitrixRows, bitrixPreviousRows, spendAll, spendPreviousAll, metaRowsAll, rates, importedAt, parentName] = await Promise.all([
      this.repository.bitrix(period, now, 'all', keyed),
      /*
        THE PREVIOUS COHORT AT THE SAME AGE. Read as of now, last month's
        leads have had thirty days to become sales and this month's a few,
        so every sales tile would show a fall that is only time. Its sales
        are read up to the same distance past ITS start as now is past this
        window's start. (Kval is the registrar's verdict as of now and keeps
        a smaller form of the same lean.)
      */
      this.repository.bitrix(previous, new Date(now.getTime() - (period.start.getTime() - previous.start.getTime())), 'total', keyed),
      this.spendDays(window.from, window.to),
      this.spendDays(previousWindow.from, previousWindow.to),
      dim === 'camp' || dim === 'adset' || dim === 'ad'
        ? this.repository.meta(dim, window.from, window.to, parent)
        : Promise.resolve([] as RoistatMetaRow[]),
      this.usd.forDays([rateDay], today),
      this.repository.metaImportedAt(),
      parent ? this.repository.metaName(dim === 'adset' ? 'campaign' : 'adset', parent) : Promise.resolve(null),
    ])
    const bitrix = bitrixOfBrand(bitrixRows, brand)
    const bitrixPrevious = bitrixOfBrand(bitrixPreviousRows, brand)
    const spend = spendOfBrand(spendAll, brand)
    const spendPrevious = spendOfBrand(spendPreviousAll, brand)
    const metaRows = keyed ? metaRowsAll.filter((row) => adBudgetProduct(row) === brand) : metaRowsAll

    const kpi = addCounters(bitrixTotal(bitrix), spendTotal(spend))

    const kpiPrevious = addCounters(bitrixTotal(bitrixPrevious), spendTotal(spendPrevious))

    const budget = spendTotal(spend)

    const spendByDay = spendCut('days', spend)
    const soldByDay = bitrixCut('days', bitrix, leadBrand)
    const daily = daysBetween(window.from, window.to < today ? window.to : today).map((date) => ({
      date,
      spendUsd: dollars(spendByDay.get(date)?.spendMicroUsd ?? 0n),
      soldUzs: soms(soldByDay.get(date)?.soldMinor ?? 0n),
    }))

    return {
      ...this.table(dim, bitrix, spend, metaRows, rates[0], rateDay, today),
      parent: parent ? { key: parent, label: parentName?.name ?? parent } : null,
      grandParent:
        dim === 'ad' && parentName ? { key: parentName.campaignId, label: parentName.campaignName } : null,
      kpi: toCountersDto(kpi),
      kpiPrevious: toCountersDto(kpiPrevious),
      previousPeriod: toPeriodDto(previous),
      daily,
      metaImportedAt: importedAt ? importedAt.toISOString() : null,
      campaignSpendUsd: dollars(budget.spendMicroUsd),
    }
  }

  /** The «Дни» table — the same rows `overview(period, { dim: 'days' })` draws, newest day first. */
  private async buildDays(period: Period, now: Date, brand: TargetProductFilter): Promise<RoistatDaysDto> {
    const today = zonedDateKey(now, period.timeZone)
    const window = dayRange(period)
    const rateDay = window.to < today ? window.to : today
    const [bitrix, spend, rates] = await Promise.all([
      this.repository.bitrix(period, now, 'days', brand !== 'all'),
      this.spendDays(window.from, window.to),
      this.usd.forDays([rateDay], today),
    ])
    return this.table('days', bitrixOfBrand(bitrix, brand), spendOfBrand(spend, brand), [], rates[0], rateDay, today)
  }

  /** One cut's table — the part `overview` and `days` share, so the two cannot drift. */
  private table(
    dim: RoistatDim,
    bitrix: Parameters<typeof bitrixCut>[1],
    spend: readonly SpendDay[],
    metaRows: readonly RoistatMetaRow[],
    rate: number | null | undefined,
    rateDay: string,
    today: string,
  ): RoistatDaysDto {
    const rows = this.rows(dim, bitrix, spend, metaRows)
    const total = rows.reduce((sum, row) => addCounters(sum, row.counters), emptyCounters())
    return {
      dim,
      columns: columnsOf(dim),
      rows: rows.map((row) => ({ key: row.key, label: row.label, account: row.account, ...toCountersDto(row.counters) })),
      total: toCountersDto(total),
      rate: rate === null || rate === undefined ? null : { uzsPerUsd: rate, date: rateDay },
      freshFrom: shiftDay(today, -(FRESH_DAYS - 1)),
    }
  }

  /** The table's rows for one cut, revenue first. */
  private rows(
    dim: RoistatDim,
    bitrix: Parameters<typeof bitrixCut>[1],
    spend: readonly SpendDay[],
    metaRows: readonly RoistatMetaRow[],
  ): { key: string; label: string; account: string | null; counters: RoistatCounters }[] {
    if (dim === 'camp' || dim === 'adset' || dim === 'ad') {
      return metaRows
        .filter((row) => adBudgetProduct(row) !== null)
        .map((row) => {
          const key = (dim === 'ad' ? row.adId : dim === 'adset' ? row.adsetId : row.campaignId) ?? ''
          const label = (dim === 'ad' ? row.adName : dim === 'adset' ? row.adsetName : row.campaignName) || key
          // Creatives are reused across cabinets under the same name — the cabinet tells them apart.
          const account = dim === 'ad' ? row.accountName || null : null
          const counters = addCounters(emptyCounters(), {
            spendMicroUsd: row.spendMicroUsd,
            impressions: row.impressions,
            reach: row.reach,
            clicks: row.clicks,
            metaLeads: row.leads,
          })
          return { key, label, account, counters }
        })
        .sort((a, b) => (b.counters.spendMicroUsd > a.counters.spendMicroUsd ? 1 : b.counters.spendMicroUsd < a.counters.spendMicroUsd ? -1 : 0))
    }
    const merged = mergeCuts(bitrixCut(dim, bitrix, leadBrand), spendCut(dim, spend))
    return [...merged.entries()]
      .filter(([, c]) => c.leads > 0 || c.orders > 0 || c.sold > 0 || c.spendMicroUsd > 0n)
      .map(([label, counters]) => ({ key: label, label, account: null, counters }))
      .sort((a, b) =>
        dim === 'days'
          ? b.key.localeCompare(a.key)
          : Number(b.counters.soldMinor - a.counters.soldMinor) || b.counters.leads - a.counters.leads,
      )
  }

  /** Meta's campaign-days with owner, product and channel resolved — the money every Bitrix cut may carry. */
  private async spendDays(from: string, to: string): Promise<SpendDay[]> {
    const rows = await this.reklama.campaignDays(from, to)
    return rows.map((row) => {
      const owner = ownerOf(row.accountId, row.accountName)
      return {
        date: row.date,
        targetolog: owner.targetolog,
        product: adBudgetProduct(row),
        form: campaignChannel(row.objective, row.campaignName, row.accountId) === 'form',
        spendMicroUsd: row.spendMicroUsd,
        impressions: row.impressions,
        clicks: row.clicks,
        metaLeads: row.leads,
      }
    })
  }
}
