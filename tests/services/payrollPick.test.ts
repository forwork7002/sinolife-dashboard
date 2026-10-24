import { beforeEach, describe, expect, it } from 'vitest'

import { rowPickOf } from '@/features/payroll/payrollFilters'
import { layout } from '@/features/payroll/PayrollSheet'
import type { PayrollDto as ClientPayrollDto } from '@/lib/api'
import { PAYROLL_NO_ROP_PICK, payrollPickKey } from '@/server/domain/payroll/payrollBranches'
import { type Period, resolvePeriod } from '@/server/domain/period/period'
import { payrollQuerySchema } from '@/server/http/queryParams'
import type { ConfirmationSellerRatingRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import { PayrollService, resetPayrollCache } from '@/server/services/payrollService'

/**
 * The top panel's filters (2026-10-24, «rop lar boʻyicha filtr … eng kerakli
 * filtrlar tepa panelga»): «Boʻlim» / «ROP» narrow the payroll ON THE SERVER,
 * whole teams with their ROP, every total the picked teams' own; the options
 * stay the window's whole list; the rank stays the company's. «Bosqich» /
 * «Oʻsish» narrow the rows in the browser.
 */

beforeEach(resetPayrollCache)

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-10-20T06:00:00Z')
const mln = (n: number) => BigInt(Math.round(n * 1_000_000)) * 100n
const EMPTY = { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 0, REJECTED: 0, UNCONFIRMED_SHIPPED: 0 }
const EMPTY_MINOR = { CONFIRM_NEW: 0n, NO_ANSWER: 0n, CONFIRMED: 0n, REJECTED: 0n, UNCONFIRMED_SHIPPED: 0n }

function days(from: string, to: string): Period {
  return resolvePeriod('custom', {
    timeZone: TZ,
    now: new Date('2030-01-01T00:00:00Z'),
    customStart: new Date(`${from}T12:00:00Z`),
    customEnd: new Date(`${to}T12:00:00Z`),
  })
}

const SEPTEMBER = days('2026-09-01', '2026-09-30')
const AUGUST = days('2026-08-01', '2026-08-31')

function row(employeeId: string, rop: string | null, fakt2Mln: number): ConfirmationSellerRatingRow {
  return {
    employeeId,
    fullName: employeeId,
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

const TREE = new Map<string, string[]>([
  ['Lola', ['Навоий']],
  ['Sevinch', ['Тошкент']],
  ['Marjona', ['Тошкент']],
])

const CURRENT = [
  row('sevinch-1', 'Sevinch', 72),
  row('lola-1', 'Lola', 61),
  row('marjona-1', 'Marjona', 50),
  row('lola-2', 'Lola', 38),
  row('alone', null, 12),
]
// A month earlier `lola-2` sold under Marjona's label — Marjona's growth keeps it, Lola's does not.
const PREVIOUS = [row('lola-1', 'Lola', 40), row('lola-2', 'Marjona', 20), row('marjona-1', 'Marjona', 60), row('gone', 'Lola', 9)]

function service(): PayrollService {
  return new PayrollService({
    ropHeadNames: async () => new Map([['Lola', 'Lola Head']]),
    ropAncestorNames: async () => TREE,
    employeesByExternalId: async () => new Map([['7044', { id: 'flat-7044', fullName: 'Flat 7044' }]]),
    confirmationSellerRating: async ({ start }: { start: Date }) =>
      start.getTime() === SEPTEMBER.start.getTime() ? CURRENT : PREVIOUS,
  } as unknown as InsightsRepository)
}

const ids = (dto: { sellers: readonly { employeeId: string }[] }) => dto.sellers.map((s) => s.employeeId)
const minor = (value: { amountMinor: string }) => BigInt(value.amountMinor)

describe('«ROP» and «Boʻlim» narrow the payroll on the server', () => {
  it('keeps the picked team whole — its sellers, its ROP — and sums the page over it alone', async () => {
    const whole = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    const lola = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW, { rops: ['Lola'] })

    expect(ids(lola)).toEqual(['lola-1', 'lola-2'])
    expect(lola.teams.map((t) => t.rop)).toEqual(['Lola'])
    expect(lola.branches.map((b) => b.branch)).toEqual(['navoiy'])

    const team = whole.teams.find((t) => t.rop === 'Lola')!
    expect(lola.totals.total).toEqual(team.total)
    expect(lola.totals.fakt2).toEqual(team.fakt2)
    expect(lola.ropTotals.total).toEqual(team.ropPay!.total)
    expect(minor(lola.fund)).toBe(minor(team.total) + minor(team.ropPay!.total))
  })

  it('keeps the company rank on a picked row', async () => {
    const lola = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW, { rops: ['Lola'] })
    expect(lola.sellers.map((s) => s.rank)).toEqual([2, 4])
  })

  it('compares a team with what was sold under its label THEN, a person with themself', async () => {
    const lola = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW, { rops: ['Lola'] })
    // Then under «Lola»: lola-1 40 + gone 9; lola-2 sold under Marjona.
    expect(minor(lola.previous.fakt2)).toBe(mln(49))
    expect(lola.previous.sellers).toBe(2)
    expect(lola.previous.gone).toBe(1)
    expect(minor(lola.sellers.find((s) => s.employeeId === 'lola-2')!.previous!.fakt2)).toBe(mln(20))
  })

  it('picks by block, the no-team bucket by its own name, and both together', async () => {
    const tashkent = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW, { blocks: ['toshkent'] })
    expect(ids(tashkent)).toEqual(['sevinch-1', 'marjona-1'])

    const alone = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW, { rops: [PAYROLL_NO_ROP_PICK] })
    expect(ids(alone)).toEqual(['alone'])
    expect(alone.ropTotals.rops).toBe(0)

    const both = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW, { blocks: ['toshkent'], rops: ['Lola', 'Marjona'] })
    expect(ids(both)).toEqual(['marjona-1'])
  })

  it('offers the whole window as options whatever is picked', async () => {
    const whole = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    const lola = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW, { rops: ['Lola'] })
    expect(lola.choices).toEqual(whole.choices)
    expect(whole.choices.blocks.map((b) => [b.branch, b.sellers])).toEqual([
      ['toshkent', 2],
      ['navoiy', 2],
      ['other', 1],
    ])
    expect(whole.choices.teams.map((t) => t.rop)).toEqual(['Sevinch', 'Marjona', 'Lola', null])
    expect(whole.choices.teams.find((t) => t.rop === 'Lola')!.head).toBe('Lola Head')
  })

  it('answers no pick exactly as before, and a pick under its own memo key', async () => {
    const before = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW, {})
    const picked = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW, { rops: ['Lola'] })
    const after = await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    expect(ids(before)).toHaveLength(5)
    expect(ids(picked)).toHaveLength(2)
    expect(after).toEqual(before)
    expect(payrollPickKey({ rops: ['b', 'a'] })).toBe(payrollPickKey({ rops: ['a', 'b', 'a'] }))
    expect(payrollPickKey({})).toBe(payrollPickKey({ rops: [], blocks: [] }))
  })
})

describe('the payroll query takes the pick', () => {
  it('reads `rops` and `blocks`, and refuses a block there is none of', () => {
    const ok = payrollQuerySchema.safeParse({ preset: 'this_month', rops: 'Lola,(ROP yoʻq)', blocks: 'toshkent,baza' })
    expect(ok.success && ok.data.rops).toEqual(['Lola', '(ROP yoʻq)'])
    expect(ok.success && ok.data.blocks).toEqual(['toshkent', 'baza'])
    expect(payrollQuerySchema.safeParse({ preset: 'this_month', blocks: 'samarqand' }).success).toBe(false)
  })

  it('still refuses a year and a bad date with a 400, not a throw', () => {
    expect(payrollQuerySchema.safeParse({ preset: 'this_year', rops: 'Lola' }).success).toBe(false)
    expect(payrollQuerySchema.safeParse({ preset: 'custom', from: '2026-9-01', to: '2026-09-30' }).success).toBe(false)
  })
})

describe('«Bosqich» and «Oʻsish» narrow the rows in the browser', () => {
  it('keeps who reached a fixed part, who is near the next rung, who grew or is new', async () => {
    const dto = (await service().payroll(SEPTEMBER, AUGUST, 'UZS', NOW)) as unknown as ClientPayrollDto
    const kept = (pick: ReturnType<typeof rowPickOf>) =>
      layout(dto, '', pick)
        .flatMap((b) => b.teams.flatMap((t) => t.rows))
        .map((r) => r.employeeId)
        .sort()

    // Month: fiksa from 45 mln — 72, 61, 50 reach it; 38 and 12 do not.
    expect(kept(rowPickOf(['fixed'], [], true))).toEqual(['lola-1', 'marjona-1', 'sevinch-1'])
    expect(kept(rowPickOf(['nofixed'], [], true))).toEqual(['alone', 'lola-2'])
    // 38 of the way to 45 is 84% — near; 72 is on the top rung, nothing is next.
    expect(kept(rowPickOf(['near'], [], true))).toEqual(['lola-2'])

    expect(kept(rowPickOf([], ['up'], true))).toEqual(['lola-1', 'lola-2'])
    expect(kept(rowPickOf([], ['down'], true))).toEqual(['marjona-1'])
    expect(kept(rowPickOf([], ['new'], true))).toEqual(['alone', 'sevinch-1'])
    // Two controls are «and», two choices in one are «or».
    expect(kept(rowPickOf(['fixed'], ['up', 'new'], true))).toEqual(['lola-1', 'sevinch-1'])
  })

  it('is off with nothing ticked, and «Oʻsish» is off without a comparison window', () => {
    expect(rowPickOf([], [], true)).toBeNull()
    expect(rowPickOf([], ['up'], false)).toBeNull()
  })
})
