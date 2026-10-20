// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { PayrollSheet } from '@/features/payroll/PayrollSheet'
import type { PayrollDto } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'
import { resolvePeriod } from '@/server/domain/period/period'
import type { ConfirmationSellerRatingRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import { PayrollService, resetPayrollCache } from '@/server/services/payrollService'

/**
 * «Hisob-kitob» as ONE sheet (2026-10-20), drawn from a payload the real
 * service built: every row spans the header's columns with and without the
 * growth column, blocks come in Toshkent · Navoiy · Baza order, a team paid
 * only through its ROP still draws, and a search narrows to the matching rows.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-10-20T06:00:00Z')
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

function row(employeeId: string, rop: string, fakt2Mln: number, day = 10): ConfirmationSellerRatingRow {
  return {
    employeeId,
    fullName: `${employeeId} name`,
    rop,
    lastQueuedAt: new Date(Date.UTC(2026, 8, day)),
    cohortOrders: 10,
    confirmedOrders: 10,
    confirmedMinor: mln(fakt2Mln),
    deliveredOrders: 8,
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

let data: PayrollDto

beforeEach(resetPayrollCache)

beforeAll(async () => {
  resetPayrollCache()
  const insights = {
    ropHeadNames: async () => new Map([['Saidaziz', 'Saidaziz Head']]),
    ropAncestorNames: async () =>
      new Map([
        ['Lola', ['Навоий']],
        ['Saidaziz', ['Навоий']],
        ['Marjona', ['Тошкент']],
      ]),
    employeesByExternalId: async () => new Map([['7044', { id: 'marjona-head', fullName: 'Marjona Shahtiyarovna 197' }]]),
    confirmationSellerRating: async ({ start }: { start: Date }) =>
      start.getTime() === SEPTEMBER.start.getTime()
        ? [
            row('baza-one', 'Baza', 28),
            row('lola-one', 'Lola', 40),
            row('marjona-head', 'Marjona', 50),
            // Sold under Saidaziz early in the month, then moved to Lola: Saidaziz's ROP is paid, no seller row.
            row('mover', 'Saidaziz', 5, 3),
            row('mover', 'Lola', 10, 25),
          ]
        : [row('lola-one', 'Lola', 30)],
  } as unknown as InsightsRepository
  const dto = await new PayrollService(insights, {
    sellerLeads: async () => [{ rop: 'Lola', employeeId: 'lola-one', leads: 25 }],
  }).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
  data = dto as unknown as PayrollDto
})

/** A row's width in columns, colSpan counted. */
const width = (tr: HTMLTableRowElement) =>
  Array.from(tr.cells).reduce((acc, cell) => acc + (cell.colSpan || 1), 0)

describe('PayrollSheet', () => {
  for (const compared of [true, false]) {
    it(`spans every row across the header — ${compared ? 'with' : 'without'} the growth column`, () => {
      const { container } = render(<PayrollSheet data={data} search="" compared={compared} />)
      const head = container.querySelector('thead tr') as HTMLTableRowElement
      const columns = width(head)
      expect(columns).toBe(compared ? 11 : 10)
      for (const tr of Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr'))) {
        expect(width(tr)).toBe(columns)
      }
    })
  }

  it('prints the blocks in Toshkent · Navoiy · Baza order, the fund at the foot', () => {
    const { container } = render(<PayrollSheet data={data} search="" compared />)
    const bands = Array.from(container.querySelectorAll('tr[data-line="branch"]')).map((tr) => tr.getAttribute('data-branch'))
    expect(bands).toEqual(['toshkent', 'navoiy', 'baza'])
    const all = container.querySelector('tr[data-line="all"]') as HTMLTableRowElement
    expect(all.textContent).toContain(formatFullUzs(data.fund.amount))
  })

  it('draws a team its ROP is paid for though no seller row is under it', () => {
    render(<PayrollSheet data={data} search="" compared />)
    expect(screen.getByText('Saidaziz jamoasi')).toBeTruthy()
    expect(screen.getByText(/ROP · Saidaziz Head/)).toBeTruthy()
  })

  it('marks the flat-rate seller and prints the lead columns', () => {
    const { container } = render(<PayrollSheet data={data} search="" compared />)
    const marjona = within(container).getByText('marjona-head name').closest('tr') as HTMLTableRowElement
    expect(marjona.textContent).toContain('18% shaxsiy')
    const lola = within(container).getByText('lola-one name').closest('tr') as HTMLTableRowElement
    // Lid soni 25, Tranzaksiya 10 → Konversiya 40%.
    expect(lola.textContent).toContain('25')
    expect(lola.textContent).toContain('40')
  })

  it('narrows to the matching sellers and drops every total while searching', () => {
    const { container } = render(<PayrollSheet data={data} search="lola-one" compared />)
    const sellers = Array.from(container.querySelectorAll('tr[data-line="seller"]'))
    expect(sellers).toHaveLength(1)
    expect(container.querySelectorAll('tr[data-line="team"]')).toHaveLength(1)
    expect(container.querySelector('tr[data-line="branch"][data-branch="navoiy"]')).not.toBeNull()
    for (const kind of ['rop', 'branch-total', 'grand', 'all']) {
      expect(container.querySelector(`tr[data-line="${kind}"]`)).toBeNull()
    }
  })

  it('says so when the search finds nobody', () => {
    render(<PayrollSheet data={data} search="nobody-here" compared />)
    expect(screen.getByText(/hech kim topilmadi/)).toBeTruthy()
  })
})
