/**
 * «Guruhlar» on «Lidlar» — the client's sheet «Mutahasis · Usp soni · Reja
 * (Avto) · Buyurtma summasi · Bajarilish % · Qarz · Dostup», one row PER
 * ROP and «Jami» at the foot. Seller by seller from 2026-10-03; ROPs only
 * since 2026-10-13 (the user: «сотувчилара эмас факат роплар руйхати»).
 *
 * FROM THE FIRST OF THE MONTH TO THE CHOSEN DAY, inclusive: the debt builds
 * over the month (the user's choice).
 *
 * WHERE EACH NUMBER COMES FROM:
 *   Usp soni — the team's «без квал» (2026-10-13): the clients of those
 *     days credited to the ROP (`registration/bezkval.ts` since 2026-10-22), the
 *     /rnp group row «без квал» and /leads «Безквал» — so the three agree.
 *   Reja (Avto) — 200 000 × Usp soni (the user: «без квал ракам сонини
 *     *200.000 купайтириб план»).
 *   Buyurtma summasi — the team's Факт-1, «ROP otchet»'s «Umumiy» summed
 *     over the days.
 *   Bajarilish % — Buyurtma ÷ Reja; null with no plan.
 *   Qarz — Buyurtma − Reja: above zero the team is ahead («ortiqcha»).
 *     The sign is the client's sheet's, the opposite of «Отклонение».
 *   Dostup — «Ruxsat emas» on a red Qarz (below zero), else «Ruxsat»
 *     (2026-10-13, the same rule as «ROP otchet»'s Dostup).
 *
 * Who is a row: every ROP team with a без квал or an order in the month,
 * named by its head. The leads and orders that name no team are left out —
 * nobody's row, and Регистрация's ~500 unassigned deals a day would bury
 * «Jami» — so «Jami» is the ROPs' sum. Rows run by Qarz, the most ahead
 * first, as on the sheet.
 *
 * Pure: «ROP otchet» and the без квал days in, a DTO out.
 */

import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'

import { canonicalRop } from './leadSplit'
import type { RopReportDto } from './ropReport'

const CURRENCY = 'UZS'

/** «без квал ракам сонини *200.000», in minor units. */
export const PLAN_PER_BEZKVAL_MINOR = 200_000n * 100n

export interface GroupPlanCellsDto {
  /** Usp soni — the без квал count. */
  readonly leads: number
  /** Reja (Avto). */
  readonly plan: MoneyDto
  /** Buyurtma summasi — Факт-1. */
  readonly orders: MoneyDto
  /** Bajarilish % — orders ÷ plan × 100; null with no plan. */
  readonly percent: number | null
  /** Qarz — orders − plan: above zero, ahead of plan. */
  readonly debt: MoneyDto
}

export interface GroupPlanRowDto extends GroupPlanCellsDto {
  /** The ROP team. */
  readonly rop: string
  /** The team's head as the roster names them; null when the roster has no head for it. */
  readonly fullName: string | null
  /** Dostup: false on a red Qarz. */
  readonly mayTakeLeads: boolean
}

export interface GroupPlanDto {
  /** The first of the month, `YYYY-MM-DD`. */
  readonly from: string
  /** The chosen day. */
  readonly to: string
  readonly rows: readonly GroupPlanRowDto[]
  readonly total: GroupPlanCellsDto
}

/** One day's без квал of one team (`BezkvalDayRow` without its day). */
export interface GroupBezkvalRow {
  /** Null: no ROP — left out. */
  readonly rop: string | null
  readonly leads: number
}

/** The first of `day`'s month. */
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`

function cells(leads: number, orders: bigint): GroupPlanCellsDto {
  const plan = PLAN_PER_BEZKVAL_MINOR * BigInt(leads)
  return {
    leads,
    plan: toMoneyDto(money(plan, CURRENCY)),
    orders: toMoneyDto(money(orders, CURRENCY)),
    percent: plan > 0n ? (Number(orders) / Number(plan)) * 100 : null,
    debt: toMoneyDto(money(orders - plan, CURRENCY)),
  }
}

/**
 * `report` and `bezkval` must already be narrowed to the same brand: the
 * report by its groups, the без квал rows by their team.
 */
export function buildGroupPlan(input: { from: string; report: RopReportDto; bezkval: readonly GroupBezkvalRow[] }): GroupPlanDto {
  const teams = new Map<string, { head: string | null; leads: number; orders: bigint }>()
  const team = (rop: string) => {
    const t = teams.get(rop) ?? { head: null, leads: 0, orders: 0n }
    teams.set(rop, t)
    return t
  }
  for (const g of input.report.groups) {
    if (g.rop === null) continue
    const t = team(g.rop)
    t.orders += BigInt(g.total.fakt1.amountMinor)
    t.head ??= g.sellers.find((s) => s.isHead)?.fullName ?? null
  }
  for (const r of input.bezkval) if (r.rop !== null) team(canonicalRop(r.rop)).leads += r.leads

  let leads = 0
  let orders = 0n
  const rows = [...teams.entries()]
    .filter(([, t]) => t.leads > 0 || t.orders !== 0n)
    .map(([rop, t]): GroupPlanRowDto => {
      leads += t.leads
      orders += t.orders
      const c = cells(t.leads, t.orders)
      return { rop, fullName: t.head, mayTakeLeads: BigInt(c.debt.amountMinor) >= 0n, ...c }
    })
    // The sheet's order: the most ahead first, the deepest debt last.
    .sort((a, b) => Number(BigInt(b.debt.amountMinor) - BigInt(a.debt.amountMinor)) || a.rop.localeCompare(b.rop, 'ru'))
  return { from: input.from, to: input.report.day, rows, total: cells(leads, orders) }
}
