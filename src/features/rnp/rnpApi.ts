/**
 * «RNP jadvali» — the wire shapes, restated for the client.
 *
 * Mirrors the DTOs of `src/server/domain/rnp/rnpSheet.ts` and `rnpSheetView.ts`, and the bodies of
 * `src/app/api/v1/rnp/costs/schema.ts`, `…/headcount/schema.ts` and `…/plan/schema.ts`.
 * Nothing checks the mirror — edit both sides.
 */

/** How a row's numbers read. Money is whole soʻm (or dollars) as a number. */
export type RnpUnit = 'count' | 'uzs' | 'usd' | 'percent' | 'grade'

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
  /** The plan's own unit, when it is not the row's — the brand P&L's «Сумма факт2» / «База усп» carry a share (%) over a soʻm row. Absent: `unit`. */
  readonly planUnit?: RnpUnit
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
  /** The plan cell is typed by hand and saved under this key (`/rnp/plan`); null = computed or none. */
  readonly planInput: RnpPlanInput | null
  /**
   * Where this row sits on the client's «РНП» sheet — its row number and its
   * label there; null = a dashboard addition. Not used on screen.
   */
  readonly sheet: RnpSheetRef | null
  readonly tone: 'total' | 'plain'
  /** One sentence saying where the number comes from. */
  readonly hint: string | null
  /** A cell typed by hand: what the page saves each day under (`RnpManual`). Null = computed. */
  readonly manual: RnpManual | null
  /** Days before this are incomplete in Bitrix24, and are drawn muted. */
  readonly reliableFrom: string | null
}

/** The brand P&L's five cost lines no system holds — typed in place (`RNP_COST_LINES`, rows 411–415 / 438–442). */
export type RnpCostLine = 'bloggers' | 'nutritionist' | 'brandface' | 'marketing' | 'team'
/** The two brands whose P&L carries them (`RNP_COST_PROJECTS`). */
export type RnpCostProject = 'Collagen' | 'Zextra'

/** What a typed plan cell is saved under (`RnpPlanInput` on the server): '' = company-wide. */
export interface RnpPlanInput {
  readonly team: string
  readonly metric: string
}

/** A typed row: a P&L cost line (`/rnp/costs`) or a ROP team's «Ходим сони» (`/rnp/headcount`). */
export type RnpManual =
  | { readonly kind: 'cost'; readonly project: RnpCostProject; readonly line: RnpCostLine }
  | { readonly kind: 'headcount'; readonly rop: string }

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
 * 'section' its orange headings, 'team' its blue team rows, 'brand' the
 * light-blue P&L sub-rows. 'company' (green) and 'alert' (pink «Разница») are
 * the sheet's palette for rows the client removed on 2026-09-30 — no line
 * carries them now. Mirrors `src/server/domain/rnp/rnpSheetLayout.ts`.
 */
export type RnpLabelTone = 'section' | 'team' | 'company' | 'brand' | 'alert' | 'plain'
/** How a line's fact column reads: FAKT sums, «План бажарилиши», ratios, key figures, budgets. */
export type RnpFactTone = 'fakt' | 'plan' | 'rate' | 'key' | 'money' | 'alert' | 'plain'

/**
 * One row of «СентябрРНП 26», in the sheet's order (`rnpSheetView.ts`).
 * `row` is the sheet row, null for a line added for a team the sheet lacks.
 */
/** `both`: a heading each brand keeps over its own rows. */
export type RnpLineBrand = 'Collagen' | 'Zextra' | 'both'

export type RnpLine =
  | {
      readonly kind: 'title'
      readonly row: number | null
      /** The ROP team the line belongs to (the page's ROP filter); null = company-wide. */
      readonly team: string | null
      readonly label: string
      readonly sub: string | null
      readonly tone: RnpLabelTone
      /** The first line of a team the sheet has no block for: draw `RNP_ADDED_TEAM_NOTE` beside it. */
      readonly added?: true
      /** Its brand on the Collagen / Zextra switch; absent = company-wide (not shown under one brand). */
      readonly brand?: RnpLineBrand
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
      /** The first line of a team the sheet has no block for: draw `RNP_ADDED_TEAM_NOTE` beside it. */
      readonly added?: true
      /** Its brand on the Collagen / Zextra switch; absent = company-wide (not shown under one brand). */
      readonly brand?: RnpLineBrand
    }

/**
 * The chip beside the first line of a team the sheet has no block for. Since
 * 2026-10-02 such a block is drawn on the sheet's own template and its first
 * line carries `added`; an older payload put this text in a heading's `sub`.
 */
export const RNP_ADDED_TEAM_NOTE = 'sheetda bloki yoʻq'

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
  /** The sheet's C2 «Неча иш куни ўтди»: today's day of the month, today counted — the forecast's denominator. */
  readonly elapsedDays: number
  readonly teams: readonly RnpTeamDto[]
  readonly blocks: readonly RnpBlockDto[]
  /** The client's sheet, row by row, each line pointing at the block row that fills it. */
  readonly lines: readonly RnpLine[]
  readonly settings: {
    /** The Central Bank's soʻm-per-dollar rate on `usdRateDate` (the latest day it answered); null when it never did. */
    readonly usdRate: number | null
    readonly usdRateDate: string | null
  }
  /** May type the hand-typed cells (P&L costs, «Ходим сони») — `kpi:manage`. */
  readonly canEditPlans: boolean
}

/**
 * What a typed P&L cost cell posts to `/rnp/costs`: whole soʻm per day,
 * `day` inside `month`; null clears the cell.
 */
export interface SaveRnpCostsBody {
  readonly month: string
  readonly cells: readonly { day: string; project: RnpCostProject; line: RnpCostLine; value: number | null }[]
}

/** What a typed plan cell posts to `/rnp/plan`: the value in the row's own unit, up to two decimals; null clears it. */
export interface SaveRnpPlanBody {
  readonly month: string
  readonly cells: readonly { team: string; metric: string; value: number | null }[]
}

export interface SaveRnpHeadcountBody {
  readonly month: string
  readonly cells: readonly { day: string; rop: string; value: number | null }[]
}
