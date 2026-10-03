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
  «Guruhlar · безквал / квал» — mirrors `GroupIntakeDto` in
  `src/server/domain/registration/groupIntake.ts` and the body of
  `src/app/api/v1/registration/groups/route.ts`. Nothing checks the mirror.
*/

export interface GroupIntakeRowDto {
  readonly group: string
  /** The ROP team whose handed-out leads are the group's kval. */
  readonly team: string
  /** Null: nobody typed it. */
  readonly intake: number | null
  readonly qualified: number
  readonly conversionPercent: number | null
}

export interface GroupIntakeDto {
  readonly day: string
  readonly groups: readonly GroupIntakeRowDto[]
  readonly total: { readonly intake: number; readonly qualified: number; readonly conversionPercent: number | null }
  readonly ungroupedQualified: number
  readonly canEdit: boolean
}

/** Null removes the typed number. */
export interface SaveGroupIntakeBody {
  readonly day: string
  readonly rows: readonly { group: string; leads: number | null }[]
}
