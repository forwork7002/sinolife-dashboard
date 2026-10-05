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
import { type MetaProduct, adBudgetProduct, campaignChannel, ownerOf } from '@/server/integrations/meta/accounts'
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
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import type { TargetProduct } from '@/server/domain/types'
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
import { ttlCache } from './ttlCache'

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

export interface FormDayDto {
  readonly date: string
  /** The targetolog's lead-form campaigns' spend that day — «Отчёт Т»'s $. */
  readonly spendUsd: number
  readonly metaLeads: number
  readonly leads: number
  readonly success: number
}

/** One targetolog's lead forms: what Meta counted, what reached the portal. */
export interface FormOwnerDto {
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
  /** Distinct clients (by phone) of these leads with a FAKT 1 order in the window — «Факт1 мижоз». */
  readonly fakt1Clients: number
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
  /** When Meta's campaign grain was last read; null means never. */
  readonly importedAt: string | null
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
    /** «Факт1 мижоз» of the whole of Регистрация — distinct, so not the sum of the channels. */
    readonly fakt1Clients: number
    readonly formReachPercent: number | null
  }
  readonly forms: {
    readonly owners: readonly FormOwnerDto[]
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
    readonly fakt1Clients: number
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

/** A targetolog's day: spend summed in micro-dollars, converted once. */
interface FormDayAcc {
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

/**
 * The whole tab from the three ledgers' rows. Exported for its test.
 */
export function leadSourcesOverview(input: {
  window: { from: string; to: string }
  registration: readonly RegistrationDayRow[]
  triage: readonly TriageDayRow[]
  campaigns: readonly CampaignDayRow[]
  /** Leads that reached FAKT 1 (`InsightsRepository.leadFakt1Clients`). */
  fakt1: readonly LeadFakt1ClientRow[]
  /** Регистрация deals WON in the window, by source (`LeadSourcesRepository.qualifiedSources`). */
  qualified: readonly QualifiedSourceRow[]
  /** Deals whose «ИИ квал сана» is in the window, any pipeline, flagged Регистрация or not (`LeadSourcesRepository.aiQualifiedStages`). */
  aiQualified: readonly AiQualifiedStageRow[]
  /** «Сарафан маркетинг» deals in Ecommerce (`LeadSourcesRepository.pipelineSourceCount`) — the «Сарафан» tile. */
  sarafan: PipelineSourceCount
  importedAt: Date | null
}): LeadSourcesOverviewDto {
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

  const formDayZero = (): FormDayAcc => ({ spend: 0n, metaLeads: 0, leads: 0, success: 0 })
  const owners = new Map<string, FormAcc>()
  const ownerAcc = (o: { key: string; targetolog: string; product: MetaProduct }) =>
    mapGet(owners, o.key, () => ({
      ...o,
      forms: new Set<string>(),
      accounts: new Set<string>(),
      spend: 0n,
      metaLeads: 0,
      outcome: outcomeZero(),
      days: new Map(),
    }))
  const pages = new Map<string, PageAcc>()
  const pageAcc = (key: string, name: string) =>
    mapGet(pages, key, () => ({ key, name, conversations: 0, outcome: outcomeZero(), days: new Map() }))
  for (const p of DM_PAGES) pageAcc(p.id, p.name)
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
  for (const row of input.fakt1) {
    const form = formNameOf(row.formTitle)
    const sourceKey = sourceKeyOf(form, row.sourceId)
    mapGet(fakt1Sources, sourceKey, () => new Set<string>()).add(row.client)
    fakt1Channels.get(leadChannel(row.sourceId, form, LEAD_SOURCE_VOCABULARY))!.add(row.client)
    fakt1All.add(row.client)
  }

  // --- Meta: lead-form campaigns only, onto the owner their account maps to
  for (const row of input.campaigns) {
    if (campaignChannel(row.objective, row.campaignName, row.accountId) !== 'form') continue
    const owner = ownerOf(row.accountId, row.accountName)
    const acc = ownerAcc({ key: `${owner.product}|${owner.targetolog}`, ...owner })
    acc.accounts.add(row.accountName)
    acc.spend += row.spendMicroUsd
    acc.metaLeads += row.leads
    const day = mapGet(acc.days, row.date, formDayZero)
    day.spend += row.spendMicroUsd
    day.metaLeads += row.leads
  }

  // --- forms block
  const formDays = days.map(() => formDayZero())
  const formOutcome = outcomeZero()
  let formSpend = 0n
  let metaFormLeads = 0
  const formOwners: FormOwnerDto[] = [...owners.values()]
    .filter((o) => o.spend > 0n || o.metaLeads > 0 || LEAD_BUCKETS.some((b) => o.outcome[b] > 0))
    .sort(
      (a, b) =>
        PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product) ||
        outcomeCells(b.outcome).leads - outcomeCells(a.outcome).leads ||
        b.metaLeads - a.metaLeads ||
        a.targetolog.localeCompare(b.targetolog, 'ru'),
    )
    .map((o) => {
      const outcome = outcomeCells(o.outcome)
      addOutcome(formOutcome, o.outcome)
      formSpend += o.spend
      metaFormLeads += o.metaLeads
      return {
        key: o.key,
        targetolog: o.targetolog,
        product: o.product,
        forms: [...o.forms].sort(),
        accounts: [...o.accounts].sort(),
        spendUsd: usd(o.spend),
        metaLeads: o.metaLeads,
        outcome,
        reachPercent: percent(outcome.leads, o.metaLeads),
        costPerLeadUsd: perUnit(o.spend, outcome.leads),
        costPerSuccessUsd: perUnit(o.spend, outcome.success),
        days: days.map((date, i) => {
          const cell = o.days.get(date) ?? formDayZero()
          formDays[i]!.spend += cell.spend
          formDays[i]!.metaLeads += cell.metaLeads
          formDays[i]!.leads += cell.leads
          formDays[i]!.success += cell.success
          return formDayCells(date, cell)
        }),
      }
    })

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
    importedAt: input.importedAt?.toISOString() ?? null,
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
      fakt1Clients: fakt1All.size,
      formReachPercent: percent(formLeads, metaFormLeads),
    },
    forms: {
      owners: formOwners,
      days: formDays.map((cell, i) => formDayCells(days[i]!, cell)),
      spendUsd: usd(formSpend),
      metaLeads: metaFormLeads,
      outcome: outcomeCells(formOutcome),
    },
    dm: { pages: dmPages, days: dmDays, conversations: dmConversations, outcome: outcomeCells(dmOutcome) },
    channels: LEAD_CHANNELS.map((channel) => ({
      channel,
      outcome: outcomeCells(channels.get(channel)!),
      fakt1Clients: fakt1Channels.get(channel)!.size,
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
        fakt1Clients: fakt1Sources.get(s.key)?.size ?? 0,
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
  One memo per window in front of the three deal scans. Company-wide by
  construction — both routes that read it (`/leads/overview`,
  `/reklama/targetologs`) refuse a narrowed account — so no scope reaches it.
*/
const scanCache = ttlCache<{
  registration: RegistrationDayRow[]
  triage: TriageDayRow[]
  fakt1: LeadFakt1ClientRow[]
  qualified: QualifiedSourceRow[]
  aiQualified: AiQualifiedStageRow[]
  sarafan: PipelineSourceCount
}>(60_000)

export class LeadSourcesService {
  constructor(
    private readonly repository: LeadSourcesRepository,
    private readonly meta: ReklamaRepository,
    private readonly insights: InsightsRepository,
  ) {}

  async overview(period: Period, timeZone: string): Promise<LeadSourcesOverviewDto> {
    const window = {
      from: zonedDateKey(period.start, timeZone),
      to: zonedDateKey(new Date(period.end.getTime() - 1), timeZone),
    }
    const key = [period.preset, period.start.toISOString(), periodLengthInDays(period)].join('|')

    const [scans, campaigns, importedAt] = await Promise.all([
      scanCache.get(key, async () => {
        const [registration, triage, fakt1, qualified, aiQualified, sarafan] = await Promise.all([
          this.repository.registrationDays(period),
          this.repository.triageDays(period),
          this.insights.leadFakt1Clients(period),
          this.repository.qualifiedSources(period),
          this.repository.aiQualifiedStages(period),
          this.repository.pipelineSourceCount(period, SARAFAN_PIPELINE_ID, [...LEAD_SOURCE_VOCABULARY.sarafan]),
        ])
        return { registration, triage, fakt1, qualified, aiQualified, sarafan }
      }),
      this.meta.campaignDays(window.from, window.to),
      this.meta.campaignsImportedAt(),
    ])

    return leadSourcesOverview({ window, ...scans, campaigns, importedAt })
  }
}
