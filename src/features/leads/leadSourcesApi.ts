/**
 * «Lid manbalari» — the wire shapes, restated for the client.
 *
 * Mirrors `src/server/services/leadSourcesService.ts` and the `LeadChannel`
 * union in `src/server/domain/leads/leadSources.ts`. Client code may not
 * import from `@/server/*`, so the DTOs are written out again here. Nothing
 * checks the mirror — edit both sides.
 */

import type { MetaProduct } from '@/features/target/targetApi'
import type { TargetProduct } from '@/features/reklama/reklamaApi'

export type LeadChannel = 'form' | 'page' | 'inbound' | 'manual' | 'telegram' | 'smm' | 'other' | 'outbound'

export type LeadTile = 'generated' | 'inbound' | 'telegram' | 'aiSmm' | 'web' | 'sarafan'

export interface LeadOutcomeDto {
  readonly leads: number
  readonly success: number
  readonly noAnswer: number
  readonly lowQuality: number
  readonly duplicate: number
  readonly open: number
  readonly successPercent: number | null
}

export interface FormDayDto {
  readonly date: string
  readonly metaLeads: number
  readonly leads: number
  readonly success: number
}

export interface FormOwnerDto {
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
  readonly leadPercent: number | null
  readonly conversationToSuccessPercent: number | null
  readonly days: readonly DmDayDto[]
}

export interface SourceRowDto {
  readonly key: string
  readonly channel: LeadChannel
  readonly name: string
  readonly outcome: LeadOutcomeDto
  /** Distinct clients (by phone) of these leads with a FAKT 1 order in the window. */
  readonly fakt1Clients: number
}

export interface LeadSourcesOverviewDto {
  readonly importedAt: string | null
  readonly window: { readonly from: string; readonly to: string }
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
    readonly fakt1Clients: number
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
    readonly fakt1Clients: number
  }[]
  /** «Boshqa kanallar lidlari» — every tile in the server's order, and their sum. */
  readonly tiles: {
    readonly rows: readonly { readonly tile: LeadTile; readonly outcome: LeadOutcomeDto }[]
    readonly total: LeadOutcomeDto
  }
  readonly sources: readonly SourceRowDto[]
}
