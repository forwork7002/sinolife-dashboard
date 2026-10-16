/**
 * «Lid manbalari» — the first tab of «Lidlar»: every lead the portal
 * registered, by where it came from, and what became of it.
 *
 * Asked for on 2026-09-25 after a week of the portal was read through the
 * read-only Bitrix24 MCP and set beside Meta (see `domain/leads/leadSources.ts`
 * for what was measured). That read found the ad screen was counting 858 of a
 * week's ad leads and missing the rest: 1 365 lead-form leads filed under
 * «Ген лид», and 4 686 Instagram conversations in «ИИ обработка». This screen
 * counts all three, from the portal's own records:
 *
 *   forms   — per targetolog: Meta's lead count for their lead-form campaigns
 *             beside the Регистрация deals their CRM forms opened, and what
 *             those became. «Yetib keldi» is the second over the first — the
 *             week measured ran ~80% where a form is linked to the portal and
 *             0% where it is not.
 *   dm      — per page: conversations («ИИ обработка» deals), the page's
 *             Регистрация leads and their kval.
 *   sources — every Регистрация source, ad or not, so the total reads whole,
 *             with «Факт1 мижоз»: the distinct clients whose number reached a
 *             FAKT 1 order in the same window (`InsightsRepository.leadFakt1Clients`,
 *             the queue cohort — the one join by phone on this tab).
 *
 * Meta and Bitrix24 are never joined deal by deal — no deal carries a UTM
 * (0 of 2 892). They meet on the targetolog and the Tashkent day.
 */

import {
  DM_PAGES,
  DM_PAGE_ALIAS,
  LEAD_SOURCE_BRAND,
  LEAD_SOURCE_VOCABULARY,
  LEAD_TILE_SOURCES,
  SMM_ACCOUNTS,
  AI_CARD_SOURCE_IDS,
} from '@/server/integrations/crm/bitrix24/mapping'
import {
  type CampaignChannel,
  type MetaProduct,
  adBudgetProduct,
  campaignChannel,
  isSiteCampaign,
  ownerOf,
} from '@/server/integrations/meta/accounts'
import {
  type LeadChannel,
  type LeadTile,
  LEAD_CHANNELS,
  LEAD_TILES,
  LEAD_TILES_APART,
  LEAD_TILES_OUTSIDE_REGISTRATION,
  formNameOf,
  formOwner,
  isCustomerForm,
  leadChannel,
  leadTile,
  targetologOfField,
} from '@/server/domain/leads/leadSources'
import { type FormFillDayRow, fillsCover, isIntegrationForm } from '@/server/domain/leads/formFills'
import { isLeadDuplicate, LEAD_BUCKETS, type LeadBucket, leadBucket } from '@/server/domain/reklama/leadQuality'
import { type ChannelLeads, type ChannelLeadsDay, type ManualSpendDto, manualSpendBlocks } from '@/server/domain/reklama/manualSpend'
import { type Period, type PeriodPreset, periodLengthInDays, resolvePeriod, zonedDateKey } from '@/server/domain/period/period'
import type { DistributedDayRow } from '@/server/domain/registration/leadSplit'
import { teamBrand } from '@/server/domain/rnp/rnpSheet'
import { type BrandFilter, type TargetProduct, brandMatches } from '@/server/domain/types'
import type { InsightsRepository, LeadFakt1ClientRow } from '@/server/repositories/insightsRepository'
import type {
  LeadSourcesRepository,
  AiQualifiedStageRow,
  PipelineSourceCount,
  QualifiedSourceRow,
  RegistrationDayRow,
  TriageDayRow,
} from '@/server/repositories/leadSourcesRepository'
import type { CampaignDayRow, ReklamaRepository } from '@/server/repositories/reklamaRepository'

import { type SideColumnDto, calendarDays, sideColumnsOf } from './reklamaService'
import { leadBrand } from './rnpService'
import { OFF_HOURS, WARM_HOURS, type WarmOutcome, withinHours } from './rnpWarmer'
import { LIVE_CACHE, ttlCache } from './ttlCache'

// ---------------------------------------------------------------------------
// DTOs — mirrored in `src/features/leads/leadSourcesApi.ts`
// ---------------------------------------------------------------------------

/** What a set of Регистрация leads became — the «lid sifati» buckets. */
export interface LeadOutcomeDto {
  readonly leads: number
  readonly success: number
  readonly noAnswer: number
  readonly lowQuality: number
  readonly duplicate: number
  readonly open: number
  /** success ÷ leads. */
  readonly successPercent: number | null
}

/**
 * What else a targetolog's accounts spent beside the lead forms — Umar's
 * nightly report (03.10.2026) gives each line: «Rasxod», «Sms rasxod · Sms
 * soni», «Sayt rasxod · Lid soni»; HR is the hiring campaigns.
 */
export interface FormExpenseDto {
  /** `spendUsd` less the website campaigns — Umar's «Rasxod». */
  readonly formUsd: number
  /** The website lead campaigns (`isSiteCampaign`): already inside `spendUsd`, their leads inside `metaLeads`. */
  readonly siteUsd: number
  readonly siteLeads: number
  /** Message campaigns (DM, «Sms»): spend and the conversations Meta counted. */
  readonly smsUsd: number
  readonly smsCount: number
  /** Hiring campaigns. */
  readonly hrUsd: number
  /** Traffic, awareness, sales — on no sheet. */
  readonly otherUsd: number
  /**
   * Everything: `spendUsd` + sms + HR + other. Under a brand (`ofBrand`) the
   * hiring and unmapped campaigns are gone first, so there HR is 0 and the
   * total leaves them out; «Targetologlar · kunlik» reads the whole.
   */
  readonly totalUsd: number
}

export interface FormDayDto extends FormExpenseDto {
  readonly date: string
  /** The targetolog's lead-form campaigns' spend that day — «Отчёт Т»'s $. */
  readonly spendUsd: number
  readonly metaLeads: number
  /** The day's Bitrix24 count of Meta's form leads — the fills, or the deals on `leadsBasis` 'deals'. */
  readonly leads: number
  readonly success: number
}

/** One targetolog's lead forms: what Meta counted, what reached the portal. */
export interface FormOwnerDto extends FormExpenseDto {
  readonly key: string
  readonly targetolog: string
  readonly product: MetaProduct
  /** The CRM forms that opened this targetolog's deals, by name. */
  readonly forms: readonly string[]
  /** The Meta accounts whose ad-budget campaigns ran in the window — lead forms, and DM / other money. */
  readonly accounts: readonly string[]
  readonly spendUsd: number
  readonly metaLeads: number
  /** What the Регистрация deals of these forms became — the deals' buckets, whatever `bitrixLeads` counts. */
  readonly outcome: LeadOutcomeDto
  /**
   * The Bitrix24 count of Meta's form leads beside `metaLeads`. On
   * `leadsBasis` 'fills' (since 2026-10-15): every CRM-form fill of these
   * forms, a returning contact's too, plus the AI targetolog's deals — as Meta
   * counts. On 'deals': `outcome.leads`, for a window the fills do not cover.
   */
  readonly bitrixLeads: number
  readonly leadsBasis: 'fills' | 'deals'
  /** `bitrixLeads` ÷ Meta leads — how much of what Meta counted arrived. */
  readonly reachPercent: number | null
  /** spend ÷ `bitrixLeads`. */
  readonly costPerLeadUsd: number | null
  /** spend ÷ kval. */
  readonly costPerSuccessUsd: number | null
  /**
   * This person's ad-budget money no lead form took — DM / message and other
   * campaigns of their Collagen / Zextra accounts, hiring out: their share of
   * «Bogʻlanmagan sarf», so the owners' rows add up to «Jami»'s spend.
   */
  readonly unlinkedUsd: number
  /** Of `outcome.leads`, «Ген лид» with no form that the deal's «Таргетолог» field files here. */
  readonly formlessLeads: number
  /**
   * «Факт1 мижоз» of these forms' leads — distinct clients (by phone) with a
   * FAKT 1 order in the window, `SourceRowDto.fakt1Clients`' rule. Null while
   * the phone match is not read.
   */
  readonly fakt1Clients: number | null
  readonly days: readonly FormDayDto[]
}

export interface DmDayDto {
  readonly date: string
  readonly conversations: number
  readonly leads: number
  readonly success: number
}

/** One page's DM funnel: conversations → Регистрация leads → kval. */
export interface DmPageDto {
  readonly key: string
  readonly name: string
  readonly product: TargetProduct | null
  readonly conversations: number
  readonly outcome: LeadOutcomeDto
  readonly days: readonly DmDayDto[]
}

/** One Регистрация source (or, for a form, one form). */
export interface SourceRowDto {
  readonly key: string
  readonly channel: LeadChannel
  readonly name: string
  readonly outcome: LeadOutcomeDto
  /**
   * Distinct clients (by phone) of these leads with a FAKT 1 order in the
   * window — «Факт1 мижоз». Null while the phone match is not ready yet.
   */
  readonly fakt1Clients: number | null
  /** In «Жами лидлар» — false for «Исход» and the sources no tile names (`LEAD_TILES_APART`). */
  readonly counted: boolean
}

/**
 * One channel tile, read as the headline tiles read Регистрация — a COHORT
 * since 2026-10-09 (the client: «ikki xil kunning leadlari aralashgan»): the
 * leads created in the window, and how many of THOSE are WON by now. Until
 * then kval was the deals WON in the window whenever they arrived, over the
 * window's arrivals; that count stays as `closedQualified`, a quiet line.
 */
export interface ChannelTileDto {
  /** Created in the window, duplicates included. */
  readonly leads: number
  /** `leads` less the duplicates. */
  readonly fresh: number
  /** Of `leads`, WON («Сделка успешна») by now. */
  readonly qualified: number
  /** qualified ÷ fresh — «Квал %» of the headline. */
  readonly qualifiedPercent: number | null
  /** The tile's deals WON in the window by `closedAt`, whenever they arrived. */
  readonly closedQualified: number
}

export interface LeadSourcesOverviewDto {
  /**
   * The Collagen / Zextra switch the figures were narrowed by. Under one
   * brand «Сарафан» (deals of every pipeline, no brand read on them) and the inbound
   * calls cannot be split: the screen prints them as «brend boʻyicha
   * ajratilmaydi», not as a zero.
   */
  readonly brand: BrandFilter
  /** When Meta's campaign grain was last read; null means never. */
  readonly importedAt: string | null
  /**
   * Inbound CALLS in the window (`call_record`, direction INBOUND) — printed
   * under «Входящий», whose big number stays the Регистрация leads from a
   * call source. Null before `CALL_DATA_FLOOR`.
   */
  readonly inboundCalls: number | null
  /**
   * The tab's six headline tiles (the client's list, 2026-10-01): Жами /
   * Янги / Дубль лидлар, Квал лидлар сони, Квал %, Квал лид нархи $.
   * ONE TOTAL SINCE 2026-10-09: the first three are `tiles.total` — the
   * channel tiles' «Jami», so «Исход» (an operator's own call, 112 of
   * 09.10's 854) and «Boshqa» are in none of them — and kval is that
   * cohort's (`ChannelTileDto`). The RNP sheet's «Регистрация» block still
   * counts every Регистрация deal and kval by the day it was WON.
   */
  readonly funnel: {
    /**
     * `tiles.total.leads`: Регистрация deals created in the window on a
     * counted tile, duplicates included — «Ген лид»'s as its CRM-form fills
     * since 2026-10-16 (`tiles.generatedBasis`).
     */
    readonly total: number
    /** `total` less the duplicates. */
    readonly fresh: number
    /** Of `total`, standing in «Дубликат (лид)» now (not the red «Дубликат»). */
    readonly duplicates: number
    /** Of `total`, WON («Сделка успешна») by now. */
    readonly qualified: number
    /** `qualified` ÷ `fresh`; null with no new leads. One cohort, so never above 100%. */
    readonly qualifiedPercent: number | null
    /** The counted tiles' deals WON in the window by `closedAt` — «Квал лидлар сони» until 2026-10-09. */
    readonly closedQualified: number
    /**
     * The deals handed out to a ROP in the window («Лид таркатилган сана»),
     * every pipeline, duplicates in — «Kimga qancha lid kelayapti» → «Квал»'s
     * «Jami» summed over the window: a day on «Bugun», the month on «Shu oy».
     * Its own card beside «Исход | Boshqa» (the client, 2026-10-16: «shu
     * yerdagi 118 ta … alohida … oʻng tomondagi boʻsh tomonga»).
     */
    readonly handedOut: number
    /** `forms.total.spendUsd` — the Meta money the kval price divides. */
    readonly spendUsd: number
    /** `forms.total.outcome.success` — the «Ген лид» cohort's kval, the price's divisor. */
    readonly generatedQualified: number
    /** `forms.total.costPerSuccessUsd`, so it IS «Targetologlar»'s «Jami» «Kval narxi». */
    readonly costPerQualifiedUsd: number | null
  }
  readonly totals: {
    /** Every Регистрация deal created in the window, «Исход» included — «Barcha manbalar»'s rows. */
    readonly registration: LeadOutcomeDto
    /** `registration` less what «Жами лидлар» leaves out — «Barcha manbalar»'s «Jami». */
    readonly counted: LeadOutcomeDto
    /** «Факт1 мижоз» of `counted` — distinct, so not the sum of the channels; null while not ready. */
    readonly fakt1Clients: number | null
    readonly formReachPercent: number | null
  }
  readonly forms: {
    readonly owners: readonly FormOwnerDto[]
    /** Owners with no form, no lead and no ad-budget money — hiring, or an unmapped / «Boshqa» account's — in none of the totals here. */
    readonly expenseOwners: readonly FormOwnerDto[]
    readonly days: readonly FormDayDto[]
    readonly spendUsd: number
    readonly metaLeads: number
    readonly outcome: LeadOutcomeDto
    /** The table's «Jami» Bitrix24 leads: the owners' `bitrixLeads` and the hand-typed «Ген лид». */
    readonly bitrixLeads: number
    readonly leadsBasis: 'fills' | 'deals'
    /** «Ген лид» typed in by hand — no form names a targetolog — so the table's «Jami» is every «Ген лид». */
    readonly manual: LeadOutcomeDto
    /**
     * «Факт1 мижоз» per targetolog across both products — distinct, so a
     * client who left a Collagen and a Zextra lead is one, which the owners'
     * `fakt1Clients` summed would count twice. Null while not read.
     */
    readonly fakt1Targetologs: readonly { readonly targetolog: string; readonly clients: number }[] | null
    /**
     * «Bogʻlanmagan sarf»: the ad budget's money no lead form took — message
     * and other campaigns of the Collagen / Zextra accounts — by account,
     * largest first. Hiring and unmapped accounts are no ad budget and stay out.
     */
    readonly unlinked: {
      readonly spendUsd: number
      readonly accounts: readonly { readonly name: string; readonly spendUsd: number }[]
    }
    /**
     * The table's «Jami» (2026-10-09): the owners, `manual` and `unlinked`
     * together. `costPerSuccessUsd` is the headline's «Квал лид нархи $» —
     * one figure on the server, so the two cannot differ. Null with no spend
     * read: unknown, never free.
     */
    readonly total: {
      readonly spendUsd: number
      readonly outcome: LeadOutcomeDto
      readonly costPerLeadUsd: number | null
      readonly costPerSuccessUsd: number | null
    }
  }
  readonly dm: {
    readonly pages: readonly DmPageDto[]
    readonly days: readonly DmDayDto[]
    readonly conversations: number
    readonly outcome: LeadOutcomeDto
  }
  /** Every channel of `LEAD_CHANNELS`, in its order — a channel with no leads is there at zero. */
  readonly channels: readonly {
    readonly channel: LeadChannel
    readonly outcome: LeadOutcomeDto
    readonly fakt1Clients: number | null
  }[]
  /**
   * «Boshqa kanallar lidlari»: every tile of `LEAD_TILES`, in its order and
   * at zero when quiet, and «Jami» — the sum of all but `LEAD_TILES_APART`
   * («Исход», «Boshqa») and `LEAD_TILES_OUTSIDE_REGISTRATION` («Сарафан»,
   * deals of every pipeline since 2026-10-10). `funnel` is this «Jami».
   */
  readonly tiles: {
    readonly rows: readonly ({ readonly tile: LeadTile } & ChannelTileDto)[]
    readonly total: ChannelTileDto
    /**
     * «Сммщик ии»'s card since 2026-10-15 (the client: «ИИ квал сана» is the
     * right count): Регистрация deals whose «ИИ квал сана» is in the window,
     * any creation day, on the client's nine sources (`AI_CARD_SOURCE_IDS`)
     * — duplicates «Дубликат (лид)», kval WON now. The
     * `aiSmm` row stays the SMM sources by creation day, which is what
     * «Jami» sums. No close-day count is read here, so none is sent.
     */
    readonly ai: Omit<ChannelTileDto, 'closedQualified'>
    /** `ai` by account (`SMM_ACCOUNTS`' names), largest first — they sum to `ai`. */
    readonly smmAccounts: readonly ({ readonly key: string; readonly name: string } & ChannelTileDto)[]
    /** The same deals outside Регистрация now (Первичный отдел, Доставка, …) — said in a tip, summed nowhere. */
    readonly aiElsewhere: number
    /**
     * What «Ген лид»'s big number counts (2026-10-16, the client: «bitrix24dan
     * ol facebookdan emas»): 'fills' — every CRM-form fill the portal
     * recorded, a returning contact's too, plus the AI targetolog's deals and
     * the «Ген лид» typed in by hand (`forms.bitrixLeads`); 'deals' — the
     * Регистрация deals on its source, for a window the fills do not cover.
     * Its «dubl» and kval are the deals' either way. Under «Brendsiz» 'fills'
     * is the hand-typed «Ген лид» alone (no customer form's fill is brandless).
     */
    readonly generatedBasis: 'fills' | 'deals'
    /** The Регистрация «Ген лид» deals, whichever the basis — the tile's quiet line on 'fills'. */
    readonly generatedDeals: number
  }
  readonly sources: readonly SourceRowDto[]
}

// ---------------------------------------------------------------------------

const MICRO = 1_000_000

function usd(micro: bigint): number {
  return Math.round(Number(micro) / 10_000) / 100
}

function perUnit(micro: bigint, count: number): number | null {
  return count > 0 ? Number(micro) / MICRO / count : null
}

function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null
}

type OutcomeAcc = Record<LeadBucket, number>

const outcomeZero = (): OutcomeAcc => ({ success: 0, noAnswer: 0, lowQuality: 0, duplicate: 0, open: 0 })

function addOutcome(into: OutcomeAcc, from: OutcomeAcc): void {
  for (const b of LEAD_BUCKETS) into[b] += from[b]
}

function outcomeCells(a: OutcomeAcc): LeadOutcomeDto {
  const leads = LEAD_BUCKETS.reduce((n, b) => n + a[b], 0)
  return { leads, ...a, successPercent: percent(a.success, leads) }
}

/** `FormExpenseDto` in micro-dollars. */
interface ExpenseAcc {
  site: bigint
  siteLeads: number
  sms: bigint
  smsCount: number
  hr: bigint
  other: bigint
}

const expenseZero = (): ExpenseAcc => ({ site: 0n, siteLeads: 0, sms: 0n, smsCount: 0, hr: 0n, other: 0n })

function addExpense(into: ExpenseAcc, from: ExpenseAcc): void {
  into.site += from.site
  into.siteLeads += from.siteLeads
  into.sms += from.sms
  into.smsCount += from.smsCount
  into.hr += from.hr
  into.other += from.other
}

/** A campaign's day onto its expense line; a lead form adds only when it is the website's (the rest is `spend`). */
function addCampaignExpense(into: ExpenseAcc, row: CampaignDayRow, channel: CampaignChannel): void {
  if (channel === 'form') {
    if (!isSiteCampaign(row.campaignName)) return
    into.site += row.spendMicroUsd
    into.siteLeads += row.leads
  } else if (channel === 'dm') {
    into.sms += row.spendMicroUsd
    into.smsCount += row.conversations
  } else if (channel === 'hiring') into.hr += row.spendMicroUsd
  else into.other += row.spendMicroUsd
}

const expenseCells = (spend: bigint, a: ExpenseAcc): FormExpenseDto => ({
  formUsd: usd(spend - a.site),
  siteUsd: usd(a.site),
  siteLeads: a.siteLeads,
  smsUsd: usd(a.sms),
  smsCount: a.smsCount,
  hrUsd: usd(a.hr),
  otherUsd: usd(a.other),
  totalUsd: usd(spend + a.sms + a.hr + a.other),
})

/** A targetolog's day: spend summed in micro-dollars, converted once. */
interface FormDayAcc extends ExpenseAcc {
  spend: bigint
  metaLeads: number
  leads: number
  /** The day's CRM-form fills (and AI targetolog deals) — `leads` on the fills' basis. */
  fills: number
  success: number
}

const formDayCells = (date: string, a: FormDayAcc, fillsBasis: boolean): FormDayDto => ({
  date,
  spendUsd: usd(a.spend),
  metaLeads: a.metaLeads,
  leads: fillsBasis ? a.fills : a.leads,
  success: a.success,
  ...expenseCells(a.spend, a),
})

interface TileAcc {
  leads: number
  duplicates: number
  qualified: number
  closed: number
}

const tileZero = (): TileAcc => ({ leads: 0, duplicates: 0, qualified: 0, closed: 0 })

/** One row's leads onto a tile: a «Дубликат (лид)» is a duplicate, a lead WON by now its kval. */
function addTileLeads(tile: TileAcc, row: { stage: string; status: string; leads: number }) {
  tile.leads += row.leads
  if (isLeadDuplicate(row.stage)) tile.duplicates += row.leads
  if (leadBucket(row.stage, row.status) === 'success') tile.qualified += row.leads
}

function tileCells(a: TileAcc): ChannelTileDto {
  const fresh = a.leads - a.duplicates
  return {
    leads: a.leads,
    fresh,
    qualified: a.qualified,
    qualifiedPercent: percent(a.qualified, fresh),
    closedQualified: a.closed,
  }
}

/** A lead (or what is read by its source) on one of these is in «Жами лидлар»; registration rows are never «Сарафан». */
const countedSource = (sourceId: string | null): boolean => !LEAD_TILES_APART.has(leadTile(sourceId, LEAD_TILE_SOURCES))

const PRODUCT_ORDER: readonly MetaProduct[] = ['Collagen', 'Zextra', 'Boshqa']

const mapGet = <K, V>(map: Map<K, V>, key: K, make: () => V): V => {
  const found = map.get(key)
  if (found !== undefined) return found
  const made = make()
  map.set(key, made)
  return made
}

type LeadOwner = { key: string; targetolog: string; product: MetaProduct }

interface OwnedLead {
  readonly sourceId: string | null
  readonly formTitle: string | null
  readonly productLine: string | null
  readonly targetolog: string | null
}

/**
 * Forms whose name names nobody but ENDS another form's name that names one
 * person: a «Qayta zayavka» copy carries the form as Meta knows it,
 * «zextra - 27 / 09 Варианты», while its first deal reads «Timur-zextra
 * zextra - 27 / 09 Варианты» (measured 2026-10-14). Two words at least, so a
 * bare «777» names nobody; two people's forms ending alike make the name
 * nobody's. Only forms the window saw: a window holding the copy alone falls
 * to the deal's «Таргетолог» field.
 */
function formTailOwners(forms: Iterable<string>): ReadonlyMap<string, string> {
  const named: { name: string; targetolog: string }[] = []
  const nameless = new Set<string>()
  for (const form of forms) {
    const owner = formOwner(form)
    if (owner) named.push({ name: form.toLowerCase(), targetolog: owner.targetolog })
    else nameless.add(form)
  }
  const tails = new Map<string, string>()
  for (const form of nameless) {
    const tail = form.trim().toLowerCase()
    if (tail.split(/\s+/).length < 2) continue
    const people = new Set(named.filter((n) => n.name.endsWith(` ${tail}`)).map((n) => n.targetolog))
    if (people.size === 1) tails.set(form, [...people][0]!)
  }
  return tails
}

/**
 * WHOSE «ГЕН ЛИД» THIS IS — the targetolog «Targetologlar» files it under.
 * The form's name first («… (UMAR) 777», «… Eldor»), as before; then a form
 * that ends a named one's name (`formTailOwners`); then the deal's own
 * «Таргетолог» field. The user, 2026-10-14: «faqat targetologlar malumoti
 * turishi kerak». Measured on the portal that day (01–14.10, 13 514 «Ген
 * лид»): 235 had no form — 181 of them Eldor's «Sinolife Collagen - 30.04»,
 * whose short name a deal retitled «Collagen Marine ген лид» (itself a row of
 * its own) made ambiguous — and 196 of the 235 carry the field (Элдор 700,
 * Umar 702, Timur 708, Sobirjon 724 …). The 39 left that fortnight were
 * incoming calls and «Сделка #…» the registrars filed under «Ген лид» — no
 * targetolog's at all; they stay «Ген лид · formasiz». A nameless form nothing
 * names keeps a row by its own name.
 *
 * THE PRODUCT IS THE LEAD'S BRAND, `leadBrand` — the rule every screen's
 * brand switch reads (form name, «Проект», source) — so a row is drawn under the
 * same slice its leads are counted in. A formless lead with no «Проект» has no
 * brand: it is the person's «Brendsiz» row (`brandless|…`, product «Boshqa»,
 * a key no Meta account's owner wears), never guessed into the collagen.
 */
function leadOwner(row: OwnedLead, tails: ReadonlyMap<string, string>): LeadOwner | null {
  const form = formNameOf(row.formTitle)
  const byForm = form === null ? null : formOwner(form)
  if (byForm) return { key: `${byForm.product}|${byForm.targetolog}`, targetolog: byForm.targetolog, product: byForm.product }
  const person = (form === null ? undefined : tails.get(form)) ?? targetologOfField(row.targetolog)
  if (person !== null) {
    const product = leadBrand(row.sourceId, row.formTitle, row.productLine)
    return product === null
      ? { key: `brandless|${person}`, targetolog: person, product: 'Boshqa' }
      : { key: `${product}|${person}`, targetolog: person, product }
  }
  return form === null ? null : { key: `form|${form}`, targetolog: form, product: 'Boshqa' }
}

/**
 * The line a lead is counted on — a form by its name, anything else by its
 * source. A form's leads on a source «Жами лидлар» leaves out («Исход») are a
 * line apart, so a line is wholly in «Jami» or wholly out of it.
 */
const sourceKeyOf = (form: string | null, sourceId: string | null): string =>
  form !== null ? `form|${form}${countedSource(sourceId) ? '' : '|apart'}` : `source|${sourceId ?? ''}`

/** What a page's chats and leads sell — the page's own brand, the second bot folded into its page. */
const pageBrand = (sourceId: string | null): TargetProduct | null =>
  sourceId === null ? null : (LEAD_SOURCE_BRAND[DM_PAGE_ALIAS[sourceId] ?? sourceId] ?? LEAD_SOURCE_BRAND[sourceId] ?? null)

type LeadSourcesInput = Parameters<typeof leadSourcesOverview>[0]

/**
 * The tab's inputs narrowed to one brand — RNP's rules, so the switch agrees
 * with RNP's «Коллаген / Зехтра проект»: a lead (and its kval, its FAKT 1
 * client, the AI's mark) by `leadBrand` — its form's name, then its «Проект», then its source; a chat
 * by its page; Meta money by its ad budget (`adBudgetProduct`). What
 * nothing ties to a brand — an outgoing call, a hand-typed lead, a page no
 * brand claims, hiring money — is «Brendsiz», and so are «Сарафан» and the
 * inbound calls, which carry no brand at all: the three slices partition the
 * tab, so Collagen + Zextra + Brendsiz is «Hammasi» on every count.
 */
function ofBrand(input: LeadSourcesInput, brand: Exclude<BrandFilter, 'all'>): LeadSourcesInput {
  const lead = (row: { sourceId: string | null; formTitle: string | null; productLine: string | null }) =>
    brandMatches(brand, leadBrand(row.sourceId, row.formTitle, row.productLine))
  const brandless = brand === 'none'
  return {
    ...input,
    registration: input.registration.filter(lead),
    triage: input.triage.filter((row) => brandMatches(brand, pageBrand(row.sourceId))),
    campaigns: input.campaigns.filter((row) => brandMatches(brand, adBudgetProduct(row))),
    fakt1: input.fakt1?.filter(lead) ?? null,
    formFills: input.formFills?.filter((row) => brandMatches(brand, fillBrand(row.subject))) ?? null,
    qualified: input.qualified.filter(lead),
    aiQualified: input.aiQualified.filter(lead),
    // By the team the lead went to, as the grid narrows its rows (`teamRowsOfBrand`); a lead given to no team is «Brendsiz».
    handedOut: input.handedOut?.filter((row) => brandMatches(brand, teamBrand(row.rop))),
    sarafan: brandless ? input.sarafan : { leads: 0, qualified: 0 },
    inboundCalls: brandless ? input.inboundCalls : null,
  }
}

/**
 * The brand a fill's subject («Заполнена CRM-форма "<form>"») is sliced
 * under on «Lidlar»: its form's, by the rule the form's deals are sliced by
 * (`leadBrand` with the form alone — a fill carries no «Проект» and no
 * source), so a form's fills and its deals land in the same slice. Null for a
 * vacancy's or the cosmetics line's form, whose fills are no customer's lead.
 */
function fillBrand(subject: string): TargetProduct | null {
  const form = formNameOf(subject)
  return form === null || !isCustomerForm(form) ? null : leadBrand(null, subject)
}

/**
 * The whole tab from the three ledgers' rows. Exported for its test.
 */
export function leadSourcesOverview(all: {
  window: { from: string; to: string }
  registration: readonly RegistrationDayRow[]
  triage: readonly TriageDayRow[]
  campaigns: readonly CampaignDayRow[]
  /**
   * Leads that reached FAKT 1 (`InsightsRepository.leadFakt1Clients`). Null when
   * the phone match did not answer in time (`FAKT1_WAIT_MS`): «Факт1 мижоз»
   * reads null, the rest stands.
   */
  fakt1: readonly LeadFakt1ClientRow[] | null
  /**
   * The window's CRM-form fills by day (`LeadSourcesRepository.formFillDays`)
   * — the Bitrix24 count of Meta's form leads on «Targetologlar». Null or
   * absent when the fills do not cover the window (`fillsCover`): the deals
   * are counted, as before 2026-10-15.
   */
  formFills?: readonly FormFillDayRow[] | null
  /** Регистрация deals WON in the window, by source (`LeadSourcesRepository.qualifiedSources`). */
  qualified: readonly QualifiedSourceRow[]
  /** Deals whose «ИИ квал сана» is in the window, any pipeline, flagged Регистрация or not (`LeadSourcesRepository.aiQualifiedStages`). */
  aiQualified: readonly AiQualifiedStageRow[]
  /** «Сарафан маркетинг» deals of every pipeline (`LeadSourcesRepository.sourceCount`) — the «Сарафан» tile. */
  sarafan: PipelineSourceCount
  /** Deals handed out to a ROP in the window (`LeadSourcesRepository.handedOutDays`); absent reads as none. */
  handedOut?: readonly DistributedDayRow[]
  importedAt: Date | null
  /** `LeadSourcesRepository.inboundCallCount`; absent reads as null. */
  inboundCalls?: number | null
  /** The brand switch (`BRAND_FILTERS`); both brands when absent. */
  brand?: BrandFilter
}): LeadSourcesOverviewDto {
  const brand = all.brand ?? 'all'
  const input = brand === 'all' ? all : ofBrand(all, brand)
  const days = calendarDays(input.window.from, input.window.to)
  // «Brendsiz» has no fill to count — every customer form's fill names a brand — so it keeps the deals.
  const fillsBasis = brand !== 'none' && input.formFills !== null && input.formFills !== undefined

  // --- Регистрация: every row into its source, channel and (for a form) its owner
  interface FormAcc {
    key: string
    targetolog: string
    product: MetaProduct
    forms: Set<string>
    accounts: Set<string>
    spend: bigint
    metaLeads: number
    /** Ad-budget money on no lead form — this owner's part of «Bogʻlanmagan sarf». */
    unlinked: bigint
    /** «Ген лид» with no form, filed here by the deal's «Таргетолог» field. */
    formless: number
    /** CRM-form fills of this owner's forms, and the AI targetolog's deals (`isIntegrationForm`). */
    fills: number
    expense: ExpenseAcc
    outcome: OutcomeAcc
    days: Map<string, FormDayAcc>
  }
  interface PageAcc {
    key: string
    name: string
    conversations: number
    outcome: OutcomeAcc
    days: Map<string, { conversations: number; leads: number; success: number }>
  }
  interface SourceAcc {
    key: string
    channel: LeadChannel
    name: string
    outcome: OutcomeAcc
    counted: boolean
  }

  const formDayZero = (): FormDayAcc => ({ spend: 0n, metaLeads: 0, leads: 0, fills: 0, success: 0, ...expenseZero() })
  const owners = new Map<string, FormAcc>()
  const ownerAcc = (o: { key: string; targetolog: string; product: MetaProduct }) =>
    mapGet(owners, o.key, () => ({
      ...o,
      forms: new Set<string>(),
      accounts: new Set<string>(),
      spend: 0n,
      metaLeads: 0,
      unlinked: 0n,
      formless: 0,
      fills: 0,
      expense: expenseZero(),
      outcome: outcomeZero(),
      days: new Map(),
    }))
  const pages = new Map<string, PageAcc>()
  const pageAcc = (key: string, name: string) =>
    mapGet(pages, key, () => ({ key, name, conversations: 0, outcome: outcomeZero(), days: new Map() }))
  // Under one brand, only its pages: a page no brand claims (sinolif_tg, sinogummy) is «Brendsiz».
  for (const p of DM_PAGES) if (brandMatches(brand, pageBrand(p.id))) pageAcc(p.id, p.name)
  const pageKeyOf = (sourceId: string) => DM_PAGE_ALIAS[sourceId] ?? sourceId
  const sources = new Map<string, SourceAcc>()
  const channels = new Map<LeadChannel, OutcomeAcc>(LEAD_CHANNELS.map((c) => [c, outcomeZero()]))
  const tiles = new Map<LeadTile, TileAcc>(LEAD_TILES.map((t) => [t, tileZero()]))
  const registration = outcomeZero()
  // What «Жами лидлар» counts of it, and the «Ген лид» no form names (typed in by hand).
  const counted = outcomeZero()
  const manual = outcomeZero()

  /*
    ИИ обработка FIRST: a page is anything people write to, and the
    Регистрация pass below needs to know which sources those are. The
    `DM_PAGES` are pages whether or not anybody wrote that week; any other
    source that chats becomes one here, after them.
  */
  for (const row of input.triage) {
    const key = row.sourceId === null ? '' : pageKeyOf(row.sourceId)
    const page = pageAcc(key, row.source ?? (row.sourceId ? row.sourceId : 'Manbasiz'))
    page.conversations += row.conversations
    mapGet(page.days, row.day, () => ({ conversations: 0, leads: 0, success: 0 })).conversations += row.conversations
  }

  // Every form named in the window, before the brand switch: a copy's short form name finds its owner's (`formTailOwners`).
  const dealForms = [...all.registration, ...(all.fakt1 ?? [])].map((row) => formNameOf(row.formTitle))
  const named = (forms: readonly (string | null)[]) => new Set(forms.filter((f): f is string => f !== null))
  const tails = formTailOwners(named(dealForms))
  /*
    The fills' own map, with their names in it — never the deals': a form
    seen only among the fills could make a deal's tail ambiguous, and which
    targetolog a DEAL is filed under (its kval, its недозвон) must not move
    with whether the fills were read.
  */
  const fillTails = formTailOwners(named([...dealForms, ...(all.formFills ?? []).map((row) => formNameOf(row.subject))]))
  for (const row of input.registration) {
    const bucket = leadBucket(row.stage, row.status)
    const form = formNameOf(row.formTitle)
    const channel = leadChannel(row.sourceId, form, LEAD_SOURCE_VOCABULARY)
    const one = outcomeZero()
    one[bucket] = row.leads

    addOutcome(registration, one)
    addOutcome(channels.get(channel)!, one)
    const tileKey = leadTile(row.sourceId, LEAD_TILE_SOURCES)
    const inTotal = !LEAD_TILES_APART.has(tileKey)
    if (inTotal) addOutcome(counted, one)
    // A form's lead, or a formless «Ген лид» — whoever the form or the deal's «Таргетолог» names.
    const owner = form !== null || tileKey === 'generated' ? leadOwner(row, tails) : null
    if (tileKey === 'generated' && form === null && owner === null) addOutcome(manual, one)
    addTileLeads(tiles.get(tileKey)!, row)
    const sourceKey = sourceKeyOf(form, row.sourceId)
    const source = mapGet(sources, sourceKey, () => ({
      key: sourceKey,
      channel,
      name: form ?? row.source ?? row.sourceId ?? 'Manbasiz',
      outcome: outcomeZero(),
      counted: inTotal,
    }))
    addOutcome(source.outcome, one)

    if (owner !== null) {
      const acc = ownerAcc(owner)
      if (form !== null) acc.forms.add(form)
      else acc.formless += row.leads
      addOutcome(acc.outcome, one)
      const day = mapGet(acc.days, row.day, formDayZero)
      day.leads += row.leads
      if (bucket === 'success') day.success += row.leads
      // The AI targetolog's leads are deals, never a CRM-form fill: on the fills' side they are these.
      if (form !== null && isIntegrationForm(form)) {
        acc.fills += row.leads
        day.fills += row.leads
      }
    } else if (row.sourceId !== null && (channel === 'page' || pages.has(pageKeyOf(row.sourceId)))) {
      const page = pageAcc(pageKeyOf(row.sourceId), row.source ?? row.sourceId)
      addOutcome(page.outcome, one)
      const day = mapGet(page.days, row.day, () => ({ conversations: 0, leads: 0, success: 0 }))
      day.leads += row.leads
      if (bucket === 'success') day.success += row.leads
    }
  }

  /*
    THE FILLS, AS META COUNTS ITS LEADS (2026-10-15/16, the client: «leadlar
    qanday hisoblanayotgan bo'lsa huddi shunday»). Every CRM-form fill onto
    the row its form's deals are filed on (`leadOwner`'s order: the person the
    form names, the person whose named form it ends, else the form's own
    row). A returning contact's fill counts here though the portal opened no
    deal for it: Meta counted it. The website's form counts too — this
    screen's «Meta lid» counts the «Sayt» campaigns' leads — a vacancy's or
    the cosmetics line's does not (`isCustomerForm`).
  */
  for (const row of fillsBasis ? (input.formFills ?? []) : []) {
    const form = formNameOf(row.subject)
    if (form === null || !isCustomerForm(form)) continue
    const byForm = formOwner(form)
    const person = byForm?.targetolog ?? fillTails.get(form)
    const product = byForm?.product ?? leadBrand(null, row.subject)
    const acc = ownerAcc(
      person !== undefined && product !== null
        ? { key: `${product}|${person}`, targetolog: person, product }
        : { key: `form|${form}`, targetolog: form, product: 'Boshqa' },
    )
    acc.forms.add(form)
    acc.fills += row.fills
    mapGet(acc.days, row.day, formDayZero).fills += row.fills
  }

  /*
    «Факт1 мижоз»: the same source key and channel as the lead's row above, so
    a client lands on the line their lead is counted on. A SET per line — one
    client who left three leads is one client — which is also why a channel's
    figure can be less than the sum of its sources.
  */
  const fakt1Sources = new Map<string, Set<string>>()
  const fakt1Channels = new Map<LeadChannel, Set<string>>(LEAD_CHANNELS.map((c) => [c, new Set<string>()]))
  const fakt1All = new Set<string>()
  const fakt1Owners = new Map<string, Set<string>>()
  const fakt1People = new Map<string, Set<string>>()
  const fakt1Ready = input.fakt1 !== null
  for (const row of input.fakt1 ?? []) {
    const form = formNameOf(row.formTitle)
    const sourceKey = sourceKeyOf(form, row.sourceId)
    mapGet(fakt1Sources, sourceKey, () => new Set<string>()).add(row.client)
    fakt1Channels.get(leadChannel(row.sourceId, form, LEAD_SOURCE_VOCABULARY))!.add(row.client)
    // The whole is «Jami»'s: a client of an «Исход» lead alone is not in it.
    if (countedSource(row.sourceId)) fakt1All.add(row.client)
    // And onto the form's owner, as the lead's row above lands its kval.
    const owner = form !== null || leadTile(row.sourceId, LEAD_TILE_SOURCES) === 'generated' ? leadOwner(row, tails) : null
    if (owner !== null) {
      mapGet(fakt1Owners, owner.key, () => new Set<string>()).add(row.client)
      mapGet(fakt1People, owner.targetolog, () => new Set<string>()).add(row.client)
    }
  }

  /*
    Meta, onto the owner their account maps to: the lead forms are `spend`;
    every other campaign is an expense line beside it. An owner with no form
    and no lead stays out of the lead tables below — `expenseOwners` carries it.
  */
  const unlinked = new Map<string, { name: string; spend: bigint }>()
  for (const row of input.campaigns) {
    const channel = campaignChannel(row.objective, row.campaignName, row.accountId)
    const owner = ownerOf(row.accountId, row.accountName)
    const acc = ownerAcc({ key: `${owner.product}|${owner.targetolog}`, ...owner })
    const day = mapGet(acc.days, row.date, formDayZero)
    addCampaignExpense(acc.expense, row, channel)
    addCampaignExpense(day, row, channel)
    if (channel !== 'form') {
      // Ad-budget money on no lead form: «Bogʻlanmagan sarf», by account.
      if (row.spendMicroUsd > 0n && adBudgetProduct(row) !== null) {
        mapGet(unlinked, row.accountId, () => ({ name: row.accountName, spend: 0n })).spend += row.spendMicroUsd
        // …and on the targetolog the account maps to: «Targetologlar» has no row that is nobody's (2026-10-14).
        acc.unlinked += row.spendMicroUsd
        acc.accounts.add(row.accountName)
      }
      continue
    }
    acc.accounts.add(row.accountName)
    acc.spend += row.spendMicroUsd
    acc.metaLeads += row.leads
    day.spend += row.spendMicroUsd
    day.metaLeads += row.leads
  }

  // --- forms block
  const formDays = days.map(() => formDayZero())
  const formOutcome = outcomeZero()
  let formSpend = 0n
  let metaFormLeads = 0
  let formlessLeads = 0
  let formFills = 0
  /* An owner whose ad money is all DM is a targetolog too: their row carries it in «DM / boshqa» (2026-10-14). */
  const hasLeadWork = (o: FormAcc) =>
    o.spend > 0n || o.metaLeads > 0 || o.unlinked > 0n || o.fills > 0 || LEAD_BUCKETS.some((b) => o.outcome[b] > 0)
  const ownerDto = (o: FormAcc): FormOwnerDto => {
    const outcome = outcomeCells(o.outcome)
    return {
      key: o.key,
      targetolog: o.targetolog,
      product: o.product,
      forms: [...o.forms].sort(),
      accounts: [...o.accounts].sort(),
      spendUsd: usd(o.spend),
      metaLeads: o.metaLeads,
      ...expenseCells(o.spend, o.expense),
      outcome,
      bitrixLeads: fillsBasis ? o.fills : outcome.leads,
      leadsBasis: fillsBasis ? 'fills' : 'deals',
      // Forms only: a lead the field filed here never passed through a Meta form, so it may not hide a broken link.
      reachPercent: fillsBasis ? percent(o.fills, o.metaLeads) : percent(outcome.leads - o.formless, o.metaLeads),
      costPerLeadUsd: perUnit(o.spend, fillsBasis ? o.fills : outcome.leads),
      costPerSuccessUsd: perUnit(o.spend, outcome.success),
      unlinkedUsd: usd(o.unlinked),
      formlessLeads: o.formless,
      fakt1Clients: fakt1Ready ? (fakt1Owners.get(o.key)?.size ?? 0) : null,
      days: days.map((date) => formDayCells(date, o.days.get(date) ?? formDayZero(), fillsBasis)),
    }
  }
  const formOwners: FormOwnerDto[] = [...owners.values()]
    .filter(hasLeadWork)
    .sort(
      (a, b) =>
        PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product) ||
        outcomeCells(b.outcome).leads - outcomeCells(a.outcome).leads ||
        b.metaLeads - a.metaLeads ||
        a.targetolog.localeCompare(b.targetolog, 'ru'),
    )
    .map((o) => {
      addOutcome(formOutcome, o.outcome)
      formSpend += o.spend
      metaFormLeads += o.metaLeads
      formlessLeads += o.formless
      formFills += o.fills
      days.forEach((date, i) => {
        const cell = o.days.get(date)
        if (!cell) return
        formDays[i]!.spend += cell.spend
        formDays[i]!.metaLeads += cell.metaLeads
        formDays[i]!.leads += cell.leads
        formDays[i]!.fills += cell.fills
        formDays[i]!.success += cell.success
        addExpense(formDays[i]!, cell)
      })
      return ownerDto(o)
    })

  /*
    An owner whose money is ALL hiring, or a «Boshqa» account's other
    campaigns — HR Eldor's account — has no form, no lead and no ad budget, so
    it is no row of the lead tables above and stays out of their totals. (A
    targetolog running only SMS is a row since 2026-10-14: his DM money is his
    «DM / boshqa sarf».) «Targetologlar · kunlik» still owes it a card
    (2026-10-07: its «Jami $» promises every dollar the accounts spent), so it
    rides apart.
  */
  const expenseOwners: FormOwnerDto[] = [...owners.values()]
    .filter((o) => !hasLeadWork(o) && o.expense.sms + o.expense.hr + o.expense.other > 0n)
    .sort(
      (a, b) =>
        PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product) ||
        a.targetolog.localeCompare(b.targetolog, 'ru'),
    )
    .map(ownerDto)

  // --- DM block: `DM_PAGES` in the portal's order, then any other page that chats
  const productOf = (key: string): TargetProduct | null => LEAD_SOURCE_BRAND[key] ?? null
  const dmRank = (key: string) => {
    const i = DM_PAGES.findIndex((p) => p.id === key)
    return i < 0 ? DM_PAGES.length : i
  }
  const dmDays = days.map((date) => ({ date, conversations: 0, leads: 0, success: 0 }))
  const dmOutcome = outcomeZero()
  let dmConversations = 0
  const dmPages: DmPageDto[] = [...pages.values()]
    .sort(
      (a, b) =>
        dmRank(a.key) - dmRank(b.key) ||
        b.conversations - a.conversations ||
        outcomeCells(b.outcome).leads - outcomeCells(a.outcome).leads ||
        a.name.localeCompare(b.name, 'ru'),
    )
    .map((p) => {
      const outcome = outcomeCells(p.outcome)
      addOutcome(dmOutcome, p.outcome)
      dmConversations += p.conversations
      return {
        key: p.key,
        name: p.name,
        product: productOf(p.key),
        conversations: p.conversations,
        outcome,
        days: days.map((date, i) => {
          const cell = p.days.get(date) ?? { conversations: 0, leads: 0, success: 0 }
          dmDays[i]!.conversations += cell.conversations
          dmDays[i]!.leads += cell.leads
          dmDays[i]!.success += cell.success
          return { date, ...cell }
        }),
      }
    })

  // «Yetib keldi» is the forms': the leads the deal's «Таргетолог» field filed on an owner are out of it.
  const formLeads = fillsBasis ? formFills : outcomeCells(formOutcome).leads - formlessLeads

  /*
    «ИИ квал сана» in the window, any creation day, on the client's nine
    sources — «Сммщик ии»'s card, their portal filter: what is in
    Регистрация, by account, and apart what has already moved on to
    Первичный отдел or Доставка.
  */
  const ai = tileZero()
  const smmAccounts = new Map<string, TileAcc>()
  let aiElsewhere = 0
  for (const row of input.aiQualified) {
    if (row.sourceId === null || !AI_CARD_SOURCE_IDS.has(row.sourceId)) continue
    if (!row.registration) {
      aiElsewhere += row.leads
      continue
    }
    addTileLeads(ai, row)
    addTileLeads(mapGet(smmAccounts, row.sourceId, tileZero), row)
  }

  // Kval by the day it was WON, onto the tile its lead counts on — each tile's quiet second line.
  for (const row of input.qualified) tiles.get(leadTile(row.sourceId, LEAD_TILE_SOURCES))!.closed += row.qualified
  // Deals of every pipeline, not Регистрация leads alone: no duplicate stage or cohort read there, and outside «Jami» below.
  const sarafanTile = tiles.get('sarafan')!
  sarafanTile.leads = input.sarafan.leads
  sarafanTile.qualified = input.sarafan.qualified
  sarafanTile.closed = input.sarafan.qualified

  /*
    «ГЕН ЛИД» IS THE FILLS, READ FROM BITRIX24 (2026-10-16, the client:
    «bitrix24dan ol facebookdan emas»). The portal records every CRM-form
    fill, but opens a Регистрация deal for only some — a returning contact's
    fill lands on the old deal — so the deals read ~2 500 short over 01–16.10
    of what came in. The tile is the «Targetologlar» table's «Jami» «Bitrix24
    lid»: every fill, the AI targetolog's deals (no CRM form behind them) and
    the «Ген лид» typed in by hand. A formless deal the «Таргетолог» field
    files on a person is left out: most are retitled form leads whose fill is
    counted already. Every form deal of 01–16.10 sat on «Ген лид»'s source
    (14 179 of 14 179, portal), so no other tile counts a fill twice.
    Under «Brendsiz», where no customer form's fill lands (`fillsBasis` off),
    the row is therefore the hand-typed «Ген лид» alone — those owners' deals
    are their fills under Collagen / Zextra, and counting them here too broke
    Collagen + Zextra + Brendsiz = «Hammasi». Duplicates are capped at the
    fills, which may trail the deals by `FILLS_STALE_MS`.
  */
  const generatedTile = tiles.get('generated')!
  const tileFills = input.formFills !== null && input.formFills !== undefined
  const generatedDeals = generatedTile.leads
  if (tileFills) {
    generatedTile.leads = formFills + outcomeCells(manual).leads
    generatedTile.duplicates = Math.min(generatedTile.duplicates, generatedTile.leads)
  }

  const tilesTotal = tileZero()
  for (const [tile, t] of tiles) {
    if (LEAD_TILES_APART.has(tile) || LEAD_TILES_OUTSIDE_REGISTRATION.has(tile)) continue
    tilesTotal.leads += t.leads
    tilesTotal.duplicates += t.duplicates
    tilesTotal.qualified += t.qualified
    tilesTotal.closed += t.closed
  }
  const jami = tileCells(tilesTotal)
  // The AI's card reads no close day: `closedQualified` is left off, never a 0 that reads as measured.
  const { closedQualified: _unread, ...aiCells } = tileCells(ai)

  /*
    «Targetologlar»'s «Jami» and the headline's kval price, ONE figure (the
    client, 2026-10-09): the ad budget — the forms' spend and what no form
    took — over the kval of every «Ген лид», a form's or typed by hand. It
    was the whole budget over every channel's kval by close day (886.49 $ ÷
    226), the free channels' kval making a paid one look cheap.
  */
  let unlinkedSpend = 0n
  for (const account of unlinked.values()) unlinkedSpend += account.spend
  const totalSpend = formSpend + unlinkedSpend
  const totalOutcome = outcomeZero()
  addOutcome(totalOutcome, formOutcome)
  addOutcome(totalOutcome, manual)
  const totalCells = outcomeCells(totalOutcome)
  // «Jami»'s Bitrix24 leads: on the fills' basis the owners' fills and the hand-typed «Ген лид».
  const totalLeads = fillsBasis ? formFills + outcomeCells(manual).leads : totalCells.leads
  /* No spend read (Meta not imported yet, or down that day) is «unknown», never a free kval. */
  const costPerSuccessUsd = totalSpend > 0n ? perUnit(totalSpend, totalCells.success) : null

  return {
    brand,
    importedAt: input.importedAt?.toISOString() ?? null,
    inboundCalls: input.inboundCalls ?? null,
    funnel: {
      total: jami.leads,
      fresh: jami.fresh,
      duplicates: tilesTotal.duplicates,
      qualified: jami.qualified,
      qualifiedPercent: jami.qualifiedPercent,
      closedQualified: jami.closedQualified,
      handedOut: (input.handedOut ?? []).reduce((n, row) => n + row.leads, 0),
      spendUsd: usd(totalSpend),
      generatedQualified: totalCells.success,
      costPerQualifiedUsd: costPerSuccessUsd,
    },
    totals: {
      registration: outcomeCells(registration),
      counted: outcomeCells(counted),
      fakt1Clients: fakt1Ready ? fakt1All.size : null,
      formReachPercent: percent(formLeads, metaFormLeads),
    },
    forms: {
      owners: formOwners,
      expenseOwners,
      days: formDays.map((cell, i) => formDayCells(days[i]!, cell, fillsBasis)),
      spendUsd: usd(formSpend),
      metaLeads: metaFormLeads,
      outcome: outcomeCells(formOutcome),
      bitrixLeads: totalLeads,
      leadsBasis: fillsBasis ? 'fills' : 'deals',
      manual: outcomeCells(manual),
      fakt1Targetologs: fakt1Ready
        ? [...fakt1People]
            .map(([targetolog, clients]) => ({ targetolog, clients: clients.size }))
            .sort((a, b) => a.targetolog.localeCompare(b.targetolog, 'ru'))
        : null,
      unlinked: {
        spendUsd: usd(unlinkedSpend),
        accounts: [...unlinked.values()]
          .sort((a, b) => (a.spend === b.spend ? a.name.localeCompare(b.name, 'ru') : a.spend > b.spend ? -1 : 1))
          .map((a) => ({ name: a.name, spendUsd: usd(a.spend) })),
      },
      total: {
        spendUsd: usd(totalSpend),
        outcome: totalCells,
        costPerLeadUsd: totalSpend > 0n ? perUnit(totalSpend, totalLeads) : null,
        costPerSuccessUsd,
      },
    },
    dm: { pages: dmPages, days: dmDays, conversations: dmConversations, outcome: outcomeCells(dmOutcome) },
    channels: LEAD_CHANNELS.map((channel) => ({
      channel,
      outcome: outcomeCells(channels.get(channel)!),
      fakt1Clients: fakt1Ready ? fakt1Channels.get(channel)!.size : null,
    })),
    tiles: {
      rows: LEAD_TILES.map((tile) => ({ tile, ...tileCells(tiles.get(tile)!) })),
      total: jami,
      ai: aiCells,
      smmAccounts: [...smmAccounts]
        .map(([key, t]) => ({ key, name: SMM_ACCOUNTS.find((a) => a.id === key)?.name ?? key, ...tileCells(t) }))
        .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name, 'ru')),
      aiElsewhere,
      generatedBasis: tileFills ? 'fills' : 'deals',
      generatedDeals,
      /*
        Not in the DTO: a tab opened before the 2026-10-09 deploy still reads
        `toHeadline` on its next poll and would throw without it, and one from
        before 2026-10-15 `aiQualified`. Delete once those tabs are gone.
      */
      ...{ toHeadline: { outbound: 0, other: 0, ai: 0 }, aiQualified: ai.leads },
    },
    sources: [...sources.values()]
      .map((s) => ({
        key: s.key,
        channel: s.channel,
        name: s.name,
        outcome: outcomeCells(s.outcome),
        fakt1Clients: fakt1Ready ? (fakt1Sources.get(s.key)?.size ?? 0) : null,
        counted: s.counted,
      }))
      .sort(
        (a, b) =>
          LEAD_CHANNELS.indexOf(a.channel) - LEAD_CHANNELS.indexOf(b.channel) ||
          b.outcome.leads - a.outcome.leads ||
          a.name.localeCompare(b.name, 'ru'),
      ),
  }
}

/*
  THE MEMOS LIVE ON `globalThis`, ONE PER PROCESS (2026-10-06 audit).
  `src/instrumentation.ts` and the route handlers are separate bundles in one
  process, each with its own copy of this module: as module variables, the
  warmer's builds filled memos no route read, and «Lidlar» stayed cold for
  its readers all the same. The warmers' first-build flag in `rnpWarmer.ts`
  is held this way for the same reason; `Symbol.for` hands both copies the
  one key, `sinolife.leads.<memo>`. Under `next dev` a reloaded module finds
  them too, so a TTL edited there needs a server restart.
*/
function processWide<T>(key: string, make: () => T): T {
  const g = globalThis as Record<symbol, unknown>
  return (g[Symbol.for(key)] ??= make()) as T
}

/*
  The Регистрация scan alone: «Targetologlar · kunlik» needs nothing else,
  and must not wait on the other scans — the FAKT 1 phone match can run into
  the 20 s statement timeout on a month (prod 2026-10-06), and one failed scan
  took the whole sheet down with it.

  BESIDE THE SCAN MEMO, NEVER INSIDE IT (2026-10-06 audit). The overview read
  it from within `scanCache`'s build, and the two memos expire together: a
  rebuild of the scans took this memo's stale rows (rebuilding them behind)
  and stored them with fresh kval. So «Жами лидлар» trailed «Квал лидлар
  сони» by a rebuild for good, and «Targetologlar · kunlik», which reads this
  memo directly, showed more form leads than «Lidlar» for the same window.
*/
const registrationCache = processWide('sinolife.leads.registrationCache', () =>
  ttlCache<RegistrationDayRow[]>(120_000, LIVE_CACHE),
)

/*
  «Факт1 мижоз» on its own memo, a reader never waits past `FAKT1_WAIT_MS`: the
  phone match is the heaviest scan of the tab (prod 2026-10-05: mean 4.4 s,
  max 19.4 s on a month, against a 20 s statement timeout). A reader who
  arrives first gets the tab without it; the query keeps running and fills
  the memo for the next poll. A failure is evicted, so the next one retries.
*/
const fakt1Cache = processWide('sinolife.leads.fakt1Cache', () => ttlCache<LeadFakt1ClientRow[]>(120_000, LIVE_CACHE))
const FAKT1_WAIT_MS = 8_000
/** Still waited for when the other scans alone took past `FAKT1_WAIT_MS`. */
const FAKT1_GRACE_MS = 1_000

/** `promise`'s answer if it lands within `ms`, else null — a failure is null too (logged where it is built). */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  const answer = promise.catch(() => null)
  try {
    return await Promise.race([answer, late])
  } finally {
    clearTimeout(timer)
  }
}

/*
  One memo per window in front of the other deal scans. Company-wide by
  construction — both routes that read these memos (`/leads/overview`,
  `/reklama/targetologs`) refuse a narrowed account — so no scope reaches them.
*/
interface WindowScans {
  triage: TriageDayRow[]
  qualified: QualifiedSourceRow[]
  aiQualified: AiQualifiedStageRow[]
  sarafan: PipelineSourceCount
  inboundCalls: number | null
  handedOut: DistributedDayRow[]
}
const scanCache = processWide('sinolife.leads.scanCache', () => ttlCache<WindowScans>(120_000, LIVE_CACHE))
/** The window's CRM-form fills, or null when they do not cover it — one index range, kept as long as the deals. */
const fillCache = processWide('sinolife.leads.fillCache', () => ttlCache<FormFillDayRow[] | null>(120_000, LIVE_CACHE))

/*
  KEPT WARM (2026-10-06, «Lidlar juda sekin ochilayapti»). The memos above
  hand out an answer up to seven minutes old at once, but a window nobody
  read for longer — the first look of the morning, after a quiet spell, after
  every deploy — was built in front of its reader: six scans, the FAKT 1
  phone match alone 4.4 s on average on a month. `warm` builds the windows
  the tab opens on («Bugun», the dashboard default, and «Shu oy») every
  `LEADS_WARM_EVERY_MS` from `src/instrumentation.ts`, into `overview`'s own
  memo keys with its own scans, so a reader is handed exactly what they would
  have waited for. Working hours only: at night nobody reads them.

  EACH REBUILD WAITED FOR, ONE AT A TIME (2026-10-06 audit). `warm` went
  through `overview`, whose memos past their TTL hand out the old answer and
  rebuild behind it: from the second tick on it returned in milliseconds,
  moved straight on to «Shu oy», and both windows' scans — 14–16 statements,
  the FAKT 1 phone match twice — met on an 8-connection pool every three
  minutes, while «leads warmed» timed nothing and never heard of a failure.
  Now each memo is `refresh`ed in turn — Регистрация and the scans window by
  window, then every window's «Факт1 мижоз» (see `warm`) — and the scans go
  `LEADS_WARM_SCANS_AT_ONCE` at a time, as `RnpService.monthRows` does:
  behind no reader, a few seconds longer cost nobody anything. A reader's
  cold miss still runs them all at once. The Meta reads are not memoised,
  so there is nothing of them to warm.

  THE PRICE, ONCE PER DEPLOY (2026-10-06 review). A new server's first tick
  builds every memo cold this way, after RNP's first build (38.7 s on
  production) and with FAKT 1 waited out in full, so it can outlast
  `/api/health`'s `WARMING_GRACE_S` (75 s from start): the platform then
  hands the new server its readers while «Lidlar» is still building, and a
  reader shares a build in flight as the warmer shares a reader's. Accepted:
  the grace only bounds how long a deploy waits, and the pacing is what
  leaves the pool to the readers on every tick after.
*/
export const LEADS_WARM_EVERY_MS = 3 * 60_000
const LEADS_WARM_PRESETS: readonly PeriodPreset[] = ['today', 'this_month']
const LEADS_WARM_SCANS_AT_ONCE = 2

type Answers<T extends readonly (() => Promise<unknown>)[]> = {
  -readonly [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never
}

/**
 * `tasks` at most `width` at a time — the next starts as one settles — with
 * their answers in order. A failure starts nothing further and rejects.
 */
async function atMost<const T extends readonly (() => Promise<unknown>)[]>(width: number, tasks: T): Promise<Answers<T>> {
  const answers: unknown[] = []
  let next = 0
  let failed = false
  const lane = async (): Promise<void> => {
    while (next < tasks.length && !failed) {
      const i = next++
      try {
        answers[i] = await tasks[i]!()
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, lane))
  return answers as unknown as Answers<T>
}

/**
 * Регистрация leads the portal filed under Telegram, per brand per day, with
 * their kval — the «Bitrix лид» and «кв лид» of the «Telegram» card, narrowed
 * by the brand switch as `ofBrand` narrows a lead. The Telegram sources name
 * no brand themselves and carry no form, so the brand is the deal's «Проект»
 * alone: a Telegram lead with none is «Brendsiz» — on «Lidlar»'s Telegram
 * tile, on neither card (the cards are a brand's, and the hint says so).
 */
export function telegramLeads(registration: readonly RegistrationDayRow[], brand: BrandFilter = 'all'): ChannelLeads {
  const out = new Map<TargetProduct, Map<string, ChannelLeadsDay>>()
  if (brand === 'none') return out
  for (const row of registration) {
    const form = formNameOf(row.formTitle)
    if (leadChannel(row.sourceId, form, LEAD_SOURCE_VOCABULARY) !== 'telegram') continue
    const product = leadBrand(row.sourceId, row.formTitle, row.productLine)
    if (product === null || !brandMatches(brand, product)) continue
    const days = mapGet(out, product, () => new Map<string, ChannelLeadsDay>())
    const was = days.get(row.day) ?? { leads: 0, success: 0 }
    const success = leadBucket(row.stage, row.status) === 'success' ? row.leads : 0
    days.set(row.day, { leads: was.leads + row.leads, success: was.success + success })
  }
  return out
}

export class LeadSourcesService {
  constructor(
    private readonly repository: LeadSourcesRepository,
    private readonly meta: ReklamaRepository,
    private readonly insights: InsightsRepository,
  ) {}

  async overview(period: Period, timeZone: string, brand: BrandFilter = 'all'): Promise<LeadSourcesOverviewDto> {
    const window = periodWindow(period, timeZone)
    const key = windowKey(period)

    // Started first, raced last: the budget counts from the start, never cutting it short of the other scans.
    const started = Date.now()
    const fakt1Scan = this.fakt1Scan(period)
    const [registration, formFills, scans, campaigns, importedAt] = await Promise.all([
      this.registrationDays(period),
      this.formFills(period),
      scanCache.get(key, () => this.scans(period)),
      this.meta.campaignDays(window.from, window.to),
      this.meta.campaignsImportedAt(),
    ])

    const fakt1 = await within(fakt1Scan, Math.max(FAKT1_GRACE_MS, FAKT1_WAIT_MS - (Date.now() - started)))

    // Narrowed after the memo: one scan serves both brands and the whole.
    return leadSourcesOverview({ window, registration, formFills, ...scans, fakt1, campaigns, importedAt, brand })
  }

  /** Builds the windows the tab opens on into the memos, one after another — see `LEADS_WARM_EVERY_MS`. */
  async warm(now: Date, timeZone: string): Promise<WarmOutcome> {
    if (!withinHours(now, timeZone, WARM_HOURS)) return OFF_HOURS
    // One at a time: two cold months side by side would take the pool from every other screen.
    const windows = LEADS_WARM_PRESETS.map((preset) => resolvePeriod(preset, { timeZone, now }))
    for (const period of windows) {
      await registrationCache.refresh(windowKey(period), () => this.repository.registrationDays(period))
      await scanCache.refresh(windowKey(period), () => this.scans(period, LEADS_WARM_SCANS_AT_ONCE))
    }
    /*
      «Факт1 мижоз» LAST, AND ITS FAILURE STOPS NOTHING (2026-10-06 review).
      The tab answers without it (`fakt1Cache`), yet built in turn with each
      window's other memos, a phone match timing out on «Bugun» left «Shu oy»
      cold for the tick — which `overview`, waiting no longer than
      `FAKT1_WAIT_MS`, never did. Every window's is tried, and the first
      failure is thrown after, for the warmer to log. A failure above still
      ends the tick: those memos are the tab itself, and when «Bugun»'s fail
      the month's heavier scans would only add to the strain — the next tick
      tries again.
    */
    let failure: { error: unknown } | undefined
    for (const period of windows) {
      try {
        await fakt1Cache.refresh(windowKey(period), () => this.insights.leadFakt1Clients(period))
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure) throw failure.error
  }

  /**
   * The `forms` block alone — «Targetologlar · kunlik». It reads only the
   * Регистрация deals and the Meta campaigns, so the other scans are not run:
   * the block is the overview's to the lead (same rows, same fold, the same
   * brand narrowing — `ofBrand`). With `fakt1`, «Факт1 мижоз» is read too
   * («Target tahlili»'s cards), waited for as `overview` waits; without it the
   * owners' `fakt1Clients` are null — unread, never 0.
   */
  async targetologForms(
    period: Period,
    timeZone: string,
    brand: BrandFilter = 'all',
    options: { readonly fakt1?: boolean } = {},
  ): Promise<
    Pick<LeadSourcesOverviewDto, 'forms' | 'importedAt'> & {
      readonly manual: readonly ManualSpendDto[]
      /** «HR · Kosmetika», the strip's last card — the hiring and Kosmetika money, narrowed as the cards' money is. */
      readonly side: readonly SideColumnDto[]
    }
  > {
    const window = periodWindow(period, timeZone)
    const started = Date.now()
    const fakt1Scan = options.fakt1 ? this.fakt1Scan(period) : null
    const [registration, formFills, campaigns, importedAt, typed] = await Promise.all([
      this.registrationDays(period),
      this.formFills(period),
      this.meta.campaignDays(window.from, window.to),
      this.meta.campaignsImportedAt(),
      this.meta.manualSpend(window.from, window.to),
    ])
    const fakt1 =
      fakt1Scan === null ? null : await within(fakt1Scan, Math.max(FAKT1_GRACE_MS, FAKT1_WAIT_MS - (Date.now() - started)))
    const { forms, importedAt: imported } = leadSourcesOverview({
      window,
      registration,
      formFills,
      triage: [],
      campaigns,
      fakt1,
      qualified: [],
      aiQualified: [],
      sarafan: { leads: 0, qualified: 0 },
      importedAt,
      brand,
    })
    /*
      The sheet's «Telegram» block beside the targetologs' cards: the dollars
      typed by hand (no Meta row behind them), the leads the portal filed
      under Telegram (`leadChannel` = telegram — the bot, the open line, the
      brand's own channel), each on the brand its form's name, «Проект» or source
      names, as «Lidlar» files every lead. Read from the SAME rows the cards
      above are built from, so the two agree to the lead.
    */
    const telegram = telegramLeads(registration, brand)
    const days = calendarDays(window.from, window.to)
    // The side table's money narrowed as `ofBrand` narrows Meta money: hiring is no brand's, so one brand has none.
    const side = sideColumnsOf(brand === 'all' ? campaigns : campaigns.filter((row) => brandMatches(brand, adBudgetProduct(row))), days)
    return { forms, importedAt: imported, manual: manualSpendBlocks(days, typed, brand, { telegram }), side }
  }

  /** Save the hand-typed ad money of «Targetologlar · kunlik» (`POST /reklama/manual-spend`). */
  saveManualSpend: ReklamaRepository['saveManualSpend'] = async (cells, by) => {
    await this.meta.saveManualSpend(cells, by)
  }

  /** «Факт1 мижоз»'s phone match through its memo; a failure is logged and evicted, so the next reader retries. */
  private fakt1Scan(period: Period): Promise<LeadFakt1ClientRow[]> {
    return fakt1Cache.get(windowKey(period), () =>
      this.insights.leadFakt1Clients(period).catch((error: unknown) => {
        void import('@/server/logging/logger').then(({ logger }) =>
          logger.warn({ err: error }, '«Факт1 мижоз» scan failed; Lidlar shows the tab without it'),
        )
        throw error
      }),
    )
  }

  /**
   * The window's fills when they cover it (`fillsCover`), else null — the
   * deals are counted then. A failed read is null too, logged: the fills are
   * one column of the tab, never a reason to take it down.
   */
  private formFills(period: Period): Promise<FormFillDayRow[] | null> {
    return fillCache.get(windowKey(period), async () => {
      try {
        const [coverage, rows] = await Promise.all([this.repository.formFillCoverage(), this.repository.formFillDays(period)])
        return fillsCover(coverage, period, new Date()) ? rows : null
      } catch (error) {
        void import('@/server/logging/logger').then(({ logger }) =>
          logger.warn({ err: error }, 'CRM-form fills read failed; «Targetologlar» counts the form deals'),
        )
        return null
      }
    })
  }

  private registrationDays(period: Period): Promise<RegistrationDayRow[]> {
    return registrationCache.get(windowKey(period), () => this.repository.registrationDays(period))
  }

  /** `scanCache`'s build: its six reads, at most `width` at a time — all at once for a reader. */
  private async scans(period: Period, width = Infinity): Promise<WindowScans> {
    const [triage, qualified, aiQualified, sarafan, inboundCalls, handedOut] = await atMost(width, [
      () => this.repository.triageDays(period),
      () => this.repository.qualifiedSources(period),
      () => this.repository.aiQualifiedStages(period),
      () => this.repository.sourceCount(period, [...LEAD_SOURCE_VOCABULARY.sarafan]),
      () => this.repository.inboundCallCount(period),
      () => this.repository.handedOutDays(period),
    ])
    return { triage, qualified, aiQualified, sarafan, inboundCalls, handedOut }
  }
}

function windowKey(period: Period): string {
  return [period.preset, period.start.toISOString(), periodLengthInDays(period)].join('|')
}

function periodWindow(period: Period, timeZone: string): { from: string; to: string } {
  return {
    from: zonedDateKey(period.start, timeZone),
    to: zonedDateKey(new Date(period.end.getTime() - 1), timeZone),
  }
}
