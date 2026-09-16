import { beforeEach, describe, expect, it } from 'vitest'

import { CALL_DURATION_BANDS } from '@/lib/callQuality'
import { resolvePeriod, trailingDays } from '@/server/domain/period/period'
import type {
  CallActivityRow,
  CallActivityRows,
  CallBandRow,
  CallCustomerBandRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import { InsightsService, resetCallActivityCaches } from '@/server/services/insightsService'

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-16T14:00:00+05:00')

/** A window wholly above the data floor. */
const TODAY = resolvePeriod('today', { timeZone: TZ, now: NOW })
/** A window that starts before it — «Shu oy» in September does. */
const MONTH = resolvePeriod('this_month', { timeZone: TZ, now: NOW })

/*
  Module-level memos, the hazard `resetConfirmationRopCache` documents: a
  fixture from one case answering a later case's identically-keyed question is
  a silent wrong answer, not a failure, unless every case starts clean.
*/
beforeEach(resetCallActivityCaches)

function row(overrides: Partial<CallActivityRow> & { key: string }): CallActivityRow {
  return {
    label: overrides.key,
    calls: 0,
    connected: 0,
    talkSec: 0,
    medianSec: null,
    p90Sec: null,
    customers: 0,
    ...overrides,
  }
}

function emptyActivity(): CallActivityRows {
  return {
    total: row({ key: 'TOTAL', label: 'Jami' }),
    operators: [],
    teams: [],
    series: [],
    unlinkedCalls: 0,
    sides: [
      row({ key: 'BAZA', label: 'Baza mijozi' }),
      row({ key: 'NOT_BAZA', label: 'Baza emas' }),
      row({ key: 'UNLINKED', label: 'Mijozga bogʻlanmagan' }),
    ],
    seriesBySide: [],
  }
}

function fakeRepository(overrides: {
  activity?: CallActivityRows
  durationBands?: readonly CallBandRow[]
  customerBands?: readonly CallCustomerBandRow[]
  onCall?: (method: string) => void
}): InsightsRepository {
  return {
    callActivity: async () => {
      overrides.onCall?.('callActivity')
      return overrides.activity ?? emptyActivity()
    },
    callDurationBands: async () => {
      overrides.onCall?.('callDurationBands')
      return overrides.durationBands ?? CALL_DURATION_BANDS.map((b) => ({ key: b.key, calls: 0, talkSec: 0 }))
    },
    callCustomerBands: async () => {
      overrides.onCall?.('callCustomerBands')
      return overrides.customerBands ?? []
    },
  } as unknown as InsightsRepository
}

describe('InsightsService.callActivity', () => {
  it('reports no connect rate for a group nobody dialled, and a real one otherwise', async () => {
    /*
      A day with no calls has no connect rate. 0% would claim a hundred
      unanswered dials — `rateBp` returns null over an empty denominator and
      this must carry it through.
    */
    const activity: CallActivityRows = {
      ...emptyActivity(),
      total: row({ key: 'TOTAL', calls: 11_230, connected: 3_261 }),
      operators: [row({ key: 'e1', calls: 4, connected: 0 })],
    }
    const dto = await new InsightsService(fakeRepository({ activity })).callActivity(TODAY)

    expect(dto.total.connectPercent).toBe(29)
    expect(dto.operators[0]?.connectPercent).toBe(0)

    const silent = await new InsightsService(fakeRepository({})).callActivity(
      resolvePeriod('yesterday', { timeZone: TZ, now: NOW }),
    )
    expect(silent.total.connectPercent).toBeNull()
  })

  it('takes band shares against CONNECTED calls, which is what the bands partition', async () => {
    /*
      Against every leg the six shares would sum to about a third, and the card
      would read as if two thirds of conversations had no length.
      Production above the floor: 273 of 3 261 connected calls ran past ten
      minutes — 8.4%.
    */
    const activity: CallActivityRows = {
      ...emptyActivity(),
      total: row({ key: 'TOTAL', calls: 11_230, connected: 3_261 }),
    }
    const durationBands: CallBandRow[] = [
      { key: 'S0', calls: 282, talkSec: 1_081 },
      { key: 'S10', calls: 653, talkSec: 13_572 },
      { key: 'S30', calls: 823, talkSec: 34_699 },
      { key: 'M1', calls: 818, talkSec: 84_328 },
      { key: 'M3', calls: 412, talkSec: 138_471 },
      { key: 'M10', calls: 273, talkSec: 277_607 },
    ]
    const dto = await new InsightsService(fakeRepository({ activity, durationBands })).callActivity(
      TODAY,
    )

    expect(dto.durationBands.map((b) => b.key)).toEqual(CALL_DURATION_BANDS.map((b) => b.key))
    expect(dto.durationBands.map((b) => b.label)).toEqual(CALL_DURATION_BANDS.map((b) => b.label))
    expect(dto.durationBands.find((b) => b.key === 'M10')?.sharePercent).toBe(8.4)
    const shareSum = dto.durationBands.reduce((sum, b) => sum + (b.sharePercent ?? 0), 0)
    expect(shareSum).toBeGreaterThan(99.5)
    expect(shareSum).toBeLessThan(100.5)
  })

  it('pivots the side series to one point per day, every side present, ascending', async () => {
    const activity: CallActivityRows = {
      ...emptyActivity(),
      seriesBySide: [
        { day: '2026-09-16', side: 'BAZA', talkSec: 40 },
        { day: '2026-09-15', side: 'NOT_BAZA', talkSec: 300 },
        { day: '2026-09-15', side: 'BAZA', talkSec: 100 },
        // 09-16 has no NOT_BAZA and no UNLINKED row at all.
      ],
    }
    const dto = await new InsightsService(fakeRepository({ activity })).callActivity(TODAY)

    expect(dto.seriesBySide).toEqual([
      { day: '2026-09-15', talkSec: { BAZA: 100, NOT_BAZA: 300, UNLINKED: 0 } },
      { day: '2026-09-16', talkSec: { BAZA: 40, NOT_BAZA: 0, UNLINKED: 0 } },
    ])
  })

  it('gives a customer band its mean talk time in whole seconds, and 0 over nobody', async () => {
    const customerBands: CallCustomerBandRow[] = [
      { key: 'C1', customers: 5_476, talkSec: 221_377 },
      { key: 'C6', customers: 0, talkSec: 0 },
    ]
    const dto = await new InsightsService(fakeRepository({ customerBands })).callActivity(TODAY)

    expect(dto.customerBands[0]).toEqual(
      expect.objectContaining({ key: 'C1', label: '1', avgTalkSec: 40 }),
    )
    expect(dto.customerBands[1]?.avgTalkSec).toBe(0)
  })

  it('says when the window was clamped at the data floor, and only then', async () => {
    const service = new InsightsService(fakeRepository({}))
    expect((await service.callActivity(MONTH)).floorApplied).toBe(true)
    expect((await service.callActivity(TODAY)).floorApplied).toBe(false)
  })

  it('memoises per window: the same window once, a different window again', async () => {
    /*
      THE KEY IS THE QUESTION. A key that dropped the window would serve
      yesterday's calls to a reader asking about today — not a stale answer, the
      wrong one.
    */
    const calls: string[] = []
    const service = new InsightsService(fakeRepository({ onCall: (m) => calls.push(m) }))

    await service.callActivity(TODAY)
    await service.callActivity(TODAY)
    expect(calls.filter((m) => m === 'callActivity')).toHaveLength(1)

    await service.callActivity(trailingDays(30, { timeZone: TZ, now: NOW }))
    expect(calls.filter((m) => m === 'callActivity')).toHaveLength(2)
  })

  it('hands every repository statement the same period it was given', async () => {
    const received: unknown[] = []
    const repository = {
      callActivity: async (o: { period: unknown }) => {
        received.push(o.period)
        return emptyActivity()
      },
      callDurationBands: async (o: { period: unknown }) => {
        received.push(o.period)
        return []
      },
      callCustomerBands: async (o: { period: unknown }) => {
        received.push(o.period)
        return []
      },
    } as unknown as InsightsRepository

    await new InsightsService(repository).callActivity(TODAY)

    expect(received).toEqual([TODAY, TODAY, TODAY])
  })
})
