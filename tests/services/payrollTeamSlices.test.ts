import { describe, expect, it } from 'vitest'

import { payrollPeriod, payrollWeekPeriod } from '@/server/domain/period/period'
import type { ConfirmationSellerRatingRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import { PayrollService } from '@/server/services/payrollService'

/**
 * PAY IS A PERSON'S, NOT A TEAM'S — 2026-09-26.
 *
 * The rating hands back one slice per seller and team since the team became
 * the deal's own «Организация сотрудника» snapshot. A seller who moved team
 * mid-month arrives twice, and pay read off the slices would split one FAKT 2
 * across the tiers: 30 + 20 mln is two sellers under the 45 mln fiksa tier,
 * where the person actually delivered 50 and earns 4 000 000 + 500 000.
 */

const mln = (n: number) => BigInt(Math.round(n * 1_000_000)) * 100n
const EMPTY = { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 0, REJECTED: 0, UNCONFIRMED_SHIPPED: 0 }
const EMPTY_MINOR = { CONFIRM_NEW: 0n, NO_ANSWER: 0n, CONFIRMED: 0n, REJECTED: 0n, UNCONFIRMED_SHIPPED: 0n }

function slice(employeeId: string, rop: string, fakt2Mln: number, day: number): ConfirmationSellerRatingRow {
  return {
    employeeId,
    fullName: employeeId,
    rop,
    lastQueuedAt: new Date(Date.UTC(2026, 8, day)),
    cohortOrders: 1,
    confirmedOrders: 1,
    confirmedMinor: mln(fakt2Mln),
    deliveredOrders: 1,
    deliveredMinor: mln(fakt2Mln),
    inTransitOrders: 0,
    inTransitMinor: 0n,
    lostAfterConfirmOrders: 0,
    lostAfterConfirmMinor: 0n,
    rejectedOrders: 0,
    byOutcome: EMPTY,
    byOutcomeMinor: EMPTY_MINOR,
  }
}

describe('payroll over per-team slices', () => {
  it('pays a seller who moved team once, on their whole FAKT 2', async () => {
    const insights = {
      confirmationSellerRating: async () => [
        slice('moved', 'Sevinchxon', 30, 10),
        slice('other', 'Lola', 45, 20),
        slice('moved', 'Sadriddin', 20, 24),
      ],
    } as unknown as InsightsRepository
    const service = new PayrollService(insights)
    const period = payrollPeriod('2026-08', 'full', 'Asia/Tashkent')
    const dto = await service.sellers(period, 'full', 'UZS', new Date('2026-09-26T06:00:00Z'))

    expect(dto.sellers.map((s) => s.employeeId)).toEqual(['moved', 'other'])
    const moved = dto.sellers[0]!
    expect(moved.fakt2.amount).toBe(50_000_000)
    expect(moved.rop).toBe('Sadriddin')
    expect(moved.rank).toBe(1)
    expect(moved.fixed.amount).toBe(500_000)
    expect(moved.total.amount).toBe(4_500_000)
    expect(dto.totals.sellers).toBe(2)
    expect(dto.totals.fakt2.amount).toBe(95_000_000)
  })

  it('pays a week off the weekly table, with the rate on every row', async () => {
    const insights = {
      confirmationSellerRating: async () => [
        slice('a', 'Lola', 34.9, 29),
        slice('b', 'Lola', 12, 29),
      ],
    } as unknown as InsightsRepository
    const service = new PayrollService(insights)
    const period = payrollWeekPeriod('2026-09-28', 'Asia/Tashkent')
    const dto = await service.weekly(period, 'UZS', new Date('2026-10-03T06:00:00Z'))

    expect(dto.scheme).toBe('week')
    expect(dto.open).toBe(true)
    const [a, b] = dto.sellers
    expect(a!.percentRate).toBe(8)
    expect(a!.total.amount).toBe(3_092_000)
    expect(b!.percentRate).toBe(0)
    expect(b!.total.amount).toBe(0)
    expect(dto.totals.total.amount).toBe(3_092_000)
  })
})
