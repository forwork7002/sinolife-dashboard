/**
 * «RNP jadvali» — the client's «СентябрРНП 26» sheet, built from rows the
 * database already holds. Pure: no framework, no database.
 *
 * THE SHEET'S SHAPE AND ITS FORMULAS (the client, 2026-10-01: «sheets dagi
 * har bir formula qanday hisoblangan bo'lsa huddi shunday»): a row per
 * metric, a column per day, and before the days the month's plan (C), the
 * daily plan (B), the fact (D), the forecast (E) and the index (F).
 *
 *   - The forecast is the sheet's `=D/$C$2*$C$1`: the fact so far ÷ today's
 *     day of the month (today counted) × the days in the month — the
 *     month's REAL length, where the sheet typed 31 (the client chose it).
 *   - The daily plan of a summed row is the sheet's `=C/27`.
 *   - Where the sheet's own formula is broken (a wrong range, a `#REF!`, a
 *     dead source tab) the row computes what the formula meant to.
 *   - Rates were typed per day and sometimes averaged. Here every rate is
 *     ΣA ÷ ΣB — for a day and for the month alike — never a mean of rates.
 *   - Totals summed half a month (`SUM(G14:U14)`) or a `#REF!`. Here a month
 *     is every day in it.
 *
 * NULL IS NEVER A ZERO. A day not yet lived, a rate with no denominator, a
 * plan nobody set: each is null, and the screen prints a dash. «0» is a
 * measurement.
 */

import { type RnpLine, sheetLines } from './rnpSheetView'
import type { TargetProduct } from '../types'

// ---------------------------------------------------------------------------
// DTOs — mirrored in `src/features/rnp/rnpApi.ts`
// ---------------------------------------------------------------------------

/**
 * How a row's numbers read. Money is whole soʻm as a JS number: a month of
 * the whole company is ~4·10⁹ soʻm, far inside 2⁵³, and this is a display
 * grid, not a ledger — the ledger stays BigInt minor units up to the row.
 */
export type RnpUnit = 'count' | 'uzs' | 'usd' | 'percent'

/** What a typed plan cell is saved under: the team ('' = company-wide, or a brand / registration group) and the metric. */
export interface RnpPlanInput {
  readonly team: string
  readonly metric: RnpPlanMetric
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
  /**
   * The plan cell is typed by hand — one of the sheet's typed C cells — and
   * saved under this key (`POST /rnp/plan`). Null: the sheet computes this
   * plan from others (orders = FAKT ÷ cheque …), or the row has none.
   */
  readonly planInput: RnpPlanInput | null
  /**
   * Where this row sits on the client's «РНП» sheet — its row number and its
   * label there; null = a dashboard addition. Kept as the record of the
   * mapping; the screen does not filter by it.
   */
  readonly sheet: RnpSheetRef | null
  readonly tone: 'total' | 'plain'
  /** One sentence saying where the number comes from. */
  readonly hint: string | null
  /**
   * A cell typed by hand: what the page saves each day under. Null = computed.
   * `cost` — the P&L's cost lines (`POST /rnp/costs`); `headcount` — a ROP
   * team's «Ходим сони» (`POST /rnp/headcount`).
   */
  readonly manual: RnpManual | null
  /** Days before this are incomplete in Bitrix24, and are drawn muted. */
  readonly reliableFrom: string | null
}

export interface RnpSheetRef {
  readonly row: number
  readonly label: string
}

export type RnpBlockKind =
  | 'marketing'
  | 'registration'
  | 'team'
  | 'company'
  | 'warehouse'
  | 'logistics'
  | 'project'
  | 'summary'

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
  /** The client's sheet, row by row, each line pointing at the block row that fills it. See `rnpSheetView.ts`. */
  readonly lines: readonly RnpLine[]
  readonly settings: {
    /** The Central Bank's soʻm-per-dollar rate on `usdRateDate` — the latest day it answered up to today; null when it never did. */
    readonly usdRate: number | null
    readonly usdRateDate: string | null
  }
  /** May type the hand-typed cells (P&L costs, «Ходим сони») — `kpi:manage`. */
  readonly canEditPlans: boolean
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface RnpFaktDay {
  readonly day: string
  readonly rop: string
  readonly fakt1Orders: number
  readonly fakt1Minor: bigint
  readonly fakt2Orders: number
  readonly fakt2Minor: bigint
  readonly refusedOrders: number
  readonly refusedMinor: bigint
}

export interface RnpSheetInput {
  readonly month: string
  readonly days: readonly string[]
  readonly today: string
  readonly teams: readonly { readonly rop: string; readonly head: string | null }[]
  readonly fakt: readonly RnpFaktDay[]
  /** Deals handed out per day × ROP × registrar («Лид таркатилган сана»); `rop` null: not handed to a ROP team. */
  readonly leads: readonly { readonly day: string; readonly rop: string | null; readonly registrar: string | null; readonly leads: number }[]
  readonly registration: readonly {
    readonly day: string
    /** The lead's brand (source, then form); null when nothing ties it to one. */
    readonly brand?: TargetProduct | null
    readonly leads: number
    readonly duplicates: number
    readonly qualified: number
    readonly aiConversations: number
  }[]
  readonly calls: readonly {
    readonly day: string
    readonly rop: string
    readonly connected: number
  }[]
  readonly warehouse: readonly { readonly day: string; readonly entered: number; readonly notPacked: number }[]
  readonly meta: readonly {
    readonly day: string
    readonly product: TargetProduct
    readonly spendMicroUsd: bigint
    readonly leads: number
  }[]
  /** Kval per day per «Регистрация» label; null = a WON deal with no registrar yet. */
  readonly registrarKval: readonly { readonly day: string; readonly registrar: string | null; readonly qualified: number }[]
  /** The month's registrar → «guruh» assignments. */
  readonly registrarGroups: readonly { readonly registrar: string; readonly group: string }[]
  /**
   * The Central Bank's soʻm-per-dollar rate for each day of the month
   * (`CbuUsdRates`); null for a day not reached or not answered. Nothing typed.
   */
  readonly usdRates: readonly (number | null)[]
  /** Each ROP team's «Ходим сони» typed by hand (`rnp_manual_headcount`). */
  readonly manualHeadcount: readonly { readonly day: string; readonly rop: string; readonly heads: number }[]
  /** The P&L cost lines typed by hand (`rnp_manual_cost`), soʻm. */
  readonly manualCosts: readonly { readonly day: string; readonly project: RnpCostProject; readonly line: RnpCostLine; readonly amount: number }[]
  readonly plans: {
    readonly rows: readonly { team: string; metric: string; fromDay: number; valueCenti: bigint }[]
    readonly fakt: readonly { rop: string; fakt1Minor: bigint | null; fakt2Minor: bigint | null }[]
  }
  readonly noRop: string
  readonly canEditPlans: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The two БАЗА teams. Their sheet blocks count calls where the others count
 * leads: «Малика РОП – БАЗА» is the department «Charos(ROP)» (headed by
 * Malika Rahmonova — the spec matched its sales 126 / 128 and its calls 130 /
 * 130 on 02.09), «Фаррух БАЗА» is «Baza(ROP)». By ropNameSql name.
 */
const BASE_TEAMS: ReadonlySet<string> = new Set(['Charos', 'Baza'])

/**
 * The brand P&L's teams, as the sheet's SUMIFS list them over 'Otchot 2'
 * (rows 394 / 421, by department): an order belongs to the brand of the team
 * that sold it. «Первичка усп» (396 / 423) is the same list without the БАЗА
 * team (`BASE_TEAMS`). The sheet's «Sevinchxon(ROP)» is folded into
 * Sadriddin (`TEAM_ALIASES`). The alias also folds «Malika(ROP)» into
 * Charos — so Malika's old deals count as Zextra, though the sheet's list
 * does not name her. A team on neither list (Hayot) is «Brendsiz».
 */
const BRAND_TEAMS: Readonly<Record<'Collagen' | 'Zextra', ReadonlySet<string>>> = {
  Collagen: new Set(['Sevinch', 'Gulzora', 'Azizbek', 'Lola', 'Saidaziz', 'Maftuna', 'Marjona', 'Baza', 'Shohjaxon']),
  Zextra: new Set(['Asliddin', 'Sadriddin', 'Charos']),
}

/**
 * Team names the deals still carry from before a department was renamed,
 * folded into the team that is the same people today. Both are the sheet's
 * own reading: its «Чарос РОП» block sums «Sevinchxon(ROP)» beside the
 * current department (row 151), and its «Малика РОП – БАЗА» block reads
 * «Malika(ROP)» (row 163) — the department Malika Rahmonova heads is
 * «Charos(ROP)». Applied to every source row before anything is summed, so a
 * folded team's money can only be counted once.
 */
export const TEAM_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  Sevinchxon: 'Sadriddin',
  Malika: 'Charos',
})

/**
 * What the client's «РНП» sheet calls each team, by department name. The
 * sheet names teams by their ROP as the floor knows them, which is not always
 * the department's name: «Садриддин РОП» (the sheet's «Чарос РОП», renamed by
 * the client on 2026-09-30) is the department «Sadriddin(ROP)»,
 * «Малика РОП – БАЗА» is «Charos(ROP)» (spec §3.4, 2026-09-28). A team the
 * sheet has no block for keeps its department name.
 */
const SHEET_TEAM_NAMES: Readonly<Record<string, string>> = Object.freeze({
  Gulzora: 'Гулзора РОП',
  Sevinch: 'Севинч РОП',
  Lola: 'Лола РОП',
  Saidaziz: 'Саидазиз РОП',
  Asliddin: 'Аслиддин РОП',
  Sadriddin: 'Садриддин РОП',
  Charos: 'Малика РОП – БАЗА',
  Marjona: 'Маржона РОП',
  Azizbek: 'Азизбек РОП',
  Maftuna: 'Мафтуна РОП',
  Saida: 'Саида РОП',
  Hayot: 'Ҳаёт РОП',
  Baza: 'Фаррух БАЗА',
  Shohjaxon: 'Шохжахон РОП',
})

/**
 * Where each team's block starts on «СентябрРНП 26» — its «Продажа … факт1»
 * row (the 13-row template of spec §2.6) — and where its logistics block
 * starts (rows 269–334, five rows each). A team the sheet has no block for is
 * absent: its rows get no sheet ref, the company totals still count it.
 */
const TEAM_SHEET_ROW: Readonly<Record<string, number>> = Object.freeze({
  Gulzora: 76,
  Sevinch: 89,
  Lola: 102,
  Saidaziz: 115,
  Asliddin: 129,
  Sadriddin: 143,
  Charos: 156,
  Marjona: 170,
  Azizbek: 183,
  Maftuna: 196,
  Hayot: 222,
  Baza: 235,
})
const LOGISTICS_SHEET_ROW: Readonly<Record<string, number>> = Object.freeze({
  Gulzora: 269,
  Sevinch: 274,
  Saidaziz: 279,
  Lola: 284,
  Asliddin: 289,
  Sadriddin: 294,
  Charos: 299,
  Marjona: 304,
  Azizbek: 309,
  Shohjaxon: 314,
  Baza: 324,
  Maftuna: 330,
})

/**
 * «РОП (Первичка)» is filled on every handed-out lead only from 16.09.2026
 * (measured on the portal: 1–14.09 almost none, 15.09 about half). The
 * «Продажа … факт1» row itself counts EVERY day, exactly as the client's
 * portal filter does (2026-09-30: «bugun erta kech barchasi»); what stays
 * muted before this day are the rates divided by it — conversion and plan % —
 * which a handful of leads would blow up.
 */
const LEAD_ROP_RELIABLE_FROM = '2026-09-16'

/**
 * Calls before this Tashkent day are wrong in the database — both their
 * duration and whether they connected (`CALL_DATA_FLOOR` in
 * `src/lib/callQuality.ts`, 2026-09-15 00:00 Tashkent; 11.6% connected
 * against a normal 31%). Restated as a day because the domain has no clock
 * of its own; `rnpSheet.test.ts` pins the two together.
 */
export const CALLS_RELIABLE_FROM = '2026-09-15'

/** Metric key of the one company-wide setting that is not a plan. */
export const SETTING_LEAD_VALUE = 'lead_value'

/**
 * Every key a plan can be stored under — the rows below name them, and the
 * plan route accepts nothing else, so a typo in a script cannot fill
 * `rnp_plan` with rows no screen reads. Plans the sheet computes (orders,
 * conversions, «Отказ %», row 47) are not keys: nothing stores them.
 */
export const RNP_PLAN_METRICS = [
  SETTING_LEAD_VALUE,
  'budget',
  'budget_collagen',
  'budget_zextra',
  'meta_leads',
  'meta_leads_collagen',
  'meta_leads_zextra',
  'cpl',
  'cpl_collagen',
  'cpl_zextra',
  'cac',
  'marketing_share',
  'reg_qualified',
  'reg_qualified_pct',
  'reg_group_qualified',
  'marketing_plan_pct',
  'targetolog_pct',
  'marketer_pct',
  'brand_fakt1',
  'brand_fakt2',
  'brand_primary_fakt2',
  'brand_base_fakt2',
  'brand_leads',
  'brand_qualified',
  'brand_qualified_pct',
  'brand_cpl',
  'brand_orders2',
  'brand_conversion',
  'brand_cheque2',
  'brand_cost',
  'brand_cac',
  'brand_cost_share',
  'leads',
  'calls',
  'avg_cheque1',
  'avg_cheque2',
  'fakt1',
  'fakt2',
  'headcount',
  'plan_pct',
  'success_rate',
  'warehouse_orders',
] as const

export type RnpPlanMetric = (typeof RNP_PLAN_METRICS)[number]

const UNDISTRIBUTED = 'Taqsimlanmagan'

/**
 * The sheet's registration «guruh» rows, in its order (rows 50–67), then the
 * two the client added on 2026-09-30 in place of the Zextra desk. A group is a
 * set of registrars, typed per month in `rnp_registrar_group` — not the ROP
 * team that receives the lead.
 */
export const REGISTRATION_GROUPS = ['Sevinch', 'Gulzora', 'Aziz', 'Maftuna', 'Lola', 'Saidaziz', 'Asliddin', 'Sadriddin'] as const

/**
 * The brand P&L's hand-typed cost lines — the one exception to «nothing
 * typed» (the client, 2026-09-30): no system holds them. In the sheet's
 * order, with its labels and its row offsets from the project's first row
 * (394 Collagen, 421 Zextra).
 */
export const RNP_COST_LINES = ['bloggers', 'nutritionist', 'brandface', 'marketing', 'team'] as const
export type RnpCostLine = (typeof RNP_COST_LINES)[number]
export const RNP_COST_PROJECTS = ['Collagen', 'Zextra'] as const
export type RnpCostProject = (typeof RNP_COST_PROJECTS)[number]
export type RnpManual =
  | { readonly kind: 'cost'; readonly project: RnpCostProject; readonly line: RnpCostLine }
  | { readonly kind: 'headcount'; readonly rop: string }
const COST_LINE_SHEET: Readonly<Record<RnpCostLine, { offset: number; label: string }>> = {
  bloggers: { offset: 17, label: 'Блогерлар' },
  nutritionist: { offset: 18, label: 'Нутрицолог' },
  brandface: { offset: 19, label: 'Брендфейс' },
  marketing: { offset: 20, label: 'Маркетинг харажатлар' },
  team: { offset: 21, label: 'Маркетинг команда' },
}

/*
  The sheet's own formula (row 16: Бюджет ÷ Колич лид), kept on purpose and
  said out loud: the budget is every non-hiring campaign, DM included, while
  Meta counts leads only on lead forms — so this is not «Отчёт Т»'s
  form-only CPL, and reads higher than it.
*/
const CPL_HINT = 'Jadvaldagidek: butun byudjet (DM kampaniyalari ham) ÷ Meta lid-forma lidlari. «Отчёт Т» dagi faqat forma CPL sidan yuqori chiqadi.'

// ---------------------------------------------------------------------------
// Series arithmetic
// ---------------------------------------------------------------------------

type Series = (number | null)[]

const minorToSom = (minor: bigint): number => Number(minor) / 100

function sum(values: readonly (number | null)[]): number {
  let total = 0
  for (const v of values) if (v !== null) total += v
  return total
}

interface Clock {
  readonly days: readonly string[]
  readonly n: number
  /** Index of today in the month; -1 before it, n after it. */
  readonly todayIndex: number
  /** Days lived, TODAY COUNTED — the sheet's C2. */
  readonly elapsed: number
}

function clockOf(days: readonly string[], today: string): Clock {
  const n = days.length
  if (today < days[0]!) return { days, n, todayIndex: -1, elapsed: 0 }
  if (today > days[n - 1]!) return { days, n, todayIndex: n, elapsed: n }
  const i = days.indexOf(today)
  return { days, n, todayIndex: i, elapsed: i + 1 }
}

/**
 * The first day a row's month cell may read. Days before a row's
 * `reliableFrom` are still drawn (muted) but never summed, pooled or paced:
 * a conversion over leads the portal recorded one in five of is not a low
 * conversion, it is a wrong one.
 */
function startOf(clock: Clock, o: RowOptions): number {
  if (!o.reliableFrom) return 0
  const i = clock.days.findIndex((d) => d >= o.reliableFrom!)
  return i < 0 ? clock.n : i
}

/** Days after today carry no value. */
function lived(clock: Clock, values: readonly (number | null)[]): Series {
  return values.map((v, i) => (i <= clock.todayIndex ? v : null))
}

interface RowOptions {
  readonly key: string
  readonly label: string
  readonly unit: RnpUnit
  readonly better?: 'up' | 'down'
  readonly plan?: number | null
  readonly planInput?: RnpPlanInput | null
  readonly tone?: 'total' | 'plain'
  readonly hint?: string | null
  readonly reliableFrom?: string | null
  readonly sheet?: RnpSheetRef | null
  readonly manual?: RnpRowDto['manual']
}

function base(o: RowOptions) {
  return {
    key: o.key,
    label: o.label,
    unit: o.unit,
    better: o.better ?? ('up' as const),
    sheet: o.sheet ?? null,
    planInput: o.planInput ?? null,
    tone: o.tone ?? ('plain' as const),
    hint: o.hint ?? null,
    reliableFrom: o.reliableFrom ?? null,
    manual: o.manual ?? null,
  }
}

/** The sheet's daily plan of a summed row: `=C/27`, whatever the month's length. */
export const DAY_PLAN_DIVISOR = 27

/** A summed row: the month is its days added, the forecast its pace. */
function additive(clock: Clock, o: RowOptions, values: readonly number[]): RnpRowDto {
  const days = lived(clock, values)
  const s = startOf(clock, o)
  const fact = clock.todayIndex < s ? null : sum(days.slice(s))
  /*
    The sheet's `=D/$C$2*$C$1`: the fact so far over the days so far, TODAY
    COUNTED, times the month's length. Days before `reliableFrom` are in
    neither. With the month over it IS the fact.
  */
  const counted = clock.elapsed - s
  const forecast = fact !== null && counted > 0 ? (fact / counted) * clock.n : null
  const plan = o.plan ?? null
  const measured = forecast
  return {
    ...base(o),
    additive: true,
    plan,
    dayPlan: plan === null ? null : plan / DAY_PLAN_DIVISOR,
    fact,
    forecast,
    index: plan !== null && plan > 0 && measured !== null ? (measured / plan) * 100 : null,
    days,
  }
}

/**
 * A row whose inputs are missing (no dollar rate, no registrar in a group):
 * every cell a dash, never a 0 that reads as «nothing was spent».
 */
function dashed(row: RnpRowDto): RnpRowDto {
  return { ...row, fact: null, forecast: null, index: null, days: row.days.map(() => null) }
}

/**
 * A ratio row: every cell is Σnumerator ÷ Σdenominator × scale — the day's
 * and the month's alike — never an average of daily rates.
 */
function ratio(clock: Clock, o: RowOptions, num: readonly number[], den: readonly number[], scale = 1): RnpRowDto {
  const cell = (a: number, b: number) => (b > 0 ? (a / b) * scale : null)
  const s = startOf(clock, o)
  /*
    A rate on a day its denominator was not recorded whole is not a muted
    figure, it is a wrong one: on production Sevinch's 04.09 read «2 000%»
    conversion over the one lead in five the portal carried. The counts stay
    drawn (muted) before `reliableFrom`; the rates built on them are empty.
  */
  const days: Series = num.map((a, i) => (i >= s && i <= clock.todayIndex ? cell(a, den[i]!) : null))
  const upto = Math.min(clock.todayIndex + 1, clock.n)
  const fact = upto <= s ? null : cell(sum(num.slice(s, upto)), sum(den.slice(s, upto)))
  const plan = o.plan ?? null
  return {
    ...base(o),
    additive: false,
    plan,
    dayPlan: plan,
    fact,
    forecast: null,
    index: plan !== null && plan > 0 && fact !== null ? (fact / plan) * 100 : null,
    days,
  }
}

/**
 * A snapshot row — something counted at a moment, which a month cannot sum.
 * `mean`: the average of the lived days that had any (headcount — a day
 * nobody worked is not a day of zero staff). `latest`: the last lived day's
 * reading (a queue — what stands in it now is the month's answer).
 */
function level(clock: Clock, o: RowOptions, values: readonly (number | null)[], reading: 'mean' | 'latest'): RnpRowDto {
  const days = lived(clock, values)
  const trusted = days.slice(startOf(clock, o))
  const seen = trusted.filter((v): v is number => v !== null && v > 0)
  const last = trusted.filter((v): v is number => v !== null).at(-1) ?? null
  const fact = reading === 'latest' ? last : seen.length > 0 ? sum(seen) / seen.length : null
  const plan = o.plan ?? null
  return {
    ...base(o),
    additive: false,
    plan,
    dayPlan: plan,
    fact,
    forecast: null,
    index: plan !== null && plan > 0 && fact !== null ? (fact / plan) * 100 : null,
    days,
  }
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

interface TeamDays {
  fakt1Orders: number[]
  fakt1: number[]
  fakt2Orders: number[]
  fakt2: number[]
  refusedOrders: number[]
  refused: number[]
  leads: number[]
  calls: number[]
}

export function buildRnpSheet(input: RnpSheetInput): RnpOverviewDto {
  const days = input.days
  const n = days.length
  const at = new Map(days.map((d, i) => [d, i]))
  const clock = clockOf(days, input.today)
  const zeros = () => new Array<number>(n).fill(0)
  /* A day the bank did not answer converts at the month's last known rate before it — never at a guess. */
  const rates: (number | null)[] = []
  for (let i = 0; i < n; i++) rates.push(input.usdRates[i] ?? (i > 0 ? rates[i - 1]! : null))
  const rateKnown = rates.some((r) => r !== null)
  const lastRateAt = rates.reduce<number>((at, r, i) => (r !== null && days[i]! <= input.today ? i : at), -1)

  // --- plans and settings -------------------------------------------------
  const planOf = new Map<string, number>()
  const leadValueRows: { team: string; fromDay: number; value: number }[] = []
  for (const r of input.plans.rows) {
    const value = Number(r.valueCenti) / 100
    if (r.metric === SETTING_LEAD_VALUE) leadValueRows.push({ team: r.team, fromDay: r.fromDay, value })
    else if (r.metric === 'usd_rate') continue // typed until 2026-09-30; the bank's rate replaced it
    else if (r.fromDay === 1) planOf.set(`${r.team}|${r.metric}`, value)
  }
  for (const f of input.plans.fakt) {
    if (f.fakt1Minor !== null) planOf.set(`${f.rop}|fakt1`, minorToSom(f.fakt1Minor))
    if (f.fakt2Minor !== null) planOf.set(`${f.rop}|fakt2`, minorToSom(f.fakt2Minor))
  }
  const plan = (team: string, metric: string) => planOf.get(`${team}|${metric}`) ?? null
  /** A plan the sheet types (column C): typed here too, in its cell. */
  const planned = (team: string, metric: RnpPlanMetric) => ({ plan: plan(team, metric), planInput: { team, metric } })
  /** A plan the sheet computes from other plans: shown, never typed. */
  const derived = (value: number | null) => ({ plan: value })
  const div = (a: number | null, b: number | null, scale = 1) => (a !== null && b !== null && b > 0 ? (a / b) * scale : null)

  /** A lead's value on each day: the team's own schedule, else the company's. */
  const leadValueDays = (team: string): number[] => {
    const own = leadValueRows.filter((r) => r.team === team)
    const rows = (own.length > 0 ? own : leadValueRows.filter((r) => r.team === '')).sort((a, b) => a.fromDay - b.fromDay)
    return days.map((_, i) => {
      let v = 0
      for (const r of rows) if (r.fromDay <= i + 1) v = r.value
      return v
    })
  }

  // --- per-team day grids -------------------------------------------------
  const grid = new Map<string, TeamDays>()
  const teamOf = (rop: string): TeamDays => {
    let t = grid.get(rop)
    if (!t) {
      t = {
        fakt1Orders: zeros(),
        fakt1: zeros(),
        fakt2Orders: zeros(),
        fakt2: zeros(),
        refusedOrders: zeros(),
        refused: zeros(),
        leads: zeros(),
        calls: zeros(),
      }
      grid.set(rop, t)
    }
    return t
  }
  const canonical = (rop: string) => TEAM_ALIASES[rop] ?? rop
  for (const t of input.teams) teamOf(canonical(t.rop))
  // Every team the sheet has a block for is drawn, zeros and all: a quiet
  // month is a Bitrix24 answer (0), not a row Bitrix24 cannot supply.
  for (const rop of [...Object.keys(TEAM_SHEET_ROW), ...Object.keys(LOGISTICS_SHEET_ROW)]) teamOf(rop)

  for (const r of input.fakt) {
    const i = at.get(r.day)
    if (i === undefined) continue
    const t = teamOf(canonical(r.rop))
    t.fakt1Orders[i]! += r.fakt1Orders
    t.fakt1[i]! += minorToSom(r.fakt1Minor)
    t.fakt2Orders[i]! += r.fakt2Orders
    t.fakt2[i]! += minorToSom(r.fakt2Minor)
    t.refusedOrders[i]! += r.refusedOrders
    t.refused[i]! += minorToSom(r.refusedMinor)
  }
  const undistributed = zeros()
  for (const r of input.leads) {
    const i = at.get(r.day)
    if (i === undefined) continue
    if (r.rop === null) undistributed[i]! += r.leads
    else teamOf(canonical(r.rop)).leads[i]! += r.leads
  }
  for (const r of input.calls) {
    const i = at.get(r.day)
    const rop = canonical(r.rop)
    if (i === undefined || !grid.has(rop)) continue
    const t = teamOf(rop)
    t.calls[i]! += r.connected
  }
  // «Ходим сони» is typed (the client, 2026-10-01); a day nobody typed stays empty.
  const typedHeads = new Map<string, Series>()
  for (const r of input.manualHeadcount) {
    const i = at.get(r.day)
    if (i === undefined) continue
    const rop = canonical(r.rop)
    let series = typedHeads.get(rop)
    if (!series) typedHeads.set(rop, (series = days.map(() => null)))
    series[i] = r.heads
  }

  const heads = new Map(input.teams.filter((t) => !(t.rop in TEAM_ALIASES)).map((t) => [t.rop, t.head]))
  const labelOf = (rop: string) => SHEET_TEAM_NAMES[rop] ?? rop
  /** The department behind a sheet name, and its head: «Sadriddin(ROP) · Mamayusupov Sadriddin». */
  const subtitleOf = (rop: string) => [`${rop}(ROP)`, heads.get(rop)].filter(Boolean).join(' · ')
  const monthFakt1 = (t: TeamDays) => sum(t.fakt1)
  const active = (t: TeamDays) => sum(t.fakt1Orders) + sum(t.fakt2Orders) + sum(t.leads) + sum(t.calls) > 0
  /*
    A ROP department with nothing in the month (a unit kept for history) is
    left out rather than drawn as a block of zeros — unless the client's sheet
    has a block for it; a team the deals still name but the org chart no
    longer has («Sevinchxon») is kept, because its money is real and the
    totals above count it.
  */
  const teamNames = [...grid.keys()]
    .filter((rop) => rop !== input.noRop && (active(grid.get(rop)!) || Object.hasOwn(TEAM_SHEET_ROW, rop)))
    .sort((a, b) => monthFakt1(grid.get(b)!) - monthFakt1(grid.get(a)!) || a.localeCompare(b, 'ru'))
  const withNoRop = grid.has(input.noRop) ? [...teamNames, input.noRop] : teamNames
  /* The sheet's logistics rows name a team its ROP blocks do not (Шохжахон): drawn too, zeros and all. */
  const logisticsTeams = [...withNoRop, ...Object.keys(LOGISTICS_SHEET_ROW).filter((rop) => !withNoRop.includes(rop))]

  // --- company totals -----------------------------------------------------
  const total = (pick: (t: TeamDays) => number[], only?: (rop: string) => boolean): number[] => {
    const out = zeros()
    for (const [rop, t] of grid) {
      if (only && !only(rop)) continue
      const v = pick(t)
      for (let i = 0; i < n; i++) out[i]! += v[i]!
    }
    return out
  }
  const isBase = (rop: string) => BASE_TEAMS.has(rop)
  const primary = (rop: string) => !isBase(rop)

  const fakt1All = total((t) => t.fakt1)
  const fakt2All = total((t) => t.fakt2)
  const fakt2Primary = total((t) => t.fakt2, primary)
  const fakt2OrdersPrimary = total((t) => t.fakt2Orders, primary)
  const refusedAll = total((t) => t.refused)
  const ropLeads = total((t) => t.leads)

  const reg = { leads: zeros(), duplicates: zeros(), qualified: zeros(), ai: zeros() }
  /*
    ONE STATEMENT FOR THE KVAL. The per-registrar read counts the same WON
    deals as the registration scan (role LEAD, status WON, closedAt), but the
    scan's closed days sit in a half-hour memo; taking the total from the
    registrar read keeps «жами» = groups + guruhsiz + Zextra on every load.
  */
  for (const r of input.registrarKval) {
    const i = at.get(r.day)
    if (i !== undefined) reg.qualified[i]! += r.qualified
  }
  for (const r of input.registration) {
    const i = at.get(r.day)
    if (i === undefined) continue
    reg.leads[i]! += r.leads
    reg.duplicates[i]! += r.duplicates
    if (input.registrarKval.length === 0) reg.qualified[i]! += r.qualified
    reg.ai[i]! += r.aiConversations
  }

  const meta = {
    Collagen: { spend: zeros(), leads: zeros() },
    Zextra: { spend: zeros(), leads: zeros() },
  }
  for (const r of input.meta) {
    const i = at.get(r.day)
    if (i === undefined) continue
    meta[r.product].spend[i]! += Number(r.spendMicroUsd) / 1_000_000
    meta[r.product].leads[i]! += r.leads
  }
  const spendAll = days.map((_, i) => meta.Collagen.spend[i]! + meta.Zextra.spend[i]!)
  const metaLeadsAll = days.map((_, i) => meta.Collagen.leads[i]! + meta.Zextra.leads[i]!)

  const blocks: RnpBlockDto[] = []

  const sh = (row: number, label: string): RnpSheetRef => ({ row, label })

  // --- Маркетинг (sheet rows 4–45) ----------------------------------------
  const productRows = (p: 'Collagen' | 'Zextra'): RnpRowDto[] => {
    const k = p === 'Collagen' ? 'collagen' : 'zextra'
    const r = p === 'Collagen' ? 14 : 38
    return [
      additive(clock, { key: `meta:${k}:spend`, label: `${p} · Бюджет, $`, unit: 'usd', better: 'down', ...planned('', `budget_${k}`), hint: `Meta Ads: ${p} akkauntlarining sarfi, ishga olish kampaniyalarisiz.`, sheet: sh(r, `Бюджет ${p}`) }, meta[p].spend),
      additive(clock, { key: `meta:${k}:leads`, label: `${p} · Лид (Meta)`, unit: 'count', ...planned('', `meta_leads_${k}`), hint: 'Meta Ads hisoblagan lid (lid-forma).', sheet: sh(r + 1, `Колич ${p} лид`) }, meta[p].leads),
      ratio(clock, { key: `meta:${k}:cpl`, label: `${p} · Лид нархи, $`, unit: 'usd', better: 'down', ...planned('', `cpl_${k}`), hint: CPL_HINT, sheet: sh(r + 2, `Цена лида ${p}`) }, meta[p].spend, meta[p].leads),
    ]
  }
  blocks.push({
    id: 'marketing',
    kind: 'marketing',
    title: 'Маркетинг',
    subtitle: 'Meta Ads — Collagen va Zextra',
    team: null,
    sheet: sh(4, 'Маркетинг'),
    rows: [
      ...productRows('Collagen'),
      ...productRows('Zextra'),
      additive(clock, { key: 'meta:spend', label: 'Жами бюджет, $', unit: 'usd', better: 'down', tone: 'total', ...planned('', 'budget'), sheet: sh(42, 'Бюджет') }, spendAll),
      additive(clock, { key: 'meta:leads', label: 'Жами лид (Meta)', unit: 'count', tone: 'total', ...planned('', 'meta_leads'), sheet: sh(43, 'Количество лид') }, metaLeadsAll),
      ratio(clock, { key: 'meta:cpl', label: 'CPL, $', unit: 'usd', better: 'down', ...planned('', 'cpl'), hint: CPL_HINT, sheet: sh(44, 'CPL $ цена лида') }, spendAll, metaLeadsAll),
      ratio(clock, { key: 'meta:cac', label: 'CAC (мижоз нарҳи), $', unit: 'usd', better: 'down', ...planned('', 'cac'), hint: 'Jami byudjet ÷ birlamchi jamoalarning FAKT 2 buyurtmalari (БАЗА jamoalarisiz).', sheet: sh(11, 'САС (мижоз нарҳи), $') }, spendAll, fakt2OrdersPrimary),
      // The sheet's unlabelled row 45, `=IFERROR(G42/G47,0)`: what one lead that reached Регистрация cost.
      ratio(clock, { key: 'meta:cost_per_reg_lead', label: 'Регистрация лид нархи, $', unit: 'usd', better: 'down', hint: 'Jadvalning 45-qatori: jami byudjet ÷ Регистрация lidlari.', sheet: sh(45, 'Регистрация лид нархи, $') }, spendAll, reg.leads),
      ratio(
        clock,
        {
          key: 'meta:share',
          label: 'Маркетинг улуши (ДРР), %',
          unit: 'percent',
          better: 'down',
          ...planned('', 'marketing_share'),
          hint: !rateKnown ? 'Markaziy bank kursi olinmadi.' : `Byudjet × shu kungi Markaziy bank kursi ÷ birlamchi FAKT 2 summasi. Jadvalda «ROMI» deb yozilgan, aslida xarajat ulushi.`,
          sheet: sh(12, 'ROMI %'),
        },
        days.map((_, i) => spendAll[i]! * (rates[i] ?? 0)),
        days.map((_, i) => (rates[i] === null ? 0 : fakt2Primary[i]!)),
        100,
      ),
    ],
  })

  // --- Регистрация (sheet rows 47–73) --------------------------------------
  const difference = days.map((_, i) => ropLeads[i]! - reg.qualified[i]!)
  const groupOf = new Map(input.registrarGroups.map((g) => [g.registrar, g.group]))
  const kvalBy = new Map<string, number[]>()
  const kvalOf = (key: string) => {
    let v = kvalBy.get(key)
    if (!v) {
      v = zeros()
      kvalBy.set(key, v)
    }
    return v
  }
  /*
    A GROUP'S KVAL IS WHAT IT HANDED TO THE ROPs (client, 2026-10-01): the
    leads of «РОП ларга тарқатилди» — by «Лид таркатилган сана», the same
    deals the ROP blocks' «Квал лид сони» count — split by the registrar
    on the deal. Groups + guruhsiz = «РОП ларга тарқатилди», day by day.
  */
  for (const r of input.leads) {
    const i = at.get(r.day)
    if (i === undefined || r.rop === null) continue
    const assigned = r.registrar === null ? null : (groupOf.get(r.registrar) ?? null)
    // A group the sheet no longer draws (the retired «Zextra» desk) counts as no group, so the rows still add up.
    const g = assigned !== null && (REGISTRATION_GROUPS as readonly string[]).includes(assigned) ? assigned : null
    kvalOf(`g|${g ?? ''}`)[i]! += r.leads
  }
  const ungrouped = kvalOf('g|')
  /* The sheet's «квал» row of each group (51, 54, … 66). Its «без квал» and «квал %» rows need a lead's registrar BEFORE it is qualified, which Bitrix24 does not record — they are not on this screen. */
  /* Asliddin and Sadriddin — the client's two groups added in place of the Zextra desk (2026-09-30) — have no sheet row; `rnpSheetLayout` numbers them 1002 / 1012. */
  const GROUP_SHEET_ROW: Readonly<Record<string, number>> = { Sevinch: 51, Gulzora: 54, Aziz: 57, Maftuna: 60, Lola: 63, Saidaziz: 66, Asliddin: 1002, Sadriddin: 1012 }
  blocks.push({
    id: 'registration',
    kind: 'registration',
    title: 'Регистрация',
    subtitle: 'Регистрация voronkasi (dublikatsiz), registrator guruhlari va ROP larga tarqatilgan lidlar',
    team: null,
    sheet: sh(47, 'Регистрация'),
    rows: [
      additive(clock, { key: 'reg:leads', label: 'Тушган лид (Регистрация)', unit: 'count', ...derived(div(plan('', 'reg_qualified'), plan('', 'reg_qualified_pct'), 100)), hint: 'Регистрация voronkasida yaratilgan bitimlar, «Дубликат (лид)» bosqichidagilarsiz. Reja — jadvaldagidek: квал rejasi ÷ квал % rejasi.', sheet: sh(47, 'Количество лид') }, reg.leads),
      additive(clock, { key: 'reg:duplicates', label: 'Дубликат', unit: 'count', better: 'down', hint: '«Дубликат (лид)» bosqichi; qizil «Дубликат» bunga kirmaydi.' }, reg.duplicates),
      additive(clock, { key: 'reg:ai', label: 'ИИ обработка мурожаатлари', unit: 'count', hint: '«ИИ обработка» voronkasida ochilgan suhbatlar.' }, reg.ai),
      additive(clock, { key: 'reg:qualified', label: 'Квал лид — жами (Сделка успешна)', unit: 'count', tone: 'total', hint: 'Registrator «Сделка успешна» ga oʻtkazgan lidlar — yopilgan kuni boʻyicha. Collagen + Zextra.' }, reg.qualified),
      additive(clock, { key: 'reg:qualified_collagen', label: 'Регистрация COLLAGEN (квал)', unit: 'count', ...planned('', 'reg_qualified'), hint: 'Barcha registratorlarning kvali (Zextra registratsiyasi 2026-09-30 da olib tashlangan).', sheet: sh(48, 'Регистрация COLLAGEN') }, reg.qualified),
      ratio(clock, { key: 'reg:qualified_pct', label: '% квал лид (Collagen)', unit: 'percent', ...planned('', 'reg_qualified_pct'), sheet: sh(49, '% квал лид') }, reg.qualified, reg.leads, 100),
      ...REGISTRATION_GROUPS.map((g) => {
        /* A group with no registrar assigned is not known to be zero — its cells stay empty («bilmagan joyni boʻsh qoldir»). */
        const row = additive(clock, { key: `reg:group:${g}:qualified`, label: `${g} guruh — квал`, unit: 'count', ...planned(g, 'reg_group_qualified'), hint: `Guruh registratorlari ROP larga tarqatgan lidlar — «Лид таркатилган сана» boʻyicha: ${[...groupOf].filter(([, x]) => x === g).map(([r]) => r).join(', ') || 'registrator biriktirilmagan'}.`, sheet: sh(GROUP_SHEET_ROW[g]!, `${g} guruh — квал`) }, kvalOf(`g|${g}`))
        return [...groupOf.values()].includes(g) ? row : dashed(row)
      }),
      additive(clock, { key: 'reg:group:none:qualified', label: 'Guruhsiz registratorlar — квал', unit: 'count', better: 'down', hint: 'ROP larga tarqatilgan lidlar, registratori hech bir guruhga biriktirilmagan (yoki registrator maydoni boʻsh) — «Лид таркатилган сана» boʻyicha.' }, ungrouped),
      additive(clock, { key: 'reg:distributed', label: 'РОП ларга тарқатилди', unit: 'count', reliableFrom: LEAD_ROP_RELIABLE_FROM, hint: '«Лид таркатилган сана» shu kun va «РОП (Первичка)» ROP jamoasi boʻlgan bitimlar.' }, ropLeads),
      additive(clock, { key: 'reg:undistributed', label: UNDISTRIBUTED, unit: 'count', better: 'down', reliableFrom: LEAD_ROP_RELIABLE_FROM, hint: 'Tarqatilgan sanasi bor, lekin «РОП (Первичка)» da ROP emas (masalan Регистрация boshligʻi) yoki boʻsh.' }, undistributed),
      additive(clock, { key: 'reg:difference', label: 'Разница (РОП лид − квал лид)', unit: 'count', reliableFrom: LEAD_ROP_RELIABLE_FROM }, difference),
    ],
  })

  // --- ROP blocks (sheet rows 75–246) ---------------------------------------
  for (const rop of teamNames) {
    const t = grid.get(rop)!
    const baseTeam = isBase(rop)
    const reach = baseTeam ? t.calls : t.leads
    const reachMetric: RnpPlanMetric = baseTeam ? 'calls' : 'leads'
    const reachFrom = baseTeam ? CALLS_RELIABLE_FROM : LEAD_ROP_RELIABLE_FROM
    /* A БАЗА team's «План бажарилиши» prices each connected call at the lead's value, as the sheet's `=G160/(G156*400000)` does. */
    const leadValue = leadValueDays(rop)
    /* The sheet's C79 `=C80/C78` and C84 `=C83/C86`: an orders plan is the money plan over the cheque plan; conversions follow. */
    const ordersPlan = div(plan(rop, 'fakt1'), plan(rop, 'avg_cheque1'))
    const orders2Plan = div(plan(rop, 'fakt2'), plan(rop, 'avg_cheque2'))
    const expected = days.map((_, i) => reach[i]! * leadValue[i]!)
    const headcount = typedHeads.get(rop) ?? days.map(() => null)
    const reachLabel = baseTeam ? 'Дозвон (уланган қўнғироқ)' : 'РОП олган лид'
    const reachHint = baseTeam
      ? 'Jamoa xodimlarining ulangan kiruvchi va chiquvchi qoʻngʻiroqlari.'
      : 'Bitrix24: «Лид таркатилган сана» shu kun va «РОП (Первичка)» shu jamoa rahbari boʻlgan barcha bitimlar (hamma voronkalar).'
    /* The team's block on the sheet: its «Продажа … факт1» row; the rest follow the 13-row template (spec §2.6). */
    const r0 = Object.hasOwn(TEAM_SHEET_ROW, rop) ? TEAM_SHEET_ROW[rop] : undefined
    const at0 = (offset: number, label: string) => (r0 === undefined ? null : sh(r0 + offset, label))
    const k = `team:${rop}`
    blocks.push({
      id: k,
      kind: 'team',
      title: labelOf(rop) === rop ? `${rop} РОП${baseTeam ? ' — БАЗА' : ''}` : labelOf(rop),
      subtitle: subtitleOf(rop),
      team: rop,
      sheet: r0 === undefined ? null : sh(r0, labelOf(rop)),
      rows: [
        additive(clock, { key: `${k}:reach`, label: reachLabel, unit: 'count', ...planned(rop, reachMetric), hint: reachHint, reliableFrom: baseTeam ? reachFrom : null, sheet: at0(0, baseTeam ? 'Продажа (база) факт1 — дозвон' : 'Продажа (первичка) факт1 — квал лид') }, reach),
        ratio(clock, { key: `${k}:conv1`, label: baseTeam ? 'Конверсия % от дозвон' : 'Конверсия % от квал лид', unit: 'percent', ...derived(div(ordersPlan, plan(rop, reachMetric), 100)), reliableFrom: reachFrom, sheet: at0(1, baseTeam ? 'Конверция % от дозвон' : 'Конверция % от квал лид') }, t.fakt1Orders, reach, 100),
        ratio(clock, { key: `${k}:cheque1`, label: 'Ўртача чек (ФАКТ 1)', unit: 'uzs', ...planned(rop, 'avg_cheque1'), sheet: at0(2, 'Средний чек факт 1') }, t.fakt1, t.fakt1Orders),
        additive(clock, { key: `${k}:orders1`, label: 'Буюртма сони (ФАКТ 1)', unit: 'count', ...derived(ordersPlan), sheet: at0(3, 'Буюртма сони') }, t.fakt1Orders),
        additive(clock, { key: `${k}:fakt1`, label: 'Сумма ФАКТ 1', unit: 'uzs', tone: 'total', ...planned(rop, 'fakt1'), hint: 'Tasdiqlandi + Tasdiqlanmay chiqdi — Tasdiqlash navbati kogortasi, jamoa bitimdagi «Организация сотрудника» boʻyicha.', sheet: at0(4, 'Сумма факт 1 сум') }, t.fakt1),
        /* The block's first line on the page (the ROP's name beside it) — so a БАЗА team without its own lead value gets it empty, not missing. */
        ratio(clock, { key: `${k}:plan_pct`, label: 'План бажарилиши, %', unit: 'percent', ...planned(rop, 'plan_pct'), reliableFrom: reachFrom, hint: `ФАКТ 1 ÷ (${baseTeam ? 'дозвон' : 'lid'} × bitta lid qiymati). Lid qiymati — jadvaldagi doimiy (400 000, 14.09 dan 500 000); yangi oy oxirgisini oladi.`, sheet: at0(5, 'План бажарилиши') }, t.fakt1, expected, 100),
        ...(baseTeam ? [ratio(clock, { key: `${k}:per_call`, label: 'Дозвонга ўртача сумма', unit: 'uzs', reliableFrom: reachFrom, sheet: at0(11, 'Средний сумма за дозвон') }, t.fakt1, reach)] : []),
        level(clock, { key: `${k}:headcount`, label: 'Ходим сони', unit: 'count', ...planned(rop, 'headcount'), hint: 'Qoʻlda kiritiladi — har kuni jamoadagi xodimlar soni. Oy ustuni — kiritilgan kunlarning oʻrtachasi (0 yozilgan kun hisobga olinmaydi).', sheet: at0(6, 'Ходим сони'), manual: { kind: 'headcount', rop } }, headcount, 'mean'),
        additive(clock, { key: `${k}:fakt2`, label: 'Сумма ФАКТ 2 (Доставлено)', unit: 'uzs', tone: 'total', ...planned(rop, 'fakt2'), sheet: at0(7, 'Сумма факт 2 сум') }, t.fakt2),
        additive(clock, { key: `${k}:orders2`, label: 'Транзакция ФАКТ 2', unit: 'count', ...derived(orders2Plan), sheet: at0(8, 'Транзакция факт 2') }, t.fakt2Orders),
        // Not for a БАЗА team: the client took «Конверсия % факт2» off Малика's and Фаррух's blocks (2026-09-30).
        ...(baseTeam ? [] : [ratio(clock, { key: `${k}:conv2`, label: 'Конверсия % ФАКТ 2', unit: 'percent', ...derived(div(orders2Plan, plan(rop, reachMetric), 100)), reliableFrom: reachFrom, sheet: at0(9, 'Конверция % факт2') }, t.fakt2Orders, reach, 100)]),
        ratio(clock, { key: `${k}:cheque2`, label: 'Ўртача чек (ФАКТ 2)', unit: 'uzs', ...planned(rop, 'avg_cheque2'), sheet: at0(10, 'Средний чек факт 2') }, t.fakt2, t.fakt2Orders),
      ],
    })
  }

  // --- Склад (sheet rows 264–267) --------------------------------------------
  const entered = zeros()
  const notPacked = zeros()
  for (const r of input.warehouse) {
    const i = at.get(r.day)
    if (i === undefined) continue
    entered[i] = r.entered
    notPacked[i] = r.notPacked
  }
  blocks.push({
    id: 'warehouse',
    kind: 'warehouse',
    title: 'Склад ва упаковка',
    subtitle: 'Доставка voronkasi bosqich tarixi',
    team: null,
    sheet: sh(264, 'Склад и упаковка'),
    rows: [
      additive(clock, { key: 'wh:entered', label: 'Жами заказ сони', unit: 'count', ...planned('', 'warehouse_orders'), hint: 'Shu kuni Доставка voronkasiga birinchi marta tushgan buyurtmalar.', sheet: sh(265, 'Жами заказ сони') }, entered),
      level(clock, { key: 'wh:not_packed', label: 'Не собран (кун охирида)', unit: 'count', better: 'down', hint: '«Подготовка товара» va «Заказ в мой склад» bosqichlarida kun oxirida turgan buyurtmalar (bugun — hozirgi holat). Oy ustuni — oxirgi kun.', sheet: sh(266, 'Не собран') }, notPacked, 'latest'),
      { ...ratio(clock, { key: 'wh:not_packed_pct', label: 'Фоизи, %', unit: 'percent', better: 'down', hint: 'Kun oxiridagi «не собран» ÷ shu kuni tushgan buyurtmalar. Oy uchun hisoblanmaydi: holatlarni qoʻshib boʻlmaydi.', sheet: sh(267, 'Фоизи %') }, notPacked, entered, 100), fact: null, index: null },
    ],
  })

  // --- Логистика (sheet rows 269–334) ----------------------------------------
  const logisticsRows = (k: string, t: { fakt1: number[]; fakt2: number[]; refused: number[] }, tone: 'total' | 'plain', team: string, r0: number | undefined): RnpRowDto[] => {
    const open = days.map((_, i) => Math.max(0, t.fakt1[i]! - t.fakt2[i]! - t.refused[i]!))
    // Not clamped: FAKT 2 is not bounded by FAKT 1 on a day, and only the unclamped difference keeps «Отказ» = 100 − «Успешность» for the month.
    const unsuccessful = days.map((_, i) => t.fakt1[i]! - t.fakt2[i]!)
    // The sheet's C272 is typed as 1 − C271: the refusal plan follows the success plan.
    const successPlan = team === input.noRop ? null : plan(team, 'success_rate')
    const at0 = (offset: number, label: string) => (r0 === undefined ? null : sh(r0 + offset, label))
    return [
      additive(clock, { key: `${k}:fakt1`, label: 'Сумма ФАКТ 1', unit: 'uzs', tone, sheet: at0(0, 'Сумма факт1') }, t.fakt1),
      additive(clock, { key: `${k}:fakt2`, label: 'Успешка сумма ФАКТ 2', unit: 'uzs', tone, sheet: at0(1, 'Успешка сумма факт 2') }, t.fakt2),
      ratio(clock, { key: `${k}:success`, label: 'Успешность, %', unit: 'percent', ...(team === input.noRop ? {} : planned(team, 'success_rate')), sheet: at0(2, 'Успешкность %') }, t.fakt2, t.fakt1, 100),
      additive(clock, { key: `${k}:refused`, label: 'Отказ сумма', unit: 'uzs', better: 'down', sheet: at0(4, 'Отказ сумма') }, t.refused),
      // The sheet's `=1-D(успешкность)`: everything of FAKT 1 not yet «Успешно» — refused, and still on its way.
      ratio(clock, { key: `${k}:refused_pct`, label: 'Отказ, %', unit: 'percent', better: 'down', ...(team === input.noRop ? {} : derived(successPlan === null ? null : 100 - successPlan)), hint: 'Jadvaldagidek: 100% − Успешность % — ФАКТ 1 ning hali «Успешно» boʻlmagan qismi (rad etilgan va yoʻldagi).', sheet: at0(3, 'Отказ %') }, unsuccessful, t.fakt1, 100),
      ratio(clock, { key: `${k}:open_pct`, label: 'Жараёнда, %', unit: 'percent', better: 'down', hint: 'Hali yetkazilmagan va rad etilmagan (yoʻlda, pochtada) buyurtmalar ulushi.' }, open, t.fakt1, 100),
    ]
  }
  blocks.push({
    id: 'logistics',
    kind: 'logistics',
    title: 'Логистика — жами',
    subtitle: 'Tasdiqlash navbati kogortasi, buyurtmaning hozirgi bosqichi boʻyicha',
    team: null,
    sheet: null,
    rows: logisticsRows('lg', { fakt1: fakt1All, fakt2: fakt2All, refused: refusedAll }, 'total', '', undefined),
  })
  for (const rop of logisticsTeams) {
    const t = grid.get(rop)!
    if (sum(t.fakt1) === 0 && sum(t.fakt2) === 0 && !Object.hasOwn(LOGISTICS_SHEET_ROW, rop)) continue
    const r0 = Object.hasOwn(LOGISTICS_SHEET_ROW, rop) ? LOGISTICS_SHEET_ROW[rop] : undefined
    blocks.push({
      id: `logistics:${rop}`,
      kind: 'logistics',
      title: `Логистика — ${labelOf(rop)}`,
      subtitle: rop === input.noRop ? null : subtitleOf(rop),
      team: rop,
      sheet: r0 === undefined ? null : sh(r0, `Логистика — ${labelOf(rop)}`),
      rows: logisticsRows(`lg:${rop}`, t, 'plain', rop, r0),
    })
  }

  // --- Loyiha P&L: Коллаген / Зехтра (sheet rows 394–445) --------------------
  const brandGrid = (b: 'Collagen' | 'Zextra' | null) => {
    const g = { fakt1: zeros(), fakt2: zeros(), primaryFakt2: zeros(), primaryOrders2: zeros(), baseFakt2: zeros(), leads: zeros(), qualified: zeros() }
    for (const r of input.fakt) {
      const i = at.get(r.day)
      const team = canonical(r.rop)
      const brand = BRAND_TEAMS.Collagen.has(team) ? 'Collagen' : BRAND_TEAMS.Zextra.has(team) ? 'Zextra' : null
      if (i === undefined || brand !== b) continue
      const base = isBase(team)
      g.fakt1[i]! += minorToSom(r.fakt1Minor)
      g.fakt2[i]! += minorToSom(r.fakt2Minor)
      if (base) g.baseFakt2[i]! += minorToSom(r.fakt2Minor)
      else {
        g.primaryFakt2[i]! += minorToSom(r.fakt2Minor)
        g.primaryOrders2[i]! += r.fakt2Orders
      }
    }
    for (const r of input.registration) {
      const i = at.get(r.day)
      if (i === undefined || (r.brand ?? null) !== b) continue
      g.leads[i]! += r.leads
      g.qualified[i]! += r.qualified
    }
    return g
  }
  /*
    The P&L's percentages are constants in the sheet's formulas: «Маркетинг
    харажат план» `=G395*11%`, «Таргетолог фот» `=G409*10%`, «Маркетолог
    фот = 1%» `=G395*1%`. A value saved for the month (before «Rejalar» was
    removed) still wins.
  */
  const pct = (metric: RnpPlanMetric, sheet: number) => plan('', metric) ?? sheet
  const marketingPlanPct = pct('marketing_plan_pct', 11)
  const targetologPct = pct('targetolog_pct', 10)
  const marketerPct = pct('marketer_pct', 1)
  /** A percent in a label, as the screen writes numbers: a decimal comma. */
  const pctText = (v: number) => String(v).replace('.', ',')
  for (const b of ['Collagen', 'Zextra'] as const) {
    const g = brandGrid(b)
    const k = `pj:${b.toLowerCase()}`
    /* Коллаген проект starts at row 394, Зехтра at 421, one 25-row template. */
    const r0 = b === 'Collagen' ? 394 : 421
    const at0 = (offset: number, label: string) => sh(r0 + offset, label)
    const spendUsd = meta[b].spend
    const spendUzs = days.map((_, i) => (rates[i] === null ? 0 : spendUsd[i]! * rates[i]!))
    const targetolog = spendUzs.map((v) => (v * targetologPct) / 100)
    const marketer = g.fakt2.map((v) => (v * marketerPct) / 100)
    const costPlan = g.fakt2.map((v) => (v * marketingPlanPct) / 100)
    /*
      The ad budget in soʻm, the targetologist's share of it, the marketer's
      share of FAKT 2 — and the five lines no system holds (bloggers,
      nutritionist, brand face, marketing costs, team; rows 411–415 /
      438–442), typed in place since the client asked on 2026-09-30.
    */
    const typed = new Map(RNP_COST_LINES.map((line) => [line, days.map((): number | null => null)] as const))
    for (const c of input.manualCosts) {
      const i = at.get(c.day)
      if (c.project === b && i !== undefined) typed.get(c.line)![i] = c.amount
    }
    const manualRows = RNP_COST_LINES.map((line) => {
      const cells = typed.get(line)!
      const { offset, label } = COST_LINE_SHEET[line]
      const row = additive(
        clock,
        { key: `${k}:cost_${line}`, label, unit: 'uzs', better: 'down', hint: 'Qoʻlda kiritiladi — Bitrix24 da yoʻq xarajat.', sheet: at0(offset, label), manual: { kind: 'cost', project: b, line } },
        cells.map((v) => v ?? 0),
      )
      // A day nobody typed is empty, not zero; the month is what was typed — and empty while nothing is.
      if (cells.every((v) => v === null)) return dashed(row)
      // A typed cost is a payment, not a pace: one 10 M payment on the 1st must not forecast 300 M.
      return { ...row, forecast: null, index: null, days: row.days.map((v, i) => (cells[i] === null ? null : v)) }
    })
    const manualCost = days.map((_, i) => RNP_COST_LINES.reduce((sum, line) => sum + (typed.get(line)![i] ?? 0), 0))
    const costFact = days.map((_, i) => spendUzs[i]! + targetolog[i]! + marketer[i]! + manualCost[i]!)
    const computedCost = days.map((_, i) => costFact[i]! - manualCost[i]!)
    /* «Маркетинг харажат факт»: the computed costs run at their pace; the typed ones are added as paid, never extrapolated. */
    const withTyped = (row: RnpRowDto): RnpRowDto => {
      const typedSoFar = sum(lived(clock, manualCost).map((v) => v ?? 0))
      const forecast = row.forecast === null ? null : row.forecast + typedSoFar
      return {
        ...row,
        fact: row.fact === null ? null : row.fact + typedSoFar,
        forecast,
        index: row.plan !== null && row.plan > 0 && forecast !== null ? (forecast / row.plan) * 100 : null,
        days: row.days.map((v, i) => (v === null ? null : v + manualCost[i]!)),
      }
    }
    const costUsd = costFact.map((v, i) => (rates[i] ? v / rates[i]! : 0))
    const rateHint = rateKnown ? ' Har kun oʻz kursi — Markaziy bank (cbu.uz).' : ' Markaziy bank kursi olinmadi.'
    /* The whole cost needs the dollar rate; without it it is not «the cost», it is part of it. */
    const missingHint = rateKnown ? '' : ' Markaziy bank kursi olinmadi.'
    const whenKnown = (known: boolean, row: RnpRowDto) => (known ? row : dashed(row))
    blocks.push({
      id: `project:${b.toLowerCase()}`,
      kind: 'project',
      title: b === 'Collagen' ? 'Коллаген проект' : 'Зехтра проект',
      subtitle: 'Brend: buyurtmaning eng qimmat mahsulot qatori; lid: manba yoki forma.',
      team: null,
      sheet: sh(r0, b === 'Collagen' ? 'Коллаген проект' : 'Зехтра проект'),
      rows: [
        additive(clock, { key: `${k}:fakt1`, label: 'Сумма ФАКТ 1', unit: 'uzs', tone: 'total', ...planned(b, 'brand_fakt1'), sheet: at0(0, 'Сумма факт1') }, g.fakt1),
        additive(clock, { key: `${k}:fakt2`, label: 'Сумма ФАКТ 2 (успешка)', unit: 'uzs', tone: 'total', ...planned(b, 'brand_fakt2'), sheet: at0(1, 'Сумма факт2 (успешка)') }, g.fakt2),
        additive(clock, { key: `${k}:primary_fakt2`, label: 'Первичка усп', unit: 'uzs', ...planned(b, 'brand_primary_fakt2'), sheet: at0(2, 'Первичка усп') }, g.primaryFakt2),
        additive(clock, { key: `${k}:base_fakt2`, label: 'База усп', unit: 'uzs', ...planned(b, 'brand_base_fakt2'), sheet: at0(3, 'База усп') }, g.baseFakt2),
        additive(clock, { key: `${k}:spend`, label: 'Таргет бюджет, $', unit: 'usd', better: 'down', hint: 'Meta Ads — shu brend akkauntlari, ishga olish kampaniyalarisiz.', sheet: at0(4, 'Таргет бюджет, $') }, spendUsd),
        additive(clock, { key: `${k}:leads`, label: 'Кол лид (Регистрация)', unit: 'count', ...planned(b, 'brand_leads'), hint: 'Регистрация lidlari, brend manba yoki CRM-forma boʻyicha.', sheet: at0(5, 'Кол лид') }, g.leads),
        additive(clock, { key: `${k}:qualified`, label: 'Квал лид', unit: 'count', ...planned(b, 'brand_qualified'), sheet: at0(6, 'Квал лид') }, g.qualified),
        ratio(clock, { key: `${k}:qualified_pct`, label: 'Квал лид %', unit: 'percent', ...planned(b, 'brand_qualified_pct'), sheet: at0(7, 'Квал лид %') }, g.qualified, g.leads, 100),
        ratio(clock, { key: `${k}:cpl`, label: 'Цена лида, $', unit: 'usd', better: 'down', ...planned(b, 'brand_cpl'), hint: 'Brend byudjeti ÷ Регистрация lidlari.', sheet: at0(8, 'Цена лида') }, spendUsd, g.leads),
        additive(clock, { key: `${k}:primary_orders2`, label: 'Транзакция первичка усп', unit: 'count', ...planned(b, 'brand_orders2'), sheet: at0(9, 'Транзакция пер усп') }, g.primaryOrders2),
        ratio(clock, { key: `${k}:conv_qualified`, label: 'Конверсия от квал, %', unit: 'percent', ...planned(b, 'brand_conversion'), sheet: at0(10, 'Конверция от квал') }, g.primaryOrders2, g.qualified, 100),
        ratio(clock, { key: `${k}:conv_leads`, label: 'Конверсия, %', unit: 'percent', sheet: at0(11, 'Конверция') }, g.primaryOrders2, g.leads, 100),
        ratio(clock, { key: `${k}:cheque2`, label: 'Ўртача чек', unit: 'uzs', ...planned(b, 'brand_cheque2'), sheet: at0(12, 'Средний чек') }, g.primaryFakt2, g.primaryOrders2),
        additive(clock, { sheet: at0(13, 'Маркетинг харажат план'), key: `${k}:cost_plan`, label: `Маркетинг харажат план (ФАКТ 2 × ${pctText(marketingPlanPct)}%)`, unit: 'uzs' }, costPlan),
        whenKnown(rateKnown, withTyped(additive(clock, { sheet: at0(14, 'Маркетинг харажат факт'), key: `${k}:cost_fact`, label: 'Маркетинг харажат факт', unit: 'uzs', tone: 'total', better: 'down', ...planned(b, 'brand_cost'), hint: `Target byudjeti (soʻm) + targetolog + marketolog ulushi + qoʻlda kiritilgan xarajatlar (blogerlar, nutritsiolog, brendfeys, marketing xarajatlari, jamoa).${missingHint}` }, computedCost))),
        whenKnown(rateKnown, additive(clock, { key: `${k}:spend_uzs`, label: 'Таргет бюджет, soʻm', unit: 'uzs', better: 'down', hint: `Byudjet $ × dollar kursi.${rateHint}`, sheet: at0(15, 'Таргет бюджет') }, spendUzs)),
        whenKnown(rateKnown, additive(clock, { key: `${k}:cost_targetolog`, label: `Таргетолог ФОТ (${pctText(targetologPct)}%)`, unit: 'uzs', better: 'down', sheet: at0(16, 'Таргетолог фот') }, targetolog)),
        ...manualRows,
        additive(clock, { key: `${k}:cost_marketer`, label: `Маркетолог ФОТ (${pctText(marketerPct)}%)`, unit: 'uzs', better: 'down', sheet: at0(22, 'Маркетолог фот = 1%') }, marketer),
        whenKnown(rateKnown, ratio(clock, { sheet: at0(23, 'CAC $'), key: `${k}:cac`, label: 'CAC, $', unit: 'usd', better: 'down', ...planned(b, 'brand_cac'), hint: `Butun marketing xarajati ($) ÷ birlamchi yetkazilgan buyurtmalar.${missingHint}` }, costUsd, g.primaryOrders2)),
        whenKnown(rateKnown, ratio(clock, { sheet: at0(24, '%'), key: `${k}:cost_share`, label: 'Маркетинг улуши, %', unit: 'percent', better: 'down', ...planned(b, 'brand_cost_share'), hint: missingHint || null }, costFact, g.fakt2, 100)),
      ],
    })
  }
  {
    const g = brandGrid(null)
    blocks.push({
      id: 'project:none',
      kind: 'project',
      title: 'Brendsiz',
      subtitle: 'Jadvalning Collagen / Zextra roʻyxatida yoʻq jamoalar sotgan buyurtmalar va manbasi brendga bogʻlanmagan lidlar — jami ikki loyiha + shu = kompaniya',
      team: null,
      sheet: null,
      rows: [
        additive(clock, { key: 'pj:none:fakt1', label: 'Сумма ФАКТ 1', unit: 'uzs' }, g.fakt1),
        additive(clock, { key: 'pj:none:fakt2', label: 'Сумма ФАКТ 2', unit: 'uzs' }, g.fakt2),
        additive(clock, { key: 'pj:none:leads', label: 'Кол лид', unit: 'count' }, g.leads),
        additive(clock, { key: 'pj:none:qualified', label: 'Квал лид', unit: 'count' }, g.qualified),
      ],
    })
  }

  // --- Свод -----------------------------------------------------------------
  const companyLeadValue = leadValueDays('')
  const companySalesPlan = days.map((_, i) => reg.qualified[i]! * companyLeadValue[i]!)
  blocks.push({
    id: 'summary',
    kind: 'summary',
    title: 'Свод',
    subtitle: 'Kompaniya boʻyicha: kval lid, sotuv rejasi, ФАКТ 1, ФАКТ 2, byudjet',
    team: null,
    sheet: sh(346, 'Свод'),
    rows: [
      additive(clock, { key: 'sv:reg_qualified', label: 'Квал лид сони (Регистрация)', unit: 'count', ...planned('', 'reg_qualified'), sheet: sh(346, 'Квал лид сони') }, reg.qualified),
      additive(clock, { key: 'sv:sales_plan', label: 'План продаж (квал лид × лид қиймати)', unit: 'uzs', sheet: sh(347, 'План продаж'), hint: 'Jadvalning 347-qatori: registratsiya kval lidi × bitta lid qiymati (shu kundagi qiymat).' }, companySalesPlan),
      additive(clock, { key: 'sv:fakt1', label: 'ФАКТ 1 — жами', unit: 'uzs', tone: 'total', ...planned('', 'fakt1'), sheet: sh(348, 'ФАКТ 1') }, fakt1All),
      additive(clock, { key: 'sv:fakt2', label: 'ФАКТ 2 — жами', unit: 'uzs', tone: 'total', ...planned('', 'fakt2'), sheet: sh(349, 'ФАКТ 2') }, fakt2All),
      additive(clock, { key: 'sv:budget', label: 'Бюджет (Meta), $', unit: 'usd', better: 'down', ...planned('', 'budget'), hint: 'Marketing blokidagi «Жами бюджет» bilan bir xil qator.', sheet: sh(350, 'Бюджет') }, spendAll),
    ],
  })

  return {
    month: input.month,
    days,
    today: input.today,
    elapsedDays: clock.elapsed,
    teams: teamNames.map((rop) => ({ rop, label: labelOf(rop), head: heads.get(rop) ?? null, isBase: isBase(rop) })),
    // The sheet's order: its brand P&L (rows 394–445) comes after «Свод».
    blocks: [...blocks.filter((b) => b.kind !== 'project'), ...blocks.filter((b) => b.kind === 'project')],
    lines: sheetLines(blocks),
    settings: {
      usdRate: lastRateAt < 0 ? null : rates[lastRateAt]!,
      usdRateDate: lastRateAt < 0 ? null : days[lastRateAt]!,
    },
    canEditPlans: input.canEditPlans,
  }
}
