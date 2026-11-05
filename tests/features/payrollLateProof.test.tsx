// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { PayrollSheet } from '@/features/payroll/PayrollSheet'
import type { PayrollDto } from '@/lib/api'
import { resolvePeriod } from '@/server/domain/period/period'
import type { ConfirmationSellerRatingRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import { PayrollService, resetPayrollCache } from '@/server/services/payrollService'

/**
 * The lateness fine's PROOF (the owner, 2026-11-05: «sen shu vaqtda kelgansan,
 * shuncha jarima bo'lgan, shu kunlar deb turishi kerak»): a press on a seller's
 * «Kechikish» opens every late day — the shift start, the arrival, the minutes,
 * the soʻm — and a day the rule did not fine says why.
 */

const TZ = 'Asia/Tashkent'
const mln = (n: number) => BigInt(Math.round(n * 1_000_000)) * 100n
const EMPTY = { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 0, REJECTED: 0, UNCONFIRMED_SHIPPED: 0 }
const EMPTY_MINOR = { CONFIRM_NEW: 0n, NO_ANSWER: 0n, CONFIRMED: 0n, REJECTED: 0n, UNCONFIRMED_SHIPPED: 0n }
const days = (from: string, to: string) =>
  resolvePeriod('custom', {
    timeZone: TZ,
    now: new Date('2030-01-01T00:00:00Z'),
    customStart: new Date(`${from}T12:00:00Z`),
    customEnd: new Date(`${to}T12:00:00Z`),
  })
const SEPTEMBER = days('2026-09-01', '2026-09-30')
const AUGUST = days('2026-08-01', '2026-08-31')

function row(employeeId: string): ConfirmationSellerRatingRow {
  return {
    employeeId,
    fullName: `${employeeId} name`,
    rop: 'Lola',
    lastQueuedAt: new Date(Date.UTC(2026, 8, 10)),
    cohortOrders: 10,
    confirmedOrders: 10,
    confirmedMinor: mln(40),
    deliveredOrders: 8,
    deliveredMinor: mln(40),
    inTransitOrders: 0,
    inTransitMinor: 0n,
    lostAfterConfirmOrders: 0,
    lostAfterConfirmMinor: 0n,
    rejectedOrders: 0,
    byOutcome: EMPTY,
    byOutcomeMinor: EMPTY_MINOR,
  }
}

let data: PayrollDto

beforeAll(async () => {
  resetPayrollCache()
  const insights = {
    ropHeadNames: async () => new Map(),
    ropAncestorNames: async () => new Map([['Lola', ['Навоий']]]),
    employeesByExternalId: async () => new Map([['7044', { id: 'flat', fullName: 'Flat' }]]),
    confirmationSellerRating: async ({ start }: { start: Date }) => (start.getTime() === SEPTEMBER.start.getTime() ? [row('late'), row('calm')] : []),
  } as unknown as InsightsRepository
  const late = (day: string, checkIn: string, lateMinutes: number) => ({ day, checkIn, lateMinutes, holiday: false, onLeave: false })
  const dto = await new PayrollService(insights, null, () => {}, {
    lateDays: async () => ({
      days: new Map([['late', [late('2026-09-02', '08:46', 16), late('2026-09-06', '09:20', 50)]]]),
      linked: new Set(['late', 'calm']),
      syncedAt: new Date('2026-09-30T05:00:00Z'),
    }),
  }).payroll(SEPTEMBER, AUGUST, 'UZS', new Date('2026-10-20T06:00:00Z'))
  data = dto as unknown as PayrollDto
})

describe('the lateness proof', () => {
  it('opens the late days from the seller’s «Kechikish», fined and not', () => {
    render(<PayrollSheet data={data} search="" compared={false} />)
    const seller = screen.getAllByRole('row').find((r) => r.getAttribute('data-line') === 'seller' && r.textContent?.includes('late name'))!
    fireEvent.click(within(seller).getByRole('button'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Kechikish · late name/)).toBeTruthy()
    const lines = within(dialog).getAllByRole('row').map((r) => r.textContent)
    expect(lines.some((t) => t?.includes('02.09') && t.includes('08:30') && t.includes('08:46') && t.includes('16 daq') && t.includes('−16'))).toBe(true)
    expect(lines.some((t) => t?.includes('06.09') && t.includes('yakshanba') && t.includes('09:20'))).toBe(true)
  })

  it('gives an on-time seller no button — there is nothing to prove', () => {
    render(<PayrollSheet data={data} search="" compared={false} />)
    const seller = screen.getAllByRole('row').find((r) => r.getAttribute('data-line') === 'seller' && r.textContent?.includes('calm name'))!
    expect(within(seller).queryByRole('button')).toBeNull()
    expect(seller.textContent).toContain('0 daq')
  })
})
