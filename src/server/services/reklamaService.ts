/**
 * «Reklama samarasi» — the client's three ad sheets, built from their sources.
 *
 * Asked for on 2026-09-23 with five screenshots of the sheets the client used
 * to analyse ads by hand. This service answers the first three:
 *
 *   «DM»       — per Instagram page per day: Кол мурожат, Кол лид, Кол квал,
 *                Реклама, Цена за квал. Messages and money from Meta's DM
 *                campaigns; leads and qualified leads from Bitrix24.
 *   «Отчёт Т»  — per targetolog per product per day: $, лид, лид $. The
 *                lead-form campaigns' spend and Meta's own lead count.
 *   lead sifati — per day: недозвон, некачественный, успешный, дубль, ЛИД, %.
 *                From where each Регистрация lead stands now.
 *
 * WHAT «Отчёт Т» DOES NOT HAVE: the sheet's «кв лид» per targetolog. Bitrix24
 * carries a targetolog on about one lead in twenty (the client's export,
 * 16.08–15.09.2026: 343 of 6 634), so a per-targetolog qualified count read
 * from it would be a twentieth of the sheet's. It is left off rather than
 * shown wrong; where the sheet's figure comes from is an open question to the
 * client.
 *
 * Every dollar figure is summed in micro-dollars and converted once, so a
 * page's days sum to its total and the pages to the grand total, to the cent.
 */

import { TARGET_SOURCE_IDS, TARGET_SOURCE_PRODUCT } from '@/server/integrations/crm/bitrix24/mapping'
import {
  type CampaignChannel,
  DM_ACCOUNT_PAGES,
  DM_PAGE_OF_ACCOUNT,
  DM_PAGE_OF_PRODUCT,
  adBudgetProduct,
  type MetaProduct,
  type SideColumn,
  campaignChannel,
  ownerOf,
  sideColumn,
} from '@/server/integrations/meta/accounts'
import { LEAD_BUCKETS, type LeadBucket, leadBucket } from '@/server/domain/reklama/leadQuality'
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import {
  type BrandFilter,
  TARGET_PRODUCTS,
  type TargetProduct,
  type TargetProductFilter,
  brandMatches,
} from '@/server/domain/types'
import type {
  CampaignDayRow,
  LeadStageDayRow,
  ReklamaRepository,
} from '@/server/repositories/reklamaRepository'

import { leadBrand } from './rnpService'
import { LIVE_CACHE, ttlCache } from './ttlCache'

// ---------------------------------------------------------------------------
// DTOs — mirrored in `src/features/reklama/reklamaApi.ts`
// ---------------------------------------------------------------------------

/** One «DM» cell group: a page on a day, or over the window. */
export interface DmCellsDto {
  /** Meta: people who started a conversation from a DM ad. */
  readonly conversations: number
  /** Bitrix24: Регистрация leads from the page. */
  readonly leads: number
  /** …of which «Сделка успешна». */
  readonly qualified: number
  /** Meta: DM campaigns' spend, hiring campaigns excluded. */
  readonly spendUsd: number
  /** spend ÷ qualified. */
  readonly costPerQualifiedUsd: number | null
  /** qualified ÷ leads. */
  readonly qualifiedPercent: number | null
  /** qualified ÷ conversations. */
  readonly conversationToQualifiedPercent: number | null
  /** spend ÷ conversations — what one person writing to the page cost. */
  readonly costPerConversationUsd: number | null
}

export interface DmDayDto extends DmCellsDto {
  readonly date: string
}

export interface DmPageDto {
  /** Portal SOURCE_ID. */
  readonly key: string
  readonly name: string
  readonly product: TargetProduct
  /** True for the page a product's DM money is shown against. */
  readonly carriesDmSpend: boolean
  readonly total: DmCellsDto
  readonly days: readonly DmDayDto[]
}

export interface DmBlockDto {
  /** «Итог»: every page's counts, but the price and «Murojat → kval» of the DM-money pages only (`dmTotalCells`). */
  readonly total: DmCellsDto
  /** «Итог» a day at a time, on the same rule. */
  readonly days: readonly DmDayDto[]
  readonly pages: readonly DmPageDto[]
  /** DM money on accounts nobody has mapped to a product — no page to put it on. */
  readonly unattributed: { readonly spendUsd: number; readonly conversations: number }
}

/** One «Отчёт Т» cell group: a targetolog's lead-form campaigns. */
export interface FormCellsDto {
  readonly spendUsd: number
  /** Meta's own count — the `lead` action. */
  readonly metaLeads: number
  /** spend ÷ Meta leads. */
  readonly costPerLeadUsd: number | null
  readonly impressions: number
  readonly clicks: number
  /** clicks ÷ impressions. */
  readonly ctrPercent: number | null
  /** spend ÷ clicks. */
  readonly cpcUsd: number | null
  /** spend ÷ impressions × 1 000. */
  readonly cpmUsd: number | null
}

export interface FormDayDto extends FormCellsDto {
  readonly date: string
}

export interface FormOwnerDto {
  readonly key: string
  readonly targetolog: string
  readonly product: MetaProduct
  readonly accounts: readonly string[]
  readonly total: FormCellsDto
  /** The same person's DM campaigns, which the sheet keeps in its own block. */
  readonly dmSpendUsd: number
  readonly dmConversations: number
  readonly days: readonly FormDayDto[]
}

export interface FormBlockDto {
  readonly total: FormCellsDto
  readonly days: readonly FormDayDto[]
  readonly owners: readonly FormOwnerDto[]
}

/** One lead-quality row: what the day's (or window's) leads became. */
export interface QualityCellsDto {
  readonly leads: number
  readonly noAnswer: number
  readonly lowQuality: number
  readonly success: number
  readonly duplicate: number
  /** Still being worked — a fifth bucket the finished sheet never needed. */
  readonly open: number
  /** success ÷ leads — the sheet's %. */
  readonly successPercent: number | null
}

export interface QualityDayDto extends QualityCellsDto {
  readonly date: string
}

export interface QualityPageDto {
  readonly key: string
  readonly name: string
  readonly product: TargetProduct
  readonly total: QualityCellsDto
  readonly days: readonly QualityDayDto[]
}

export interface QualityBlockDto {
  readonly total: QualityCellsDto
  readonly days: readonly QualityDayDto[]
  readonly pages: readonly QualityPageDto[]
  /** Every stage met, with the bucket it was counted in — the rule, shown. */
  readonly stages: readonly { readonly stage: string; readonly bucket: LeadBucket; readonly leads: number }[]
}

export interface SpendSplitDto {
  readonly totalUsd: number
  readonly formUsd: number
  readonly dmUsd: number
  readonly hiringUsd: number
  readonly otherUsd: number
}

/**
 * One Meta campaign over the window — which ads the money actually went to.
 * `results` is the channel's own result: Meta leads on a lead-form campaign,
 * conversations on a DM one.
 */
export interface CampaignDto {
  readonly id: string
  readonly name: string
  readonly account: string
  readonly targetolog: string
  readonly product: MetaProduct
  readonly channel: CampaignChannel
  readonly spendUsd: number
  readonly metaLeads: number
  readonly conversations: number
  readonly results: number
  readonly costPerResultUsd: number | null
  readonly impressions: number
  readonly clicks: number
  readonly ctrPercent: number | null
  /** Days in the window the campaign spent anything. */
  readonly activeDays: number
  readonly lastActive: string | null
}

/**
 * A narrow side column — the client's «Навой HR» table: the month's dollars
 * at the head, then one row a day. See `sideColumn`.
 */
export interface SideColumnDto {
  readonly key: SideColumn
  readonly name: string
  readonly totalUsd: number
  readonly days: readonly { readonly date: string; readonly spendUsd: number }[]
}

export interface ReklamaOverviewDto {
  /** When Meta's campaign grain was last read; null means never. */
  readonly importedAt: string | null
  readonly window: { readonly from: string; readonly to: string }
  readonly spend: SpendSplitDto
  readonly dm: DmBlockDto
  readonly form: FormBlockDto
  readonly quality: QualityBlockDto
  /** Every campaign that spent in the window, biggest first. */
  readonly campaigns: readonly CampaignDto[]
}

// ---------------------------------------------------------------------------

const MICRO = 1_000_000

/** Micro-dollars summed exactly, then printed as dollars with cents. */
function usd(micro: bigint): number {
  return Math.round(Number(micro) / 10_000) / 100
}

function perUnit(micro: bigint, count: number): number | null {
  return count > 0 ? Number(micro) / MICRO / count : null
}

function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null
}

/** Every calendar day from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
export function calendarDays(from: string, to: string): string[] {
  const out: string[] = []
  for (
    let day = new Date(`${from}T00:00:00Z`);
    day.toISOString().slice(0, 10) <= to;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    out.push(day.toISOString().slice(0, 10))
    // Bounded: the period schema caps a range at ten years.
    if (out.length > 4000) break
  }
  return out
}

// --- DM ---------------------------------------------------------------------

interface DmAcc {
  conversations: number
  leads: number
  qualified: number
  spend: bigint
}

const dmZero = (): DmAcc => ({ conversations: 0, leads: 0, qualified: 0, spend: 0n })

function dmCells(a: DmAcc): DmCellsDto {
  return {
    conversations: a.conversations,
    leads: a.leads,
    qualified: a.qualified,
    spendUsd: usd(a.spend),
    costPerQualifiedUsd: perUnit(a.spend, a.qualified),
    qualifiedPercent: percent(a.qualified, a.leads),
    conversationToQualifiedPercent: percent(a.qualified, a.conversations),
    costPerConversationUsd: perUnit(a.spend, a.conversations),
  }
}

function addDm(into: DmAcc, from: DmAcc): void {
  into.conversations += from.conversations
  into.leads += from.leads
  into.qualified += from.qualified
  into.spend += from.spend
}

/**
 * The block's «Итог» — the window's or a day's. Its counts are every page's,
 * but its price of a kval and «Murojat → kval» are over the pages that CARRY
 * the DM money only (`priced`, `carriesDmSpend`): a page with no DM spend
 * (sinolife_otziv, collagen.marine, the Telegram pages) would add its kval to
 * the denominator and make every DM lead look cheaper than it was. The
 * sheet's «Итог» «Цена за квал» is sinolifeuz's, and the «DM kval narxi» tile
 * prints this figure, so the tile, the «Jami» row and the day grid agree.
 */
function dmTotalCells(all: DmAcc, priced: DmAcc): DmCellsDto {
  return {
    ...dmCells(all),
    costPerQualifiedUsd: perUnit(priced.spend, priced.qualified),
    conversationToQualifiedPercent: percent(priced.qualified, priced.conversations),
  }
}

// --- quality ----------------------------------------------------------------

type QualityAcc = Record<LeadBucket, number>

const qualityZero = (): QualityAcc => ({ noAnswer: 0, lowQuality: 0, success: 0, duplicate: 0, open: 0 })

function qualityCells(a: QualityAcc): QualityCellsDto {
  const leads = LEAD_BUCKETS.reduce((n, b) => n + a[b], 0)
  return { leads, ...a, successPercent: percent(a.success, leads) }
}

// --- form -------------------------------------------------------------------

interface FormAcc {
  spend: bigint
  leads: number
  impressions: number
  clicks: number
}

const formZero = (): FormAcc => ({ spend: 0n, leads: 0, impressions: 0, clicks: 0 })

function addForm(into: FormAcc, from: { spendMicroUsd: bigint; leads: number; impressions: number; clicks: number }): void {
  into.spend += from.spendMicroUsd
  into.leads += from.leads
  into.impressions += from.impressions
  into.clicks += from.clicks
}

function formCells(a: FormAcc): FormCellsDto {
  return {
    spendUsd: usd(a.spend),
    metaLeads: a.leads,
    costPerLeadUsd: perUnit(a.spend, a.leads),
    impressions: a.impressions,
    clicks: a.clicks,
    ctrPercent: percent(a.clicks, a.impressions),
    cpcUsd: perUnit(a.spend, a.clicks),
    cpmUsd: a.impressions > 0 ? (Number(a.spend) / MICRO / a.impressions) * 1000 : null,
  }
}

const asForm = (a: FormAcc) => ({ spendMicroUsd: a.spend, leads: a.leads, impressions: a.impressions, clicks: a.clicks })

const PRODUCT_ORDER: readonly MetaProduct[] = ['Collagen', 'Zextra', 'Boshqa']

const SIDE_NAMES: Readonly<Record<SideColumn, string>> = { hr: 'HR', kosmetika: 'Kosmetika' }

/**
 * The whole screen from the two ledgers' rows. Exported for its test.
 *
 * `pages` is the target pages in display order, each with its product; a page
 * with nothing on it in the window is still listed, so the columns do not
 * move from one month to the next.
 *
 * `brand` (the brand switch, `BRAND_FILTERS`) narrows all three ledgers
 * before anything is summed: a lead by `leadBrand`, as «Lidlar», RNP and
 * Roistat file it — its «Проект» first (2026-10-06), so a sinolifeuz lead
 * whose project is Zextra is Zextra's and a «Kosmetika» one «Brendsiz»; else
 * its page (`LEAD_SOURCE_BRAND`, which names every page this screen reads).
 * The pages are that brand's, then any other page still holding one of its
 * leads — dropping that page would drop the lead from every total — and only
 * a page of the slice's own brand carries its DM money. The Meta rows go to
 * that brand's AD BUDGET (`adBudgetProduct`, as every other screen reads a
 * brand's money). What no budget claims — hiring campaigns, HR Eldor,
 * Kosmetika, an unmapped account — is «Brendsiz», so Collagen + Zextra +
 * Brendsiz is «Hammasi» to the cent and to the lead.
 */
export function reklamaOverview(input: {
  window: { from: string; to: string }
  pages: readonly { key: string; name: string; product: TargetProduct }[]
  leadRows: readonly LeadStageDayRow[]
  campaignRows: readonly CampaignDayRow[]
  importedAt: Date | null
  brand?: BrandFilter
}): ReklamaOverviewDto {
  const brand = input.brand ?? 'all'
  if (brand !== 'all') {
    const leadRows = input.leadRows.filter((row) => brandMatches(brand, leadBrand(row.sourceId, null, row.productLine)))
    const pagesWithLeads = new Set(leadRows.map((row) => row.sourceId))
    input = {
      ...input,
      brand: 'all',
      pages: input.pages
        .filter((page) => brandMatches(brand, page.product) || pagesWithLeads.has(page.key))
        /*
          The slice's own pages first, in the sheet's order: its DM page, which
          carries its money, opens the DM sheet. Collagen's pages sort first
          overall, so on «Zextra» sinolifeuz — kept for a few Zextra-«Проект»
          leads, no money — took that place from zextrauzb.
        */
        .sort((a, b) => Number(brandMatches(brand, b.product)) - Number(brandMatches(brand, a.product))),
      leadRows,
      campaignRows: input.campaignRows.filter((row) => brandMatches(brand, adBudgetProduct(row))),
    }
  }
  const days = calendarDays(input.window.from, input.window.to)
  const dmPageOf = new Map<TargetProduct, string>(
    (Object.entries(DM_PAGE_OF_PRODUCT) as [TargetProduct, string][]).map(([p, id]) => [p, id]),
  )

  // DM and quality, per page per day.
  const dm = new Map<string, Map<string, DmAcc>>()
  const quality = new Map<string, Map<string, QualityAcc>>()
  const stages = new Map<string, { bucket: LeadBucket; leads: number }>()
  const cellOf = <T>(map: Map<string, Map<string, T>>, page: string, day: string, zero: () => T): T => {
    const byDay = map.get(page) ?? new Map<string, T>()
    map.set(page, byDay)
    const cell = byDay.get(day) ?? zero()
    byDay.set(day, cell)
    return cell
  }

  for (const row of input.leadRows) {
    const bucket = leadBucket(row.stage, row.status)
    cellOf(quality, row.sourceId, row.day, qualityZero)[bucket] += row.leads
    const d = cellOf(dm, row.sourceId, row.day, dmZero)
    d.leads += row.leads
    if (bucket === 'success') d.qualified += row.leads
    const seen = stages.get(row.stage) ?? { bucket, leads: 0 }
    seen.leads += row.leads
    stages.set(row.stage, seen)
  }

  // Meta, per campaign-day: into the sheet its channel belongs on.
  const split: Record<CampaignChannel, bigint> = { form: 0n, dm: 0n, hiring: 0n, other: 0n }
  const unattributed = { spend: 0n, conversations: 0 }
  interface OwnerAcc {
    key: string
    targetolog: string
    product: MetaProduct
    accounts: Set<string>
    total: FormAcc
    dmSpend: bigint
    dmConversations: number
    days: Map<string, FormAcc>
  }
  const owners = new Map<string, OwnerAcc>()

  for (const row of input.campaignRows) {
    const channel = campaignChannel(row.objective, row.campaignName, row.accountId)
    split[channel] += row.spendMicroUsd
    const owner = ownerOf(row.accountId, row.accountName)

    if (channel === 'dm') {
      const page =
        DM_PAGE_OF_ACCOUNT[row.accountId]?.page ?? (owner.product === 'Boshqa' ? undefined : dmPageOf.get(owner.product))
      if (page === undefined) {
        unattributed.spend += row.spendMicroUsd
        unattributed.conversations += row.conversations
      } else {
        const d = cellOf(dm, page, row.date, dmZero)
        d.spend += row.spendMicroUsd
        d.conversations += row.conversations
      }
    }

    if (channel === 'form' || channel === 'dm') {
      const key = `${owner.product}|${owner.targetolog}`
      const acc =
        owners.get(key) ??
        ({
          key,
          targetolog: owner.targetolog,
          product: owner.product,
          accounts: new Set<string>(),
          total: formZero(),
          dmSpend: 0n,
          dmConversations: 0,
          days: new Map<string, FormAcc>(),
        } satisfies OwnerAcc)
      owners.set(key, acc)
      acc.accounts.add(row.accountName)
      if (channel === 'form') {
        addForm(acc.total, row)
        const day = acc.days.get(row.date) ?? formZero()
        addForm(day, row)
        acc.days.set(row.date, day)
      } else {
        acc.dmSpend += row.spendMicroUsd
        acc.dmConversations += row.conversations
      }
    }
  }

  // --- DM block: every page into the total, the DM-money pages into its price too (`dmTotalCells`).
  const dmTotalDays = days.map(() => dmZero())
  const dmTotal = dmZero()
  const dmPricedDays = days.map(() => dmZero())
  const dmPriced = dmZero()
  const dmPages: DmPageDto[] = input.pages.map((page) => {
    // Another brand's DM page, shown for this slice's leads, carries none of the slice's money.
    const carriesDmSpend =
      (dmPageOf.get(page.product) === page.key || DM_ACCOUNT_PAGES.has(page.key)) && brandMatches(brand, page.product)
    const byDay = dm.get(page.key)
    const total = dmZero()
    const pageDays = days.map((date, i) => {
      const cell = byDay?.get(date) ?? dmZero()
      addDm(total, cell)
      addDm(dmTotalDays[i]!, cell)
      if (carriesDmSpend) addDm(dmPricedDays[i]!, cell)
      return { date, ...dmCells(cell) }
    })
    addDm(dmTotal, total)
    if (carriesDmSpend) addDm(dmPriced, total)
    return {
      key: page.key,
      name: page.name,
      product: page.product,
      carriesDmSpend,
      total: dmCells(total),
      days: pageDays,
    }
  })

  // DM money on a page the sheet does not draw (a `DM_PAGE_OF_ACCOUNT` page missing from `sales_source`) is
  // reported as unattributed, never lost from the page totals while «DM sarfi» still counts it.
  const drawn = new Set(input.pages.map((p) => p.key))
  for (const [key, byDay] of dm) {
    if (drawn.has(key)) continue
    for (const cell of byDay.values()) {
      unattributed.spend += cell.spend
      unattributed.conversations += cell.conversations
    }
  }

  // --- quality block
  const qualityTotalDays = days.map(() => qualityZero())
  const qualityTotal = qualityZero()
  const qualityPages: QualityPageDto[] = input.pages.map((page) => {
    const byDay = quality.get(page.key)
    const total = qualityZero()
    const pageDays = days.map((date, i) => {
      const cell = byDay?.get(date) ?? qualityZero()
      for (const b of LEAD_BUCKETS) {
        total[b] += cell[b]
        qualityTotalDays[i]![b] += cell[b]
        qualityTotal[b] += cell[b]
      }
      return { date, ...qualityCells(cell) }
    })
    return { key: page.key, name: page.name, product: page.product, total: qualityCells(total), days: pageDays }
  })

  // --- form block: product first, then the biggest spender.
  // Per campaign, every channel — the drill-down under all three sheets.
  interface CampaignAcc {
    row: CampaignDayRow
    channel: CampaignChannel
    total: FormAcc
    conversations: number
    days: Set<string>
    lastActive: string | null
  }
  const byCampaign = new Map<string, CampaignAcc>()
  for (const row of input.campaignRows) {
    const acc =
      byCampaign.get(row.campaignId) ??
      ({
        row,
        channel: campaignChannel(row.objective, row.campaignName, row.accountId),
        total: formZero(),
        conversations: 0,
        days: new Set<string>(),
        lastActive: null,
      } satisfies CampaignAcc)
    byCampaign.set(row.campaignId, acc)
    addForm(acc.total, row)
    acc.conversations += row.conversations
    if (row.spendMicroUsd > 0n) {
      acc.days.add(row.date)
      if (acc.lastActive === null || row.date > acc.lastActive) acc.lastActive = row.date
    }
  }
  const campaigns: CampaignDto[] = [...byCampaign.values()]
    .filter((c) => c.total.spend > 0n)
    .sort((a, b) => Number(b.total.spend - a.total.spend))
    .map((c) => {
      const owner = ownerOf(c.row.accountId, c.row.accountName)
      const results = c.channel === 'dm' || c.channel === 'hiring' ? c.conversations : c.total.leads
      return {
        id: c.row.campaignId,
        name: c.row.campaignName,
        account: c.row.accountName,
        targetolog: owner.targetolog,
        product: owner.product,
        channel: c.channel,
        spendUsd: usd(c.total.spend),
        metaLeads: c.total.leads,
        conversations: c.conversations,
        results,
        costPerResultUsd: perUnit(c.total.spend, results),
        impressions: c.total.impressions,
        clicks: c.total.clicks,
        ctrPercent: percent(c.total.clicks, c.total.impressions),
        activeDays: c.days.size,
        lastActive: c.lastActive,
      }
    })

  const ordered = [...owners.values()]
    .filter((o) => o.total.spend > 0n || o.total.leads > 0 || o.dmSpend > 0n)
    .sort(
      (a, b) =>
        PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product) ||
        Number(b.total.spend - a.total.spend) ||
        a.targetolog.localeCompare(b.targetolog, 'ru'),
    )
  const formTotal = formZero()
  const formTotalDays = days.map(() => formZero())
  const formOwners: FormOwnerDto[] = ordered.map((o) => {
    addForm(formTotal, asForm(o.total))
    return {
      key: o.key,
      targetolog: o.targetolog,
      product: o.product,
      accounts: [...o.accounts].sort(),
      total: formCells(o.total),
      dmSpendUsd: usd(o.dmSpend),
      dmConversations: o.dmConversations,
      days: days.map((date, i) => {
        const cell = o.days.get(date) ?? formZero()
        addForm(formTotalDays[i]!, asForm(cell))
        return { date, ...formCells(cell) }
      }),
    }
  })

  return {
    importedAt: input.importedAt?.toISOString() ?? null,
    window: input.window,
    spend: {
      totalUsd: usd(split.form + split.dm + split.hiring + split.other),
      formUsd: usd(split.form),
      dmUsd: usd(split.dm),
      hiringUsd: usd(split.hiring),
      otherUsd: usd(split.other),
    },
    dm: {
      total: dmTotalCells(dmTotal, dmPriced),
      days: days.map((date, i) => ({ date, ...dmTotalCells(dmTotalDays[i]!, dmPricedDays[i]!) })),
      pages: dmPages,
      unattributed: { spendUsd: usd(unattributed.spend), conversations: unattributed.conversations },
    },
    form: {
      total: formCells(formTotal),
      days: days.map((date, i) => ({ date, ...formCells(formTotalDays[i]!) })),
      owners: formOwners,
    },
    quality: {
      total: qualityCells(qualityTotal),
      days: days.map((date, i) => ({ date, ...qualityCells(qualityTotalDays[i]!) })),
      pages: qualityPages,
      stages: [...stages.entries()]
        .map(([stage, s]) => ({ stage, bucket: s.bucket, leads: s.leads }))
        .sort((a, b) => b.leads - a.leads || a.stage.localeCompare(b.stage, 'ru')),
    },
    campaigns,
  }
}

/**
 * The «HR · Kosmetika» side table from the campaign rows: HR, then Kosmetika,
 * always both (so it never changes shape), each the window's total and a row
 * a day. Since 2026-10-08 read by «Targetologlar · kunlik» alone
 * (`LeadSourcesService.targetologForms`), whose strip carries the table as
 * its last card; «Reklama samarasi» no longer draws it.
 */
export function sideColumnsOf(rows: readonly CampaignDayRow[], days: readonly string[]): SideColumnDto[] {
  const side: Record<SideColumn, Map<string, bigint>> = { hr: new Map(), kosmetika: new Map() }
  for (const row of rows) {
    const column = sideColumn(campaignChannel(row.objective, row.campaignName, row.accountId), row.accountId)
    if (column !== null) side[column].set(row.date, (side[column].get(row.date) ?? 0n) + row.spendMicroUsd)
  }
  return (Object.keys(SIDE_NAMES) as SideColumn[]).map((key) => {
    const byDay = side[key]
    return {
      key,
      name: SIDE_NAMES[key],
      totalUsd: usd(days.reduce((n, date) => n + (byDay.get(date) ?? 0n), 0n)),
      days: days.map((date) => ({ date, spendUsd: usd(byDay.get(date) ?? 0n) })),
    }
  })
}

/**
 * The target pages in the order the sheet reads them: Collagen's first, then
 * Zextra's, each by the portal's name.
 */
function orderedPages(named: readonly { externalId: string; name: string }[]) {
  const products: readonly TargetProduct[] = ['Collagen', 'Zextra']
  return named
    .flatMap((s) => {
      const product = TARGET_SOURCE_PRODUCT[s.externalId] ?? DM_ACCOUNT_PAGES.get(s.externalId)
      return product ? [{ key: s.externalId, name: s.name, product }] : []
    })
    .sort(
      (a, b) =>
        products.indexOf(a.product) - products.indexOf(b.product) ||
        // The page that carries DM money first — the sheet's first column.
        Number(DM_PAGE_OF_PRODUCT[b.product] === b.key) - Number(DM_PAGE_OF_PRODUCT[a.product] === a.key) ||
        Number(DM_ACCOUNT_PAGES.has(b.key)) - Number(DM_ACCOUNT_PAGES.has(a.key)) ||
        a.name.localeCompare(b.name, 'ru'),
    )
}

/**
 * One product's DM kval price on «Target tahlili» — what «Reklama samarasi»
 * prints in its «Итог» under that product's brand switch: its DM money over
 * the kval of the pages that money is written to (`carriesDmSpend`).
 */
export interface DmProductDto {
  readonly product: TargetProduct
  /** The DM-money pages, by name. */
  readonly pages: readonly string[]
  /** Those pages' DM spend, dollars. */
  readonly spendUsd: number
  readonly conversations: number
  /** Those pages' kval («Сделка успешна»). */
  readonly qualified: number
  /** spend ÷ qualified; null with no kval, and with no DM money — «$0» would read as the cheaper product. */
  readonly costPerQualifiedUsd: number | null
}

/** «Target tahlili»'s DM sheet: the slice's DM block, and each product priced as its own slice. */
export interface TargetDmDto {
  readonly importedAt: string | null
  /** Every DM campaign's spend in the slice, vakansiyasiz — `spend.dmUsd`. */
  readonly dmSpendUsd: number
  readonly dm: DmBlockDto
  readonly products: readonly DmProductDto[]
}

/**
 * Exported for its test. Each product is `reklamaOverview` run under that
 * brand — the leads filed by «Проект» first, the money by its ad budget — so
 * its price is the brand switch's «Итог» to the cent, never a re-derivation
 * that could drift from it. A product with no DM-money page is left out.
 */
export function targetDm(
  input: Omit<Parameters<typeof reklamaOverview>[0], 'brand'>,
  product: TargetProductFilter,
): TargetDmDto {
  const slice = reklamaOverview({ ...input, brand: product })
  const products = (product === 'all' ? TARGET_PRODUCTS : [product]).flatMap((p): DmProductDto[] => {
    const dm = p === product ? slice.dm : reklamaOverview({ ...input, brand: p }).dm
    const priced = dm.pages.filter((page) => page.carriesDmSpend)
    if (priced.length === 0) return []
    const spendUsd = Math.round(priced.reduce((n, page) => n + page.total.spendUsd, 0) * 100) / 100
    return [
      {
        product: p,
        pages: priced.map((page) => page.name),
        spendUsd,
        conversations: priced.reduce((n, page) => n + page.total.conversations, 0),
        qualified: priced.reduce((n, page) => n + page.total.qualified, 0),
        costPerQualifiedUsd: spendUsd > 0 ? dm.total.costPerQualifiedUsd : null,
      },
    ]
  })
  return { importedAt: slice.importedAt, dmSpendUsd: slice.spend.dmUsd, dm: slice.dm, products }
}

/** The ad pages, and the pages an account's DM money goes to (`DM_ACCOUNT_PAGES`) — this screen's alone. */
const REKLAMA_SOURCE_IDS: readonly string[] = [...new Set([...TARGET_SOURCE_IDS, ...DM_ACCOUNT_PAGES.keys()])]

/*
  A memo in front of the lead scan, keyed by the window. Company-wide by
  construction — the route refuses a narrowed account — so no scope reaches it.
*/

const leadCache = ttlCache<LeadStageDayRow[]>(120_000, LIVE_CACHE)

export class ReklamaService {
  constructor(private readonly repository: ReklamaRepository) {}

  async overview(period: Period, timeZone: string, brand: BrandFilter = 'all'): Promise<ReklamaOverviewDto> {
    // The cache holds both brands' leads; the switch narrows after it.
    return reklamaOverview({ ...(await this.load(period, timeZone)), brand })
  }

  /** «Target tahlili»'s DM sheet, from the same rows as `overview` (`targetDm`). */
  async targetDm(period: Period, timeZone: string, product: TargetProductFilter): Promise<TargetDmDto> {
    return targetDm(await this.load(period, timeZone), product)
  }

  private async load(period: Period, timeZone: string) {
    const window = {
      from: zonedDateKey(period.start, timeZone),
      to: zonedDateKey(new Date(period.end.getTime() - 1), timeZone),
    }
    const key = [period.preset, period.start.toISOString(), periodLengthInDays(period)].join('|')

    const [leadRows, named, campaignRows, importedAt] = await Promise.all([
      leadCache.get(key, () => this.repository.leadStageDays(period, REKLAMA_SOURCE_IDS)),
      this.repository.sources(REKLAMA_SOURCE_IDS),
      this.repository.campaignDays(window.from, window.to),
      this.repository.campaignsImportedAt(),
    ])

    return { window, pages: orderedPages(named), leadRows, campaignRows, importedAt }
  }
}
