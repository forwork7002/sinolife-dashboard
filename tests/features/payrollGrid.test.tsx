// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { type PayrollDaysDto, PayrollGrid, payrollCsv } from '@/features/payroll/PayrollGrid'
import type { PayrollDto } from '@/lib/api'
import { resolvePeriod } from '@/server/domain/period/period'
import type { ConfirmationSellerRatingRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import { PayrollService, resetPayrollCache } from '@/server/services/payrollService'

/**
 * «Maosh jadvali» (2026-10-23): the payroll as one sheet with a column per
 * day, drawn from a payload the real service built — every row spans the
 * header, a seller's days add up to their FAKT 2, a block folds, and the
 * Excel rows carry the same figures.
 */

afterEach(cleanup)

const mln = (n: number) => BigInt(Math.round(n * 1_000_000)) * 100n
const EMPTY = { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 0, REJECTED: 0, UNCONFIRMED_SHIPPED: 0 }
const EMPTY_MINOR = { CONFIRM_NEW: 0n, NO_ANSWER: 0n, CONFIRMED: 0n, REJECTED: 0n, UNCONFIRMED_SHIPPED: 0n }

const window = (from: string, to: string) =>
  resolvePeriod('custom', {
    timeZone: 'Asia/Tashkent',
    now: new Date('2030-01-01T00:00:00Z'),
    customStart: new Date(`${from}T12:00:00Z`),
    customEnd: new Date(`${to}T12:00:00Z`),
  })

const SEPTEMBER = window('2026-09-01', '2026-09-30')
const AUGUST = window('2026-08-01', '2026-08-31')

function row(employeeId: string, rop: string, fakt2Mln: number): ConfirmationSellerRatingRow {
  return {
    employeeId,
    fullName: `${employeeId} name`,
    rop,
    lastQueuedAt: new Date(Date.UTC(2026, 8, 10)),
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
const DAYS = ['2026-09-01', '2026-09-02', '2026-09-03']
// Each seller's days sum to their FAKT 2: 40 mln and 50 mln.
const days: PayrollDaysDto = {
  days: DAYS,
  today: '2026-10-23',
  sellers: { 'lola-one': [10_000_000, 30_000_000, 0], 'marjona-one': [25_000_000, 0, 25_000_000] },
  rops: { Lola: [10_000_000, 30_000_000, 0], Marjona: [25_000_000, 0, 25_000_000] },
}

beforeAll(async () => {
  resetPayrollCache()
  const insights = {
    ropHeadNames: async () => new Map([['Lola', 'Lola Head']]),
    ropAncestorNames: async () =>
      new Map([
        ['Lola', ['Навоий']],
        ['Marjona', ['Тошкент']],
      ]),
    employeesByExternalId: async () => new Map([['7044', { id: 'flat-7044', fullName: 'Flat 7044' }]]),
    confirmationSellerRating: async ({ start }: { start: Date }) =>
      start.getTime() === SEPTEMBER.start.getTime() ? [row('lola-one', 'Lola', 40), row('marjona-one', 'Marjona', 50)] : [row('lola-one', 'Lola', 30)],
  } as unknown as InsightsRepository
  data = (await new PayrollService(insights).payroll(SEPTEMBER, AUGUST, 'UZS', new Date('2026-10-20T06:00:00Z'))) as unknown as PayrollDto
})

const width = (tr: HTMLTableRowElement) => Array.from(tr.cells).reduce((acc, cell) => acc + (cell.colSpan || 1), 0)

describe('PayrollGrid', () => {
  for (const compared of [true, false]) {
    it(`spans every row across the header — ${compared ? 'with' : 'without'} the growth column`, () => {
      const { container } = render(<PayrollGrid data={data} days={days} search="" compared={compared} />)
      const columns = width(container.querySelector('thead tr') as HTMLTableRowElement)
      // Name, JAMI, nine (or eight) figure columns, three days.
      expect(columns).toBe(2 + (compared ? 9 : 8) + DAYS.length)
      for (const tr of Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr'))) expect(width(tr)).toBe(columns)
    })
  }

  it('writes each seller’s FAKT 2 per day beside their pay, in the sheet’s dots', () => {
    render(<PayrollGrid data={data} days={days} search="" compared />)
    const lola = screen.getAllByRole('row').find((r) => r.getAttribute('data-line') === 'seller' && r.textContent?.includes('lola-one name'))!
    const cells = within(lola).getAllByRole('cell')
    expect(cells.at(-3)!.textContent).toBe('10.000.000')
    expect(cells.at(-2)!.textContent).toBe('30.000.000')
    expect(cells.at(-1)!.textContent).toBe('0')
    // FAKT 2 itself, the second figure column after JAMI and Hisob.
    expect(cells[2]!.textContent).toBe('40.000.000')
  })

  it('sums a team’s and the company’s days from their sellers', () => {
    const { container } = render(<PayrollGrid data={data} days={days} search="" compared />)
    const grand = container.querySelector('tr[data-line="grand"]') as HTMLTableRowElement
    const cells = within(grand).getAllByRole('cell')
    expect(cells.at(-3)!.textContent).toBe('35.000.000')
    expect(cells.at(-2)!.textContent).toBe('30.000.000')
    expect(cells.at(-1)!.textContent).toBe('25.000.000')
  })

  it('folds a block away and opens it again', () => {
    render(<PayrollGrid data={data} days={days} search="" compared />)
    const navoiy = screen.getAllByRole('button').find((b) => b.textContent?.includes('jamoa ·') && b.closest('tr')?.textContent?.toLowerCase().includes('navoiy'))!
    fireEvent.click(navoiy)
    expect(screen.queryAllByRole('row').some((r) => r.textContent?.includes('lola-one name'))).toBe(false)
    expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('marjona-one name'))).toBe(true)
    fireEvent.click(navoiy)
    expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('lola-one name'))).toBe(true)
  })

  it('keeps the day columns empty until they arrive, the pay already on screen', () => {
    const { container } = render(<PayrollGrid data={data} days={null} search="" compared />)
    expect(container.querySelectorAll('thead [data-c]')).toHaveLength(0)
    expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('lola-one name'))).toBe(true)
  })
})

describe('payrollCsv', () => {
  it('writes a row per seller with the pay, the working and the days as plain numbers', () => {
    const rows = payrollCsv(data, days, true)
    expect(rows[0]!.slice(0, 6)).toEqual(['Boʻlim', 'Jamoa', 'Sotuvchi', 'JAMI maosh', 'Hisob', 'FAKT 2'])
    expect(rows[0]!.slice(-3)).toEqual(['01.09.2026', '02.09.2026', '03.09.2026'])
    const lola = rows.find((r) => r[2] === 'lola-one name')!
    const seller = data.sellers.find((s) => s.employeeId === 'lola-one')!
    expect(lola[3]).toBe(String(seller.total.amount))
    expect(lola[5]).toBe('40000000')
    expect(lola.slice(-3)).toEqual(['10000000', '30000000', '0'])
    expect(rows.at(-1)).toEqual(['', '', 'Hammasi boʻlib', String(data.fund.amount)])
  })
})
