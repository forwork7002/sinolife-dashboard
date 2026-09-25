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
 *   sources — every Регистрация source, ad or not, so the total reads whole.
 *
 * Meta and Bitrix24 are never joined deal by deal — no deal carries a UTM
 * (0 of 2 892). They meet on the targetolog and the Tashkent day.
 */

import { LEAD_SOURCE_VOCABULARY, TARGET_SOURCE_PRODUCT } from '@/server/integrations/crm/bitrix24/mapping'
import { type MetaProduct, campaignChannel, ownerOf } from '@/server/integrations/meta/accounts'
import { type LeadChannel, LEAD_CHANNELS, formNameOf, formOwner, leadChannel } from '@/server/domain/leads/leadSources'
import { LEAD_BUCKETS, type LeadBucket, leadBucket } from '@/server/domain/reklama/leadQuality'
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import type { TargetProduct } from '@/server/domain/types'
import type { LeadSourcesRepository, RegistrationDayRow, TriageDayRow } from '@/server/repositories/leadSourcesRepository'
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
  /** leads ÷ conversations. */
  readonly leadPercent: number | null
  /** kval ÷ conversations. */
  readonly conversationToSuccessPercent: number | null
  readonly days: readonly DmDayDto[]
}

/** One Регистрация source (or, for a form, one form). */
export interface SourceRowDto {
  readonly key: string
  readonly channel: LeadChannel
  readonly name: string
  readonly outcome: LeadOutcomeDto
}

export interface LeadSourcesOverviewDto {
  /** When Meta's campaign grain was last read; null means never. */
  readonly importedAt: string | null
  readonly window: { readonly from: string; readonly to: string }
  readonly totals: {
    /** Every Регистрация deal created in the window. */
    readonly registration: LeadOutcomeDto
    /** Of those, the ad leads: forms plus the ad pages. */
    readonly ads: LeadOutcomeDto
    /** «ИИ обработка» deals — Instagram conversations. */
    readonly conversations: number
    readonly metaFormLeads: number
    readonly formLeads: number
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
  readonly channels: readonly { readonly channel: LeadChannel; readonly outcome: LeadOutcomeDto }[]
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

/**
 * The whole tab from the three ledgers' rows. Exported for its test.
 */
export function leadSourcesOverview(input: {
  window: { from: string; to: string }
  registration: readonly RegistrationDayRow[]
  triage: readonly TriageDayRow[]
  campaigns: readonly CampaignDayRow[]
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
    days: Map<string, { metaLeads: number; leads: number; success: number }>
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
  const sources = new Map<string, SourceAcc>()
  const channels = new Map<LeadChannel, OutcomeAcc>(LEAD_CHANNELS.map((c) => [c, outcomeZero()]))
  const registration = outcomeZero()

  /*
    ИИ обработка FIRST: a page is anything people write to, and the
    Регистрация pass below needs to know which sources those are. The ad
    pages are pages whether or not anybody wrote that week; a non-ad page
    that chats (collagen.sinolife, sinolif_tg) becomes one here.
  */
  let conversations = 0
  for (const row of input.triage) {
    conversations += row.conversations
    const key = row.sourceId ?? ''
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
    const sourceKey = form !== null ? `form|${form}` : `source|${row.sourceId ?? ''}`
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
      const day = mapGet(acc.days, row.day, () => ({ metaLeads: 0, leads: 0, success: 0 }))
      day.leads += row.leads
      if (bucket === 'success') day.success += row.leads
    } else if (row.sourceId !== null && (channel === 'page' || pages.has(row.sourceId))) {
      const page = pageAcc(row.sourceId, row.source ?? row.sourceId)
      addOutcome(page.outcome, one)
      const day = mapGet(page.days, row.day, () => ({ conversations: 0, leads: 0, success: 0 }))
      day.leads += row.leads
      if (bucket === 'success') day.success += row.leads
    }
  }

  // --- Meta: lead-form campaigns only, onto the owner their account maps to
  for (const row of input.campaigns) {
    if (campaignChannel(row.objective, row.campaignName) !== 'form') continue
    const owner = ownerOf(row.accountId, row.accountName)
    const acc = ownerAcc({ key: `${owner.product}|${owner.targetolog}`, ...owner })
    acc.accounts.add(row.accountName)
    acc.spend += row.spendMicroUsd
    acc.metaLeads += row.leads
    mapGet(acc.days, row.date, () => ({ metaLeads: 0, leads: 0, success: 0 })).metaLeads += row.leads
  }

  // --- forms block
  const formDays = days.map((date) => ({ date, metaLeads: 0, leads: 0, success: 0 }))
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
          const cell = o.days.get(date) ?? { metaLeads: 0, leads: 0, success: 0 }
          formDays[i]!.metaLeads += cell.metaLeads
          formDays[i]!.leads += cell.leads
          formDays[i]!.success += cell.success
          return { date, ...cell }
        }),
      }
    })

  // --- DM block: the ad pages first (in the sheet's order), then any other page that chats
  const productOf = (key: string): TargetProduct | null => TARGET_SOURCE_PRODUCT[key] ?? null
  const dmDays = days.map((date) => ({ date, conversations: 0, leads: 0, success: 0 }))
  const dmOutcome = outcomeZero()
  let dmConversations = 0
  const dmPages: DmPageDto[] = [...pages.values()]
    .sort(
      (a, b) =>
        Number(productOf(b.key) !== null) - Number(productOf(a.key) !== null) ||
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
        leadPercent: percent(outcome.leads, p.conversations),
        conversationToSuccessPercent: percent(outcome.success, p.conversations),
        days: days.map((date, i) => {
          const cell = p.days.get(date) ?? { conversations: 0, leads: 0, success: 0 }
          dmDays[i]!.conversations += cell.conversations
          dmDays[i]!.leads += cell.leads
          dmDays[i]!.success += cell.success
          return { date, ...cell }
        }),
      }
    })

  const ads = outcomeZero()
  addOutcome(ads, channels.get('form')!)
  addOutcome(ads, channels.get('page')!)
  const formLeads = outcomeCells(formOutcome).leads

  return {
    importedAt: input.importedAt?.toISOString() ?? null,
    window: input.window,
    totals: {
      registration: outcomeCells(registration),
      ads: outcomeCells(ads),
      conversations,
      metaFormLeads,
      formLeads,
      formReachPercent: percent(formLeads, metaFormLeads),
    },
    forms: {
      owners: formOwners,
      days: formDays,
      spendUsd: usd(formSpend),
      metaLeads: metaFormLeads,
      outcome: outcomeCells(formOutcome),
    },
    dm: { pages: dmPages, days: dmDays, conversations: dmConversations, outcome: outcomeCells(dmOutcome) },
    channels: LEAD_CHANNELS.map((channel) => ({ channel, outcome: outcomeCells(channels.get(channel)!) })),
    sources: [...sources.values()]
      .map((s) => ({ key: s.key, channel: s.channel, name: s.name, outcome: outcomeCells(s.outcome) }))
      .sort(
        (a, b) =>
          LEAD_CHANNELS.indexOf(a.channel) - LEAD_CHANNELS.indexOf(b.channel) ||
          b.outcome.leads - a.outcome.leads ||
          a.name.localeCompare(b.name, 'ru'),
      ),
  }
}

/*
  One memo per window in front of the two deal scans. Company-wide by
  construction — the route refuses a narrowed account — so no scope reaches it.
*/
const scanCache = ttlCache<{ registration: RegistrationDayRow[]; triage: TriageDayRow[] }>(60_000)

/** Test seam. */
export function resetLeadSourcesCaches(): void {
  scanCache.clear()
}

export class LeadSourcesService {
  constructor(
    private readonly repository: LeadSourcesRepository,
    private readonly meta: ReklamaRepository,
  ) {}

  async overview(period: Period, timeZone: string): Promise<LeadSourcesOverviewDto> {
    const window = {
      from: zonedDateKey(period.start, timeZone),
      to: zonedDateKey(new Date(period.end.getTime() - 1), timeZone),
    }
    const key = [period.preset, period.start.toISOString(), periodLengthInDays(period)].join('|')

    const [scans, campaigns, importedAt] = await Promise.all([
      scanCache.get(key, async () => {
        const [registration, triage] = await Promise.all([
          this.repository.registrationDays(period),
          this.repository.triageDays(period),
        ])
        return { registration, triage }
      }),
      this.meta.campaignDays(window.from, window.to),
      this.meta.campaignsImportedAt(),
    ])

    return leadSourcesOverview({ window, ...scans, campaigns, importedAt })
  }
}
