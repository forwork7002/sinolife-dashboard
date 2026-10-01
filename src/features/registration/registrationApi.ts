/**
 * «Registratsiya» — the wire shapes, restated for the client.
 *
 * Mirrors `LeadSplitDto` in `src/server/domain/registration/leadSplit.ts` and
 * the body of `src/app/api/v1/registration/split/route.ts`. Nothing checks
 * the mirror — edit both sides.
 */

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
