import { callWindowStart, callFloorApplied } from '@/lib/callQuality'
import {
  type GroupCounts,
  type InboundDay,
  type InboundTotal,
  inboundReport,
} from '@/server/domain/calls/inboundCalls'
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import type { InboundCallsRepository } from '@/server/repositories/inboundCallsRepository'
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

export type { GroupCounts }

const reportCache = ttlCache<InboundCallsDto>(120_000, LIVE_CACHE)

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
    const key = `inbound|${period.start.toISOString()}|${periodLengthInDays(period)}`
    return reportCache.get(key, () => this.build(period, now))
  }

  private async build(period: Period, now: Date): Promise<InboundCallsDto> {
    const start = callWindowStart(period.start)
    const end = period.end
    const [calls, outbound] = await Promise.all([
      this.repository.inboundCalls(start, end),
      this.repository.outboundByDay(start, end),
    ])
    const customerIds = [...new Set(calls.map((c) => c.customerId).filter((id): id is string => !!id))]
    const contacts = await this.repository.contactHistories(customerIds)

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
