/**
 * «Target tahlili» — the wire shapes, restated for the client.
 *
 * Mirrors `src/server/services/targetService.ts`. Client code may not import
 * from `@/server/*`, so the DTOs are written out again here, the way
 * `marketingApi.ts` does for the ad ledger. Nothing checks the mirror — edit
 * both sides.
 */

import type { MoneyDto } from '@/lib/api'

import type {
  MarketingDayDto,
  MarketingFeedCoverageDto,
  MarketingMetricsDto,
  MarketingSnapshotDto,
  MarketingWindowDto,
} from '@/features/marketing/marketingApi'

export type TargetScope = 'target' | 'all'

export interface TargetCountersDto {
  readonly leads: number
  /** Distinct contacts among the leads. */
  readonly leadCustomers: number
  /** «Сделка успешна» — the registrar passed the lead on to a seller. */
  readonly leadWon: number
  readonly leadLost: number
  readonly passPercent: number | null
  readonly sales: number
  /** Sales deals that reached Тасдиклаш or Доставка. */
  readonly orders: number
  readonly ordered: MoneyDto
  readonly orderPercent: number | null
  readonly delivered: number
  readonly deliveredMoney: MoneyDto
  readonly returned: number
  readonly returnedMoney: MoneyDto
  readonly buyoutPercent: number | null
  readonly inTransit: number
  readonly confirming: number
  readonly sellerLost: number
  readonly averageCheque: MoneyDto | null
  readonly revenuePerLead: MoneyDto | null
}

export interface TargetGroupDto extends TargetCountersDto {
  readonly key: string
}

export interface TargetStageDto {
  readonly kind: 'lead' | 'sale'
  readonly pipeline: string
  readonly stage: string
  /** NEW | IN_PROGRESS | WON | LOST */
  readonly category: string
  readonly deals: number
  readonly amount: MoneyDto
}

export interface TargetOverviewDto {
  readonly scope: TargetScope
  readonly sources: readonly { readonly name: string; readonly isTarget: boolean }[]
  readonly total: TargetCountersDto
  readonly bySource: readonly TargetGroupDto[]
  readonly byTargetolog: readonly TargetGroupDto[]
  readonly byCreative: readonly TargetGroupDto[]
  readonly days: readonly TargetGroupDto[]
  readonly stages: readonly TargetStageDto[]
  readonly notStated: string
  readonly ads: {
    readonly snapshot: MarketingSnapshotDto | null
    readonly window: MarketingWindowDto
    readonly current: MarketingMetricsDto
    readonly previous: MarketingMetricsDto
    readonly daily: readonly MarketingDayDto[]
    readonly feedCoverage: MarketingFeedCoverageDto
  } | null
}

export interface TargetLeadSaleDto {
  readonly bitrixId: string | null
  readonly createdAt: string
  readonly pipeline: string
  /** QUALIFICATION | CONFIRMATION | REVENUE */
  readonly role: string
  readonly stage: string
  /** OPEN | WON | LOST */
  readonly status: string
  readonly amount: MoneyDto
  readonly seller: string | null
}

export interface TargetLeadDto {
  readonly bitrixId: string | null
  readonly createdAt: string
  readonly title: string
  readonly customerName: string | null
  readonly phone: string | null
  readonly source: string
  readonly targetolog: string | null
  readonly creative: string | null
  readonly primarySource: string | null
  readonly stage: string
  readonly stageCategory: string
  readonly registrar: string | null
  readonly sale: TargetLeadSaleDto | null
}

export interface TargetLeadsDto {
  readonly items: readonly TargetLeadDto[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly totalItems: number
    readonly totalPages: number
    readonly hasNextPage: boolean
    readonly hasPreviousPage: boolean
  }
}

/** The portal's own page for a deal — where the whole card already is. */
export function bitrixDealUrl(bitrixId: string): string {
  return `https://obey.bitrix24.kz/crm/deal/details/${encodeURIComponent(bitrixId)}/`
}
