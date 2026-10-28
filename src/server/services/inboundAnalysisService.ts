import { CALL_DATA_FLOOR } from '@/lib/callQuality'
import {
  type AnalysisDay,
  type AnalysisGroup,
  type GroupOutcome,
  type HistoryCall,
  type NumberVerdict,
  type ReturningDetail,
  INBOUND_ANALYSIS_FLOOR,
  groupOutcome,
  inboundAnalysis,
  returningDetail,
} from '@/server/domain/calls/inboundAnalysis'
import { phoneKey, telTarget } from '@/server/domain/calls/inboundCalls'
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import type { InboundAnalysisRepository } from '@/server/repositories/inboundAnalysisRepository'
import type { InboundCallsRepository } from '@/server/repositories/inboundCallsRepository'
import { windowDays } from './inboundCallsService'
import { processWide } from '@/server/processWide'

import { LIVE_CACHE, ttlCache } from './ttlCache'

export interface AnalysisDayDto extends AnalysisDay {
  /** Today: the day is still running and its row will grow. */
  readonly unfinished: boolean
}

export interface InboundAnalysisDto {
  readonly days: readonly AnalysisDayDto[]
  readonly total: {
    readonly calls: number
    readonly numbers: number
    readonly fresh: GroupOutcome
    readonly returning: GroupOutcome
  }
  readonly returning: ReturningDetail & {
    /** Where the returning numbers' contacts stand now — their newest deal's funnel, biggest first. */
    readonly funnels: readonly { readonly funnel: string; readonly numbers: number }[]
  }
  /** ISO: the analysis starts here whatever was asked (01.10.2026). */
  readonly analysisFrom: string
  /** ISO: the conversations looked back over start here (`CALL_DATA_FLOOR`). */
  readonly historyFrom: string
  /** The window asked for began before `analysisFrom`. */
  readonly floorApplied: boolean
}

/** One number of either group, for the list and its CSV. */
export interface AnalysisNumberDto {
  readonly key: string
  readonly phone: string | null
  readonly tel: string | null
  readonly group: AnalysisGroup
  readonly firstCallAt: string
  readonly calls: number
  readonly answered: boolean
  readonly calledBack: boolean
  readonly talked: boolean
  /** Whole days since the last conversation before the first call; null with none. */
  readonly silenceDays: number | null
  readonly contact: { readonly name: string; readonly bitrixId: string | null } | null
  /** «Воронка · стадия» of the contact's newest deal; null with no deal. */
  readonly state: string | null
}

export interface AnalysisNumbersDto {
  readonly rows: readonly AnalysisNumberDto[]
}

interface Snapshot {
  readonly dto: InboundAnalysisDto
  readonly verdicts: readonly NumberVerdict[]
}

/* On `globalThis` (2026-10-28): the warm lane builds «Shu oy» / «Oʻtgan oy» into it (`warm`). */
const reportCache = processWide('sinolife.inboundAnalysis.reportCache', () => ttlCache<Snapshot>(120_000, LIVE_CACHE))
const numbersCache = ttlCache<AnalysisNumbersDto>(120_000, LIVE_CACHE)

/**
 * «Kiruvchi tahlil» — see `domain/calls/inboundAnalysis.ts` for every
 * definition. The window's inbound calls and contacts are «Qoʻngʻiroqlar»'s own
 * reads; on top of them each number's conversations either way from
 * `CALL_DATA_FLOOR` to now, and each contact's newest deal.
 */
export class InboundAnalysisService {
  constructor(
    private readonly calls: InboundCallsRepository,
    private readonly repository: InboundAnalysisRepository,
    private readonly timeZone: string,
  ) {}

  async report(period: Period, now: Date): Promise<InboundAnalysisDto> {
    return (await this.snapshot(period, now)).dto
  }

  /** The window's report, built by the warm lane (2026-10-28) and handed out for `ttlMs` — see `OwnedRefresh`. */
  async warm(period: Period, now: Date, ttlMs: number): Promise<void> {
    await reportCache.refresh(this.key(period), () => this.build(period, now), { ttlMs })
  }

  /** The numbers of the period's two groups, oldest first call first. */
  async numbers(period: Period, now: Date): Promise<AnalysisNumbersDto> {
    return numbersCache.get(this.key(period), async () => {
      const { verdicts } = await this.snapshot(period, now)
      const grouped = verdicts.filter((v): v is NumberVerdict & { group: AnalysisGroup } => v.group !== null)
      const customerIds = [...new Set(grouped.map((v) => v.customerId).filter((id): id is string => !!id))]
      const [cards, deals] = await Promise.all([
        this.calls.contactCards(customerIds),
        this.repository.currentDeals(customerIds),
      ])
      return {
        rows: grouped.map((v) => {
          const deal = v.customerId ? deals.get(v.customerId) : undefined
          return {
            key: v.key,
            phone: v.phone,
            tel: v.phone ? telTarget(v.phone) : null,
            group: v.group,
            firstCallAt: v.firstCallAt.toISOString(),
            calls: v.calls,
            answered: v.answered,
            calledBack: v.calledBack,
            talked: v.talked,
            silenceDays: v.silenceDays === null ? null : Math.floor(v.silenceDays),
            contact: v.customerId ? (cards.get(v.customerId) ?? null) : null,
            state: deal ? [deal.pipeline, deal.stage].filter(Boolean).join(' · ') || null : null,
          }
        }),
      }
    })
  }

  private key(period: Period): string {
    return `analysis|${period.start.toISOString()}|${periodLengthInDays(period)}`
  }

  private snapshot(period: Period, now: Date): Promise<Snapshot> {
    return reportCache.get(this.key(period), () => this.build(period, now))
  }

  private async build(period: Period, now: Date): Promise<Snapshot> {
    const start = period.start < INBOUND_ANALYSIS_FLOOR ? INBOUND_ANALYSIS_FLOOR : period.start
    const end = period.end
    const calls = start < end ? await this.calls.inboundCalls(start, end) : []
    const customerIds = [...new Set(calls.map((c) => c.customerId).filter((id): id is string => !!id))]
    const keys = [...new Set(calls.map((c) => phoneKey(c.phone)).filter((k): k is string => k !== null && k.length === 9))]
    const [contacts, history] = await Promise.all([
      this.calls.contactHistories(customerIds),
      this.repository.history(keys, CALL_DATA_FLOOR),
    ])
    const byKey = new Map<string, HistoryCall[]>()
    for (const call of history) {
      const list = byKey.get(call.key)
      if (list) list.push(call)
      else byKey.set(call.key, [call])
    }

    const { days, verdicts } = inboundAnalysis(calls, contacts, byKey, start < end ? windowDays(start, end, this.timeZone) : [])

    // Where the returning numbers' contacts stand now.
    const returningIds = [
      ...new Set(verdicts.filter((v) => v.group === 'returning').map((v) => v.customerId).filter((id): id is string => !!id)),
    ]
    const deals = await this.repository.currentDeals(returningIds)
    const funnels = new Map<string, number>()
    for (const v of verdicts) {
      if (v.group !== 'returning') continue
      const funnel = (v.customerId ? deals.get(v.customerId)?.pipeline : null) ?? 'Bitimsiz'
      funnels.set(funnel, (funnels.get(funnel) ?? 0) + 1)
    }

    const today = zonedDateKey(now, this.timeZone)
    const dto: InboundAnalysisDto = {
      days: days.map((d) => ({ ...d, unfinished: d.day === today })),
      total: {
        calls: calls.length,
        numbers: verdicts.length,
        fresh: groupOutcome(verdicts, 'fresh'),
        returning: groupOutcome(verdicts, 'returning'),
      },
      returning: {
        ...returningDetail(verdicts),
        funnels: [...funnels.entries()].map(([funnel, numbers]) => ({ funnel, numbers })).sort((a, b) => b.numbers - a.numbers),
      },
      analysisFrom: INBOUND_ANALYSIS_FLOOR.toISOString(),
      historyFrom: CALL_DATA_FLOOR.toISOString(),
      floorApplied: period.start < INBOUND_ANALYSIS_FLOOR,
    }
    return { dto, verdicts }
  }
}
