import { beforeEach, describe, expect, it } from 'vitest'

import { resolvePeriod, trailingDays } from '@/server/domain/period/period'
import type {
  CallActivityRow,
  CallActivityRows,
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
  Module-level memo, the hazard `resetConfirmationRopCache` documents: a
  fixture from one case answering a later case's identically-keyed question is
  a silent wrong answer, not a failure, unless every case starts clean.
*/
beforeEach(resetCallActivityCaches)

function row(overrides: Partial<CallActivityRow> & { key: string }): CallActivityRow {
  return {
    label: overrides.key,
    team: null,
    calls: 0,
    connected: 0,
    talkSec: 0,
    medianSec: null,
    customers: 0,
    firstCallAt: null,
    lastCallAt: null,
    ...overrides,
  }
}

function emptyActivity(): CallActivityRows {
  return {
    total: row({ key: 'TOTAL', label: 'Jami' }),
    operators: [],
    teams: [],
    days: [],
    hours: [],
  }
}

function fakeRepository(overrides: {
  activity?: CallActivityRows
  onCall?: (period: unknown) => void
}): InsightsRepository {
  return {
    callActivity: async (options: { period: unknown }) => {
      overrides.onCall?.(options.period)
      return overrides.activity ?? emptyActivity()
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

  it('carries an operator’s team and the exact first and last call through unchanged', async () => {
    const activity: CallActivityRows = {
      ...emptyActivity(),
      operators: [
        row({
          key: 'e1',
          label: 'Ismoilova Malika',
          team: 'Sevinch',
          calls: 120,
          connected: 41,
          talkSec: 9_310,
          firstCallAt: '2026-09-16T04:02:11Z',
          lastCallAt: '2026-09-16T08:47:03Z',
        }),
      ],
      total: row({ key: 'TOTAL', lastCallAt: '2026-09-16T08:47:03Z' }),
    }
    const dto = await new InsightsService(fakeRepository({ activity })).callActivity(TODAY)

    expect(dto.operators[0]).toEqual(
      expect.objectContaining({
        team: 'Sevinch',
        firstCallAt: '2026-09-16T04:02:11Z',
        lastCallAt: '2026-09-16T08:47:03Z',
      }),
    )
    expect(dto.total.lastCallAt).toBe('2026-09-16T08:47:03Z')
  })

  it('keeps the day and hour series in the order the repository sent', async () => {
    const activity: CallActivityRows = {
      ...emptyActivity(),
      days: [row({ key: '2026-09-15' }), row({ key: '2026-09-16' })],
      hours: [row({ key: '9' }), row({ key: '10' })],
    }
    const dto = await new InsightsService(fakeRepository({ activity })).callActivity(TODAY)

    expect(dto.days.map((d) => d.key)).toEqual(['2026-09-15', '2026-09-16'])
    expect(dto.hours.map((h) => h.key)).toEqual(['9', '10'])
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
    const received: unknown[] = []
    const service = new InsightsService(fakeRepository({ onCall: (p) => received.push(p) }))

    await service.callActivity(TODAY)
    await service.callActivity(TODAY)
    expect(received).toEqual([TODAY])

    const month = trailingDays(30, { timeZone: TZ, now: NOW })
    await service.callActivity(month)
    expect(received).toEqual([TODAY, month])
  })
})
