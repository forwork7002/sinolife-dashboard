import { beforeEach, describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import type { ConfirmationSellerDayRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import { PayrollService, resetPayrollCache, windowDays } from '@/server/services/payrollService'

/** «Maosh jadvali»'s day columns: FAKT 2 per day of the window, per seller and per team label. */

beforeEach(resetPayrollCache)

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-10-23T06:00:00Z')

const window = (from: string, to: string) =>
  resolvePeriod('custom', { timeZone: TZ, now: NOW, customStart: new Date(`${from}T12:00:00Z`), customEnd: new Date(`${to}T12:00:00Z`) })

const row = (employeeId: string, rop: string | null, day: string, som: number): ConfirmationSellerDayRow => ({
  employeeId,
  rop,
  day,
  deliveredOrders: 1,
  deliveredMinor: BigInt(som) * 100n,
})

function service(rows: ConfirmationSellerDayRow[]) {
  const insights = { confirmationSellerDays: async () => rows } as unknown as InsightsRepository
  return new PayrollService(insights)
}

describe('windowDays', () => {
  it('lists every Tashkent day of the window, its last instant included', () => {
    expect(windowDays(window('2026-10-01', '2026-10-03'))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(windowDays(resolvePeriod('this_month', { timeZone: TZ, now: NOW }))).toHaveLength(23)
    expect(windowDays(resolvePeriod('yesterday', { timeZone: TZ, now: NOW }))).toEqual(['2026-10-22'])
  })
})

describe('PayrollService.days', () => {
  it('adds a seller’s team slices together, and keeps each label’s for its ROP', async () => {
    const out = await service([
      row('a', 'Azizbek', '2026-10-01', 1_000_000),
      // The same seller, moved team the next day: one row of theirs, two labels' bases.
      row('a', 'Malika', '2026-10-02', 2_000_000),
      row('b', 'Azizbek', '2026-10-02', 500_000),
      row('c', null, '2026-10-03', 300_000),
    ]).days(window('2026-10-01', '2026-10-03'), NOW)

    expect(out.days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(out.today).toBe('2026-10-23')
    expect(out.sellers.a).toEqual([1_000_000, 2_000_000, 0])
    expect(out.sellers.b).toEqual([0, 500_000, 0])
    expect(out.rops.Azizbek).toEqual([1_000_000, 500_000, 0])
    expect(out.rops.Malika).toEqual([0, 2_000_000, 0])
    // No team: the empty label.
    expect(out.rops['']).toEqual([0, 0, 300_000])
  })

  it('drops a row dated outside the window rather than misfiling it', async () => {
    const out = await service([row('a', 'Azizbek', '2026-09-30', 9_000_000)]).days(window('2026-10-01', '2026-10-02'), NOW)
    expect(out.sellers.a).toBeUndefined()
  })
})
