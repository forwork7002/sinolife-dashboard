import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RegistrationRepository } from '@/server/repositories/registrationRepository'
import { RegistrationService, resetRegistrationCaches } from '@/server/services/registrationService'

/*
  «Lidlar»'s split cards (`/registration/overview`), polled by every open
  «Lid manbalari» tab and asked again on every brand switch. The month grid's
  day rows — «Безквал» is 31 days of Регистрация deals with subplans per deal
  — are memoised and carry no brand; the split is read fresh, so one saved a
  second ago is on the next read (2026-10-06 audit).
*/
describe('RegistrationService.overview', () => {
  it('reads the grid\'s day rows once for both brands, and the split on every read', async () => {
    const calls = { distributedDays: 0, bezkvalDays: 0, split: 0, previousSplit: 0 }
    const repository = {
      distributedDays: async () => {
        calls.distributedDays++
        return [
          { day: '2026-04-20', rop: 'Sevinch', leads: 5, duplicates: 0 },
          { day: '2026-04-20', rop: 'Asliddin', leads: 3, duplicates: 0 },
        ]
      },
      bezkvalDays: async () => {
        calls.bezkvalDays++
        return []
      },
      split: async () => {
        calls.split++
        return null
      },
      previousSplit: async () => {
        calls.previousSplit++
        return null
      },
    } as unknown as RegistrationRepository
    const service = new RegistrationService(repository, {} as never)
    // Days after the grid's last: every day of it is closed.
    const base = { day: '2026-04-20', timeZone: 'Asia/Tashkent', canEdit: false, now: new Date('2026-04-25T09:00:00+05:00') }

    const collagen = await service.overview({ ...base, brand: 'Collagen' })
    const zextra = await service.overview({ ...base, brand: 'Zextra' })
    expect(calls).toEqual({ distributedDays: 1, bezkvalDays: 1, split: 2, previousSplit: 2 })
    // Narrowed after the memo: Sevinch's team is Collagen's, Asliddin's Zextra's.
    expect(collagen.total).toBe(5)
    expect(zextra.total).toBe(3)

    // Another day is another question.
    await service.overview({ ...base, day: '2026-04-21' })
    expect(calls.bezkvalDays).toBe(2)
  })
})

/*
  THE SETTLED DAYS APART FROM THE LAST TWO (2026-10-16, «dashboard sekin»).
  The grid is 31 days, and every poll past the memo's few minutes read all 31
  again: production logged the endpoint at 10–14 s. The days before yesterday
  have settled, so they are read once per half hour; yesterday («Безквал»
  re-credits last evening's leads the next morning) and today are read live.
  Both statements bucket by day and are bounded to their own days, so the two
  reads never overlap.
*/
describe('RegistrationService.overview over the last two days', () => {
  beforeEach(resetRegistrationCaches)
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A repository that logs each range it is asked and answers per range; `settled` stands in for the long read's rows. */
  function harness(settled: () => Promise<{ day: string; rop: string; leads: number; duplicates: number }[]>) {
    const reads: string[] = []
    const repository = {
      distributedDays: async (from: string, to: string) => {
        reads.push(`handed ${from}..${to}`)
        return from === '2026-09-16' ? settled() : [{ day: to, rop: 'Sevinch', leads: 4, duplicates: 1 }]
      },
      // The stored «Безквал» rows: read whole, for the grid's window.
      bezkvalDays: async (from: string, to: string) => {
        reads.push(`bezkval ${from}..${to}`)
        return [
          { day: '2026-10-14', rop: 'Sevinch', leads: 11 },
          { day: to, rop: 'Sevinch', leads: 7 },
        ]
      },
      split: async () => null,
      previousSplit: async () => null,
    } as unknown as RegistrationRepository
    const service = new RegistrationService(repository, {} as never)
    const ask = (day = '2026-10-16') =>
      service.overview({ day, timeZone: 'Asia/Tashkent', canEdit: false, now: new Date(Date.now()) })
    return { reads, ask }
  }

  it('reads the settled days once per half hour and yesterday with today on the live clock', async () => {
    // 00:30 in Tashkent is still the 15th in UTC: the days are Tashkent's.
    vi.useFakeTimers({ now: new Date('2026-10-15T19:30:00Z') })
    let settledRows = [
      { day: '2026-10-14', rop: 'Sevinch', leads: 9, duplicates: 0 },
      { day: '2026-09-16', rop: 'Asliddin', leads: 2, duplicates: 0 },
    ]
    let release: (() => void) | null = null
    const { reads, ask } = harness(() =>
      release === null ? Promise.resolve(settledRows) : new Promise((resolve) => (release = () => resolve(settledRows))),
    )

    const first = await ask()
    expect(reads.sort()).toEqual(['bezkval 2026-09-16..2026-10-16', 'handed 2026-09-16..2026-10-14', 'handed 2026-10-15..2026-10-16'])
    // Both reads land in the one grid: today's cards, the settled days' columns and the window's first.
    expect(first.total).toBe(4)
    expect(first.fresh).toBe(3)
    const sevinch = first.rops.find((r) => r.rop === 'Sevinch')!
    expect(sevinch.week.slice(-3)).toEqual([9, 0, 4])
    expect(first.rops.find((r) => r.rop === 'Asliddin')!.week[0]).toBe(2)
    expect(first.bezkval.rops.find((r) => r.rop === 'Sevinch')!.week.slice(-3)).toEqual([11, 0, 7])

    // Five minutes on: the last two days' hand-outs are read again (behind the reader), the settled ones are
    // not; the stored «Безквал» rows are read again whole — a recount of a settled day shows within a minute.
    reads.length = 0
    vi.advanceTimersByTime(5 * 60_000)
    await ask()
    await vi.runAllTimersAsync()
    expect(reads.sort()).toEqual(['bezkval 2026-09-16..2026-10-16', 'handed 2026-10-15..2026-10-16'])

    // Past the half hour the settled days are rebuilt behind the reader, who is handed the previous rows at once.
    release = () => undefined
    settledRows = [{ day: '2026-10-14', rop: 'Sevinch', leads: 10, duplicates: 0 }]
    vi.advanceTimersByTime(31 * 60_000)
    expect((await ask()).rops.find((r) => r.rop === 'Sevinch')!.week.at(-3)).toBe(9)
    ;(release as () => void)()
    await vi.runAllTimersAsync()
    expect((await ask()).rops.find((r) => r.rop === 'Sevinch')!.week.at(-3)).toBe(10)
  })

  it('reads a day before yesterday\'s whole grid as settled', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-16T09:00:00+05:00') })
    const { reads, ask } = harness(async () => [])
    await ask('2026-10-10')
    expect(reads.sort()).toEqual(['bezkval 2026-09-10..2026-10-10', 'handed 2026-09-10..2026-10-10'])
  })

  it('reads a day ahead live from yesterday on, and one past the grid live alone', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-16T09:00:00+05:00') })
    const { reads, ask } = harness(async () => [])
    await ask('2026-10-20')
    expect(reads.sort()).toEqual(['bezkval 2026-09-20..2026-10-20', 'handed 2026-09-20..2026-10-14', 'handed 2026-10-15..2026-10-20'])
    reads.length = 0
    await ask('2026-11-30')
    expect(reads.sort()).toEqual(['bezkval 2026-10-31..2026-11-30', 'handed 2026-10-31..2026-11-30'])
  })
})
