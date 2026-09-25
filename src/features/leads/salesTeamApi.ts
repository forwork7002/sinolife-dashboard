/**
 * «Sotuv · ROP» — the wire shapes, restated for the client.
 *
 * Mirrors `src/server/services/salesTeamService.ts`. Nothing checks the
 * mirror — edit both sides.
 */

import type { MoneyDto } from '@/lib/api'

export interface SalesCellsDto {
  readonly leads: number
  readonly manualLeads: number
  readonly orders: number
  readonly fakt1: MoneyDto
  readonly fakt2Orders: number
  readonly fakt2: MoneyDto
  readonly conversionPercent: number | null
  readonly conversion2Percent: number | null
  readonly averageCheque1: MoneyDto | null
  readonly averageCheque2: MoneyDto | null
  readonly headcount: number
}

export interface SalesDayDto extends SalesCellsDto {
  readonly date: string
  readonly plan: MoneyDto | null
  readonly planPercent: number | null
}

export interface SalesSellerDto {
  readonly employeeId: string
  readonly fullName: string
  readonly leads: number
  readonly manualLeads: number
  readonly plan: MoneyDto | null
  readonly fakt1: MoneyDto
  readonly deviation: MoneyDto | null
  readonly orders: number
  readonly conversionPercent: number | null
  readonly onRoster: boolean
}

export interface SalesTeamDto {
  readonly rop: string
  readonly plan: { readonly fakt1: MoneyDto | null; readonly fakt2: MoneyDto | null }
  readonly month: SalesCellsDto & {
    readonly fakt1Percent: number | null
    readonly fakt2Percent: number | null
    readonly fakt1Forecast: MoneyDto | null
    readonly fakt1ForecastPercent: number | null
  }
  readonly days: readonly SalesDayDto[]
  readonly day: {
    readonly date: string
    readonly sellers: readonly SalesSellerDto[]
    readonly total: SalesCellsDto & {
      readonly plan: MoneyDto | null
      readonly deviation: MoneyDto | null
      readonly planPercent: number | null
    }
  }
  readonly roster: readonly { employeeId: string; fullName: string; dayPlan: MoneyDto | null }[]
}

export interface SalesTeamOverviewDto {
  readonly month: string
  readonly day: string
  readonly daysInMonth: number
  readonly elapsedDays: number
  readonly teams: readonly SalesTeamDto[]
  readonly canEditPlans: boolean
}

/** What the plan form posts. Whole soʻm; null or 0 removes a plan. */
export interface SavePlansBody {
  readonly month: string
  readonly teams: readonly { rop: string; fakt1: number | null; fakt2: number | null }[]
  readonly sellers: readonly { employeeId: string; dayPlan: number | null }[]
}
