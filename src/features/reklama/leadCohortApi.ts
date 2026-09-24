/**
 * «Lid kogortasi» — the wire shapes, restated for the client.
 *
 * Mirrors `src/server/domain/leadCohort/leadCohort.ts`. Nothing checks the
 * mirror — edit both sides.
 */

/** D+0 … D+6, then D+7+. */
export const LAG_BUCKETS = 8

/** Portal CATEGORY_IDs and the names the floor knows them by. */
export const LEAD_PIPELINE_OPTIONS = [
  { id: '12', label: 'Первичный отдел' },
  { id: '4', label: 'Тасдиклаш' },
  { id: '6', label: 'Доставка' },
] as const

export interface LeadCohortRowDto {
  /** `YYYY-MM-DD`; the empty string on the total row. */
  readonly day: string
  readonly arrived: number
  readonly byLag: readonly number[]
  readonly distributed: number
  readonly undistributed: number
}

export interface LeadCohortTableDto {
  readonly rows: readonly LeadCohortRowDto[]
  readonly total: LeadCohortRowDto
}

export interface LeadRopDto {
  readonly employeeId: string | null
  readonly name: string | null
  readonly total: number
  readonly new: number
  readonly repeat: number
  readonly sameDay: number
}

export interface LeadCohortOverviewDto {
  readonly from: string
  readonly to: string
  readonly cohortFrom: string
  readonly today: string
  readonly cohortStart: string
  readonly kpi: {
    readonly arrived: number
    readonly arrivedToday: number
    readonly distributedToday: number
    readonly aiQualified: number
    readonly undistributed: number
    readonly repeat: { readonly total: number; readonly bought: number; readonly processing: number; readonly other: number }
    readonly missingArrival: number
    readonly arrivedBeforeStart: number
    readonly distributedBeforeArrival: number
  }
  readonly cohorts: { readonly new: LeadCohortTableDto; readonly repeat: LeadCohortTableDto }
  readonly rops: readonly LeadRopDto[]
  readonly ropOptions: readonly { readonly employeeId: string; readonly name: string }[]
}
