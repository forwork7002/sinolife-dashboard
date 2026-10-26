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
  /** «Безквал»: each team's clients by day over `week.days` (`domain/registration/bezkval.ts`). */
  readonly bezkval: {
    readonly rops: readonly { readonly rop: string; readonly week: readonly number[] }[]
    readonly unassigned: readonly number[]
    /** «Jami lid» — the lead deals of each day; null under one brand. */
    readonly deals: readonly number[] | null
  }
  readonly split: { readonly updatedAt: string } | null
  readonly previous: { readonly day: string; readonly rows: readonly SplitShare[] } | null
  readonly canEdit: boolean
}

/*
  «Bezkval lidlar» — mirrors `BezkvalDayDto` / `BezkvalClientsDto` in
  `src/server/domain/registration/bezkval.ts`. Nothing checks the mirror.
*/

export type BezkvalKeyKind = 'phone' | 'dealPhone' | 'contact' | 'deal'
export type BezkvalBucket = 'rop' | 'registration' | 'unassigned'
export type BezkvalStatus = 'new' | 't30' | 'old'
export type BezkvalEntry = 'created' | 'ai'
export type BezkvalEntryKind = 'created' | 'ai' | 'leadGuard'

export interface BezkvalCountsDto {
  readonly bezkval: number
  readonly fresh: number
  readonly repeat30: number
  readonly repeatOld: number
}

export interface BezkvalRopLineDto extends BezkvalCountsDto {
  /** Null on «Регистрация boʻlimida» and «Taqsimlanmagan» — `bucket` says which. */
  readonly rop: string | null
  readonly bucket: BezkvalBucket
  /** Who heads the team now. */
  readonly head: string | null
  readonly sharePct: number
}

export interface BezkvalDayDto extends BezkvalCountsDto {
  readonly day: string
  /** When the sync worker last counted the day; null: not yet. */
  readonly computedAt: string | null
  readonly kirim: number
  readonly unassigned: number
  readonly registration: number
  readonly kval: { readonly deals: number; readonly clients: number }
  readonly entries: Readonly<Record<BezkvalEntryKind, { readonly deals: number; readonly clients: number }>>
  readonly multiRop: number
  readonly keyKinds: Readonly<Record<BezkvalKeyKind, number>>
  readonly rops: readonly BezkvalRopLineDto[]
  readonly sources: readonly ({ readonly source: string | null } & BezkvalCountsDto)[]
  readonly hours: readonly number[]
  readonly trend: readonly { readonly day: string; readonly kirim: number; readonly bezkval: number }[]
  readonly problems: readonly string[]
}

export interface BezkvalClientDealDto {
  readonly id: string | null
  /** The pipeline it stands in now. */
  readonly pipeline: string | null
  readonly stage: string | null
  readonly source: string | null
  readonly rop: string | null
  readonly at: string
  readonly entry: BezkvalEntry
  readonly leadGuard: boolean
}

export interface BezkvalClientDto {
  /** Masked to its last four digits. */
  readonly phone: string | null
  readonly kind: BezkvalKeyKind
  readonly rop: string | null
  readonly bucket: BezkvalBucket
  readonly source: string | null
  readonly hour: number
  /** Null on a kval client. */
  readonly status: BezkvalStatus | null
  readonly multiRop: boolean
  readonly previous: { readonly id: string | null; readonly at: string; readonly pipeline: string | null } | null
  readonly deals: readonly BezkvalClientDealDto[]
}

export interface BezkvalClientsDto {
  readonly day: string
  readonly clients: readonly BezkvalClientDto[]
  readonly kval: readonly BezkvalClientDto[]
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
  /** The window's first day; equal to `day` for one day. */
  readonly from: string
  readonly day: string
  readonly groups: readonly RopReportGroupDto[]
  readonly total: RopReportCellsDto
}

/*
  «Guruhlar» — mirrors `GroupPlanDto` in
  `src/server/domain/registration/groupPlan.ts`. Nothing checks the mirror.
*/

export interface GroupPlanCellsDto {
  /** Usp soni — the ROP team's без квал. */
  readonly leads: number
  /** Reja (Avto) — 200 000 × leads. */
  readonly plan: MoneyDto
  /** Buyurtma summasi — Факт-1. */
  readonly orders: MoneyDto
  /** Bajarilish % — null with no plan. */
  readonly percent: number | null
  /** Qarz — orders − plan: above zero, ahead. */
  readonly debt: MoneyDto
}

export interface GroupPlanRowDto extends GroupPlanCellsDto {
  /** The ROP team. */
  readonly rop: string
  /** The team's head; null when the roster has none. */
  readonly fullName: string | null
  /** Dostup: false on a red Qarz. */
  readonly mayTakeLeads: boolean
}

export interface GroupPlanDto {
  readonly from: string
  readonly to: string
  readonly rows: readonly GroupPlanRowDto[]
  readonly total: GroupPlanCellsDto
}
