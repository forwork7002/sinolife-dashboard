/**
 * «Sotuv · ROP» — the client's two ROP sheets, on «Reklama samarasi».
 *
 * Asked for on 2026-09-23 with the rest of the ad sheets («4 va 5-jadvalni
 * qil»):
 *
 *   The group sheet, ONE DAY — per seller of a ROP team: ЛИД СОНИ, ЛИД РУЧ,
 *     ПЛАН, fact, ОТКЛОНЕНИЕ, ТРАНЗ, КОНВЕР; the team's total and its
 *     «бажарилиш». Checked against the sheet of 18.09.2026 (Husniddin
 *     gruppa): the plan is the sellers' day plans summed (25 000 000), the
 *     completion is fact over it (21 400 000 → 85.6%), the conversion is
 *     ТРАНЗ over ЛИД (3 of 10 → 30%).
 *   The ROP sheet, ONE MONTH, day by day — «Продажа (первичка)»: conversion
 *     from qualified leads, average cheque, orders, FAKT 1, plan completion,
 *     headcount, then FAKT 2 and its transactions, conversion and cheque;
 *     the month against the ROP's plan, with the run-rate forecast.
 *
 * WHERE EACH NUMBER COMES FROM:
 *   ЛИД / ЛИД РУЧ — Первичный отдел deals (`SalesTeamRepository.leadDays`).
 *   FAKT 1 / FAKT 2 / ТРАНЗ — the sellers board's own queue cohort, credited
 *     to the operator (`InsightsRepository.salesTeamDays`), so a team's month
 *     here equals its row on Sotuvchilar reytingi.
 *   Plans — typed in by an administrator (`seller_day_plan`,
 *     `team_month_plan`); nothing in Bitrix24 holds them.
 *
 * The day's plan completion on the ROP sheet is FAKT 1 over the day plans of
 * the sellers who WORKED that day (a lead or an order) — the sheet's 129% on
 * a five-person day is not a thirtieth of the monthly plan, it is that day's
 * people against their own plans.
 */

import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import { type Period, resolvePeriod, zonedDateKey } from '@/server/domain/period/period'
import type { InsightsRepository, SalesTeamDayRow } from '@/server/repositories/insightsRepository'
import type {
  PlanRows,
  SalesTeamRepository,
  SellerLeadDayRow,
  TeamMember,
} from '@/server/repositories/salesTeamRepository'

import { ttlCache } from './ttlCache'

// ---------------------------------------------------------------------------
// DTOs — mirrored in `src/features/reklama/salesTeamApi.ts`
// ---------------------------------------------------------------------------

/** What a set of sellers did over a span — one day, or the month. */
export interface SalesCellsDto {
  /** Первичный отдел deals handed over from Регистрация. */
  readonly leads: number
  /** …opened by the seller with no Регистрация lead behind them. */
  readonly manualLeads: number
  /** FAKT 1 orders — ТРАНЗ. */
  readonly orders: number
  readonly fakt1: MoneyDto
  readonly fakt2Orders: number
  readonly fakt2: MoneyDto
  /** orders ÷ (leads + manualLeads). */
  readonly conversionPercent: number | null
  /** fakt2Orders ÷ (leads + manualLeads). */
  readonly conversion2Percent: number | null
  readonly averageCheque1: MoneyDto | null
  readonly averageCheque2: MoneyDto | null
  /** Sellers with a lead or an order in the span. */
  readonly headcount: number
}

export interface SalesDayDto extends SalesCellsDto {
  readonly date: string
  /** The day plans of the sellers who worked that day, summed. */
  readonly plan: MoneyDto | null
  /** fakt1 ÷ plan. */
  readonly planPercent: number | null
}

/** One row of the group sheet: a seller on the chosen day. */
export interface SalesSellerDto {
  readonly employeeId: string
  readonly fullName: string
  readonly leads: number
  readonly manualLeads: number
  /** Their day plan, or null when none is set. */
  readonly plan: MoneyDto | null
  readonly fakt1: MoneyDto
  /** fakt1 − plan; null without a plan. */
  readonly deviation: MoneyDto | null
  readonly orders: number
  readonly conversionPercent: number | null
  /** On the roster of a ROP department (false: credited here from elsewhere). */
  readonly onRoster: boolean
}

export interface SalesTeamDto {
  readonly rop: string
  readonly plan: {
    readonly fakt1: MoneyDto | null
    readonly fakt2: MoneyDto | null
  }
  readonly month: SalesCellsDto & {
    readonly fakt1Percent: number | null
    readonly fakt2Percent: number | null
    /** FAKT 1 at today's pace to the month's end; null outside the current month. */
    readonly fakt1Forecast: MoneyDto | null
    readonly fakt1ForecastPercent: number | null
  }
  readonly days: readonly SalesDayDto[]
  /** The group sheet for the chosen day. */
  readonly day: {
    readonly date: string
    readonly sellers: readonly SalesSellerDto[]
    readonly total: SalesCellsDto & {
      readonly plan: MoneyDto | null
      readonly deviation: MoneyDto | null
      readonly planPercent: number | null
    }
  }
  /** The roster with each seller's day plan — what the plan form edits. */
  readonly roster: readonly { employeeId: string; fullName: string; dayPlan: MoneyDto | null }[]
}

export interface SalesTeamOverviewDto {
  /** `YYYY-MM`. */
  readonly month: string
  /** `YYYY-MM-DD`, inside the month. */
  readonly day: string
  readonly daysInMonth: number
  /** Days of the month already lived; the forecast's denominator. */
  readonly elapsedDays: number
  readonly teams: readonly SalesTeamDto[]
  /** Whether this reader may change the plans. */
  readonly canEditPlans: boolean
}

// ---------------------------------------------------------------------------

const CURRENCY = 'UZS'
const uzs = (minor: bigint): MoneyDto => toMoneyDto(money(minor, CURRENCY))

function percent(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null
}

function ratioMinor(n: bigint, d: bigint): number | null {
  return d > 0n ? (Number(n) / Number(d)) * 100 : null
}

interface Acc {
  leads: number
  manualLeads: number
  orders: number
  fakt1: bigint
  fakt2Orders: number
  fakt2: bigint
  workers: Set<string>
}

const zero = (): Acc => ({
  leads: 0,
  manualLeads: 0,
  orders: 0,
  fakt1: 0n,
  fakt2Orders: 0,
  fakt2: 0n,
  workers: new Set<string>(),
})

function add(into: Acc, from: Acc): void {
  into.leads += from.leads
  into.manualLeads += from.manualLeads
  into.orders += from.orders
  into.fakt1 += from.fakt1
  into.fakt2Orders += from.fakt2Orders
  into.fakt2 += from.fakt2
  for (const w of from.workers) into.workers.add(w)
}

function cells(a: Acc): SalesCellsDto {
  const all = a.leads + a.manualLeads
  return {
    leads: a.leads,
    manualLeads: a.manualLeads,
    orders: a.orders,
    fakt1: uzs(a.fakt1),
    fakt2Orders: a.fakt2Orders,
    fakt2: uzs(a.fakt2),
    conversionPercent: percent(a.orders, all),
    conversion2Percent: percent(a.fakt2Orders, all),
    averageCheque1: a.orders > 0 ? uzs(a.fakt1 / BigInt(a.orders)) : null,
    averageCheque2: a.fakt2Orders > 0 ? uzs(a.fakt2 / BigInt(a.fakt2Orders)) : null,
    headcount: a.workers.size,
  }
}

/** Every day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function monthDays(month: string): string[] {
  const out: string[] = []
  for (let d = new Date(`${month}-01T00:00:00Z`); d.toISOString().startsWith(month); d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * The whole screen from its rows. Exported for its test.
 *
 * Teams are the ROP rosters plus any team the cohort credited orders to; a
 * person with orders and no roster place (moved, or parked in a back-office
 * unit that still names a ROP) is listed under the team their orders name,
 * marked off the roster.
 */
export function salesTeamOverview(input: {
  month: string
  day: string
  today: string
  faktRows: readonly SalesTeamDayRow[]
  leadRows: readonly SellerLeadDayRow[]
  members: readonly TeamMember[]
  names: ReadonlyMap<string, string>
  plans: PlanRows
  canEditPlans: boolean
}): SalesTeamOverviewDto {
  const days = monthDays(input.month)
  const elapsedDays =
    input.today < days[0]! ? 0 : input.today > days[days.length - 1]! ? days.length : days.indexOf(input.today) + 1

  const dayPlan = new Map(input.plans.sellers.map((p) => [p.employeeId, p.amountMinor]))
  const teamPlan = new Map(input.plans.teams.map((p) => [p.rop, p]))

  // team → seller → day → Acc
  const grid = new Map<string, Map<string, Map<string, Acc>>>()
  const cell = (rop: string, seller: string, date: string): Acc => {
    const team = grid.get(rop) ?? new Map<string, Map<string, Acc>>()
    grid.set(rop, team)
    const person = team.get(seller) ?? new Map<string, Acc>()
    team.set(seller, person)
    const acc = person.get(date) ?? zero()
    person.set(date, acc)
    return acc
  }

  for (const r of input.leadRows) {
    if (r.rop === null) continue
    const acc = cell(r.rop, r.employeeId, r.day)
    acc.leads += r.leads
    acc.manualLeads += r.manualLeads
    if (r.leads + r.manualLeads > 0) acc.workers.add(r.employeeId)
  }
  for (const r of input.faktRows) {
    if (r.rop === null) continue
    const acc = cell(r.rop, r.employeeId, r.day)
    acc.orders += r.confirmedOrders
    acc.fakt1 += r.confirmedMinor
    acc.fakt2Orders += r.deliveredOrders
    acc.fakt2 += r.deliveredMinor
    if (r.cohortOrders > 0) acc.workers.add(r.employeeId)
  }

  const roster = new Map<string, TeamMember[]>()
  for (const m of input.members) {
    roster.set(m.rop, [...(roster.get(m.rop) ?? []), m])
    if (!grid.has(m.rop)) grid.set(m.rop, new Map())
  }
  const nameOf = (id: string) =>
    input.members.find((m) => m.employeeId === id)?.fullName ?? input.names.get(id) ?? id

  const teams: SalesTeamDto[] = [...grid.entries()].map(([rop, people]) => {
    const onRoster = new Set((roster.get(rop) ?? []).map((m) => m.employeeId))
    const everyone = [...new Set([...onRoster, ...people.keys()])]

    // --- month, day by day
    const month = zero()
    const dayRows: SalesDayDto[] = days.map((date) => {
      const acc = zero()
      let plan = 0n
      let planned = false
      for (const id of everyone) {
        const c = people.get(id)?.get(date)
        if (!c) continue
        add(acc, c)
        const p = dayPlan.get(id)
        if (c.workers.size > 0 && p !== undefined) {
          plan += p
          planned = true
        }
      }
      add(month, acc)
      return {
        date,
        ...cells(acc),
        plan: planned ? uzs(plan) : null,
        planPercent: planned ? ratioMinor(acc.fakt1, plan) : null,
      }
    })

    const tp = teamPlan.get(rop)
    const fakt1Plan = tp?.fakt1Minor ?? null
    const fakt2Plan = tp?.fakt2Minor ?? null
    const current = input.today >= days[0]! && input.today <= days[days.length - 1]!
    const forecast =
      current && elapsedDays > 0 ? (month.fakt1 * BigInt(days.length)) / BigInt(elapsedDays) : null

    // --- the group sheet for the chosen day
    const dayTotal = zero()
    let dayPlanSum = 0n
    let dayPlanned = false
    const sellers: SalesSellerDto[] = everyone
      .map((id) => {
        const c = people.get(id)?.get(input.day) ?? zero()
        add(dayTotal, c)
        const p = dayPlan.get(id) ?? null
        if (p !== null && onRoster.has(id)) {
          dayPlanSum += p
          dayPlanned = true
        }
        return {
          employeeId: id,
          fullName: nameOf(id),
          leads: c.leads,
          manualLeads: c.manualLeads,
          plan: p === null ? null : uzs(p),
          fakt1: uzs(c.fakt1),
          deviation: p === null ? null : uzs(c.fakt1 - p),
          orders: c.orders,
          conversionPercent: percent(c.orders, c.leads + c.manualLeads),
          onRoster: onRoster.has(id),
        }
      })
      // Off-roster people only when they did something that day.
      .filter((s) => s.onRoster || s.leads + s.manualLeads + s.orders > 0 || s.fakt1.amountMinor !== '0')
      .sort(
        (a, b) =>
          Number(BigInt(b.fakt1.amountMinor) - BigInt(a.fakt1.amountMinor)) ||
          b.leads - a.leads ||
          a.fullName.localeCompare(b.fullName, 'ru'),
      )

    return {
      rop,
      plan: {
        fakt1: fakt1Plan === null ? null : uzs(fakt1Plan),
        fakt2: fakt2Plan === null ? null : uzs(fakt2Plan),
      },
      month: {
        ...cells(month),
        fakt1Percent: fakt1Plan === null ? null : ratioMinor(month.fakt1, fakt1Plan),
        fakt2Percent: fakt2Plan === null ? null : ratioMinor(month.fakt2, fakt2Plan),
        fakt1Forecast: forecast === null ? null : uzs(forecast),
        fakt1ForecastPercent: forecast === null || fakt1Plan === null ? null : ratioMinor(forecast, fakt1Plan),
      },
      days: dayRows,
      day: {
        date: input.day,
        sellers,
        total: {
          ...cells(dayTotal),
          plan: dayPlanned ? uzs(dayPlanSum) : null,
          deviation: dayPlanned ? uzs(dayTotal.fakt1 - dayPlanSum) : null,
          planPercent: dayPlanned ? ratioMinor(dayTotal.fakt1, dayPlanSum) : null,
        },
      },
      roster: (roster.get(rop) ?? [])
        .map((m) => {
          const p = dayPlan.get(m.employeeId)
          return { employeeId: m.employeeId, fullName: m.fullName, dayPlan: p === undefined ? null : uzs(p) }
        })
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')),
    }
  })

  return {
    month: input.month,
    day: input.day,
    daysInMonth: days.length,
    elapsedDays,
    // Biggest FAKT 1 first — the order the sellers board ranks teams in.
    teams: teams.sort(
      (a, b) =>
        Number(BigInt(b.month.fakt1.amountMinor) - BigInt(a.month.fakt1.amountMinor)) ||
        a.rop.localeCompare(b.rop, 'ru'),
    ),
    canEditPlans: input.canEditPlans,
  }
}

/** The month as a dashboard Period — its first to its last Tashkent day. */
export function monthPeriod(month: string, timeZone: string, now: Date): Period {
  const days = monthDays(month)
  return resolvePeriod('custom', {
    timeZone,
    now,
    customStart: new Date(`${days[0]}T00:00:00Z`),
    customEnd: new Date(`${days[days.length - 1]}T00:00:00Z`),
  })
}

/*
  A memo keyed by the month. Company-wide by construction — the route refuses
  a narrowed account — and the plans are read fresh every time, so a saved
  plan shows on the next load rather than a minute later.
*/
const cohortCache = ttlCache<{ fakt: SalesTeamDayRow[]; leads: SellerLeadDayRow[] }>(60_000)

export function resetSalesTeamCaches(): void {
  cohortCache.clear()
}

export class SalesTeamService {
  constructor(
    private readonly insights: InsightsRepository,
    private readonly repository: SalesTeamRepository,
  ) {}

  async overview(input: {
    month: string
    day: string | undefined
    timeZone: string
    now: Date
    canEditPlans: boolean
  }): Promise<SalesTeamOverviewDto> {
    const today = zonedDateKey(input.now, input.timeZone)
    const days = monthDays(input.month)
    // The chosen day, clamped into the month: today in the current month,
    // the last day of a past one.
    const day =
      input.day && input.day.startsWith(input.month)
        ? input.day
        : today.startsWith(input.month)
          ? today
          : days[days.length - 1]!
    const period = monthPeriod(input.month, input.timeZone, input.now)

    const [cohort, members, plans] = await Promise.all([
      cohortCache.get(input.month, async () => {
        const [fakt, leads] = await Promise.all([
          this.insights.salesTeamDays(period),
          this.repository.leadDays(period),
        ])
        return { fakt, leads }
      }),
      this.repository.members(),
      this.repository.plans(input.month),
    ])
    const rostered = new Set(members.map((m) => m.employeeId))
    const names = await this.repository.names(
      [...new Set(cohort.fakt.map((r) => r.employeeId))].filter((id) => !rostered.has(id)),
    )

    return salesTeamOverview({
      month: input.month,
      day,
      today,
      faktRows: cohort.fakt,
      leadRows: cohort.leads,
      members,
      names,
      plans,
      canEditPlans: input.canEditPlans,
    })
  }

  savePlans: SalesTeamRepository['savePlans'] = (month, input, by) => this.repository.savePlans(month, input, by)
}
