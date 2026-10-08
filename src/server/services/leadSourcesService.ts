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
  SARAFAN_PIPELINE_ID,
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
  leadChannel,
  leadTile,
} from '@/server/domain/leads/leadSources'
import { isLeadDuplicate, LEAD_BUCKETS, type LeadBucket, leadBucket } from '@/server/domain/reklama/leadQuality'
import { type ChannelLeads, type ChannelLeadsDay, type ManualSpendDto, manualSpendBlocks } from '@/server/domain/reklama/manualSpend'
import { type Period, type PeriodPreset, periodLengthInDays, resolvePeriod, zonedDateKey } from '@/server/domain/period/period'
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

import { calendarDays } from './reklamaService'
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
  /** The Meta accounts whose lead-form campaigns ran in the window. */
  readonly accounts: readonly string[]
  readonly spendUsd: number
  readonly metaLeads: number
  readonly outcome: LeadOutcomeDto
  /** Регистрация leads ÷ Meta leads — how much of what Meta counted arrived. */
  readonly reachPercent: number | null
  /** spend ÷ Регистрация leads — the lead the business actually got. */
  readonly costPerLeadUsd: number | null
  /** spend ÷ kval. */
  readonly costPerSuccessUsd: number | null
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
}

/**
 * One channel tile, read as the headline tiles read Регистрация: leads by the
 * day they arrived, kval by the day it was WON — so the tiles' «Jami» is
 * «Жами лидлар» and «Квал лидлар сони» to the lead.
 */
export interface ChannelTileDto {
  /** Created in the window, duplicates included. */
  readonly leads: number
  /** `leads` less the duplicates. */
  readonly fresh: number
  /** WON in the window, whenever it arrived. */
  readonly qualified: number
  /** qualified ÷ fresh — «Квал %» of the headline. */
  readonly qualifiedPercent: number | null
}

export interface LeadSourcesOverviewDto {
  /**
   * The Collagen / Zextra switch the figures were narrowed by. Under one
   * brand «Сарафан» (Ecommerce deals, no brand on them) and the inbound
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
   * The RNP sheet's «Регистрация» block on the same day reads the same
   * figures: leads by creation day, kval by the day it was WON, the ad
   * budget as its «Жами бюджет».
   */
  readonly funnel: {
    /** Every Регистрация deal created in the window, duplicates included. */
    readonly total: number
    /** `total` less the duplicates. */
    readonly fresh: number
    /** Created in the window and standing in «Дубликат (лид)» now (not the red «Дубликат»). */
    readonly duplicates: number
    /** Регистрация deals WON («Сделка успешна») in the window, by `closedAt`. */
    readonly qualified: number
    /**
     * `qualified` ÷ `fresh`, the sheet's «% квал лид»; null with no new leads.
     * Two clocks, as on the sheet (WON day over arrival day), so a short
     * window can read above 100%.
     */
    readonly qualifiedPercent: number | null
    /** Meta spend of Collagen + Zextra, hiring campaigns left out (`adBudgetProduct`). */
    readonly spendUsd: number
    readonly costPerQualifiedUsd: number | null
  }
  readonly totals: {
    /** Every Регистрация deal created in the window. */
    readonly registration: LeadOutcomeDto
    /** «Факт1 мижоз» of the whole of Регистрация — distinct, so not the sum of the channels; null while not ready. */
    readonly fakt1Clients: number | null
    readonly formReachPercent: number | null
  }
  readonly forms: {
    readonly owners: readonly FormOwnerDto[]
    /** Owners with no form and no lead but other Meta money (SMS, hiring, other) — in none of the totals here. */
    readonly expenseOwners: readonly FormOwnerDto[]
    readonly days: readonly FormDayDto[]
    readonly spendUsd: number
    readonly metaLeads: number
    readonly outcome: LeadOutcomeDto
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
   * Ecommerce deals since 2026-10-05), so `funnel` less «Исход» and «Boshqa».
   */
  readonly tiles: {
    readonly rows: readonly ({ readonly tile: LeadTile } & ChannelTileDto)[]
    readonly total: ChannelTileDto
    /**
     * What takes `total.leads` to `funnel.total` (the client, 2026-10-02:
     * «Jami» must visibly meet «Жами лидлар»). An identity, not a remainder:
     * total.leads + outbound + other + ai = funnel.total, always.
     *   outbound, other — the two tiles kept out of «Jami».
     *   ai — Регистрация leads of the window carrying the AI mark, less
     *        «Сммщик ии» (the «ИИ квал сана» filter on Регистрация, any
     *        creation day): 01.10 read 60 − 72 = −12.
     */
    readonly toHeadline: { readonly outbound: number; readonly other: number; readonly ai: number }
    /**
     * Deals the AI qualified in the window that sit outside Регистрация now
     * (Первичный отдел, Доставка, …) — the client, 2026-10-03: shown under
     * «Сммщик ии» as duplicates, counted in no tile and not in «Jami».
     */
    readonly aiElsewhere: number
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
  success: number
}

const formDayCells = (date: string, a: FormDayAcc): FormDayDto => ({
  date,
  spendUsd: usd(a.spend),
  metaLeads: a.metaLeads,
  leads: a.leads,
  success: a.success,
  ...expenseCells(a.spend, a),
})

interface TileAcc {
  leads: number
  duplicates: number
  qualified: number
}

const tileZero = (): TileAcc => ({ leads: 0, duplicates: 0, qualified: 0 })

function tileCells(a: TileAcc): ChannelTileDto {
  const fresh = a.leads - a.duplicates
  return { leads: a.leads, fresh, qualified: a.qualified, qualifiedPercent: percent(a.qualified, fresh) }
}

const PRODUCT_ORDER: readonly MetaProduct[] = ['Collagen', 'Zextra', 'Boshqa']

const mapGet = <K, V>(map: Map<K, V>, key: K, make: () => V): V => {
  const found = map.get(key)
  if (found !== undefined) return found
  const made = make()
  map.set(key, made)
  return made
}

/** A form with no targetolog in its name still gets a row — by its own name. */
function ownerOfForm(form: string): { key: string; targetolog: string; product: MetaProduct } {
  const owner = formOwner(form)
  return owner
    ? { key: `${owner.product}|${owner.targetolog}`, targetolog: owner.targetolog, product: owner.product }
    : { key: `form|${form}`, targetolog: form, product: 'Boshqa' }
}

/** The line a lead is counted on — a form by its name, anything else by its source. */
const sourceKeyOf = (form: string | null, sourceId: string | null): string =>
  form !== null ? `form|${form}` : `source|${sourceId ?? ''}`

/** What a page's chats and leads sell — the page's own brand, the second bot folded into its page. */
const pageBrand = (sourceId: string | null): TargetProduct | null =>
  sourceId === null ? null : (LEAD_SOURCE_BRAND[DM_PAGE_ALIAS[sourceId] ?? sourceId] ?? LEAD_SOURCE_BRAND[sourceId] ?? null)

type LeadSourcesInput = Parameters<typeof leadSourcesOverview>[0]

/**
 * The tab's inputs narrowed to one brand — RNP's rules, so the switch agrees
 * with RNP's «Коллаген / Зехтра проект»: a lead (and its kval, its FAKT 1
 * client, the AI's mark) by `leadBrand` — its «Проект», then its source, then its form; a chat
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
    qualified: input.qualified.filter(lead),
    aiQualified: input.aiQualified.filter(lead),
    sarafan: brandless ? input.sarafan : { leads: 0, qualified: 0 },
    inboundCalls: brandless ? input.inboundCalls : null,
  }
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
  /** Регистрация deals WON in the window, by source (`LeadSourcesRepository.qualifiedSources`). */
  qualified: readonly QualifiedSourceRow[]
  /** Deals whose «ИИ квал сана» is in the window, any pipeline, flagged Регистрация or not (`LeadSourcesRepository.aiQualifiedStages`). */
  aiQualified: readonly AiQualifiedStageRow[]
  /** «Сарафан маркетинг» deals in Ecommerce (`LeadSourcesRepository.pipelineSourceCount`) — the «Сарафан» tile. */
  sarafan: PipelineSourceCount
  importedAt: Date | null
  /** `LeadSourcesRepository.inboundCallCount`; absent reads as null. */
  inboundCalls?: number | null
  /** The brand switch (`BRAND_FILTERS`); both brands when absent. */
  brand?: BrandFilter
}): LeadSourcesOverviewDto {
  const brand = all.brand ?? 'all'
  const input = brand === 'all' ? all : ofBrand(all, brand)
  const days = calendarDays(input.window.from, input.window.to)

  // --- Регистрация: every row into its source, channel and (for a form) its owner
  interface FormAcc {
    key: string
    targetolog: string
    product: MetaProduct
    forms: Set<string>
    accounts: Set<string>
    spend: bigint
    metaLeads: number
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
  }

  const formDayZero = (): FormDayAcc => ({ spend: 0n, metaLeads: 0, leads: 0, success: 0, ...expenseZero() })
  const owners = new Map<string, FormAcc>()
  const ownerAcc = (o: { key: string; targetolog: string; product: MetaProduct }) =>
    mapGet(owners, o.key, () => ({
      ...o,
      forms: new Set<string>(),
      accounts: new Set<string>(),
      spend: 0n,
      metaLeads: 0,
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
  let leadDuplicates = 0
  // Регистрация leads carrying the AI mark — what «Сммщик ии» held before it read the AI's date.
  let aiArrived = 0

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

  for (const row of input.registration) {
    const bucket = leadBucket(row.stage, row.status)
    const form = formNameOf(row.formTitle)
    const channel = leadChannel(row.sourceId, form, LEAD_SOURCE_VOCABULARY)
    const one = outcomeZero()
    one[bucket] = row.leads

    addOutcome(registration, one)
    addOutcome(channels.get(channel)!, one)
    if (isLeadDuplicate(row.stage)) leadDuplicates += row.leads
    const tileKey = leadTile(row.sourceId, row.aiQualified, LEAD_SOURCE_VOCABULARY)
    // «Сммщик ии» counts by the AI's date, not the day the lead arrived — below.
    if (tileKey !== 'aiSmm') {
      const tile = tiles.get(tileKey)!
      tile.leads += row.leads
      if (isLeadDuplicate(row.stage)) tile.duplicates += row.leads
    } else {
      aiArrived += row.leads
    }
    const sourceKey = sourceKeyOf(form, row.sourceId)
    const source = mapGet(sources, sourceKey, () => ({
      key: sourceKey,
      channel,
      name: form ?? row.source ?? row.sourceId ?? 'Manbasiz',
      outcome: outcomeZero(),
    }))
    addOutcome(source.outcome, one)

    if (form !== null) {
      const acc = ownerAcc(ownerOfForm(form))
      acc.forms.add(form)
      addOutcome(acc.outcome, one)
      const day = mapGet(acc.days, row.day, formDayZero)
      day.leads += row.leads
      if (bucket === 'success') day.success += row.leads
    } else if (row.sourceId !== null && (channel === 'page' || pages.has(pageKeyOf(row.sourceId)))) {
      const page = pageAcc(pageKeyOf(row.sourceId), row.source ?? row.sourceId)
      addOutcome(page.outcome, one)
      const day = mapGet(page.days, row.day, () => ({ conversations: 0, leads: 0, success: 0 }))
      day.leads += row.leads
      if (bucket === 'success') day.success += row.leads
    }
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
  const fakt1Ready = input.fakt1 !== null
  for (const row of input.fakt1 ?? []) {
    const form = formNameOf(row.formTitle)
    const sourceKey = sourceKeyOf(form, row.sourceId)
    mapGet(fakt1Sources, sourceKey, () => new Set<string>()).add(row.client)
    fakt1Channels.get(leadChannel(row.sourceId, form, LEAD_SOURCE_VOCABULARY))!.add(row.client)
    fakt1All.add(row.client)
  }

  /*
    Meta, onto the owner their account maps to: the lead forms are `spend`;
    every other campaign is an expense line beside it. An owner with no form
    and no lead stays out of the lead tables below — `expenseOwners` carries it.
  */
  for (const row of input.campaigns) {
    const channel = campaignChannel(row.objective, row.campaignName, row.accountId)
    const owner = ownerOf(row.accountId, row.accountName)
    const acc = ownerAcc({ key: `${owner.product}|${owner.targetolog}`, ...owner })
    const day = mapGet(acc.days, row.date, formDayZero)
    addCampaignExpense(acc.expense, row, channel)
    addCampaignExpense(day, row, channel)
    if (channel !== 'form') continue
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
  const hasLeadWork = (o: FormAcc) => o.spend > 0n || o.metaLeads > 0 || LEAD_BUCKETS.some((b) => o.outcome[b] > 0)
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
      reachPercent: percent(outcome.leads, o.metaLeads),
      costPerLeadUsd: perUnit(o.spend, outcome.leads),
      costPerSuccessUsd: perUnit(o.spend, outcome.success),
      days: days.map((date) => formDayCells(date, o.days.get(date) ?? formDayZero())),
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
      days.forEach((date, i) => {
        const cell = o.days.get(date)
        if (!cell) return
        formDays[i]!.spend += cell.spend
        formDays[i]!.metaLeads += cell.metaLeads
        formDays[i]!.leads += cell.leads
        formDays[i]!.success += cell.success
        addExpense(formDays[i]!, cell)
      })
      return ownerDto(o)
    })

  /*
    An owner whose money is ALL messages, hiring or other campaigns — HR
    Eldor's account, a targetolog running only SMS that week — has no form and
    no lead, so it is no row of the lead tables above and stays out of their
    totals. «Targetologlar · kunlik» still owes it a card (2026-10-07: its
    «Jami $» promises every dollar the accounts spent), so it rides apart.
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

  const formLeads = outcomeCells(formOutcome).leads

  /*
    Kval by the day it was WON, onto the tile its lead counts on — the
    headline's own count, split. The arrival cohort's kval (a lead created in
    the window and WON by now) stays in the tables below, where it sits beside
    the lead's other outcomes; on the tiles it read 189 against the headline's
    240 on 01.10.
  */
  /*
    «Сммщик ии» is the portal's «ИИ квал сана» filter on the window, any
    creation day, but only what is in Регистрация (the client, 2026-10-03;
    01.10: 72 of the filter's 89). A deal already moved on to Первичный отдел
    or Доставка is a repeat of a lead counted before: said apart, as
    `aiElsewhere`, and summed nowhere. Its kval stays the Регистрация WON by
    close date below, like every other tile.
  */
  const aiTile = tiles.get('aiSmm')!
  let aiElsewhere = 0
  for (const row of input.aiQualified) {
    if (!row.registration) {
      aiElsewhere += row.leads
      continue
    }
    aiTile.leads += row.leads
    if (isLeadDuplicate(row.stage)) aiTile.duplicates += row.leads
  }

  let qualifiedTotal = 0
  for (const row of input.qualified) {
    tiles.get(leadTile(row.sourceId, row.aiQualified, LEAD_SOURCE_VOCABULARY))!.qualified += row.qualified
    qualifiedTotal += row.qualified
  }
  // Ecommerce deals, no Регистрация lead: no duplicate stage there, and outside «Jami» below.
  const sarafanTile = tiles.get('sarafan')!
  sarafanTile.leads = input.sarafan.leads
  sarafanTile.qualified = input.sarafan.qualified

  const tilesTotal = tileZero()
  for (const [tile, t] of tiles) {
    if (LEAD_TILES_APART.has(tile) || LEAD_TILES_OUTSIDE_REGISTRATION.has(tile)) continue
    tilesTotal.leads += t.leads
    tilesTotal.duplicates += t.duplicates
    tilesTotal.qualified += t.qualified
  }

  // --- the headline tiles
  let adSpend = 0n
  for (const row of input.campaigns) if (adBudgetProduct(row) !== null) adSpend += row.spendMicroUsd
  const registrationCells = outcomeCells(registration)
  const fresh = registrationCells.leads - leadDuplicates

  return {
    brand,
    importedAt: input.importedAt?.toISOString() ?? null,
    inboundCalls: input.inboundCalls ?? null,
    funnel: {
      total: registrationCells.leads,
      fresh,
      duplicates: leadDuplicates,
      qualified: qualifiedTotal,
      qualifiedPercent: percent(qualifiedTotal, fresh),
      spendUsd: usd(adSpend),
      /* No spend read (Meta not imported yet, or down that day) is «unknown», never a free kval. */
      costPerQualifiedUsd: adSpend > 0n ? perUnit(adSpend, qualifiedTotal) : null,
    },
    totals: {
      registration: registrationCells,
      fakt1Clients: fakt1Ready ? fakt1All.size : null,
      formReachPercent: percent(formLeads, metaFormLeads),
    },
    forms: {
      owners: formOwners,
      expenseOwners,
      days: formDays.map((cell, i) => formDayCells(days[i]!, cell)),
      spendUsd: usd(formSpend),
      metaLeads: metaFormLeads,
      outcome: outcomeCells(formOutcome),
    },
    dm: { pages: dmPages, days: dmDays, conversations: dmConversations, outcome: outcomeCells(dmOutcome) },
    channels: LEAD_CHANNELS.map((channel) => ({
      channel,
      outcome: outcomeCells(channels.get(channel)!),
      fakt1Clients: fakt1Ready ? fakt1Channels.get(channel)!.size : null,
    })),
    tiles: {
      rows: LEAD_TILES.map((tile) => ({ tile, ...tileCells(tiles.get(tile)!) })),
      total: tileCells(tilesTotal),
      toHeadline: {
        outbound: tiles.get('outbound')!.leads,
        other: tiles.get('other')!.leads,
        ai: aiArrived - aiTile.leads,
      },
      aiElsewhere,
    },
    sources: [...sources.values()]
      .map((s) => ({
        key: s.key,
        channel: s.channel,
        name: s.name,
        outcome: outcomeCells(s.outcome),
        fakt1Clients: fakt1Ready ? (fakt1Sources.get(s.key)?.size ?? 0) : null,
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
}
const scanCache = processWide('sinolife.leads.scanCache', () => ttlCache<WindowScans>(120_000, LIVE_CACHE))

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
    const fakt1Scan = fakt1Cache.get(key, () =>
      this.insights.leadFakt1Clients(period).catch((error: unknown) => {
        void import('@/server/logging/logger').then(({ logger }) =>
          logger.warn({ err: error }, '«Факт1 мижоз» scan failed; Lidlar shows the tab without it'),
        )
        throw error
      }),
    )
    const [registration, scans, campaigns, importedAt] = await Promise.all([
      this.registrationDays(period),
      scanCache.get(key, () => this.scans(period)),
      this.meta.campaignDays(window.from, window.to),
      this.meta.campaignsImportedAt(),
    ])

    const fakt1 = await within(fakt1Scan, Math.max(FAKT1_GRACE_MS, FAKT1_WAIT_MS - (Date.now() - started)))

    // Narrowed after the memo: one scan serves both brands and the whole.
    return leadSourcesOverview({ window, registration, ...scans, fakt1, campaigns, importedAt, brand })
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
   * brand narrowing — `ofBrand`).
   */
  async targetologForms(
    period: Period,
    timeZone: string,
    brand: BrandFilter = 'all',
  ): Promise<Pick<LeadSourcesOverviewDto, 'forms' | 'importedAt'> & { readonly manual: readonly ManualSpendDto[] }> {
    const window = periodWindow(period, timeZone)
    const [registration, campaigns, importedAt, typed] = await Promise.all([
      this.registrationDays(period),
      this.meta.campaignDays(window.from, window.to),
      this.meta.campaignsImportedAt(),
      this.meta.manualSpend(window.from, window.to),
    ])
    const { forms, importedAt: imported } = leadSourcesOverview({
      window,
      registration,
      triage: [],
      campaigns,
      fakt1: [],
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
      brand's own channel), each on the brand its «Проект», source or form
      names, as «Lidlar» files every lead. Read from the SAME rows the cards
      above are built from, so the two agree to the lead.
    */
    const telegram = telegramLeads(registration, brand)
    return { forms, importedAt: imported, manual: manualSpendBlocks(calendarDays(window.from, window.to), typed, brand, { telegram }) }
  }

  /** Save the hand-typed ad money of «Targetologlar · kunlik» (`POST /reklama/manual-spend`). */
  saveManualSpend: ReklamaRepository['saveManualSpend'] = async (cells, by) => {
    await this.meta.saveManualSpend(cells, by)
  }

  private registrationDays(period: Period): Promise<RegistrationDayRow[]> {
    return registrationCache.get(windowKey(period), () => this.repository.registrationDays(period))
  }

  /** `scanCache`'s build: its five reads, at most `width` at a time — all at once for a reader. */
  private async scans(period: Period, width = Infinity): Promise<WindowScans> {
    const [triage, qualified, aiQualified, sarafan, inboundCalls] = await atMost(width, [
      () => this.repository.triageDays(period),
      () => this.repository.qualifiedSources(period),
      () => this.repository.aiQualifiedStages(period),
      () => this.repository.pipelineSourceCount(period, SARAFAN_PIPELINE_ID, [...LEAD_SOURCE_VOCABULARY.sarafan]),
      () => this.repository.inboundCallCount(period),
    ])
    return { triage, qualified, aiQualified, sarafan, inboundCalls }
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
