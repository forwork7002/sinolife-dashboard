import { callWindowStart, callFloorApplied } from '@/lib/callQuality'
import {
  type ContactHistory,
  type GroupCounts,
  type InboundCall,
  type InboundDay,
  type InboundGroup,
  type InboundTotal,
  callbackOf,
  inboundReport,
  unansweredCallers,
} from '@/server/domain/calls/inboundCalls'
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import type { InboundCallsRepository, OutboundCall } from '@/server/repositories/inboundCallsRepository'
import { LIVE_CACHE, ttlCache } from './ttlCache'

export interface InboundDayDto extends InboundDay {
  /** Talked numbers ÷ numbers, one decimal; null over a silent day. */
  readonly talkedPercent: number | null
  /** Today: the day is still running and its row will grow. */
  readonly unfinished: boolean
}

export interface InboundCallsDto {
  readonly days: readonly InboundDayDto[]
  readonly total: InboundTotal & { readonly talkedPercent: number | null }
  /** The newest inbound call written, ISO — calls arrive on the three-hourly reference pass. */
  readonly lastCallAt: string | null
  /** Contacts with no portal creation time yet (`customer.createdAtSource` null). */
  readonly undatedContacts: number
  readonly floorApplied: boolean
}

export interface UnansweredCallerDto {
  readonly key: string
  readonly phone: string
  /** What a tap dials; null for a number that cannot be dialled. */
  readonly tel: string | null
  readonly group: InboundGroup
  /** The Bitrix24 contact; null when no contact is linked to the number yet. */
  readonly contact: { readonly name: string; readonly bitrixId: string | null } | null
  readonly calls: number
  readonly firstCallAt: string
  readonly lastCallAt: string
  readonly operator: string | null
  /** Null: nobody has rung the number since its latest call. */
  readonly callback: {
    readonly at: string
    readonly talked: boolean
    readonly operator: string | null
    readonly attempts: number
  } | null
}

export interface UnansweredCallsDto {
  /** Not rung back first (newest call on top), then rung back but not reached, then reached. */
  readonly rows: readonly UnansweredCallerDto[]
  readonly waiting: number
  readonly calledBack: number
  readonly reached: number
}

export type { GroupCounts }

interface Basis {
  readonly calls: InboundCall[]
  readonly outbound: Map<string, number>
  readonly contacts: Map<string, ContactHistory>
}

/** The window's calls and contacts, read once for the report and its callback list. */
const basisCache = ttlCache<Basis>(120_000, LIVE_CACHE)
const reportCache = ttlCache<InboundCallsDto>(120_000, LIVE_CACHE)
/*
  No stale window: once a callback is written it must leave «Qilinmagan» on the
  next poll, not up to five minutes later. It is written only by the CALLS pass,
  which runs with the three-hourly reference data (REFERENCE, never HOT, in
  `scripts/syncWorker.ts`) — so a callback made a minute ago can stand as
  «Qilinmagan» for up to three hours, and the card's hint says that, not «a
  minute or two». The calls under it may also be up to one basis TTL old.
*/
const unansweredCache = ttlCache<UnansweredCallsDto>(120_000)

/** Waiting, then tried, then reached; newest call first inside each. */
function urgency(row: UnansweredCallerDto): number {
  return row.callback === null ? 0 : row.callback.talked ? 2 : 1
}

function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10
}

/** Every Tashkent day the window touches, in order. Tashkent has no DST, so a day is 24 h. */
function windowDays(start: Date, end: Date, timeZone: string): string[] {
  const days: string[] = []
  for (let t = start.getTime(); t < end.getTime(); t += 86_400_000) {
    const key = zonedDateKey(new Date(t), timeZone)
    if (days[days.length - 1] !== key) days.push(key)
  }
  return days
}

/**
 * «Kiruvchi qoʻngʻiroqlar» on «Qoʻngʻiroqlar» — see `domain/calls/inboundCalls.ts`
 * for every definition. Memoised for a minute, like `callActivity`, and keyed
 * the same way: nothing here compares against a previous window, so the
 * preset is not part of the question.
 */
export class InboundCallsService {
  constructor(
    private readonly repository: InboundCallsRepository,
    private readonly timeZone: string,
  ) {}

  async report(period: Period, now: Date): Promise<InboundCallsDto> {
    return reportCache.get(this.key(period), () => this.build(period, now))
  }

  /**
   * «javobsiz qoldi», number by number, and whether each was rung back since
   * — to this moment, past the window's end: a callback the next morning counts.
   */
  async unanswered(period: Period): Promise<UnansweredCallsDto> {
    return unansweredCache.get(this.key(period), async () => {
      const { calls, contacts } = await this.basis(period)
      const callers = unansweredCallers(calls, contacts)
      const customerIds = [...new Set(callers.map((c) => c.customerId).filter((id): id is string => !!id))]
      const [outbound, cards] = await Promise.all([
        this.repository.outboundTo(callers.map((c) => ({ key: c.key, after: c.lastCallAt }))),
        this.repository.contactCards(customerIds),
      ])
      const byKey = new Map<string, OutboundCall[]>()
      for (const call of outbound) {
        const list = byKey.get(call.key)
        if (list) list.push(call)
        else byKey.set(call.key, [call])
      }
      const rows = callers
        .map((c): UnansweredCallerDto => {
          const callback = callbackOf(c, byKey.get(c.key) ?? [])
          return {
            key: c.key,
            phone: c.phone,
            tel: c.tel,
            group: c.group,
            contact: c.customerId ? (cards.get(c.customerId) ?? null) : null,
            calls: c.calls,
            firstCallAt: c.firstCallAt.toISOString(),
            lastCallAt: c.lastCallAt.toISOString(),
            operator: c.operator,
            callback: callback && { ...callback, at: callback.at.toISOString() },
          }
        })
        .sort((a, b) => urgency(a) - urgency(b) || b.lastCallAt.localeCompare(a.lastCallAt))
      return {
        rows,
        waiting: rows.filter((r) => r.callback === null).length,
        calledBack: rows.filter((r) => r.callback !== null).length,
        reached: rows.filter((r) => r.callback?.talked).length,
      }
    })
  }

  private key(period: Period): string {
    return `inbound|${period.start.toISOString()}|${periodLengthInDays(period)}`
  }

  private basis(period: Period): Promise<Basis> {
    return basisCache.get(this.key(period), async () => {
      const start = callWindowStart(period.start)
      const end = period.end
      const [calls, outbound] = await Promise.all([
        this.repository.inboundCalls(start, end),
        this.repository.outboundByDay(start, end),
      ])
      const customerIds = [...new Set(calls.map((c) => c.customerId).filter((id): id is string => !!id))]
      const contacts = await this.repository.contactHistories(customerIds)
      return { calls, outbound, contacts }
    })
  }

  private async build(period: Period, now: Date): Promise<InboundCallsDto> {
    const start = callWindowStart(period.start)
    const end = period.end
    const { calls, outbound, contacts } = await this.basis(period)

    const today = zonedDateKey(now, this.timeZone)
    const { days, total } = inboundReport(calls, contacts, outbound, start < end ? windowDays(start, end, this.timeZone) : [])

    let undated = 0
    for (const contact of contacts.values()) if (contact.createdAt === null) undated += 1

    return {
      days: days.map((d) => ({
        ...d,
        talkedPercent: percent(d.talked, d.numbers),
        unfinished: d.day === today,
      })),
      total: { ...total, talkedPercent: percent(total.talked, total.numbers) },
      lastCallAt: calls.length ? calls[calls.length - 1]!.startedAt.toISOString() : null,
      undatedContacts: undated,
      floorApplied: callFloorApplied(period.start),
    }
  }
}
