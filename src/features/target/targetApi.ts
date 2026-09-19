/**
 * «Target tahlili» — the wire shapes, restated for the client.
 *
 * Mirrors `src/server/services/targetService.ts`. Client code may not import
 * from `@/server/*`, so the DTOs are written out again here, the way
 * `marketingApi.ts` does for its ledger. Nothing checks the mirror — edit
 * both sides.
 */

import type { MoneyDto } from '@/lib/api'

export type TargetScope = 'target' | 'all'

/** The product switch: both, or one. */
export type TargetProductFilter = 'all' | 'Collagen' | 'Zextra'

export interface TargetCountersDto {
  readonly leads: number
  /** Distinct contacts among the leads. */
  readonly leadCustomers: number
  /** «Сделка успешна» — the registrar passed the lead on to a seller. */
  readonly leadWon: number
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
  readonly deals: number
  readonly amount: MoneyDto
}

export interface TargetOverviewDto {
  /** The seven ad pages' names, as the portal spells them. */
  readonly targetSources: readonly string[]
  readonly total: TargetCountersDto
  readonly bySource: readonly TargetGroupDto[]
  readonly byTargetolog: readonly TargetGroupDto[]
  readonly byCreative: readonly TargetGroupDto[]
  readonly days: readonly TargetGroupDto[]
  readonly stages: readonly TargetStageDto[]
  readonly notStated: string
  readonly meta: MetaBlockDto
}

export type MetaProduct = 'Collagen' | 'Zextra' | 'Boshqa'

export interface MetaColumnDto {
  readonly key: string
  readonly product: MetaProduct
  readonly targetolog: string
}

export interface MetaDayDto {
  readonly date: string
  /** Dollars. */
  readonly total: number
  /** Dollars, one per `columns` entry. */
  readonly cells: readonly number[]
}

export interface MetaMetricsDto {
  readonly spendUsd: number
  readonly metaLeads: number
  readonly metaCplUsd: number | null
  readonly impressions: number
  readonly clicks: number
  readonly ctrPercent: number | null
  readonly cpcUsd: number | null
  readonly cpmUsd: number | null
}

export interface MetaOwnerDto extends MetaColumnDto, MetaMetricsDto {
  readonly accounts: readonly string[]
}

/** One person across both products. */
export interface MetaTargetologDto extends MetaMetricsDto {
  readonly targetolog: string
  readonly products: readonly {
    readonly product: MetaProduct
    readonly spendUsd: number
    readonly metaLeads: number
  }[]
  readonly accounts: readonly string[]
}

/** One product (or both, as the total): Meta's delivery and the pages' results. */
export interface MetaProductTotalsDto extends MetaMetricsDto {
  readonly bitrixLeads: number
  readonly bitrixLeadWon: number
  readonly orders: number
  readonly ordered: MoneyDto
  readonly delivered: number
  readonly deliveredMoney: MoneyDto
  readonly returned: number
  readonly orderPercent: number | null
  readonly buyoutPercent: number | null
  readonly costPerBitrixLeadUsd: number | null
  readonly costPerOrderUsd: number | null
  readonly costPerDeliveredUsd: number | null
  readonly roas: number | null
}

export interface MetaBlockDto {
  readonly importedAt: string | null
  readonly window: { readonly from: string; readonly to: string }
  readonly columns: readonly MetaColumnDto[]
  readonly days: readonly MetaDayDto[]
  readonly targetologs: readonly MetaTargetologDto[]
  readonly owners: readonly MetaOwnerDto[]
  readonly products: readonly (MetaProductTotalsDto & { readonly product: MetaProduct })[]
  readonly total: MetaProductTotalsDto
  readonly usdRate: number | null
  readonly usdRateDate: string | null
}

export interface TargetLeadSaleDto {
  readonly bitrixId: string | null
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
