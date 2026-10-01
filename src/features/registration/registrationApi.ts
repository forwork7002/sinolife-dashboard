/**
 * «Registratsiya» — the wire shapes, restated for the client.
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
  readonly receivedFresh: number
  readonly week: readonly number[]
}

export interface LeadSplitDto {
  readonly day: string
  readonly total: number
  readonly duplicates: number
  readonly fresh: number
  readonly unassigned: number
  readonly rops: readonly LeadSplitRopDto[]
  readonly week: { readonly days: readonly string[]; readonly unassigned: readonly number[] }
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
  `src/server/domain/registration/ropReport.ts` and the body of
  `src/app/api/v1/registration/plan/route.ts`. Nothing checks the mirror.
*/

export interface RopReportCellsDto {
  readonly leads: number
  readonly plan: MoneyDto | null
  readonly fakt1: MoneyDto
  readonly deviation: MoneyDto | null
  readonly fakt1Orders: number
  readonly conversionPercent: number | null
  readonly fakt2: MoneyDto
  readonly fakt2Orders: number
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
  readonly month: string
  readonly groups: readonly RopReportGroupDto[]
  readonly total: RopReportCellsDto
  readonly canEdit: boolean
}

/** Whole soʻm; null or 0 removes the plan. */
export interface SaveSellerPlansBody {
  readonly month: string
  readonly sellers: readonly { employeeId: string; dayPlan: number | null }[]
}
