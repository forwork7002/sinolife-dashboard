/**
 * The day's ROP cards on «Lidlar» (once «Registratsiya») — the wire shapes, restated for the client.
 *
 * Mirrors `LeadSplitDto` in `src/server/domain/registration/leadSplit.ts` and
 * the body of `src/app/api/v1/registration/split/route.ts`. Nothing checks
 * the mirror — edit both sides.
 */

import type { MoneyDto } from '@/lib/api'

/** A share is in basis points: 15 % = 1 500; a day's split sums to this. */
export const SHARE_TOTAL_BP = 10_000

export interface SplitShare {
  readonly rop: string
  readonly shareBp: number
}

export interface LeadSplitRopDto {
  readonly rop: string
  readonly shareBp: number | null
  readonly planLeads: number | null
  readonly received: number
  readonly week: readonly number[]
}

export interface LeadSplitDto {
  readonly day: string
  readonly total: number
  readonly fresh: number
  readonly unassigned: number
  readonly rops: readonly LeadSplitRopDto[]
  readonly week: { readonly days: readonly string[]; readonly unassigned: readonly number[] }
  /** «Безквал»: Регистрация deals whose «Ответственный» heads the team, by creation day over `week.days`. */
  readonly bezkval: {
    readonly rops: readonly { readonly rop: string; readonly week: readonly number[] }[]
    readonly unassigned: readonly number[]
  }
  readonly split: { readonly updatedAt: string } | null
  readonly previous: { readonly day: string; readonly rows: readonly SplitShare[] } | null
  readonly canEdit: boolean
}

export interface SaveSplitBody {
  readonly day: string
  readonly rows: readonly SplitShare[]
}

/*
  «ROP otchet» — mirrors `RopReportDto` in
  `src/server/domain/registration/ropReport.ts`. Nothing checks the mirror.
*/

export interface RopReportCellsDto {
  readonly leads: number
  readonly plan: MoneyDto
  readonly fakt1: MoneyDto
  /** План − Факт-1: above zero, short of plan. */
  readonly deviation: MoneyDto
  readonly fakt1Orders: number
  readonly conversionPercent: number | null
  readonly fakt2: MoneyDto
  readonly fakt2Orders: number
  /** Дозвон; null before the call data floor. */
  readonly connectedCalls: number | null
  /** Длительность, seconds; null with `connectedCalls`. */
  readonly talkSec: number | null
}

export interface RopReportSellerDto extends RopReportCellsDto {
  readonly employeeId: string
  readonly fullName: string
  readonly isHead: boolean
  readonly onRoster: boolean
}

export interface RopReportGroupDto {
  /** Null: the leads and orders that name no team. */
  readonly rop: string | null
  readonly sellers: readonly RopReportSellerDto[]
  readonly total: RopReportCellsDto
}

export interface RopReportDto {
  readonly day: string
  readonly groups: readonly RopReportGroupDto[]
  readonly total: RopReportCellsDto
}

/*
  «Guruhlar» — mirrors `GroupPlanDto` in
  `src/server/domain/registration/groupPlan.ts`. Nothing checks the mirror.
*/

export interface GroupPlanCellsDto {
  /** Usp soni — the seller's kval leads. */
  readonly leads: number
  /** Reja (Avto) — 500 000 × leads. */
  readonly plan: MoneyDto
  /** Buyurtma summasi — Факт-1. */
  readonly orders: MoneyDto
  /** Bajarilish % — null with no plan. */
  readonly percent: number | null
  /** Qarz — orders − plan: above zero, ahead. */
  readonly debt: MoneyDto
}

export interface GroupPlanSellerDto extends GroupPlanCellsDto {
  readonly employeeId: string
  readonly fullName: string
  /** Dostup; null on the «Hech kimga biriktirilmagan» row. */
  readonly mayTakeLeads: boolean | null
}

export interface GroupPlanGroupDto {
  /** Null: the leads and orders that name no team. */
  readonly rop: string | null
  readonly sellers: readonly GroupPlanSellerDto[]
  readonly total: GroupPlanCellsDto
}

export interface GroupPlanDto {
  readonly from: string
  readonly to: string
  readonly groups: readonly GroupPlanGroupDto[]
  readonly total: GroupPlanCellsDto
}
