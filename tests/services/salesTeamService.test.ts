import { describe, expect, it } from 'vitest'

import type { SalesTeamDayRow } from '@/server/repositories/insightsRepository'
import type { SellerLeadDayRow, TeamMember } from '@/server/repositories/salesTeamRepository'

/*
  The repositories read `env` at module scope for APP_TIMEZONE, and `env`
  refuses to load without a complete configuration — the preamble
  `cohortsSql.test.ts` explains.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { monthDays, salesTeamOverview } = await import('@/server/services/salesTeamService')
const { SalesTeamRepository } = await import('@/server/repositories/salesTeamRepository')
const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

const M = 1_000_000n * 100n // one million soʻm, in minor units

const member = (employeeId: string, rop = 'Husniddin'): TeamMember => ({ employeeId, fullName: employeeId, rop })

const fakt = (day: string, employeeId: string, orders: number, fakt1: bigint, over: Partial<SalesTeamDayRow> = {}): SalesTeamDayRow => ({
  day,
  employeeId,
  rop: 'Husniddin',
  cohortOrders: orders,
  confirmedOrders: orders,
  confirmedMinor: fakt1,
  deliveredOrders: 0,
  deliveredMinor: 0n,
  ...over,
})

const leads = (day: string, employeeId: string, n: number, manual = 0, rop: string | null = 'Husniddin'): SellerLeadDayRow => ({
  day,
  employeeId,
  rop,
  leads: n,
  manualLeads: manual,
})

const DAY = '2026-09-18'

/** The group sheet of 18.09.2026, Husniddin gruppa, as the client sent it. */
function husniddin() {
  const plan = (employeeId: string, millions: number) => ({ employeeId, amountMinor: (M * BigInt(millions * 10)) / 10n })
  return salesTeamOverview({
    month: '2026-09',
    day: DAY,
    today: '2026-09-23',
    members: ['Niginabonu', 'Bashorat', 'Nilufar', 'Mahliyo', 'Lobar', 'Diyora', 'Stajor137', 'Stajor138', 'Sitora', 'Lola'].map((n) =>
      member(n),
    ),
    names: new Map(),
    leadRows: [
      leads(DAY, 'Niginabonu', 10),
      leads(DAY, 'Bashorat', 9),
      leads(DAY, 'Nilufar', 7),
      leads(DAY, 'Mahliyo', 7),
      leads(DAY, 'Lobar', 7),
      leads(DAY, 'Diyora', 5),
      leads(DAY, 'Sitora', 5),
    ],
    faktRows: [
      fakt(DAY, 'Niginabonu', 3, 66n * M / 10n),
      fakt(DAY, 'Bashorat', 4, 75n * M / 10n),
      fakt(DAY, 'Nilufar', 2, 36n * M / 10n),
      fakt(DAY, 'Mahliyo', 1, 17n * M / 10n),
      fakt(DAY, 'Lobar', 1, 10n * M / 10n),
      fakt(DAY, 'Sitora', 1, 10n * M / 10n),
    ],
    plans: {
      sellers: [
        plan('Niginabonu', 5),
        plan('Bashorat', 4.5),
        plan('Nilufar', 3.5),
        plan('Mahliyo', 3.5),
        plan('Lobar', 3.5),
        plan('Diyora', 2.5),
        plan('Sitora', 2.5),
      ],
      teams: [{ rop: 'Husniddin', fakt1Minor: 620n * M, fakt2Minor: 500n * M }],
    },
    canEditPlans: true,
  })
}

describe('salesTeamOverview — the group sheet for one day', () => {
  it('reproduces Husniddin gruppa on 18.09.2026: plan 25 mln, fact 21.4 mln, 85.6%', () => {
    const team = husniddin().teams[0]!
    const total = team.day.total
    expect(total.plan?.amountMinor).toBe(String(25n * M))
    expect(total.fakt1.amountMinor).toBe(String(214n * M / 10n))
    expect(total.deviation?.amountMinor).toBe(String(-36n * M / 10n))
    expect(total.planPercent).toBeCloseTo(85.6, 9)
    expect(total.leads).toBe(50)
    expect(total.orders).toBe(12)
    expect(total.conversionPercent).toBeCloseTo(24, 9)
  })

  it('prints each seller\'s plan, deviation and ТРАНЗ ÷ ЛИД — Niginabonu 3 of 10', () => {
    const row = husniddin().teams[0]!.day.sellers.find((s) => s.employeeId === 'Niginabonu')!
    expect(row).toMatchObject({ leads: 10, orders: 3, onRoster: true })
    expect(row.plan?.amountMinor).toBe(String(5n * M))
    expect(row.deviation?.amountMinor).toBe(String(16n * M / 10n))
    expect(row.conversionPercent).toBeCloseTo(30, 9)
  })

  it('lists a roster seller who did nothing at zero, with no plan rather than a zero plan', () => {
    const row = husniddin().teams[0]!.day.sellers.find((s) => s.employeeId === 'Lola')!
    expect(row).toMatchObject({ leads: 0, orders: 0, plan: null, deviation: null, conversionPercent: null })
  })
})

describe('salesTeamOverview — the ROP sheet for the month', () => {
  it('measures the month against the ROP plan and forecasts FAKT 1 at today\'s pace', () => {
    const out = husniddin()
    const month = out.teams[0]!.month
    expect(out.daysInMonth).toBe(30)
    expect(out.elapsedDays).toBe(23)
    expect(month.fakt1Percent).toBeCloseTo((21.4 / 620) * 100, 9)
    // 21.4 mln in 23 days → 30 days.
    expect(month.fakt1Forecast?.amountMinor).toBe(String((214n * M / 10n) * 30n / 23n))
  })

  it('counts a day\'s plan over the sellers who WORKED it, and its headcount', () => {
    const day = husniddin().teams[0]!.days.find((d) => d.date === DAY)!
    // Seven sellers worked; all seven have plans: 25 mln.
    expect(day.headcount).toBe(7)
    expect(day.plan?.amountMinor).toBe(String(25n * M))
    expect(day.planPercent).toBeCloseTo(85.6, 9)
    // A day nobody worked has no plan to miss.
    const quiet = husniddin().teams[0]!.days.find((d) => d.date === '2026-09-01')!
    expect(quiet).toMatchObject({ headcount: 0, plan: null, planPercent: null })
  })

  it('has no forecast outside the current month', () => {
    const out = salesTeamOverview({
      month: '2026-08',
      day: '2026-08-31',
      today: '2026-09-23',
      members: [member('A')],
      names: new Map(),
      leadRows: [],
      faktRows: [fakt('2026-08-10', 'A', 1, M)],
      plans: { sellers: [], teams: [] },
      canEditPlans: false,
    })
    expect(out.elapsedDays).toBe(31)
    expect(out.teams[0]!.month.fakt1Forecast).toBeNull()
    expect(out.teams[0]!.plan).toEqual({ fakt1: null, fakt2: null })
  })

  it('keeps FAKT 2 separate, with its own transactions, conversion and cheque', () => {
    const out = salesTeamOverview({
      month: '2026-09',
      day: DAY,
      today: DAY,
      members: [member('A')],
      names: new Map(),
      leadRows: [leads(DAY, 'A', 4)],
      faktRows: [fakt(DAY, 'A', 2, 3n * M, { deliveredOrders: 1, deliveredMinor: 2n * M })],
      plans: { sellers: [], teams: [] },
      canEditPlans: false,
    })
    const m = out.teams[0]!.month
    expect(m).toMatchObject({ orders: 2, fakt2Orders: 1 })
    expect(m.conversion2Percent).toBeCloseTo(25, 9)
    expect(m.averageCheque1?.amountMinor).toBe(String(15n * M / 10n))
    expect(m.averageCheque2?.amountMinor).toBe(String(2n * M))
  })

  it('credits an off-roster seller to the team their orders name, marked as such, and drops no-team rows', () => {
    const out = salesTeamOverview({
      month: '2026-09',
      day: DAY,
      today: DAY,
      members: [member('A')],
      names: new Map([['B', 'Boshqa Sotuvchi']]),
      leadRows: [leads(DAY, 'X', 3, 0, null)],
      faktRows: [fakt(DAY, 'B', 1, M), fakt(DAY, 'X', 1, M, { rop: null })],
      plans: { sellers: [], teams: [] },
      canEditPlans: false,
    })
    expect(out.teams).toHaveLength(1)
    const b = out.teams[0]!.day.sellers.find((s) => s.employeeId === 'B')!
    expect(b).toMatchObject({ fullName: 'Boshqa Sotuvchi', onRoster: false, orders: 1 })
    expect(out.teams[0]!.month.fakt1.amountMinor).toBe(String(M))
  })
})

describe('monthDays', () => {
  it('lists a month, including a leap February', () => {
    expect(monthDays('2026-09')).toHaveLength(30)
    expect(monthDays('2028-02')).toHaveLength(29)
    expect(monthDays('2026-12').at(-1)).toBe('2026-12-31')
  })
})

describe('the statements', () => {
  const named = (sql: string) =>
    [...new Set([...sql.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort()

  it('leadDaysSql binds exactly $1–$4 and reads Первичный отдел against Регистрация', () => {
    const sql = SalesTeamRepository.leadDaysSql()
    expect(named(sql)).toEqual([1, 2, 3, 4])
    expect(sql).toContain(`p."role" = 'QUALIFICATION'`)
    expect(sql).toContain(`lp."role" = 'LEAD'`)
  })

  it('salesTeamDaysSql reads the board\'s own FAKT predicates from its own cohort', () => {
    const sql = InsightsRepository.salesTeamDaysSql()
    expect(sql).toContain(`c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')`)
    expect(sql).toContain(`ds."logisticsRole" = 'DELIVERED'`)
    expect(sql).toContain('FROM scoped c')
    expect(sql).toContain('c.operator_id')
  })
})
