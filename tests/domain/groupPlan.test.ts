import { describe, expect, it } from 'vitest'

import { buildGroupPlan, monthStart } from '@/server/domain/registration/groupPlan'
import { buildRopReport, type RosterMember, type SellerFaktRow } from '@/server/domain/registration/ropReport'

/*
  «Guruhlar» — the client's seller sheet of 2026-10-03: Shaxnoza 18 usp,
  14 600 000 ordered → reja 9 000 000, 162,2 %, «+5 600 000 ortiqcha»;
  Asilbek N 14 usp, 6 700 000 → −300 000; Jo'rabek 4 usp, nothing ordered.
*/

const roster: RosterMember[] = [
  { employeeId: 'aziz', fullName: 'Azizbek ROP', rop: 'Azizbek', isHead: true },
  { employeeId: 'shax', fullName: 'Shaxnoza', rop: 'Azizbek', isHead: false },
  { employeeId: 'asil', fullName: 'Asilbek N', rop: 'Azizbek', isHead: false },
  { employeeId: 'jora', fullName: "Jo'rabek", rop: 'Azizbek', isHead: false },
]

const fakt = (employeeId: string, som: number, orders: number): SellerFaktRow => ({
  employeeId,
  rop: 'Azizbek',
  fakt1Minor: BigInt(som) * 100n,
  fakt1Orders: orders,
  fakt2Minor: 0n,
  fakt2Orders: 0,
})

const report = buildRopReport({
  day: '2026-10-03',
  roster,
  names: new Map(),
  calls: null,
  leads: [
    { rop: 'Azizbek', employeeId: 'shax', leads: 18 },
    { rop: 'Azizbek', employeeId: 'asil', leads: 14 },
    { rop: 'Azizbek', employeeId: 'jora', leads: 4 },
  ],
  fakt: [fakt('shax', 14_600_000, 9), fakt('asil', 6_700_000, 4)],
})
const plan = buildGroupPlan({ from: '2026-10-01', report })
const team = plan.groups[0]!
const som = (n: number) => String(BigInt(n) * 100n)

describe('buildGroupPlan', () => {
  it('runs from the first of the month to the day', () => {
    expect(monthStart('2026-10-03')).toBe('2026-10-01')
    expect(plan.from).toBe('2026-10-01')
    expect(plan.to).toBe('2026-10-03')
  })

  it('plans 500 000 per kval lead and owes Buyurtma − Reja, the sheet\'s sign', () => {
    const shax = team.sellers.find((s) => s.employeeId === 'shax')!
    expect(shax.leads).toBe(18)
    expect(shax.plan.amountMinor).toBe(som(9_000_000))
    expect(shax.orders.amountMinor).toBe(som(14_600_000))
    expect(shax.percent).toBeCloseTo(162.2, 1)
    expect(shax.debt.amountMinor).toBe(som(5_600_000))
    const asil = team.sellers.find((s) => s.employeeId === 'asil')!
    expect(asil.debt.amountMinor).toBe(som(-300_000))
    const jora = team.sellers.find((s) => s.employeeId === 'jora')!
    expect(jora.percent).toBe(0)
    expect(jora.debt.amountMinor).toBe(som(-2_000_000))
  })

  it('sorts the most ahead first and leaves out a rostered head with nothing', () => {
    expect(team.sellers.map((s) => s.employeeId)).toEqual(['shax', 'asil', 'jora'])
  })

  it('gives everybody access while the client has set no limit', () => {
    expect(team.sellers.every((s) => s.mayTakeLeads)).toBe(true)
  })

  it('totals the team and the company like the sheet\'s «Jami»', () => {
    expect(team.total.leads).toBe(36)
    expect(team.total.plan.amountMinor).toBe(som(18_000_000))
    expect(team.total.debt.amountMinor).toBe(som(21_300_000 - 18_000_000))
    expect(plan.total).toEqual(team.total)
  })

  it('has no percent without a plan', () => {
    const empty = buildGroupPlan({
      from: '2026-10-01',
      report: buildRopReport({ day: '2026-10-01', roster, names: new Map(), calls: null, leads: [], fakt: [fakt('shax', 1_000_000, 1)] }),
    })
    const shax = empty.groups[0]!.sellers[0]!
    expect(shax.percent).toBeNull()
    expect(shax.debt.amountMinor).toBe(som(1_000_000))
  })

  it('puts nobody\'s leads last, with no Dostup, and splits a seller who changed team', () => {
    const two = buildGroupPlan({
      from: '2026-10-01',
      report: buildRopReport({
        day: '2026-10-03',
        roster: [...roster, { employeeId: 'sev', fullName: 'Sevinch ROP', rop: 'Sevinch', isHead: true }],
        names: new Map(),
        calls: null,
        leads: [
          { rop: 'Azizbek', employeeId: null, leads: 3 },
          { rop: 'Azizbek', employeeId: 'shax', leads: 2 },
          { rop: 'Sevinch', employeeId: 'sev', leads: 1 },
        ],
        // Shaxnoza's orders name Sevinch's team: a row in each.
        fakt: [{ ...fakt('shax', 4_000_000, 2), rop: 'Sevinch' }],
      }),
    })
    const aziz = two.groups.find((g) => g.rop === 'Azizbek')!
    expect(aziz.sellers.map((s) => [s.employeeId, s.mayTakeLeads])).toEqual([
      ['shax', true],
      ['∅', null],
    ])
    const sev = two.groups.find((g) => g.rop === 'Sevinch')!
    expect(sev.sellers.find((s) => s.employeeId === 'shax')!.debt.amountMinor).toBe(som(4_000_000))
    const sum = (k: 'leads') => two.groups.reduce((n, g) => n + g.total[k], 0)
    expect(two.total.leads).toBe(sum('leads'))
    expect(two.total.debt.amountMinor).toBe(som(4_000_000 - 6 * 500_000))
  })
})
