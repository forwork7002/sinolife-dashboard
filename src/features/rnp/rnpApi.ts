/**
 * «RNP jadvali» — the wire shapes, restated for the client.
 *
 * Mirrors the DTOs of `src/server/domain/rnp/rnpSheet.ts`, and the bodies of
 * `src/app/api/v1/rnp/plans/route.ts`, `…/inputs/route.ts` and
 * `…/registrars/route.ts`.
 * Nothing checks the mirror — edit both sides.
 */

/** How a row's numbers read. Money is whole soʻm (or dollars) as a number. */
export type RnpUnit = 'count' | 'uzs' | 'usd' | 'percent'

export interface RnpPlanKey {
  /** The ROP team, or '' for a company-wide plan. */
  readonly team: string
  readonly metric: string
}

export interface RnpRowDto {
  readonly key: string
  readonly label: string
  readonly unit: RnpUnit
  /** Summed over days (and forecast by run-rate), or a ratio of sums. */
  readonly additive: boolean
  /** Whether a higher figure is the good direction — colours the index. */
  readonly better: 'up' | 'down'
  /** C — the month's plan. */
  readonly plan: number | null
  /** B — the day's share of it (a rate's plan is the same every day). */
  readonly dayPlan: number | null
  /** D — the month so far. */
  readonly fact: number | null
  /** E — the fact at the pace of the full days lived; additive rows only. */
  readonly forecast: number | null
  /** F — forecast ÷ plan (a rate: fact ÷ plan), in percent. */
  readonly index: number | null
  /** One value per day of the month; null for a day not lived or undefined. */
  readonly days: readonly (number | null)[]
  /** What the plan form writes for this row; null when nothing is planned. */
  readonly planKey: RnpPlanKey | null
  /**
   * What a typed day cell of this row is stored under; null when every cell
   * comes from Bitrix24 or Meta. A typed cell overrides Bitrix24 for its day.
   */
  readonly inputKey: RnpPlanKey | null
  /** This row's share of its column's total, in percent (the «Свод»). */
  readonly share: number | null
  readonly tone: 'total' | 'plain'
  /** One sentence saying where the number comes from. */
  readonly hint: string | null
  /** Days before this are incomplete in Bitrix24, and are drawn muted. */
  readonly reliableFrom: string | null
}

export type RnpBlockKind =
  | 'marketing'
  | 'social'
  | 'registration'
  | 'team'
  | 'company'
  | 'warehouse'
  | 'logistics'
  | 'hr'
  | 'summary'
  | 'project'

export interface RnpBlockDto {
  readonly id: string
  readonly kind: RnpBlockKind
  readonly title: string
  readonly subtitle: string | null
  /** The ROP team the block is about; null for a company block. */
  readonly team: string | null
  readonly rows: readonly RnpRowDto[]
}

export interface RnpTeamDto {
  readonly rop: string
  /** The name the client's sheet gives the team («Чарос РОП»); the department name when it gives none. */
  readonly label: string
  readonly head: string | null
  /** A БАЗА team: works the existing customers, measured by calls, not leads. */
  readonly isBase: boolean
}

export interface RnpOverviewDto {
  /** `YYYY-MM`. */
  readonly month: string
  /** Every day of the month, `YYYY-MM-DD`. */
  readonly days: readonly string[]
  /** `YYYY-MM-DD`, Tashkent. */
  readonly today: string
  /** Full days of the month already over — the forecast's denominator. */
  readonly elapsedDays: number
  readonly teams: readonly RnpTeamDto[]
  readonly blocks: readonly RnpBlockDto[]
  readonly settings: {
    /** Soʻm per dollar; null when nobody set it for the month. */
    readonly usdRate: number | null
    /** What one handed-out lead is worth, from each day it starts on. */
    readonly leadValues: readonly { readonly team: string; readonly fromDay: number; readonly value: number }[]
    /** The brand P&L's percentages; null when nobody set them. */
    readonly marketingPlanPct: number | null
    readonly targetologPct: number | null
    readonly marketerPct: number | null
  }
  readonly canEditPlans: boolean
  /** What the registrar → «guruh» form edits. */
  readonly registration: {
    /** Every registrar the month's kval names, and every one already assigned. */
    readonly registrars: readonly string[]
    readonly groups: readonly { readonly registrar: string; readonly group: string }[]
    /** The groups the sheet has rows for, in its order, the Zextra desk last. */
    readonly groupNames: readonly string[]
  }
}

/** Metric keys of the company-wide settings, never a plan. */
export const SETTING_USD_RATE = 'usd_rate'
export const SETTING_LEAD_VALUE = 'lead_value'
/** The brand P&L's three percentages — company-wide, from day 1, like the dollar rate. */
export const SETTING_MARKETING_PLAN_PCT = 'marketing_plan_pct'
export const SETTING_TARGETOLOG_PCT = 'targetolog_pct'
export const SETTING_MARKETER_PCT = 'marketer_pct'

/**
 * What the «Rejalar» form posts. `rows` carry the row's own unit, up to two
 * decimals; `fakt` is a team's FAKT 1 / FAKT 2 in whole soʻm, the plan
 * «Sotuv · ROP» reads too. Null removes.
 */
export interface SaveRnpPlansBody {
  readonly month: string
  readonly rows: readonly { team: string; metric: string; fromDay: number; value: number | null }[]
  readonly fakt: readonly { rop: string; fakt1: number | null; fakt2: number | null }[]
}

/**
 * What a typed day cell posts to `/rnp/inputs`: the figure in the row's own
 * unit, up to two decimals, may be negative. Null clears the cell.
 */
export interface SaveRnpInputsBody {
  readonly rows: readonly { day: string; team: string; metric: string; value: number | null }[]
}

/** What the registrar → «guruh» form posts to `/rnp/registrars`: changed rows only; null takes the registrar out of every group. */
export interface SaveRnpRegistrarsBody {
  readonly month: string
  readonly rows: readonly { registrar: string; group: string | null }[]
}
