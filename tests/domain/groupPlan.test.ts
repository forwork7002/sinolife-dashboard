import { describe, expect, it } from 'vitest'

import { buildGroupPlan, monthStart } from '@/server/domain/registration/groupPlan'
import { buildRopReport, type RosterMember, type SellerFaktRow } from '@/server/domain/registration/ropReport'

/*
  «Guruhlar» since 2026-10-13: one row per ROP — Usp soni = the team's без
  квал, Reja = 200 000 × it, Buyurtma = the team's Факт-1, Dostup closed on a
  red Qarz.
*/

const roster: RosterMember[] = [
  { employeeId: 'aziz', fullName: 'Azizbek ROP', rop: 'Azizbek', isHead: true },
  { employeeId: 'shax', fullName: 'Shaxnoza', rop: 'Azizbek', isHead: false },
  { employeeId: 'asil', fullName: 'Asilbek N', rop: 'Azizbek', isHead: false },
  { employeeId: 'sev', fullName: 'Sevinch ROP', rop: 'Sevinch', isHead: true },
  { employeeId: 'zeb', fullName: 'Zebiniso', rop: 'Sevinch', isHead: false },
]

const fakt = (employeeId: string, rop: string | null, som: number, orders: number): SellerFaktRow => ({
  employeeId,
  rop,
  fakt1Minor: BigInt(som) * 100n,
  fakt1Orders: orders,
  fakt2Minor: 0n,
  fakt2Orders: 0,
})

const report = buildRopReport({
  day: '2026-10-13',
  roster,
  names: new Map(),
  calls: null,
  // Kval hand-outs no longer drive the plan.
  leads: [{ rop: 'Azizbek', employeeId: 'shax', leads: 18 }],
  fakt: [fakt('shax', 'Azizbek', 14_600_000, 9), fakt('asil', 'Azizbek', 6_700_000, 4), fakt('zeb', 'Sevinch', 3_000_000, 2), fakt('x', null, 900_000, 1)],
})

const plan = buildGroupPlan({
  from: '2026-10-01',
  report,
  bezkval: [
    { rop: 'Azizbek', leads: 60 },
    { rop: 'Azizbek', leads: 40 },
    { rop: 'Sevinch', leads: 30 },
    // No ROP: not a row, not in «Jami».
    { rop: null, leads: 500 },
  ],
})
const som = (n: number) => String(BigInt(n) * 100n)
const row = (rop: string) => plan.rows.find((r) => r.rop === rop)!

describe('buildGroupPlan', () => {
  it('runs from the first of the month to the day', () => {
    expect(monthStart('2026-10-13')).toBe('2026-10-01')
    expect(plan.from).toBe('2026-10-01')
    expect(plan.to).toBe('2026-10-13')
  })

  it('is one row per ROP, named by the head — no sellers, no team-less row', () => {
    expect(plan.rows.map((r) => [r.rop, r.fullName])).toEqual([
      ['Azizbek', 'Azizbek ROP'],
      ['Sevinch', 'Sevinch ROP'],
    ])
  })

  it('plans 200 000 per без квал lead against the team\'s Факт-1', () => {
    const aziz = row('Azizbek')
    expect(aziz.leads).toBe(100)
    expect(aziz.plan.amountMinor).toBe(som(20_000_000))
    expect(aziz.orders.amountMinor).toBe(som(21_300_000))
    expect(aziz.percent).toBeCloseTo(106.5, 1)
    expect(aziz.debt.amountMinor).toBe(som(1_300_000))
    const sev = row('Sevinch')
    expect(sev.plan.amountMinor).toBe(som(6_000_000))
    expect(sev.debt.amountMinor).toBe(som(-3_000_000))
  })

  it('closes Dostup on a red Qarz only', () => {
    expect(row('Azizbek').mayTakeLeads).toBe(true)
    expect(row('Sevinch').mayTakeLeads).toBe(false)
  })

  it('sums the ROP rows into «Jami»', () => {
    expect(plan.total.leads).toBe(130)
    expect(plan.total.plan.amountMinor).toBe(som(26_000_000))
    expect(plan.total.orders.amountMinor).toBe(som(24_300_000))
    expect(plan.total.debt.amountMinor).toBe(som(-1_700_000))
  })

  it('keeps a team with orders and no без квал, with no percent and access', () => {
    const p = buildGroupPlan({ from: '2026-10-01', report, bezkval: [] })
    expect(p.rows.map((r) => [r.rop, r.percent, r.mayTakeLeads])).toEqual([
      ['Azizbek', null, true],
      ['Sevinch', null, true],
    ])
  })

  it('folds an old team name and names a headless team by itself', () => {
    const p = buildGroupPlan({
      from: '2026-10-01',
      report: buildRopReport({ day: '2026-10-13', roster: [], names: new Map(), calls: null, leads: [], fakt: [] }),
      bezkval: [{ rop: 'Sevinchxon', leads: 5 }],
    })
    expect(p.rows.map((r) => [r.rop, r.fullName, r.leads])).toEqual([['Sadriddin', null, 5]])
  })
})
