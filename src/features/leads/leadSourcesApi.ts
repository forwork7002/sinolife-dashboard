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

/** A cohort: the leads created in the window, and how many of those are WON by now — as the headline tiles. */
export interface ChannelTileDto {
  readonly leads: number
  readonly fresh: number
  readonly qualified: number
  /** qualified ÷ fresh. */
  readonly qualifiedPercent: number | null
  /** The tile's deals WON in the window by close day, whenever they arrived — the quiet second line. */
  readonly closedQualified: number
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
  /** What the Регистрация deals of these forms became. */
  readonly outcome: LeadOutcomeDto
  /**
   * «Bitrix24 lid» beside Meta's: every CRM-form fill ('fills' — a returning
   * contact's too, as Meta counts) or, for a window the fills do not cover,
   * `outcome.leads` ('deals').
   */
  readonly bitrixLeads: number
  readonly leadsBasis: 'fills' | 'deals'
  readonly reachPercent: number | null
  readonly costPerLeadUsd: number | null
  readonly costPerSuccessUsd: number | null
  /** DM / message and other ad money of this person's accounts — their part of «Bogʻlanmagan sarf». */
  readonly unlinkedUsd: number
  /** Of `outcome.leads`, formless «Ген лид» the deal's «Таргетолог» field files here. */
  readonly formlessLeads: number
  /** «Факт1 мижоз» of these forms' leads; null while not read. */
  readonly fakt1Clients: number | null
  readonly days: readonly FormDayDto[]
}

/**
 * Ad money typed by hand on «Targetologlar · kunlik» — the sheet's «Telegram»
 * block (`src/server/domain/reklama/manualSpend.ts`): one channel of one
 * product, a row per day of the window; `spendUsd` null where nobody typed.
 */
export interface ManualSpendDto {
  readonly key: string
  readonly channel: 'telegram'
  readonly name: string
  readonly product: TargetProduct
  readonly totalUsd: number
  /** Регистрация leads the portal filed under the channel, and their kval — the sheet's «лид» and «кв лид». */
  readonly leads: number
  readonly success: number
  readonly days: readonly { readonly date: string; readonly spendUsd: number | null; readonly leads: number; readonly success: number }[]
}

/** The body of `POST /reklama/manual-spend`: dollars to the cent; null clears the day. */
export interface SaveManualSpendBody {
  readonly cells: readonly { day: string; project: ManualSpendDto['product']; channel: ManualSpendDto['channel']; value: number | null }[]
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
  /** In «Жами лидлар» — false for «Исход» and the sources no tile names. */
  readonly counted: boolean
}

export interface LeadSourcesOverviewDto {
  /** The brand switch the figures were narrowed by. One brand: «Сарафан» and the inbound calls are not split — they are «Brendsiz»'s. */
  readonly brand: DashboardBrand
  readonly importedAt: string | null
  /** Inbound calls in the window, under «Входящий»; null before the call data floor or under one brand. */
  readonly inboundCalls: number | null
  /** The six headline tiles — `tiles.total` («Исход» and «Boshqa» in none), kval the cohort's. */
  readonly funnel: {
    readonly total: number
    readonly fresh: number
    /** Repeat leads — «Такрор лид» filled. */
    readonly duplicates: number
    /** Of `duplicates`: «Такрор - харид қилган», «Такрор - обработка». */
    readonly repeatBought: number
    readonly repeatProcessing: number
    readonly qualified: number
    readonly qualifiedPercent: number | null
    /** WON in the window by close day — the count until 2026-10-09. */
    readonly closedQualified: number
    /** Handed out to a ROP in the window — «Kimga qancha lid kelayapti» → «Квал»'s «Jami» summed; the «Квал лидлар сони · ROP» card. */
    readonly handedOut: number
    /** `forms.total`'s spend, kval and price — «Targetologlar»'s «Jami». */
    readonly spendUsd: number
    readonly generatedQualified: number
    readonly costPerQualifiedUsd: number | null
  }
  readonly totals: {
    /** Every Регистрация deal, «Исход» included. */
    readonly registration: LeadOutcomeDto
    /** `registration` less what «Жами лидлар» leaves out — «Barcha manbalar»'s «Jami». */
    readonly counted: LeadOutcomeDto
    /** Distinct over `counted` — not the sum of the channels. */
    readonly fakt1Clients: number | null
    readonly formReachPercent: number | null
  }
  readonly forms: {
    readonly owners: readonly FormOwnerDto[]
    /** Owners with no form and no lead but other Meta money (SMS, hiring, other) — in none of the totals here. */
    readonly expenseOwners: readonly FormOwnerDto[]
    readonly days: readonly FormDayDto[]
    readonly spendUsd: number
    readonly metaLeads: number
    readonly outcome: LeadOutcomeDto
    /** «Jami»'s «Bitrix24 lid»: the owners' `bitrixLeads` and the hand-typed «Ген лид». */
    readonly bitrixLeads: number
    readonly leadsBasis: 'fills' | 'deals'
    /** «Ген лид» typed in by hand, no form. */
    readonly manual: LeadOutcomeDto
    /** «Факт1 мижоз» per targetolog across both products, distinct; null while not read. */
    readonly fakt1Targetologs: readonly { readonly targetolog: string; readonly clients: number }[] | null
    /** Ad-budget money on no lead form, by account. */
    readonly unlinked: {
      readonly spendUsd: number
      readonly accounts: readonly { readonly name: string; readonly spendUsd: number }[]
    }
    /** The table's «Jami»: owners (their forms' spend + `unlinkedUsd`) + `manual`; its kval price is the headline's. */
    readonly total: {
      readonly spendUsd: number
      readonly outcome: LeadOutcomeDto
      readonly costPerLeadUsd: number | null
      readonly costPerSuccessUsd: number | null
    }
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
  /** «Boshqa kanallar lidlari» — every tile in the server's order, and the sum of all but «Исход», «Boshqa» and «Сарафан» (= `funnel`). */
  readonly tiles: {
    readonly rows: readonly ({ readonly tile: LeadTile } & ChannelTileDto)[]
    readonly total: ChannelTileDto
    /**
     * «Сммщик ии»'s card: Регистрация deals whose «ИИ квал сана» is in the
     * window, any creation day, on the client's nine sources (the `aiSmm` row is what «Jami» sums — the SMM
     * sources by creation day). No close-day count is read for it.
     */
    readonly ai: Omit<ChannelTileDto, 'closedQualified'>
    /** `ai` by account, largest first — they sum to `ai`. */
    readonly smmAccounts: readonly ({ readonly key: string; readonly name: string } & ChannelTileDto)[]
    /** The same «ИИ квал сана», outside Регистрация now — said in a tip, summed nowhere. */
    readonly aiElsewhere: number
    /** «Ген лид»'s big number: every CRM-form fill in Bitrix24 ('fills') or its Регистрация deals ('deals'). */
    readonly generatedBasis: 'fills' | 'deals'
    /** The Регистрация «Ген лид» deals, whichever the basis — the tile's quiet line on 'fills'. */
    readonly generatedDeals: number
  }
  readonly sources: readonly SourceRowDto[]
}
