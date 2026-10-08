/**
 * «Guruhlar» on «Lidlar» — the client's seller sheet (2026-10-03): «Mutahasis ·
 * Usp soni · Reja (Avto) · Buyurtma summasi · Bajarilish % · Qarz · Dostup»,
 * every ROP team apart and «Jami» at the foot. It replaced the «безквал /
 * квал» group report the same day. The point, in the user's words: a kval
 * lead is worth 500 000 to the seller who takes it, and a seller whose orders
 * outrun that may be given more leads.
 *
 * FROM THE FIRST OF THE MONTH TO THE CHOSEN DAY, inclusive: the debt builds
 * over the month (the user's choice).
 *
 * WHERE EACH NUMBER COMES FROM — «ROP otchet»'s own figures (`ropReport.ts`)
 * summed over those days, so a month here is the sum of its days there:
 *   Usp soni — the seller's kval leads («Квал лид сони»).
 *   Reja (Avto) — 500 000 × Usp soni («План»).
 *   Buyurtma summasi — Факт-1.
 *   Bajarilish % — Buyurtma ÷ Reja; null with no plan.
 *   Qarz — Buyurtma − Reja: above zero the seller is ahead («ortiqcha»).
 *     The sign is the client's sheet's, the opposite of «Отклонение».
 *   Dostup — whether the seller may take more leads. The client has not set
 *     the debt that closes it yet (2026-10-03), so everybody may.
 *
 * Who is a row: anybody the month credited with a lead or an order. A
 * rostered seller with neither has nothing to owe and is left out. Kval
 * leads that name no seller are one last row of the no-team group, «Hech
 * kimga biriktirilmagan» — no person, so no Dostup. Rows run by Qarz, the
 * most ahead first, as on the sheet (not head first, as «ROP otchet» does).
 *
 * A ROW IS A PERSON IN ONE TEAM, as on «ROP otchet»: the leads sit under the
 * team the seller is in today, so a seller whose orders name another (a move
 * mid-month) is a row in each, the plan on one and the orders on the other.
 * The totals stay right; a debt threshold for Dostup, once the client names
 * one, must net the person's rows first.
 *
 * Pure: «ROP otchet» in, a DTO out.
 */

import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'

import type { RopReportCellsDto, RopReportDto } from './ropReport'

/** `buildRopReport`'s id for the kval leads that name no seller. */
const NOBODY = '∅'

const CURRENCY = 'UZS'

export interface GroupPlanCellsDto {
  /** Usp soni. */
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

export interface GroupPlanSellerDto extends GroupPlanCellsDto {
  readonly employeeId: string
  readonly fullName: string
  /** Dostup; null on the «Hech kimga biriktirilmagan» row, which is nobody. */
  readonly mayTakeLeads: boolean | null
}

export interface GroupPlanGroupDto {
  /** Null: the leads and orders that name no team. */
  readonly rop: string | null
  readonly sellers: readonly GroupPlanSellerDto[]
  readonly total: GroupPlanCellsDto
}

export interface GroupPlanDto {
  /** The first of the month, `YYYY-MM-DD`. */
  readonly from: string
  /** The chosen day. */
  readonly to: string
  readonly groups: readonly GroupPlanGroupDto[]
  readonly total: GroupPlanCellsDto
}

/** The first of `day`'s month. */
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`

function cells(c: RopReportCellsDto): GroupPlanCellsDto {
  const plan = BigInt(c.plan.amountMinor)
  const orders = BigInt(c.fakt1.amountMinor)
  return {
    leads: c.leads,
    plan: c.plan,
    orders: c.fakt1,
    percent: plan > 0n ? (Number(orders) / Number(plan)) * 100 : null,
    debt: toMoneyDto(money(orders - plan, CURRENCY)),
  }
}

export function buildGroupPlan(input: { from: string; report: RopReportDto }): GroupPlanDto {
  const groups = input.report.groups
    .map((g): GroupPlanGroupDto => ({
      rop: g.rop,
      sellers: g.sellers
        .filter((s) => s.leads > 0 || s.fakt1Orders > 0)
        .map((s) => ({ employeeId: s.employeeId, fullName: s.fullName, mayTakeLeads: s.employeeId === NOBODY ? null : true, ...cells(s) }))
        // The sheet's order: the most ahead first, the deepest debt last; nobody's leads after everybody.
        .sort(
          (a, b) =>
            Number(a.employeeId === NOBODY) - Number(b.employeeId === NOBODY) ||
            Number(BigInt(b.debt.amountMinor) - BigInt(a.debt.amountMinor)) ||
            a.fullName.localeCompare(b.fullName, 'ru'),
        ),
      total: cells(g.total),
    }))
    .filter((g) => g.sellers.length > 0)
  return { from: input.from, to: input.report.day, groups, total: cells(input.report.total) }
}
