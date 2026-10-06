import { describe, expect, it } from 'vitest'

import {
  comparablePayrollPeriod,
  payrollPeriod,
  payrollWeekPeriod,
} from '@/server/domain/period/period'
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
      deliveredSellerRows: async () => [
        slice('moved', 'Sevinchxon', 30, 10),
        slice('other', 'Lola', 45, 20),
        slice('moved', 'Sadriddin', 20, 24),
      ],
    } as unknown as InsightsRepository
    const service = new PayrollService(insights)
    const period = payrollPeriod('2026-08', 'full', 'Asia/Tashkent')
    const now = new Date('2026-09-26T06:00:00Z')
    const previous = comparablePayrollPeriod(period, payrollPeriod('2026-07', 'full', 'Asia/Tashkent'), now)
    const dto = await service.sellers(period, previous, 'full', 'UZS', now)

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
      deliveredSellerRows: async () => [
        slice('a', 'Lola', 34.9, 29),
        slice('b', 'Lola', 12, 29),
      ],
    } as unknown as InsightsRepository
    const service = new PayrollService(insights)
    const period = payrollWeekPeriod('2026-09-28', 'Asia/Tashkent')
    const now = new Date('2026-10-03T06:00:00Z')
    const previous = comparablePayrollPeriod(period, payrollWeekPeriod('2026-09-21', 'Asia/Tashkent'), now)
    const dto = await service.weekly(period, previous, 'UZS', now)

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

/**
 * «KIM QANCHAGA OʻSGAN» (2026-10-05): the comparison window is read through
 * the same query, paid by the same table, and summed per ROP under the label
 * each seller wore THEN.
 */
describe('payroll growth and ROP cards', () => {
  const TZ = 'Asia/Tashkent'
  const now = new Date('2026-10-05T06:00:00Z')

  /*
    Each case asks for its OWN month: the service's 60-second memo is module
    state and keyed on the window, so two cases on one window would read each
    other's answer.
  */
  function setup(month: string, monthBefore: string) {
    const period = payrollPeriod(month, 'first', TZ)
    const previous = comparablePayrollPeriod(period, payrollPeriod(monthBefore, 'first', TZ), now)
    const service = (current: ConfirmationSellerRatingRow[], then: ConfirmationSellerRatingRow[]) =>
      new PayrollService({
        deliveredSellerRows: async (window: { start: Date }) =>
          window.start.getTime() === period.start.getTime() ? current : then,
      } as unknown as InsightsRepository)
    return { period, previous, service }
  }

  it('pays the previous half by the half table and states the change', async () => {
    const { period, previous, service } = setup('2026-06', '2026-05')
    const dto = await service(
      [slice('a', 'Lola', 30, 10), slice('b', 'Lola', 10, 10), slice('new', 'Aziz', 5, 10)],
      [slice('a', 'Lola', 20, 5), slice('b', 'Lola', 20, 5)],
    ).sellers(period, previous, 'first', 'UZS', now)

    const [a, b, fresh] = dto.sellers
    // 30 mln in a half clears 30 → 2 400 000 + 750 000; 20 mln is 8% only.
    expect(a!.total.amount).toBe(3_150_000)
    expect(a!.previous?.fakt2.amount).toBe(20_000_000)
    expect(a!.previous?.total.amount).toBe(1_600_000)
    expect(a!.fakt2Delta).toEqual({ kind: 'change', percent: 50, direction: 'up' })
    expect(b!.fakt2Delta).toEqual({ kind: 'change', percent: -50, direction: 'down' })
    // Nobody delivered under this id then: no row, and no percentage off zero.
    expect(fresh!.previous).toBeNull()
    expect(fresh!.fakt2Delta.kind).toBe('no_baseline')

    expect(dto.previous.sellers).toBe(2)
    expect(dto.previous.fakt2.amount).toBe(40_000_000)
    expect(dto.previous.total.amount).toBe(3_200_000)
    expect(dto.deltas.fakt2).toEqual({ kind: 'change', percent: 12.5, direction: 'up' })
  })

  it('adds the ROP cards up to the fund, ROP yoʻq last', async () => {
    const { period, previous, service } = setup('2026-04', '2026-03')
    const dto = await service(
      [
        { ...slice('x', 'Lola', 22.5, 10) },
        { ...slice('y', 'Aziz', 40, 10) },
        { ...slice('z', 'Lola', 3, 10) },
        { ...slice('lone', 'Lola', 1, 10), rop: null },
      ],
      [slice('x', 'Aziz', 10, 5), slice('y', 'Aziz', 30, 5)],
    ).sellers(period, previous, 'first', 'UZS', now)

    expect(dto.teams.map((t) => t.rop)).toEqual(['Aziz', 'Lola', null])
    const sum = (pick: (t: (typeof dto.teams)[number]) => { amountMinor: string }) =>
      dto.teams.reduce((acc, t) => acc + BigInt(pick(t).amountMinor), 0n)
    expect(sum((t) => t.total)).toBe(BigInt(dto.totals.total.amountMinor))
    expect(sum((t) => t.fakt2)).toBe(BigInt(dto.totals.fakt2.amountMinor))
    expect(dto.teams.reduce((acc, t) => acc + t.sellers, 0)).toBe(dto.totals.sellers)

    const [aziz, lola, none] = dto.teams
    // Then, x sold under Aziz: Aziz's previous is both sellers, Lola had nobody.
    expect(aziz!.previous).toEqual(
      expect.objectContaining({ sellers: 2 }),
    )
    expect(aziz!.previous?.fakt2.amount).toBe(40_000_000)
    expect(lola!.previous).toBeNull()
    expect(lola!.sellers).toBe(2)
    expect(none!.sellers).toBe(1)
  })

  it('reads a seller whose orders were all in flight then as new, not as a baseline of 0', async () => {
    const { period, previous, service } = setup('2026-02', '2026-01')
    const dto = await service(
      [slice('a', 'Lola', 12, 10), slice('b', 'Lola', 9, 10)],
      [{ ...slice('a', 'Lola', 5, 5), deliveredMinor: 0n }, slice('b', 'Lola', 10, 5)],
    ).sellers(period, previous, 'first', 'UZS', now)
    const a = dto.sellers.find((s) => s.employeeId === 'a')!
    expect(a.previous).toBeNull()
    expect(a.fakt2Delta.kind).toBe('no_baseline')
    // The team's baseline is b's 10 mln alone.
    expect(dto.teams[0]!.previous?.fakt2.amount).toBe(10_000_000)
  })

  it('keeps a team paid then and empty now at zero, and counts the sellers gone', async () => {
    const { period, previous, service } = setup('2025-12', '2025-11')
    const dto = await service(
      [slice('a', 'Lola', 12, 10)],
      [slice('a', 'Lola', 10, 5), slice('gone', 'Aziz', 8, 5)],
    ).sellers(period, previous, 'first', 'UZS', now)
    expect(dto.teams.map((t) => t.rop)).toEqual(['Lola', 'Aziz'])
    const aziz = dto.teams[1]!
    expect(aziz.sellers).toBe(0)
    expect(aziz.total.amount).toBe(0)
    expect(aziz.previous?.fakt2.amount).toBe(8_000_000)
    expect(aziz.fakt2Delta).toEqual({ kind: 'change', percent: -100, direction: 'down' })
    // Σ over the cards is both funds.
    const sum = (pick: (t: (typeof dto.teams)[number]) => bigint) => dto.teams.reduce((acc, t) => acc + pick(t), 0n)
    expect(sum((t) => BigInt(t.previous?.total.amountMinor ?? '0'))).toBe(BigInt(dto.previous.total.amountMinor))
    expect(sum((t) => BigInt(t.total.amountMinor))).toBe(BigInt(dto.totals.total.amountMinor))
    expect(dto.previous.gone).toBe(1)
  })

  it('states a «small base» pair in soʻm, not tiyin', async () => {
    const { period, previous, service } = setup('2025-10', '2025-09')
    const dto = await service(
      [slice('a', 'Lola', 9, 10)],
      [slice('a', 'Lola', 0.4, 5)],
    ).sellers(period, previous, 'first', 'UZS', now)
    expect(dto.sellers[0]!.fakt2Delta).toEqual({ kind: 'small_base', current: 9_000_000, previous: 400_000 })
  })

  it('does not serve one comparison window’s answer for another', async () => {
    const TZ_ = 'Asia/Tashkent'
    const period = payrollPeriod('2025-08', 'first', TZ_)
    const whole = comparablePayrollPeriod(period, payrollPeriod('2025-07', 'first', TZ_), now)
    const cut = comparablePayrollPeriod(period, payrollPeriod('2025-07', 'first', TZ_), new Date('2025-08-05T06:00:00Z'))
    const service = new PayrollService({
      deliveredSellerRows: async (window: { start: Date; end: Date }) =>
        window.start.getTime() === period.start.getTime()
          ? [slice('a', 'Lola', 10, 10)]
          : [slice('a', 'Lola', window.end.getTime() === whole.end.getTime() ? 20 : 5, 5)],
    } as unknown as InsightsRepository)
    const first = await service.sellers(period, whole, 'first', 'UZS', now)
    const second = await service.sellers(period, cut, 'first', 'UZS', now)
    expect(first.previous.fakt2.amount).toBe(20_000_000)
    expect(second.previous.fakt2.amount).toBe(5_000_000)
  })

  it('does not ask for a comparison window that is empty', async () => {
    let calls = 0
    const insights = {
      deliveredSellerRows: async () => {
        calls += 1
        return [slice('a', 'Lola', 1, 10)]
      },
    } as unknown as InsightsRepository
    const week = payrollWeekPeriod('2026-10-12', TZ)
    const empty = comparablePayrollPeriod(week, payrollWeekPeriod('2026-10-05', TZ), now)
    const dto = await new PayrollService(insights).weekly(week, empty, 'UZS', now)
    expect(calls).toBe(1)
    expect(dto.previous.sellers).toBe(0)
  })
})

/**
 * THE RUNNING PERIOD IS READ ONCE ACROSS POLLS — 2026-10-06.
 *
 * The payroll memo is keyed on the comparison window as well, and while a
 * period runs that window moves with the clock, so a poll regularly meets a key
 * nothing has built. The rebuild used to scan the CURRENT window again too,
 * although its start and end had not moved; its rows have their own memo now.
 */
describe('the payroll memo across polls', () => {
  it('reads the running week once while the comparison window moves on', async () => {
    const TZ = 'Asia/Tashkent'
    const asked: string[] = []
    const insights = {
      deliveredSellerRows: async (window: { start: Date; end: Date }) => {
        asked.push(`${window.start.toISOString()}|${window.end.toISOString()}`)
        return [slice('a', 'Lola', 20, 10)]
      },
    } as unknown as InsightsRepository
    const service = new PayrollService(insights)
    // A week no other case asks for: the memos are module state.
    const week = payrollWeekPeriod('2026-11-02', TZ)
    const weekBefore = payrollWeekPeriod('2026-10-26', TZ)
    const poll = (instant: string) => {
      const now = new Date(instant)
      return service.weekly(week, comparablePayrollPeriod(week, weekBefore, now), 'UZS', now)
    }

    // Twelve minutes apart: the comparison's ten-minute step has moved on.
    const first = await poll('2026-11-04T06:00:00Z')
    const later = await poll('2026-11-04T06:12:00Z')

    const current = `${week.start.toISOString()}|${week.end.toISOString()}`
    expect(asked.filter((key) => key === current)).toHaveLength(1)
    // Two comparison windows, each read once.
    expect(asked.filter((key) => key !== current)).toHaveLength(2)
    expect(later.totals.fakt2.amount).toBe(first.totals.fakt2.amount)
  })
})
