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

import {
  type Period,
  calendarMonth,
  monthPieces,
  previousEquivalent,
  resolvePeriod,
  zonedDateKey,
  zonedMonthKey,
} from '@/server/domain/period/period'
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
import { leadChannel } from '@/server/domain/leads/leadSources'
import type { DealProductBrand } from '@/server/domain/products/productBrand'
import { isBaseTeam, saleBrand } from '@/server/domain/rnp/rnpSheet'
import { type BrandFilter, brandMatches } from '@/server/domain/types'
import type { CbuUsdRates } from '@/server/integrations/cbu/cbuRates'
import { LEAD_SOURCE_VOCABULARY } from '@/server/integrations/crm/bitrix24/mapping'
import { adBudgetProduct, campaignChannel, ownerOf } from '@/server/integrations/meta/accounts'
import type { InsightsRepository, RnpTeamDayRow } from '@/server/repositories/insightsRepository'
import { ORIGIN_LEAD_DAYS } from '@/server/repositories/leadFormSql'
import type { MonthScanReader, StoredMonthScan } from '@/server/repositories/monthScanRepository'
import type { ReklamaRepository } from '@/server/repositories/reklamaRepository'
import {
  type RoistatBitrixRow,
  type RoistatMetaRow,
  type RoistatRepository,
  bitrixRowsOfShape,
  mergeBitrixRows,
} from '@/server/repositories/roistatRepository'

import { processWide } from '@/server/processWide'

import { leadBrand } from './rnpService'
import { OFF_HOURS, WARM_HOURS, WARM_OWNED_TTL_MS, type WarmOutcome, withinHours } from './rnpWarmer'
import { LIVE_CACHE, ttlCache } from './ttlCache'

/** The brand and channel rules the cuts label by — RNP's and «Lidlar»'s, never a copy. */
const LABELERS = Object.freeze({
  brandOf: leadBrand,
  channelOf: (sourceId: string | null) => {
    const channel = leadChannel(sourceId, null, LEAD_SOURCE_VOCABULARY)
    // Never 'form' with no form name; narrowed for the type only.
    return channel === 'form' ? 'other' : channel
  },
})

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
export type RoistatDaysDto = Pick<RoistatOverviewDto, 'dim' | 'columns' | 'rows' | 'total' | 'rate' | 'freshFrom'> & {
  /** «Kunlar boʻyicha» only (`RoistatService.days`): the queue cohort's FAKT beside each day. */
  readonly fakt?: RoistatFaktDaysDto
}

/**
 * FAKT 1 / FAKT 2 of a day, whole soʻm, by the selling team — БАЗА
 * (`isBaseTeam`) or everyone else, «Первичка» (the client, 2026-10-08:
 * «Первичка, База факт 1 / факт 2 Первичка»).
 */
export interface RoistatFaktDto {
  readonly fakt1PrimaryUzs: number
  readonly fakt1BaseUzs: number
  readonly fakt2PrimaryUzs: number
}

/**
 * ANOTHER CLOCK THAN THE ROW IT SITS ON: the day an order reached the queue
 * (`rnpTeamDays`, Savdo dinamikasi's FAKT), not its lead's day — so a day's
 * FAKT and its «Продажи» are different orders. Days with no FAKT are absent.
 */
export interface RoistatFaktDaysDto {
  readonly byDay: Readonly<Record<string, RoistatFaktDto>>
  readonly total: RoistatFaktDto
}

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
  /** The brand switch (`BRAND_FILTERS`); both brands when absent. */
  readonly brand?: BrandFilter
}

/**
 * The Bitrix scan narrowed to one brand: a lead by RNP's `leadBrand` (its CRM
 * form's name first — the client's rule of 2026-10-15 — then its «Проект»,
 * then its source), a sale by its origin lead's form (`saleBrand`; the
 * product it was paid for when no form names a brand, its team only when it
 * has no line item either) — as RNP's «Коллаген / Зехтра проект» reads it,
 * so the switch and the P&L agree on every sale and on every lead whose title
 * names its form. A repeat lead («Такрор - обработка») is recovered from
 * SOURCE_DESCRIPTION on both (`leadFormSql.ts`); a lead known only by a
 * form's short name is recovered here (`form_alias`) and not on a sale
 * (`brandForm` on a sale row is already the brand, read without the alias).
 * Rows of a brand-keyed scan only (`RoistatRepository.bitrix`'s `brandKeys`).
 */
function bitrixOfBrand(rows: readonly RoistatBitrixRow[], brand: BrandFilter): Parameters<typeof bitrixCut>[1] {
  if (brand === 'all') return rows
  return narrowBitrix(rows, (row) => brandMatches(brand, brandOfRow(row)))
}

/** The brand a brand-keyed row is filed by — decided already on a stored month's row (`foldBitrixToBrand`). */
function brandOfRow(row: RoistatBitrixRow): 'Collagen' | 'Zextra' | null {
  if (row.brand !== undefined) return row.brand
  return row.brandTeam !== null
    ? saleBrand(row.brandProduct as DealProductBrand, row.brandTeam, row.brandForm as 'Collagen' | 'Zextra' | null)
    : leadBrand(row.brandSource, row.brandForm, row.brandLine)
}

/**
 * A brand-keyed scan with each row's brand decided and its five inputs let
 * go, rows of one group and brand added together — what the worker stores
 * for a month (`monthScanRefresh.ts`). The switch reads nothing of a row but
 * that brand (`bitrixOfBrand`), and a month's widest scan split by every
 * source, form, «Проект», team and product ran to tens of thousands of rows
 * where its brands are a few thousand.
 */
export function foldBitrixToBrand(rows: readonly RoistatBitrixRow[]): RoistatBitrixRow[] {
  return mergeBitrixRows(
    rows.map((row) => ({
      ...row,
      brand: brandOfRow(row),
      brandSource: null,
      brandForm: null,
      brandLine: null,
      brandTeam: null,
      brandProduct: null,
    })),
  )
}

/**
 * Meta money narrowed to one brand's ad budget. «Brendsiz» keeps the money no
 * brand's budget claims (hiring, an unmapped account) — which every total on
 * this screen leaves out anyway (`spendTotal`), so its spend reads 0 and the
 * three slices still add up to «Hammasi».
 */
function spendOfBrand(days: readonly SpendDay[], brand: BrandFilter): readonly SpendDay[] {
  return brand === 'all' ? days : days.filter((d) => brandMatches(brand, d.product))
}

/**
 * The queue cohort's team-days as «Kunlar boʻyicha»'s FAKT columns: per day,
 * FAKT 1 of the Первичка teams and of the БАЗА teams, and the Первичка
 * teams' FAKT 2. The brand switch files an order as the P&L does (`saleBrand`).
 * Summed in tiyin and rounded once per cell.
 */
export function faktDays(rows: readonly RnpTeamDayRow[], brand: BrandFilter): RoistatFaktDaysDto {
  const acc = new Map<string, { fakt1Primary: bigint; fakt1Base: bigint; fakt2Primary: bigint }>()
  const total = { fakt1Primary: 0n, fakt1Base: 0n, fakt2Primary: 0n }
  for (const row of rows) {
    if (brand !== 'all' && !brandMatches(brand, saleBrand(row.productBrand ?? null, row.rop, row.formBrand))) continue
    const base = isBaseTeam(row.rop)
    const fakt1 = row.fakt1Minor
    const fakt2 = base ? 0n : row.fakt2Minor
    if (fakt1 === 0n && fakt2 === 0n) continue
    const day = acc.get(row.day) ?? acc.set(row.day, { fakt1Primary: 0n, fakt1Base: 0n, fakt2Primary: 0n }).get(row.day)!
    for (const into of [day, total]) {
      if (base) into.fakt1Base += fakt1
      else into.fakt1Primary += fakt1
      into.fakt2Primary += fakt2
    }
  }
  const dto = (a: typeof total): RoistatFaktDto => ({
    fakt1PrimaryUzs: soms(a.fakt1Primary),
    fakt1BaseUzs: soms(a.fakt1Base),
    fakt2PrimaryUzs: soms(a.fakt2Primary),
  })
  return { byDay: Object.fromEntries([...acc].map(([day, a]) => [day, dto(a)])), total: dto(total) }
}

/** The overview's two Bitrix cohort scans: this window's every grouping set, the previous window's total. */
interface BitrixScan {
  /** Which build this is — the table memo's key carries it (see `overview`). */
  readonly build: number
  readonly current: readonly RoistatBitrixRow[]
  readonly previous: readonly RoistatBitrixRow[]
}

/** The scans' TTL, the production sync tick; the table's life is derived from it. */
const SCAN_TTL_MS = 120_000
/*
  A table lives as long as the scan it was cut from can be handed out (that
  TTL and LIVE_CACHE's stale window) and is never rebuilt behind a reader. It
  is cut after its scan, so it expires only after that scan has, and by then
  the scan is rebuilding and the table's key, which carries the scan's build,
  is about to move on. Rebuilt then, it cut the OLD scan again (the Meta reads
  once more per open cut, every cycle) and was dropped the moment the new
  scan landed; the next read cuts it once, from the new scan.
*/
const overviewCache = ttlCache<RoistatOverviewDto>(SCAN_TTL_MS + (LIVE_CACHE.staleMs ?? 0))
/*
  «Kunlar boʻyicha»'s reads for a window, memoised WITHOUT the brand
  (2026-10-16, «dashboard sekin»): the scans read it only as `keyed`, so
  Collagen, Zextra and «Brendsiz» each ran the same month-long cohort scan and
  FAKT scan (15–20 s on production) for rows the other slices had just read.
  The table is cut from it per request — the scan's rows, no query. A failed
  FAKT scan (`teamDays` null) now leaves every slice without FAKT for the
  memo's life, as it left the one slice that asked before.
*/
interface DaysScan {
  readonly today: string
  readonly rateDay: string
  readonly bitrix: readonly RoistatBitrixRow[]
  readonly spend: readonly SpendDay[]
  readonly rate: number | null | undefined
  readonly teamDays: readonly RnpTeamDayRow[] | null
}
/* On `globalThis` (`processWide`): the warm-up (`warm`, from `instrumentation.ts`'s bundle) fills the routes' copy. */
const daysScanCache = processWide('sinolife.roistat.daysScanCache', () => ttlCache<DaysScan>(120_000, LIVE_CACHE))
/*
  The two scans, memoised apart from the table (2026-10-06). Neither depends
  on the cut or its drill parent, and the brand reaches them only as `keyed`:
  one brand-keyed scan serves Collagen, Zextra and «Brendsiz» alike, narrowed
  after it (`bitrixOfBrand`). Inside the table's memo they ran again for every
  tab, drill level and brand slice — walking the eleven cuts cost ~22
  month-long cohort scans on the one-vCPU database where 2 do. The rows are
  only read (narrowed and grouped into new arrays), never changed.
*/
const bitrixScanCache = ttlCache<BitrixScan>(SCAN_TTL_MS, LIVE_CACHE)
let bitrixScanBuilds = 0

/*
  THE CLOSED MONTHS ARE READ FROM THE SYNC WORKER'S STORE (2026-10-28).
  «Kunlar boʻyicha» and the overview read a lead cohort, and a window of it
  is the sum of its months (`RoistatRepository.bitrix`; the queue cohort's
  FAKT is too — an order is counted on its LAST arrival, in one month only).
  On the one-core database a year of it ran past the web pool's 20 s
  statement timeout — /analytics/sales-days «Shu yil» answered 500 at 20.1 s
  on 27.10, «Oʻtgan oy» took 18.7 s, and September or July 8.7–10.3 s. So
  the worker reads each closed month once and stores it (`month_scan`,
  `monthScanRefresh.ts`), and a window here is its stored months plus ONE
  live read of what is left — the running month, a part-month at either end,
  or a run of months the store does not hold yet. A closed whole month on its
  own («Oʻtgan oy») is the stored answer to the very statement it ran; any
  other window inside one month never touches the store and is read live,
  exactly as before.

  A STORED MONTH IS SERVED ONLY WHILE IT IS TRUE ENOUGH: built after the
  month closed, and under `MONTH_SCAN_MAX_AGE_MS` old — six hours while its
  leads' sales still open (`monthSettling`, the worker rebuilds it every half
  hour of the working day), two days after (rebuilt twice a day: a delivery
  or a refund still moves it, rarely). Past either, or missing, it is read
  live with the rest — a stalled worker costs speed, never a wrong table.
*/
const MONTH_SCAN_VERSION = 'v1'
const DAY_MS = 86_400_000
/**
 * A stored month's key, `YYYY-MM` in Tashkent: its scan (`bitrix`), the same
 * scan's day and total sets alone (`bitrix-days` — what «Kunlar boʻyicha»
 * reads, a hundredth of it), or its queue cohort's FAKT (`fakt`).
 */
export function monthScanKey(kind: 'bitrix' | 'bitrix-days' | 'fakt', month: string): string {
  return `${MONTH_SCAN_VERSION}:${kind}:${month}`
}
/** True while sales deals may still open for the month's leads (`ORIGIN_LEAD_DAYS` after it), and a few days more. */
export function monthSettling(monthEnd: Date, now: Date): boolean {
  return now.getTime() < monthEnd.getTime() + (ORIGIN_LEAD_DAYS + 5) * DAY_MS
}
export const MONTH_SCAN_MAX_AGE_MS = { settling: 6 * 3_600_000, settled: 48 * 3_600_000 } as const

/** The stored rows, a minute at a time: a primary-key read, shared by every reader of the minute. */
const monthScanCache = processWide('sinolife.roistat.monthScanCache', () => ttlCache<StoredMonthScan<unknown> | null>(60_000))
/*
  THE RUNNING MONTH'S LIVE READ, ONE PER MINUTE WHOEVER ASKS (2026-10-28):
  «Shu oy» and «Shu yil» both read the month to date live, and as two
  windows they were two scans. Keyed by the piece and the read — never by a
  preset: a piece is never compared against anything — and only for a read
  as of now (the previous window's same-age reads are not shared). No stale
  window of its own: the memos above it have theirs, and two would stack.
*/
const liveScanCache = processWide('sinolife.roistat.liveScanCache', () => ttlCache<RoistatBitrixRow[]>(60_000))

/** Test seam: each case builds its own answer, and the memo would hand the first one to the rest. */
export function resetRoistatCaches(): void {
  overviewCache.clear()
  daysScanCache.clear()
  bitrixScanCache.clear()
  monthScanCache.clear()
  liveScanCache.clear()
}

/** How old the RNP sheet's FAKT may be to stand in for «Kunlar boʻyicha»'s own scan: two of its warm ticks. */
export const BORROWED_FAKT_MAX_AGE_MS = 8 * 60_000
/*
  A LIVE READ HERE MAY TAKE A MINUTE (2026-10-28), as «Mijoz qaytishi»'s may:
  the running month alone measured 10–24 s on production the morning this
  shipped (the warm lane's «sales-days warmed»), past the pool's 20 s on a
  busy minute — a reader then waits, it does not get a 500. Under it the
  readers who matter most never wait at all: «Shu oy», «Shu yil» and «Oʻtgan
  oy» are warmed (`warm`).
*/
export const ROISTAT_READ_TIMEOUT_MS = 60_000
/** The «Kunlar boʻyicha» windows the warm lane keeps built — what the client opens. */
const WARM_DAYS_PRESETS = ['this_month', 'this_year', 'previous_month'] as const

export class RoistatService {
  constructor(
    private readonly repository: RoistatRepository,
    private readonly reklama: Pick<ReklamaRepository, 'campaignDays'>,
    private readonly usd: Pick<CbuUsdRates, 'dated'>,
    private readonly insights: Pick<InsightsRepository, 'rnpTeamDays'>,
    /** The sync worker's closed months (`month_scan`); null reads every month live. */
    private readonly months: MonthScanReader | null = null,
    /**
     * The running month's FAKT as the RNP sheet's warmer last built it
     * (`warmMonthFakt`), or null when it holds none young enough.
     */
    private readonly borrowFakt: ((month: string) => Promise<RnpTeamDayRow[]> | null) | null = null,
  ) {}

  /**
   * Builds «Kunlar boʻyicha»'s «Shu oy», «Shu yil» and «Oʻtgan oy» into
   * their memo (2026-10-28): the first reader of the morning waited for the
   * month's scan cold and met the 20 s limit (08:19 on 28.10). One live read
   * of the running month serves the first two (`liveScanCache`); the year's
   * other months and «Oʻtgan oy» are the store's. Run by the warm lane every
   * few minutes of the working day (`instrumentation.ts`); `OFF_HOURS`
   * outside them. One window's failure does not stop the others; the first
   * is thrown after, for the warmer to log.
   */
  async warm(now: Date, timeZone: string): Promise<WarmOutcome> {
    if (!withinHours(now, timeZone, WARM_HOURS)) return OFF_HOURS
    let failure: { error: unknown } | undefined
    for (const preset of WARM_DAYS_PRESETS) {
      const period = resolvePeriod(preset, { timeZone, now })
      try {
        // The warmer's for two ticks (`WARM_OWNED_TTL_MS`): no reader rebuilds a month's scan on the 20 s pool meanwhile.
        await daysScanCache.refresh(this.daysKey(period, false), () => this.daysScan(period, now, false), { ttlMs: WARM_OWNED_TTL_MS })
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure) throw failure.error
  }

  private daysKey(period: Period, keyed: boolean): string {
    return [period.preset, period.start.toISOString(), period.end.toISOString(), keyed].join('|')
  }

  /*
    Both memoised (2026-10-05): each build runs the lead cohort with a LATERAL
    origin-lead probe per sales deal (the overview twice — this window and the
    previous one), and «Kunlar boʻyicha» is polled on Savdo dinamikasi with no
    memo. Company-wide (no scope reaches the SQL), so the key is the question:
    the window, the cut, its parent and the brand. `now` moves the «today» cells and the
    previous cohort's age, which two minutes cannot change in substance.
    The overview's scans have a memo of their own (`bitrixScanCache`), and
    the table's key carries the scan's build: a table is cut again the moment
    a newer scan lands, so two stale-while-revalidate windows never stack into
    one answer twice as old as either allows.
  */
  async overview(period: Period, query: RoistatQuery, now: Date): Promise<RoistatOverviewDto> {
    const parent = query.dim === 'adset' || query.dim === 'ad' ? (query.parent ?? '') : ''
    const brand = query.brand ?? 'all'
    const scan = await this.bitrixScan(period, brand !== 'all', now)
    const key = [period.preset, period.start.toISOString(), period.end.toISOString(), query.dim, parent, brand, scan.build].join('|')
    return overviewCache.get(key, () => this.buildOverview(period, query, now, scan))
  }

  async days(period: Period, now: Date, brand: BrandFilter = 'all'): Promise<RoistatDaysDto> {
    const keyed = brand !== 'all'
    return this.daysTable(await daysScanCache.get(this.daysKey(period, keyed), () => this.daysScan(period, now, keyed)), brand)
  }

  /** The overview's two scans for a window, shared by every cut, drill and brand slice of it. */
  private bitrixScan(period: Period, keyed: boolean, now: Date): Promise<BitrixScan> {
    // The preset too: `previousEquivalent` reads it, so two presets on one window compare against different ones.
    const key = [period.preset, period.start.toISOString(), period.end.toISOString(), keyed].join('|')
    return bitrixScanCache.get(key, async () => {
      const previous = previousEquivalent(period)
      const [current, previousRows] = await Promise.all([
        this.bitrixRows(period, now, 'all', keyed, now),
        /*
          THE PREVIOUS COHORT AT THE SAME AGE. Read as of now, last month's
          leads have had thirty days to become sales and this month's a few,
          so every sales tile would show a fall that is only time. Its sales
          are read up to the same distance past ITS start as now is past this
          window's start. (Kval is the registrar's verdict as of now and keeps
          a smaller form of the same lean.)
        */
        this.bitrixRows(previous, new Date(now.getTime() - (period.start.getTime() - previous.start.getTime())), 'total', keyed, now),
      ])
      bitrixScanBuilds += 1
      return { build: bitrixScanBuilds, current, previous: previousRows }
    })
  }

  private async buildOverview(period: Period, query: RoistatQuery, now: Date, scan: BitrixScan): Promise<RoistatOverviewDto> {
    const { dim } = query
    const brand = query.brand ?? 'all'
    const keyed = brand !== 'all'
    const parent = dim === 'adset' || dim === 'ad' ? (query.parent ?? null) : null
    const today = zonedDateKey(now, period.timeZone)
    const window = dayRange(period)
    const previous = previousEquivalent(period)
    const previousWindow = dayRange(previous)
    const rateDay = window.to < today ? window.to : today

    const [spendAll, spendPreviousAll, metaRowsAll, rates, importedAt, parentName] = await Promise.all([
      this.spendDays(window.from, window.to),
      this.spendDays(previousWindow.from, previousWindow.to),
      dim === 'camp' || dim === 'adset' || dim === 'ad'
        ? this.repository.meta(dim, window.from, window.to, parent)
        : Promise.resolve([] as RoistatMetaRow[]),
      this.usd.dated(rateDay, today),
      this.repository.metaImportedAt(),
      parent ? this.repository.metaName(dim === 'adset' ? 'campaign' : 'adset', parent) : Promise.resolve(null),
    ])
    const bitrix = bitrixOfBrand(scan.current, brand)
    const bitrixPrevious = bitrixOfBrand(scan.previous, brand)
    const spend = spendOfBrand(spendAll, brand)
    const spendPrevious = spendOfBrand(spendPreviousAll, brand)
    const metaRows = keyed ? metaRowsAll.filter((row) => brandMatches(brand, adBudgetProduct(row))) : metaRowsAll

    const kpi = addCounters(bitrixTotal(bitrix), spendTotal(spend))

    const kpiPrevious = addCounters(bitrixTotal(bitrixPrevious), spendTotal(spendPrevious))

    const budget = spendTotal(spend)

    const spendByDay = spendCut('days', spend)
    const soldByDay = bitrixCut('days', bitrix, LABELERS)
    const daily = daysBetween(window.from, window.to < today ? window.to : today).map((date) => ({
      date,
      spendUsd: dollars(spendByDay.get(date)?.spendMicroUsd ?? 0n),
      soldUzs: soms(soldByDay.get(date)?.soldMinor ?? 0n),
    }))

    return {
      ...this.table(dim, bitrix, spend, metaRows, rates?.rate, rates?.day ?? rateDay, today),
      parent: parent ? { key: parent, label: parentName?.name ?? parent } : null,
      grandParent:
        dim === 'ad' && parentName ? { key: parentName.campaignId, label: parentName.campaignName } : null,
      kpi: toCountersDto(kpi),
      kpiPrevious: toCountersDto(kpiPrevious),
      daily,
      metaImportedAt: importedAt ? importedAt.toISOString() : null,
      campaignSpendUsd: dollars(budget.spendMicroUsd),
    }
  }

  /** «Kunlar boʻyicha»'s reads for a window, every brand slice's — see `daysScanCache`. */
  private async daysScan(period: Period, now: Date, keyed: boolean): Promise<DaysScan> {
    const today = zonedDateKey(now, period.timeZone)
    const window = dayRange(period)
    const rateDay = window.to < today ? window.to : today
    const [bitrix, spend, rates, teamDays] = await Promise.all([
      this.bitrixRows(period, now, 'days', keyed, now),
      this.spendDays(window.from, window.to),
      this.usd.dated(rateDay, today),
      // An addition to the «Дни» table, never its price: a failed scan is logged and the table draws without FAKT.
      // Under «Hammasi» no order is filed by brand, so the per-order brand probes are skipped.
      this.faktRows(period, keyed, now).catch((error: unknown) => {
        void import('@/server/logging/logger').then(({ logger }) =>
          logger.warn({ err: error }, '«Kunlar boʻyicha» FAKT scan failed; the table draws without it'),
        )
        return null
      }),
    ])
    // The day the rate is the bank's for — rateDay, or the last stored day before it when the bank is out of reach.
    return { today, rateDay: rates?.day ?? rateDay, bitrix, spend, rate: rates?.rate, teamDays }
  }

  /**
   * `RoistatRepository.bitrix(period, asOf, shape, keyed)`, its closed whole
   * months from the store (see `monthScanKey`) and the rest in one live read
   * per run of months the store did not answer. `asOf` is the cohort's age —
   * `now`, or the previous window's same-age instant; a stored month read
   * up to a later instant than `asOf` allows is not used.
   */
  private async bitrixRows(
    period: Period,
    asOf: Date,
    shape: 'all' | 'days' | 'total',
    keyed: boolean,
    now: Date,
  ): Promise<RoistatBitrixRow[]> {
    const pieces = monthPieces(period)
    const read = (range: Period) => this.repository.bitrix(range, asOf, shape, keyed, ROISTAT_READ_TIMEOUT_MS)
    const live = (range: Period) =>
      asOf.getTime() === now.getTime()
        ? liveScanCache.get([range.start.toISOString(), range.end.toISOString(), shape, keyed].join('|'), () => read(range))
        : read(range)
    if (this.months === null) return live(period)
    const stored = await Promise.all(
      pieces.map(async (piece) => {
        const month = await this.storedMonth<RoistatBitrixRow[]>(shape === 'all' ? 'bitrix' : 'bitrix-days', piece, now)
        if (month === null) return null
        // Its sales were read up to min(built, the month's last possible sale); the cohort's age may not be passed.
        const settle = piece.end.getTime() + ORIGIN_LEAD_DAYS * DAY_MS
        return Math.min(month.builtAt.getTime(), settle) <= Math.min(asOf.getTime(), settle) ? month.rows : null
      }),
    )
    // Nothing stored: the window read as it always was, in one statement.
    if (stored.every((rows) => rows === null)) return live(period)
    const runs = await Promise.all(liveRuns(pieces, stored).map(live))
    return mergeBitrixRows([...stored.flatMap((rows) => (rows === null ? [] : bitrixRowsOfShape(rows, shape, keyed))), ...runs.flat()])
  }

  /** `InsightsRepository.rnpTeamDays(period, brands)` the same way — the closed whole months stored, the rest live. */
  private async faktRows(period: Period, brands: boolean, now: Date): Promise<RnpTeamDayRow[]> {
    const pieces = monthPieces(period)
    // Stored brand-keyed: under «Hammasi» `faktDays` reads no brand, and the split rows add up to the unsplit ones.
    const stored = await Promise.all(pieces.map(async (piece) => (await this.storedMonth<RnpTeamDayRow[]>('fakt', piece, now))?.rows ?? null))
    const runs = stored.every((rows) => rows === null) ? [period] : liveRuns(pieces, stored)
    const scan = (range: Period) => this.insights.rnpTeamDays(range, brands, ROISTAT_READ_TIMEOUT_MS)
    const live = await Promise.all(runs.map((range) => this.borrowedFakt(range, now)?.catch(() => scan(range)) ?? scan(range)))
    return [...stored.flatMap((rows) => rows ?? []), ...live.flat()]
  }

  /**
   * The RNP sheet's FAKT for `range` when `range` is the running month to
   * date — the sheet reads the whole month, and nothing has arrived after
   * now — and the sheet holds one young enough; null otherwise. Brand-keyed,
   * so it answers «Hammasi» and either brand alike.
   */
  private borrowedFakt(range: Period, now: Date): Promise<RnpTeamDayRow[]> | null {
    if (this.borrowFakt === null) return null
    const month = calendarMonth(now, range.timeZone)
    if (
      range.start.getTime() !== month.start.getTime() ||
      range.end.getTime() <= now.getTime() ||
      range.end.getTime() > month.end.getTime()
    ) {
      return null
    }
    return this.borrowFakt(zonedMonthKey(now, range.timeZone))
  }

  /** A closed whole month's stored rows while they may be served (see `MONTH_SCAN_MAX_AGE_MS`); null otherwise. */
  private async storedMonth<T>(kind: 'bitrix' | 'bitrix-days' | 'fakt', piece: Period, now: Date): Promise<StoredMonthScan<T> | null> {
    const reader = this.months
    const month = calendarMonth(piece.start, piece.timeZone)
    if (
      reader === null ||
      piece.start.getTime() !== month.start.getTime() ||
      piece.end.getTime() !== month.end.getTime() ||
      month.end.getTime() > calendarMonth(now, piece.timeZone).start.getTime()
    ) {
      return null
    }
    const key = monthScanKey(kind, zonedMonthKey(piece.start, piece.timeZone))
    const row = (await monthScanCache.get(key, () => reader.read(key)).catch(() => null)) as StoredMonthScan<T> | null
    if (row === null || row.builtAt.getTime() < month.end.getTime()) return null
    const maxAge = monthSettling(month.end, now) ? MONTH_SCAN_MAX_AGE_MS.settling : MONTH_SCAN_MAX_AGE_MS.settled
    return now.getTime() - row.builtAt.getTime() < maxAge ? row : null
  }

  /** The «Дни» table — the same rows `overview(period, { dim: 'days' })` draws, newest day first. */
  private daysTable(scan: DaysScan, brand: BrandFilter): RoistatDaysDto {
    const { today, rateDay, teamDays } = scan
    const table = this.table('days', bitrixOfBrand(scan.bitrix, brand), spendOfBrand(scan.spend, brand), [], scan.rate, rateDay, today)
    if (teamDays === null) return table
    const fakt = faktDays(teamDays, brand)
    // A day with orders in the queue and neither a lead nor a dollar still has its FAKT to show.
    const known = new Set(table.rows.map((row) => row.key))
    const bare = Object.keys(fakt.byDay)
      .filter((day) => !known.has(day))
      .map((day) => ({ key: day, label: day, account: null, ...toCountersDto(emptyCounters()) }))
    return {
      ...table,
      rows: bare.length === 0 ? table.rows : [...table.rows, ...bare].sort((a, b) => b.key.localeCompare(a.key)),
      fakt,
    }
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
    const merged = mergeCuts(bitrixCut(dim, bitrix, LABELERS), spendCut(dim, spend))
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

/**
 * The windows to read live: each run of consecutive pieces the store did not
 * answer, as one window — a window's months read together are the same rows
 * as read one by one (`RoistatRepository.bitrix`), in one statement.
 */
function liveRuns(pieces: readonly Period[], stored: readonly (unknown | null)[]): Period[] {
  const runs: Period[] = []
  let from: Period | null = null
  pieces.forEach((piece, i) => {
    if (stored[i] === null) from ??= piece
    if (from !== null && (stored[i] !== null || i === pieces.length - 1)) {
      const end = stored[i] === null ? piece.end : pieces[i - 1]!.end
      runs.push(Object.freeze({ start: from.start, end, timeZone: piece.timeZone, preset: 'custom' as const }))
      from = null
    }
  })
  return runs
}
