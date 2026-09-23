/**
 * «Reklama samarasi» — the wire shapes, restated for the client.
 *
 * Mirrors `src/server/services/reklamaService.ts`. Client code may not import
 * from `@/server/*`, so the DTOs are written out again here, the way
 * `targetApi.ts` does. Nothing checks the mirror — edit both sides.
 */

import type { MetaProduct } from '@/features/target/targetApi'

/** A product a target page sells — never «Boshqa», which is an unmapped ad account. */
export type TargetProduct = Exclude<MetaProduct, 'Boshqa'>

export interface DmCellsDto {
  readonly conversations: number
  readonly leads: number
  readonly qualified: number
  readonly spendUsd: number
  readonly costPerQualifiedUsd: number | null
  readonly qualifiedPercent: number | null
  readonly conversationToQualifiedPercent: number | null
  readonly costPerConversationUsd: number | null
}

export interface DmDayDto extends DmCellsDto {
  readonly date: string
}

export interface DmPageDto {
  readonly key: string
  readonly name: string
  readonly product: TargetProduct
  readonly carriesDmSpend: boolean
  readonly total: DmCellsDto
  readonly days: readonly DmDayDto[]
}

export interface DmBlockDto {
  readonly total: DmCellsDto
  readonly days: readonly DmDayDto[]
  readonly pages: readonly DmPageDto[]
  readonly unattributed: { readonly spendUsd: number; readonly conversations: number }
}

export interface FormCellsDto {
  readonly spendUsd: number
  readonly metaLeads: number
  readonly costPerLeadUsd: number | null
  readonly impressions: number
  readonly clicks: number
  readonly ctrPercent: number | null
  readonly cpcUsd: number | null
  readonly cpmUsd: number | null
}

export interface FormDayDto extends FormCellsDto {
  readonly date: string
}

export interface FormOwnerDto {
  readonly key: string
  readonly targetolog: string
  readonly product: MetaProduct
  readonly accounts: readonly string[]
  readonly total: FormCellsDto
  readonly dmSpendUsd: number
  readonly dmConversations: number
  readonly days: readonly FormDayDto[]
}

export interface FormBlockDto {
  readonly total: FormCellsDto
  readonly days: readonly FormDayDto[]
  readonly owners: readonly FormOwnerDto[]
}

export type LeadBucket = 'success' | 'duplicate' | 'noAnswer' | 'lowQuality' | 'open'

export interface QualityCellsDto {
  readonly leads: number
  readonly noAnswer: number
  readonly lowQuality: number
  readonly success: number
  readonly duplicate: number
  readonly open: number
  readonly successPercent: number | null
}

export interface QualityDayDto extends QualityCellsDto {
  readonly date: string
}

export interface QualityPageDto {
  readonly key: string
  readonly name: string
  readonly product: TargetProduct
  readonly total: QualityCellsDto
  readonly days: readonly QualityDayDto[]
}

export interface QualityBlockDto {
  readonly total: QualityCellsDto
  readonly days: readonly QualityDayDto[]
  readonly pages: readonly QualityPageDto[]
  readonly stages: readonly { readonly stage: string; readonly bucket: LeadBucket; readonly leads: number }[]
}

export interface SpendSplitDto {
  readonly totalUsd: number
  readonly formUsd: number
  readonly dmUsd: number
  readonly hiringUsd: number
  readonly otherUsd: number
}

export type CampaignChannel = 'form' | 'dm' | 'hiring' | 'other'

export interface CampaignDto {
  readonly id: string
  readonly name: string
  readonly account: string
  readonly targetolog: string
  readonly product: MetaProduct
  readonly channel: CampaignChannel
  readonly spendUsd: number
  readonly metaLeads: number
  readonly conversations: number
  readonly results: number
  readonly costPerResultUsd: number | null
  readonly impressions: number
  readonly clicks: number
  readonly ctrPercent: number | null
  readonly activeDays: number
  readonly lastActive: string | null
}

export interface ReklamaOverviewDto {
  readonly importedAt: string | null
  readonly window: { readonly from: string; readonly to: string }
  readonly spend: SpendSplitDto
  readonly dm: DmBlockDto
  readonly form: FormBlockDto
  readonly quality: QualityBlockDto
  readonly campaigns: readonly CampaignDto[]
}
