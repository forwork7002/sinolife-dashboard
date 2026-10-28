import { callWindowStart, callFloorApplied } from '@/lib/callQuality'
import {
  type ContactHistory,
  type GroupCounts,
  type InboundCall,
  type InboundDay,
  type InboundGroup,
  type InboundTotal,
  callbackOf,
  groupCallers,
  inboundReport,
  unansweredCallers,
} from '@/server/domain/calls/inboundCalls'
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import type { InboundCallsRepository, OutboundCall } from '@/server/repositories/inboundCallsRepository'
import { processWide } from '@/server/processWide'

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

/** One number behind a group tile; `GroupCaller` with the contact and the callback. */
export interface GroupCallerDto {
  readonly key: string
  readonly phone: string | null
  readonly tel: string | null
  readonly contact: { readonly name: string; readonly bitrixId: string | null } | null
  readonly calls: number
  readonly talked: boolean
  readonly talkSec: number
  readonly firstCallAt: string
  readonly lastCallAt: string
  /** As on «Javobsiz qolgan raqamlar»: outbound calls after the latest inbound one, up to now. */
  readonly callback: {
    readonly at: string
    readonly talked: boolean
    readonly operator: string | null
    readonly attempts: number
  } | null
}

export interface GroupCallersDto {
  readonly group: InboundGroup
  /** Oldest first call first — the tile's numbers, as many as it counts. */
  readonly rows: readonly GroupCallerDto[]
}

export type { GroupCounts }

interface Basis {
  readonly calls: InboundCall[]
  readonly outbound: Map<string, number>
  readonly contacts: Map<string, ContactHistory>
}

/*
  The window's calls and contacts, read once for the report and its callback
  list. On `globalThis` with the report's memo and its counter (2026-10-28):
  the warm lane builds «Shu oy» / «Oʻtgan oy» into them (`warm`) — cold, the
  basis made «javobsiz qoldi» for «Oʻtgan oy» take 16.6–17.2 s of the 20 s.
*/
const basisCache = processWide('sinolife.inboundCalls.basisCache', () => ttlCache<Basis>(120_000, LIVE_CACHE))
/**
 * The report AND the calls it was counted from. A group list is built from
 * this snapshot, never from a newer read: the report is served stale for up
 * to five minutes while it rebuilds, and on «Bugun» calls land every two —
 * a list read beside it would say «43 ta» under a tile reading 41.
 */
interface Snapshot {
  readonly dto: InboundCallsDto
  readonly basis: Basis
  /** Which build this is — the group lists' memo key. */
  readonly seq: number
}
/* One counter for both bundles: a seq repeated by the other bundle would key a group list to the wrong snapshot. */
const snapshotSeq = processWide('sinolife.inboundCalls.snapshotSeq', () => ({ next: 0 }))
const reportCache = processWide('sinolife.inboundCalls.reportCache', () => ttlCache<Snapshot>(120_000, LIVE_CACHE))
/*
  No stale window: once a callback is written it must leave «Qilinmagan» on the
  next poll, not up to five minutes later. It is written only by the CALLS pass,
  which runs with the three-hourly reference data (REFERENCE, never HOT, in
  `scripts/syncWorker.ts`) — so a callback made a minute ago can stand as
  «Qilinmagan» for up to three hours, and the card's hint says that, not «a
  minute or two». The calls under it may also be up to one basis TTL old.
*/
const unansweredCache = ttlCache<UnansweredCallsDto>(120_000)
/** No stale window either, for the same callback column. */
const callersCache = ttlCache<GroupCallersDto>(120_000)

/** Waiting, then tried, then reached; newest call first inside each. */
function urgency(row: UnansweredCallerDto): number {
  return row.callback === null ? 0 : row.callback.talked ? 2 : 1
}

function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10
}

/** Every Tashkent day the window touches, in order. Tashkent has no DST, so a day is 24 h. Also «Kiruvchi tahlil»'s. */
export function windowDays(start: Date, end: Date, timeZone: string): string[] {
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
    return (await this.snapshot(period, now)).dto
  }

  /**
   * The window's basis and report, built by the warm lane (2026-10-28) and
   * handed out for `ttlMs` — see `OwnedRefresh`. The basis first, so the
   * report is counted from the basis just built. «javobsiz qoldi» itself is
   * not warmed: its callback column is read fresh on every miss, as before.
   */
  async warm(period: Period, now: Date, ttlMs: number): Promise<void> {
    await basisCache.refresh(this.key(period), () => this.readBasis(period), { ttlMs })
    await reportCache.refresh(this.key(period), () => this.build(period, now), { ttlMs })
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

  /**
   * A group tile's numbers, number by number — the tile's own grouping
   * (`groupCallers`), the contact card and the callback column of
   * «Javobsiz qolgan raqamlar», so a number on both lists reads the same.
   */
  async callers(period: Period, group: InboundGroup, now: Date): Promise<GroupCallersDto> {
    const snapshot = await this.snapshot(period, now)
    return callersCache.get(`${this.key(period)}|${group}|${snapshot.seq}`, async () => {
      const { calls, contacts } = snapshot.basis
      const callers = groupCallers(calls, contacts, group)
      // A number nobody can dial (none, or an extension) has no callback to find.
      const dialable = callers.filter((c) => c.key.length === 9 && !c.key.startsWith('#'))
      const customerIds = [...new Set(callers.map((c) => c.customerId).filter((id): id is string => !!id))]
      const [outbound, cards] = await Promise.all([
        this.repository.outboundTo(dialable.map((c) => ({ key: c.key, after: c.lastCallAt }))),
        this.repository.contactCards(customerIds),
      ])
      const byKey = new Map<string, OutboundCall[]>()
      for (const call of outbound) {
        const list = byKey.get(call.key)
        if (list) list.push(call)
        else byKey.set(call.key, [call])
      }
      return {
        group,
        rows: callers.map((c): GroupCallerDto => {
          const callback = callbackOf(c, byKey.get(c.key) ?? [])
          return {
            key: c.key,
            phone: c.phone,
            tel: c.tel,
            contact: c.customerId ? (cards.get(c.customerId) ?? null) : null,
            calls: c.calls,
            talked: c.talked,
            talkSec: c.talkSec,
            firstCallAt: c.firstCallAt.toISOString(),
            lastCallAt: c.lastCallAt.toISOString(),
            callback: callback && { ...callback, at: callback.at.toISOString() },
          }
        }),
      }
    })
  }

  private snapshot(period: Period, now: Date): Promise<Snapshot> {
    return reportCache.get(this.key(period), () => this.build(period, now))
  }

  private key(period: Period): string {
    return `inbound|${period.start.toISOString()}|${periodLengthInDays(period)}`
  }

  private basis(period: Period): Promise<Basis> {
    return basisCache.get(this.key(period), () => this.readBasis(period))
  }

  private async readBasis(period: Period): Promise<Basis> {
    const start = callWindowStart(period.start)
    const end = period.end
    const [calls, outbound] = await Promise.all([
      this.repository.inboundCalls(start, end),
      this.repository.outboundByDay(start, end),
    ])
    const customerIds = [...new Set(calls.map((c) => c.customerId).filter((id): id is string => !!id))]
    const contacts = await this.repository.contactHistories(customerIds)
    return { calls, outbound, contacts }
  }

  private async build(period: Period, now: Date): Promise<Snapshot> {
    const start = callWindowStart(period.start)
    const end = period.end
    const basis = await this.basis(period)
    const { calls, outbound, contacts } = basis

    const today = zonedDateKey(now, this.timeZone)
    const { days, total } = inboundReport(calls, contacts, outbound, start < end ? windowDays(start, end, this.timeZone) : [])

    let undated = 0
    for (const contact of contacts.values()) if (contact.createdAt === null) undated += 1

    const dto: InboundCallsDto = {
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
    snapshotSeq.next += 1
    return { dto, basis, seq: snapshotSeq.next }
  }
}
