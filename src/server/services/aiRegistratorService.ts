import { rateBp } from '@/server/domain/analytics/rates'
import {
  type AiCall,
  type AiCallKind,
  type CallFunnel,
  type ExtensionAttempts,
  type GroupStats,
  type Handoff,
  type LeadOutcome,
  type LeadVerdict,
  type SaleDeal,
  type SellerCall,
  type TransferAttempt,
  FOLLOW_DAYS,
  HANDOFF_SLACK_MS,
  MIN_LEADS_TO_COMPARE,
  activityAt,
  aiTransfers,
  assignSales,
  attemptsByExtension,
  attemptsOf,
  callFunnel,
  groupStats,
  leadOutcome,
  selectCalls,
} from '@/server/domain/aiRegistrator/aiRegistrator'
import { floorNumberOf, indexByFloorNumber } from '@/server/domain/employees/floorNumber'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import type { Period } from '@/server/domain/period/period'
import type { AiRegistratorRepository } from '@/server/repositories/aiRegistratorRepository'
import { LIVE_CACHE, ttlCache } from './ttlCache'

const DAY_MS = 86_400_000

/** One cohort, with its rates. A rate over 0 leads is `null`, never 0. */
export interface AiGroupDto {
  readonly leads: number
  readonly withSalesDeal: number
  readonly ordered: number
  readonly orderSum: MoneyDto
  readonly sold: number
  readonly soldSum: MoneyDto
  readonly lost: number
  readonly noDeal: number
  readonly orderedRateBp: number | null
  readonly soldRateBp: number | null
  /** Delivered money ÷ leads; null over 0 leads. */
  readonly soldPerLead: MoneyDto | null
  readonly medianHoursToOrder: number | null
}

/** One seller, the AI's leads beside their own classic ones in the same window. */
export interface AiSellerRowDto {
  readonly key: string
  readonly employeeId: string | null
  readonly name: string | null
  /** The extension the AI rang them on; null for a seller only the classic side names. */
  readonly ext: string | null
  readonly ai: AiGroupDto
  readonly classic: AiGroupDto
}

/**
 * What the seller was doing when the agent found them busy or rang them, from their own Bitrix24 calls
 * (`activityAt`); `pending` — the moment is too recent for the call sync to have read their calls yet.
 */
export interface SellerDoingDto {
  readonly kind: 'talking' | 'dialing' | 'ended' | 'starting' | 'none' | 'pending'
  readonly from: string | null
  readonly to: string | null
  readonly direction: string | null
  readonly phone: string | null
  readonly gapSec: number | null
}

export interface AiAttemptDto {
  readonly ext: string
  readonly name: string | null
  readonly result: string
  readonly at: string | null
  readonly ringSec: number | null
  /** The ATS's word for a busy line («On the phone», «Ringing», «On hold»), since when, and when it came free. */
  readonly note: string | null
  readonly since: string | null
  readonly freedAt: string | null
  readonly doing: SellerDoingDto | null
}

/** Bitrix24 calls reach `call_record` within a sync pass or two; younger moments read «not yet». */
const SELLER_CALLS_SETTLE_MS = 20 * 60_000

export interface AiExtensionDto extends ExtensionAttempts {
  readonly name: string | null
}

export interface AiSaleDto {
  readonly dealId: string
  readonly pipeline: string | null
  readonly stage: string | null
  readonly status: SaleDeal['status']
  readonly amount: MoneyDto
  readonly createdAt: string
}

/** One lead the AI put through (or tried to): the call, the seller, and every deal that followed. */
export interface AiDealRowDto {
  readonly dealId: string
  readonly title: string | null
  readonly phone: string
  readonly at: string
  readonly outcome: string
  readonly transferredTo: string | null
  /** The seller the extension resolves to by its floor number. */
  readonly seller: string | null
  readonly attempts: readonly { readonly ext: string; readonly result: string }[]
  readonly problem: string | null
  readonly summary: string | null
  /** The Регистрация deal now; null until the sync has read it. */
  readonly lead: { readonly pipeline: string | null; readonly stage: string | null; readonly status: string } | null
  readonly sales: readonly AiSaleDto[]
  /** Who the sales side credits, when it is not the person the AI rang. */
  readonly soldBy: string | null
  /** `not_transferred`: every transfer failed. `not_synced`: the deal is not in the store yet. */
  readonly verdict: LeadVerdict | 'not_transferred' | 'not_synced'
}

export interface AiRegistratorDto {
  readonly funnel: CallFunnel
  readonly ai: AiGroupDto
  readonly classic: AiGroupDto
  readonly sellers: readonly AiSellerRowDto[]
  readonly extensions: readonly AiExtensionDto[]
  readonly deals: readonly AiDealRowDto[]
  /** The AI side has at least `minLeads` leads — below it the screen says no conclusion is possible yet. */
  readonly enoughToCompare: boolean
  readonly minLeads: number
  readonly followDays: number
  readonly slackMinutes: number
}

/** One AI call as the drawer behind a number lists it — see `selectCalls`. */
export interface AiCallRowDto {
  readonly callId: string
  readonly dealId: string
  /** The Регистрация deal's title; null until the sync has read it. */
  readonly title: string | null
  readonly phone: string
  readonly at: string
  readonly answeredAt: string | null
  readonly durationSec: number
  /** Which attempt on the lead the agent counted it as; null when it did not say. */
  readonly attempt: number | null
  readonly outcome: string
  readonly transferredTo: string | null
  /** The seller the answering extension resolves to by its floor number. */
  readonly seller: string | null
  /** Every extension tried, in order, each with the seller it resolves to. */
  readonly attempts: readonly AiAttemptDto[]
  /** What the agent wrote down, field by field, as given. */
  readonly notes: readonly { readonly key: string; readonly value: string }[]
  /** The Регистрация deal now; null until the sync has read it. */
  readonly lead: { readonly pipeline: string | null; readonly stage: string | null; readonly status: string } | null
  /** What came of the lead — the report's own verdict, for a lead it follows; null for any other call. */
  readonly verdict: AiDealRowDto['verdict'] | null
  readonly sales: readonly AiSaleDto[]
  readonly soldBy: string | null
}

export interface AiCallsDto {
  /** Every call the filter picks; `rows` is the first `limit` of them. */
  readonly total: number
  readonly rows: readonly AiCallRowDto[]
}

export interface AiCallsQuery {
  readonly kind: AiCallKind | 'ordered'
  readonly outcome?: string | null
  readonly ext?: string | null
  readonly seller?: string | null
  readonly q?: string | null
  readonly limit: number
}

const cache = ttlCache<AiRegistratorDto>(60_000, LIVE_CACHE)
/** The window's stored calls, for the drawers — the report's own clock. */
const callsCache = ttlCache<AiCall[]>(60_000, LIVE_CACHE)


const textOf = (result: Readonly<Record<string, unknown>> | null, key: string): string | null => {
  const value = result?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * «Lidlar → AI registrator». Every definition is in
 * `domain/aiRegistrator/aiRegistrator.ts`; this joins the agent's pushed calls
 * to the synced deals and shapes the answer.
 */
export class AiRegistratorService {
  constructor(
    private readonly repository: AiRegistratorRepository,
    private readonly currency: string,
  ) {}

  report(period: Period, now: Date): Promise<AiRegistratorDto> {
    const key = `ai|${period.preset}|${period.start.toISOString()}|${period.end.toISOString()}`
    return cache.get(key, () => this.build(period, now))
  }

  /**
   * The calls behind one number on the screen (`selectCalls`), newest first,
   * the first `limit` of them in full: the phone, the deal, what the agent
   * did and wrote, every extension it tried and whose it is, the lead now,
   * and — for a lead the report follows — what came of it, in the report's
   * own words (`deals`), so a row here and the row there cannot disagree.
   * «ordered» is «Buyurtma (AI lidlari)»: the report's leads with an order.
   */
  async calls(period: Period, query: AiCallsQuery, now: Date): Promise<AiCallsDto> {
    const key = `${period.start.toISOString()}|${period.end.toISOString()}`
    const [calls, roster, report] = await Promise.all([
      callsCache.get(key, () => this.repository.calls(period.start, period.end)),
      this.repository.roster(),
      this.report(period, now),
    ])
    const { nameOf, employeeOfExt } = extensionNames(roster)
    const sellerKeyOf = (ext: string | null) => (ext ? (employeeOfExt(ext) ?? `ext:${ext}`) : null)
    const followed = new Map(report.deals.map((d) => [d.dealId, d]))
    const picked = selectCalls(
      calls,
      query.kind === 'ordered'
        ? { kind: 'deals', deals: new Set(report.deals.filter((d) => d.verdict === 'ordered' || d.verdict === 'sold').map((d) => d.dealId)), q: query.q }
        : { kind: query.kind, outcome: query.outcome, ext: query.ext, seller: query.seller, q: query.q },
      sellerKeyOf,
    )
    const page = picked.slice(0, query.limit)
    // every try that did not put the caller through, with the seller it resolves to: what were they doing then
    const looked = page.flatMap((c) => attemptsOf(c)).filter((a) => a.result !== 'answered' && a.at !== null && employeeOfExt(a.ext))
    const moments = looked.map((a) => (a.at as Date).getTime())
    const [leads, sellerCalls] = await Promise.all([
      this.repository.leadDeals([...new Set(page.map((c) => c.dealExternalId))]),
      looked.length > 0
        ? this.repository.sellerCalls(
            [...new Set(looked.map((a) => employeeOfExt(a.ext) as string))],
            new Date(Math.min(...moments)),
            new Date(Math.max(...moments)),
          )
        : Promise.resolve([]),
    ])
    const callsOf = new Map<string, SellerCall[]>()
    for (const c of sellerCalls) callsOf.set(c.employeeId, [...(callsOf.get(c.employeeId) ?? []), c])
    const doingOf = (a: TransferAttempt): SellerDoingDto | null => {
      const id = a.result === 'answered' || a.at === null ? null : employeeOfExt(a.ext)
      if (!id || a.at === null) return null
      const act = activityAt(callsOf.get(id) ?? [], a.at)
      if (act.kind === 'none') {
        const recent = now.getTime() - a.at.getTime() < SELLER_CALLS_SETTLE_MS
        return { kind: recent ? 'pending' : 'none', from: null, to: null, direction: null, phone: null, gapSec: null }
      }
      return {
        kind: act.kind,
        from: act.call.startedAt.toISOString(),
        to: act.endsAt.toISOString(),
        direction: act.call.direction,
        phone: act.call.phone,
        gapSec: 'gapSec' in act ? act.gapSec : null,
      }
    }
    const sellerOf = (ext: string | null) => {
      const id = ext ? employeeOfExt(ext) : null
      return id ? (nameOf.get(id) ?? null) : null
    }
    return {
      total: picked.length,
      rows: page.map((call) => {
        const lead = leads.get(call.dealExternalId)
        const deal = followed.get(call.dealExternalId)
        return {
          callId: call.callId,
          dealId: call.dealExternalId,
          title: lead?.title ?? null,
          phone: call.phone,
          at: call.startedAt.toISOString(),
          answeredAt: call.answeredAt?.toISOString() ?? null,
          durationSec: call.durationSec,
          attempt: call.attempt ?? null,
          outcome: call.outcome,
          transferredTo: call.transferredTo,
          seller: sellerOf(call.transferredTo),
          attempts: attemptsOf(call).map((a) => ({
            ext: a.ext,
            name: sellerOf(a.ext),
            result: a.result,
            at: a.at?.toISOString() ?? null,
            ringSec: a.ringSec ?? null,
            note: a.note ?? null,
            since: a.since?.toISOString() ?? null,
            freedAt: a.freedAt?.toISOString() ?? null,
            doing: doingOf(a),
          })),
          notes: notesOf(call.result),
          lead: lead ? { pipeline: lead.pipeline, stage: lead.stage, status: lead.status } : null,
          verdict: deal?.verdict ?? null,
          sales: deal?.sales ?? [],
          soldBy: deal?.soldBy ?? null,
        }
      }),
    }
  }

  private async build(period: Period, now: Date): Promise<AiRegistratorDto> {
    const [calls, classicLeads, roster] = await Promise.all([
      this.repository.calls(period.start, period.end),
      this.repository.classicLeads(period.start, period.end),
      this.repository.roster(),
    ])
    const real = calls.filter((c) => !c.isTest)
    const transfers = aiTransfers(real)
    const transferred = new Set(transfers.map((t) => t.dealExternalId))
    const failed = latestFailed(real, transferred)

    const leads = await this.repository.leadDeals([...transferred, ...failed.keys()])
    const aiCohort = transfers.map((t) => ({ ...t, customerId: leads.get(t.dealExternalId)?.customerId ?? null }))

    // Every contact either cohort reaches, and every hand-off those contacts ever had.
    const customerIds = [
      ...new Set(
        [...aiCohort.map((t) => t.customerId), ...classicLeads.map((l) => l.customerId)].filter((id): id is string => !!id),
      ),
    ]
    const cohortHandoffs: Handoff[] = [
      ...aiCohort.flatMap((t) => (t.customerId ? [{ leadKey: t.dealExternalId, customerId: t.customerId, at: t.call.startedAt }] : [])),
      ...classicLeads.flatMap((l) => (l.customerId ? [{ leadKey: l.externalId, customerId: l.customerId, at: l.closedAt }] : [])),
    ]
    let byLead = new Map<string, SaleDeal[]>()
    if (cohortHandoffs.length > 0) {
      const times = cohortHandoffs.map((h) => h.at.getTime())
      const from = new Date(Math.min(...times) - HANDOFF_SLACK_MS)
      const to = new Date(Math.min(Math.max(...times) + FOLLOW_DAYS * DAY_MS, now.getTime() + DAY_MS))
      const [history, sales] = await Promise.all([this.repository.handoffs(customerIds), this.repository.sales(customerIds, from, to)])
      byLead = assignSales([...history, ...cohortHandoffs], sales)
    }
    const outcomeOf = (leadKey: string): LeadOutcome => leadOutcome(byLead.get(leadKey) ?? [])

    // Names: the AI side by the extension's floor number, the classic side by the employee the sale credits.
    const { nameOf, employeeOfExt } = extensionNames(roster)

    const aiRows = aiCohort.map((t) => ({ t, outcome: outcomeOf(t.dealExternalId), handoffAt: t.call.startedAt }))
    const classicRows = classicLeads.map((l) => ({ l, outcome: outcomeOf(l.externalId), handoffAt: l.closedAt }))

    // Sellers: everyone the AI rang (by extension) or put a lead through to, beside their own classic leads.
    const extensions = attemptsByExtension(real)
    const sellerKeys = new Map<string, { employeeId: string | null; ext: string | null }>()
    for (const ext of [...extensions.map((e) => e.ext), ...aiRows.map((r) => r.t.call.transferredTo ?? '')]) {
      if (!ext) continue
      const employeeId = employeeOfExt(ext)
      const key = employeeId ?? `ext:${ext}`
      if (!sellerKeys.has(key)) sellerKeys.set(key, { employeeId, ext })
    }
    const sellers: AiSellerRowDto[] = [...sellerKeys.entries()]
      .map(([key, s]) => ({
        key,
        employeeId: s.employeeId,
        name: s.employeeId ? (nameOf.get(s.employeeId) ?? null) : null,
        ext: s.ext,
        ai: this.group(
          groupStats(aiRows.filter((r) => (employeeOfExt(r.t.call.transferredTo) ?? `ext:${r.t.call.transferredTo}`) === key)),
        ),
        classic: this.group(groupStats(s.employeeId ? classicRows.filter((r) => r.outcome.sellerId === s.employeeId) : [])),
      }))
      .sort((a, b) => (a.ext ?? '').localeCompare(b.ext ?? '', 'en', { numeric: true }))

    const deals: AiDealRowDto[] = [
      ...aiRows.map(({ t, outcome }) => {
        const lead = leads.get(t.dealExternalId)
        const sellerId = employeeOfExt(t.call.transferredTo)
        return {
          ...this.dealBase(t.call, lead),
          seller: sellerId ? (nameOf.get(sellerId) ?? null) : null,
          sales: (byLead.get(t.dealExternalId) ?? []).map((d) => this.sale(d)),
          soldBy:
            outcome.sellerId && outcome.sellerId !== sellerId ? (nameOf.get(outcome.sellerId) ?? null) : null,
          verdict: lead ? outcome.verdict : ('not_synced' as const),
        }
      }),
      ...[...failed.values()].map((call) => ({
        ...this.dealBase(call, leads.get(call.dealExternalId)),
        seller: null,
        sales: [],
        soldBy: null,
        verdict: 'not_transferred' as const,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at))

    return {
      funnel: callFunnel(calls),
      ai: this.group(groupStats(aiRows)),
      classic: this.group(groupStats(classicRows)),
      sellers,
      extensions: extensions.map((e) => {
        const id = employeeOfExt(e.ext)
        return { ...e, name: id ? (nameOf.get(id) ?? null) : null }
      }),
      deals,
      enoughToCompare: aiRows.length >= MIN_LEADS_TO_COMPARE,
      minLeads: MIN_LEADS_TO_COMPARE,
      followDays: FOLLOW_DAYS,
      slackMinutes: HANDOFF_SLACK_MS / 60_000,
    }
  }

  private dealBase(call: AiCall, lead: { title: string; pipeline: string | null; stage: string | null; status: string } | undefined) {
    return {
      dealId: call.dealExternalId,
      title: lead?.title ?? null,
      phone: call.phone,
      at: call.startedAt.toISOString(),
      outcome: call.outcome,
      transferredTo: call.transferredTo,
      attempts: attemptsOf(call).map((a) => ({ ext: a.ext, result: a.result })),
      problem: textOf(call.result, 'problem'),
      summary: textOf(call.result, 'summary'),
      lead: lead ? { pipeline: lead.pipeline, stage: lead.stage, status: lead.status } : null,
    }
  }

  private sale(d: SaleDeal): AiSaleDto {
    return {
      dealId: d.externalId,
      pipeline: d.pipeline,
      stage: d.stage,
      status: d.status,
      amount: toMoneyDto(money(d.amountMinor, this.currency)),
      createdAt: d.createdAt.toISOString(),
    }
  }

  private group(g: GroupStats): AiGroupDto {
    return {
      leads: g.leads,
      withSalesDeal: g.withSalesDeal,
      ordered: g.ordered,
      orderSum: toMoneyDto(money(g.orderMinor, this.currency)),
      sold: g.sold,
      soldSum: toMoneyDto(money(g.soldMinor, this.currency)),
      lost: g.lost,
      noDeal: g.noDeal,
      orderedRateBp: rateBp(g.ordered, g.leads),
      soldRateBp: rateBp(g.sold, g.leads),
      soldPerLead: g.leads === 0 ? null : toMoneyDto(money(g.soldMinor / BigInt(g.leads), this.currency)),
      medianHoursToOrder: g.medianHoursToOrder,
    }
  }
}

/** Deals whose every transfer in the window failed — the latest such call each, none the AI put through. */
function latestFailed(calls: readonly AiCall[], transferred: ReadonlySet<string>): Map<string, AiCall> {
  const out = new Map<string, AiCall>()
  for (const call of calls) {
    if (call.outcome !== 'transfer_failed' || transferred.has(call.dealExternalId)) continue
    const held = out.get(call.dealExternalId)
    if (!held || call.startedAt > held.startedAt) out.set(call.dealExternalId, call)
  }
  return out
}

/** Who an extension is — the employee whose name carries its floor number — and every employee's name. */
function extensionNames(roster: readonly { id: string; fullName: string }[]) {
  const badge = indexByFloorNumber(roster, (p) => p)
  const nameOf = new Map(roster.map((p) => [p.id, p.fullName]))
  const employeeOfExt = (ext: string | null): string | null => {
    const n = ext ? floorNumberOf(ext) : null
    return n === null ? null : (badge.get(n) ?? null)
  }
  return { nameOf, employeeOfExt }
}

/**
 * What the agent wrote down, field by field and as given: a text, a number or
 * a yes / no is printed; anything nested is shown as its JSON, cut at 300
 * characters. Empty fields are left out.
 */
export function notesOf(result: Readonly<Record<string, unknown>> | null): { key: string; value: string }[] {
  if (!result) return []
  return Object.entries(result).flatMap(([key, value]) => {
    if (value === null || value === undefined) return []
    if (typeof value === 'string') return value.trim() === '' ? [] : [{ key, value: value.trim() }]
    if (typeof value === 'number' || typeof value === 'boolean') return [{ key, value: String(value) }]
    const json = JSON.stringify(value)
    return json === '[]' || json === '{}' ? [] : [{ key, value: json.length > 300 ? `${json.slice(0, 300)}…` : json }]
  })
}
