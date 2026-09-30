/**
 * «RNP jadvali» — the wire shapes, restated for the client.
 *
 * Mirrors the DTOs of `src/server/domain/rnp/rnpSheet.ts` and `rnpSheetView.ts`, and the bodies of
 * `src/app/api/v1/rnp/plans/route.ts`, `…/registrars/route.ts` and `…/costs/route.ts`.
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
   * Where this row sits on the client's «РНП» sheet — its row number and its
   * label there; null = a dashboard addition. Not used on screen.
   */
  readonly sheet: RnpSheetRef | null
  readonly tone: 'total' | 'plain'
  /** One sentence saying where the number comes from. */
  readonly hint: string | null
  /** A cell typed by hand (the P&L's cost lines): what the page saves each day under. Null = computed. */
  readonly manual: { readonly project: RnpCostProject; readonly line: RnpCostLine } | null
  /** Days before this are incomplete in Bitrix24, and are drawn muted. */
  readonly reliableFrom: string | null
}

/** The brand P&L's five cost lines no system holds — typed in place (`RNP_COST_LINES`, rows 411–415 / 438–442). */
export type RnpCostLine = 'bloggers' | 'nutritionist' | 'brandface' | 'marketing' | 'team'
/** The two brands whose P&L carries them (`RNP_COST_PROJECTS`). */
export type RnpCostProject = 'Collagen' | 'Zextra'

export interface RnpSheetRef {
  readonly row: number
  readonly label: string
}

export type RnpBlockKind = 'marketing' | 'registration' | 'team' | 'company' | 'warehouse' | 'logistics' | 'project' | 'summary'

export interface RnpBlockDto {
  readonly id: string
  readonly kind: RnpBlockKind
  readonly title: string
  readonly subtitle: string | null
  /** The ROP team the block is about; null for a company block. */
  readonly team: string | null
  /** The block's first row on the sheet and its title there; null = not on the sheet. */
  readonly sheet: RnpSheetRef | null
  readonly rows: readonly RnpRowDto[]
}

/**
 * How a line's label cell reads — the sheet's colours by meaning, not by hex:
 * 'section' its orange headings, 'team' its blue team rows, 'company' the
 * green company rows, 'brand' the light-blue P&L sub-rows, 'alert' the pink
 * «Разница». Mirrors `src/server/domain/rnp/rnpSheetLayout.ts`.
 */
export type RnpLabelTone = 'section' | 'team' | 'company' | 'brand' | 'alert' | 'plain'
/** How a line's fact column reads: FAKT sums, «План бажарилиши», ratios, key figures, budgets. */
export type RnpFactTone = 'fakt' | 'plan' | 'rate' | 'key' | 'money' | 'alert' | 'plain'

/**
 * One row of «СентябрРНП 26», in the sheet's order (`rnpSheetView.ts`).
 * `row` is the sheet row, null for a line added for a team the sheet lacks.
 */
export type RnpLine =
  | {
      readonly kind: 'title'
      readonly row: number | null
      /** The ROP team the line belongs to (the page's ROP filter); null = company-wide. */
      readonly team: string | null
      readonly label: string
      readonly sub: string | null
      readonly tone: RnpLabelTone
    }
  | {
      readonly kind: 'value'
      readonly row: number | null
      readonly team: string | null
      readonly label: string
      /** The sheet's column-B text: the ROP on a team's first row, «без квал», «факт1» … */
      readonly sub: string | null
      readonly tone: RnpLabelTone
      readonly fact: RnpFactTone
      readonly bold: boolean
      /** The `RnpRowDto.key` that fills it; null = Bitrix24 cannot supply this row. */
      readonly key: string | null
    }

/** The `sub` of a heading added for a team the sheet has no block for (`ADDED_TEAM_NOTE`). */
export const RNP_ADDED_TEAM_NOTE = 'jadvalda yoʻq jamoa'

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
  /** The client's sheet, row by row, each line pointing at the block row that fills it. */
  readonly lines: readonly RnpLine[]
  readonly settings: {
    /** The Central Bank's soʻm-per-dollar rate on `usdRateDate` (the latest day it answered); null when it never did. */
    readonly usdRate: number | null
    readonly usdRateDate: string | null
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
    /** The registration groups the sheet has rows for, in its order. */
    readonly groupNames: readonly string[]
  }
}

/** Metric key of the one company-wide setting that is not a plan. */
export const SETTING_LEAD_VALUE = 'lead_value'
/** The brand P&L's three percentages — company-wide, from day 1. */
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

/** What the registrar → «guruh» form posts to `/rnp/registrars`: changed rows only; null takes the registrar out of every group. */
export interface SaveRnpRegistrarsBody {
  readonly month: string
  readonly rows: readonly { registrar: string; group: string | null }[]
}

/**
 * What a typed P&L cost cell posts to `/rnp/costs`: whole soʻm per day,
 * `day` inside `month`; null clears the cell.
 */
export interface SaveRnpCostsBody {
  readonly month: string
  readonly cells: readonly { day: string; project: RnpCostProject; line: RnpCostLine; value: number | null }[]
}
