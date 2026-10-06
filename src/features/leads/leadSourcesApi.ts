/**
 * «Lid manbalari» — the wire shapes, restated for the client.
 *
 * Mirrors `src/server/services/leadSourcesService.ts` and the `LeadChannel`
 * union in `src/server/domain/leads/leadSources.ts`. Client code may not
 * import from `@/server/*`, so the DTOs are written out again here. Nothing
 * checks the mirror — edit both sides.
 */

import type { DashboardBrand } from '@/features/shared/useDashboardFilters'
import type { MetaProduct } from '@/features/target/targetApi'
import type { TargetProduct } from '@/features/reklama/reklamaApi'

export type LeadChannel = 'form' | 'page' | 'inbound' | 'manual' | 'telegram' | 'smm' | 'other' | 'outbound'

export type LeadTile = 'generated' | 'inbound' | 'telegram' | 'aiSmm' | 'web' | 'sarafan' | 'outbound' | 'other'

/** Leads by the day they arrived, kval by the day it was WON — as the headline tiles. */
export interface ChannelTileDto {
  readonly leads: number
  readonly fresh: number
  readonly qualified: number
  /** qualified ÷ fresh. */
  readonly qualifiedPercent: number | null
}

export interface LeadOutcomeDto {
  readonly leads: number
  readonly success: number
  readonly noAnswer: number
  readonly lowQuality: number
  readonly duplicate: number
  readonly open: number
  readonly successPercent: number | null
}

/** Beside the lead forms: the website campaigns (inside `spendUsd`), messages, hiring, the rest; `totalUsd` is all of it. */
export interface FormExpenseDto {
  readonly formUsd: number
  readonly siteUsd: number
  readonly siteLeads: number
  readonly smsUsd: number
  readonly smsCount: number
  readonly hrUsd: number
  readonly otherUsd: number
  readonly totalUsd: number
}

export interface FormDayDto extends FormExpenseDto {
  readonly date: string
  readonly spendUsd: number
  readonly metaLeads: number
  readonly leads: number
  readonly success: number
}

export interface FormOwnerDto extends FormExpenseDto {
  readonly key: string
  readonly targetolog: string
  readonly product: MetaProduct
  readonly forms: readonly string[]
  readonly accounts: readonly string[]
  readonly spendUsd: number
  readonly metaLeads: number
  readonly outcome: LeadOutcomeDto
  readonly reachPercent: number | null
  readonly costPerLeadUsd: number | null
  readonly costPerSuccessUsd: number | null
  readonly days: readonly FormDayDto[]
}

export interface DmDayDto {
  readonly date: string
  readonly conversations: number
  readonly leads: number
  readonly success: number
}

export interface DmPageDto {
  readonly key: string
  readonly name: string
  readonly product: TargetProduct | null
  readonly conversations: number
  readonly outcome: LeadOutcomeDto
  readonly days: readonly DmDayDto[]
}

export interface SourceRowDto {
  readonly key: string
  readonly channel: LeadChannel
  readonly name: string
  readonly outcome: LeadOutcomeDto
  /** Distinct clients (by phone) of these leads with a FAKT 1 order in the window; null while not ready. */
  readonly fakt1Clients: number | null
}

export interface LeadSourcesOverviewDto {
  /** The brand switch the figures were narrowed by. One brand: «Сарафан» and the inbound calls are not split — they are «Brendsiz»'s. */
  readonly brand: DashboardBrand
  readonly importedAt: string | null
  /** Inbound calls in the window, under «Входящий»; null before the call data floor or under one brand. */
  readonly inboundCalls: number | null
  /** The six headline tiles — leads by creation day, kval by the day it was WON. */
  readonly funnel: {
    readonly total: number
    readonly fresh: number
    readonly duplicates: number
    readonly qualified: number
    readonly qualifiedPercent: number | null
    readonly spendUsd: number
    readonly costPerQualifiedUsd: number | null
  }
  readonly totals: {
    readonly registration: LeadOutcomeDto
    /** Distinct over the whole of Регистрация — not the sum of the channels. */
    readonly fakt1Clients: number | null
    readonly formReachPercent: number | null
  }
  readonly forms: {
    readonly owners: readonly FormOwnerDto[]
    readonly days: readonly FormDayDto[]
    readonly spendUsd: number
    readonly metaLeads: number
    readonly outcome: LeadOutcomeDto
  }
  readonly dm: {
    readonly pages: readonly DmPageDto[]
    readonly days: readonly DmDayDto[]
    readonly conversations: number
    readonly outcome: LeadOutcomeDto
  }
  readonly channels: readonly {
    readonly channel: LeadChannel
    readonly outcome: LeadOutcomeDto
    readonly fakt1Clients: number | null
  }[]
  /** «Boshqa kanallar lidlari» — every tile in the server's order, and the sum of all but «Исход» and «Boshqa». */
  readonly tiles: {
    readonly rows: readonly ({ readonly tile: LeadTile } & ChannelTileDto)[]
    readonly total: ChannelTileDto
    /** total.leads + outbound + other + ai = funnel.total — what «Jami» lacks of «Жами лидлар». */
    readonly toHeadline: { readonly outbound: number; readonly other: number; readonly ai: number }
    /** AI-qualified in the window but outside Регистрация now — shown under «Сммщик ии» as duplicates, summed nowhere. */
    readonly aiElsewhere: number
  }
  readonly sources: readonly SourceRowDto[]
}
