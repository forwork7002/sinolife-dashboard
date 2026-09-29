/**
 * «RNP jadvali» — the client's «СентябрРНП 26» sheet, built from rows the
 * database already holds. Pure: no framework, no database.
 *
 * THE SHEET'S SHAPE IS KEPT: a row per metric, a column per day, and before
 * the days the month's plan (C), the daily plan (B), the fact (D), the
 * forecast (E) and the index (F). What is NOT kept is the sheet's arithmetic,
 * which the client's own audit (2026-09-28, 27 findings) showed wrong in
 * ways that move real figures:
 *
 *   - The forecast divided by a typed-in 31 for a 30-day month and by today's
 *     date, today's unfinished day included. Here it is the fact through the
 *     last FULL day, over the full days lived, times the month's real length.
 *   - Rates were typed per day and sometimes averaged. Here every rate is
 *     ΣA ÷ ΣB — for a day and for the month alike — never a mean of rates.
 *   - Totals summed half a month (`SUM(G14:U14)`) or a `#REF!`. Here a month
 *     is every day in it.
 *
 * NULL IS NEVER A ZERO. A day not yet lived, a rate with no denominator, a
 * plan nobody set: each is null, and the screen prints a dash. «0» is a
 * measurement.
 */

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
  /** This row's share of its column's total, in percent (the «Свод»). */
  readonly share: number | null
  readonly tone: 'total' | 'plain'
  /** One sentence saying where the number comes from. */
  readonly hint: string | null
  /** Days before this are incomplete in Bitrix24, and are drawn muted. */
  readonly reliableFrom: string | null
}

export type RnpBlockKind = 'marketing' | 'registration' | 'team' | 'company' | 'warehouse' | 'logistics' | 'summary'

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
  }
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
  readonly leads: readonly { readonly day: string; readonly rop: string | null; readonly leads: number }[]
  readonly registration: readonly {
    readonly day: string
    readonly leads: number
    readonly duplicates: number
    readonly qualified: number
    readonly aiConversations: number
  }[]
  readonly calls: readonly {
    readonly day: string
    readonly rop: string
    readonly employeeId: string
    readonly isHead: boolean
    readonly connected: number
  }[]
  readonly warehouse: readonly { readonly day: string; readonly entered: number; readonly notPacked: number }[]
  readonly meta: readonly {
    readonly day: string
    readonly product: TargetProduct
    readonly spendMicroUsd: bigint
    readonly leads: number
  }[]
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
export const BASE_TEAMS: ReadonlySet<string> = new Set(['Charos', 'Baza'])

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
 * the department's name: «Чарос РОП» is the department «Sadriddin(ROP)»,
 * «Малика РОП – БАЗА» is «Charos(ROP)» (spec §3.4, 2026-09-28). A team the
 * sheet has no block for keeps its department name.
 */
export const SHEET_TEAM_NAMES: Readonly<Record<string, string>> = Object.freeze({
  Gulzora: 'Гулзора РОП',
  Sevinch: 'Севинч РОП',
  Lola: 'Лола РОП',
  Saidaziz: 'Саидазиз РОП',
  Asliddin: 'Аслиддин РОП',
  Sadriddin: 'Чарос РОП',
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
 * «РОП (Первичка)» is filled on every handed-out lead only from 16.09.2026;
 * before it about one lead in five carries it, so those days undercount and
 * are drawn muted rather than presented as the team's leads.
 */
export const LEAD_ROP_RELIABLE_FROM = '2026-09-16'

/**
 * Calls before this Tashkent day are wrong in the database — both their
 * duration and whether they connected (`CALL_DATA_FLOOR` in
 * `src/lib/callQuality.ts`, 2026-09-15 00:00 Tashkent; 11.6% connected
 * against a normal 31%). Restated as a day because the domain has no clock
 * of its own; `rnpSheet.test.ts` pins the two together.
 */
export const CALLS_RELIABLE_FROM = '2026-09-15'

/** Metric keys of the company-wide settings, never a plan. */
export const SETTING_USD_RATE = 'usd_rate'
export const SETTING_LEAD_VALUE = 'lead_value'

/**
 * Every key a plan can be stored under — the rows below name them, and the
 * plans route accepts nothing else, so a typo in a script cannot fill
 * `rnp_plan` with rows no screen reads.
 */
export const RNP_PLAN_METRICS = [
  SETTING_USD_RATE,
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
  'reg_leads',
  'reg_qualified',
  'reg_qualified_pct',
  'leads',
  'calls',
  'conversion',
  'conversion2',
  'avg_cheque1',
  'avg_cheque2',
  'orders',
  'orders2',
  'fakt1',
  'fakt2',
  'headcount',
  'plan_pct',
  'success_rate',
  'refusal_rate',
  'primary_orders2',
  'primary_fakt2',
  'primary_conversion',
  'base_fakt2',
  'warehouse_orders',
] as const

export type RnpPlanMetric = (typeof RNP_PLAN_METRICS)[number]

const UNDISTRIBUTED = 'Taqsimlanmagan'

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
  /** Full days over. */
  readonly elapsed: number
  /** Whether the month is still running (the forecast means something). */
  readonly running: boolean
}

function clockOf(days: readonly string[], today: string): Clock {
  const n = days.length
  if (today < days[0]!) return { days, n, todayIndex: -1, elapsed: 0, running: false }
  if (today > days[n - 1]!) return { days, n, todayIndex: n, elapsed: n, running: false }
  const i = days.indexOf(today)
  return { days, n, todayIndex: i, elapsed: i, running: true }
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
function lived(clock: Clock, values: readonly number[]): Series {
  return values.map((v, i) => (i <= clock.todayIndex ? v : null))
}

interface RowOptions {
  readonly key: string
  readonly label: string
  readonly unit: RnpUnit
  readonly better?: 'up' | 'down'
  readonly plan?: number | null
  readonly planKey?: RnpPlanKey | null
  readonly tone?: 'total' | 'plain'
  readonly hint?: string | null
  readonly reliableFrom?: string | null
}

function base(o: RowOptions) {
  return {
    key: o.key,
    label: o.label,
    unit: o.unit,
    better: o.better ?? ('up' as const),
    planKey: o.planKey ?? null,
    share: null,
    tone: o.tone ?? ('plain' as const),
    hint: o.hint ?? null,
    reliableFrom: o.reliableFrom ?? null,
  }
}

/** A summed row: the month is its days added, the forecast its pace. */
function additive(clock: Clock, o: RowOptions, values: readonly number[]): RnpRowDto {
  const days = lived(clock, values)
  const s = startOf(clock, o)
  const fact = clock.todayIndex < s ? null : sum(days.slice(s))
  /*
    The pace of the full days the row can be trusted on, over the whole
    month. With nothing unreliable and the month over, it IS the fact.
  */
  const paced = clock.elapsed - s
  const forecast = clock.todayIndex >= 0 && paced > 0 ? (sum(values.slice(s, clock.elapsed)) / paced) * clock.n : null
  const plan = o.plan ?? null
  const measured = forecast
  return {
    ...base(o),
    additive: true,
    plan,
    dayPlan: plan === null ? null : plan / clock.n,
    fact,
    forecast,
    index: plan !== null && plan > 0 && measured !== null ? (measured / plan) * 100 : null,
    days,
  }
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
function level(clock: Clock, o: RowOptions, values: readonly number[], reading: 'mean' | 'latest'): RnpRowDto {
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
  heads: Set<string>[]
}

export function buildRnpSheet(input: RnpSheetInput): RnpOverviewDto {
  const days = input.days
  const n = days.length
  const at = new Map(days.map((d, i) => [d, i]))
  const clock = clockOf(days, input.today)
  const zeros = () => new Array<number>(n).fill(0)

  // --- plans and settings -------------------------------------------------
  const planOf = new Map<string, number>()
  const leadValueRows: { team: string; fromDay: number; value: number }[] = []
  let usdRate: number | null = null
  for (const r of input.plans.rows) {
    const value = Number(r.valueCenti) / 100
    if (r.metric === SETTING_LEAD_VALUE) leadValueRows.push({ team: r.team, fromDay: r.fromDay, value })
    else if (r.metric === SETTING_USD_RATE && r.team === '' && r.fromDay === 1) usdRate = value
    else if (r.fromDay === 1) planOf.set(`${r.team}|${r.metric}`, value)
  }
  for (const f of input.plans.fakt) {
    if (f.fakt1Minor !== null) planOf.set(`${f.rop}|fakt1`, minorToSom(f.fakt1Minor))
    if (f.fakt2Minor !== null) planOf.set(`${f.rop}|fakt2`, minorToSom(f.fakt2Minor))
  }
  const plan = (team: string, metric: string) => planOf.get(`${team}|${metric}`) ?? null
  const planned = (team: string, metric: RnpPlanMetric) => ({ plan: plan(team, metric), planKey: { team, metric } })

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
        heads: days.map(() => new Set<string>()),
      }
      grid.set(rop, t)
    }
    return t
  }
  const canonical = (rop: string) => TEAM_ALIASES[rop] ?? rop
  for (const t of input.teams) teamOf(canonical(t.rop))

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
    if (!r.isHead) t.heads[i]!.add(r.employeeId)
  }

  const heads = new Map(input.teams.filter((t) => !(t.rop in TEAM_ALIASES)).map((t) => [t.rop, t.head]))
  const labelOf = (rop: string) => SHEET_TEAM_NAMES[rop] ?? rop
  /** The department behind a sheet name, and its head: «Sadriddin(ROP) · Mamayusupov Sadriddin». */
  const subtitleOf = (rop: string) => [`${rop}(ROP)`, heads.get(rop)].filter(Boolean).join(' · ')
  const monthFakt1 = (t: TeamDays) => sum(t.fakt1)
  const active = (t: TeamDays) => sum(t.fakt1Orders) + sum(t.fakt2Orders) + sum(t.leads) + sum(t.calls) > 0
  /*
    A ROP department with nothing in the month (a unit kept for history) is
    left out rather than drawn as a block of zeros; a team the deals still
    name but the org chart no longer has («Sevinchxon») is kept, because its
    money is real and the totals above count it.
  */
  const teamNames = [...grid.keys()]
    .filter((rop) => rop !== input.noRop && active(grid.get(rop)!))
    .sort((a, b) => monthFakt1(grid.get(b)!) - monthFakt1(grid.get(a)!) || a.localeCompare(b, 'ru'))
  const withNoRop = grid.has(input.noRop) ? [...teamNames, input.noRop] : teamNames

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
  const fakt1OrdersAll = total((t) => t.fakt1Orders)
  const fakt2All = total((t) => t.fakt2)
  const fakt2OrdersAll = total((t) => t.fakt2Orders)
  const fakt2Primary = total((t) => t.fakt2, primary)
  const fakt2OrdersPrimary = total((t) => t.fakt2Orders, primary)
  const fakt2Base = total((t) => t.fakt2, isBase)
  const refusedAll = total((t) => t.refused)
  const ropLeads = total((t) => t.leads)

  const reg = { leads: zeros(), duplicates: zeros(), qualified: zeros(), ai: zeros() }
  for (const r of input.registration) {
    const i = at.get(r.day)
    if (i === undefined) continue
    reg.leads[i]! += r.leads
    reg.duplicates[i]! += r.duplicates
    reg.qualified[i]! += r.qualified
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

  // --- Маркетинг ----------------------------------------------------------
  const productRows = (p: 'Collagen' | 'Zextra'): RnpRowDto[] => {
    const k = p === 'Collagen' ? 'collagen' : 'zextra'
    return [
      additive(clock, { key: `meta:${k}:spend`, label: `${p} · Бюджет, $`, unit: 'usd', better: 'down', ...planned('', `budget_${k}`), hint: `Meta Ads: ${p} akkauntlarining sarfi, ishga olish kampaniyalarisiz.` }, meta[p].spend),
      additive(clock, { key: `meta:${k}:leads`, label: `${p} · Лид (Meta)`, unit: 'count', ...planned('', `meta_leads_${k}`), hint: 'Meta Ads hisoblagan lid (lid-forma).' }, meta[p].leads),
      ratio(clock, { key: `meta:${k}:cpl`, label: `${p} · Лид нархи, $`, unit: 'usd', better: 'down', ...planned('', `cpl_${k}`), hint: CPL_HINT }, meta[p].spend, meta[p].leads),
    ]
  }
  const usdDays = days.map(() => usdRate ?? 0)
  blocks.push({
    id: 'marketing',
    kind: 'marketing',
    title: 'Маркетинг',
    subtitle: 'Meta Ads — Collagen va Zextra',
    team: null,
    rows: [
      ...productRows('Collagen'),
      ...productRows('Zextra'),
      additive(clock, { key: 'meta:spend', label: 'Жами бюджет, $', unit: 'usd', better: 'down', tone: 'total', ...planned('', 'budget') }, spendAll),
      additive(clock, { key: 'meta:leads', label: 'Жами лид (Meta)', unit: 'count', tone: 'total', ...planned('', 'meta_leads') }, metaLeadsAll),
      ratio(clock, { key: 'meta:cpl', label: 'CPL, $', unit: 'usd', better: 'down', ...planned('', 'cpl'), hint: CPL_HINT }, spendAll, metaLeadsAll),
      ratio(clock, { key: 'meta:cac', label: 'CAC (мижоз нархи), $', unit: 'usd', better: 'down', ...planned('', 'cac'), hint: 'Jami byudjet ÷ birlamchi jamoalarning FAKT 2 buyurtmalari (БАЗА jamoalarisiz).' }, spendAll, fakt2OrdersPrimary),
      ratio(
        clock,
        {
          key: 'meta:share',
          label: 'Маркетинг улуши (ДРР), %',
          unit: 'percent',
          better: 'down',
          ...planned('', 'marketing_share'),
          hint: usdRate === null ? 'Dollar kursi kiritilmagan — «Rejalar» formasida belgilang.' : `Byudjet × ${usdRate} soʻm ÷ birlamchi FAKT 2 summasi. Jadvalda «ROMI» deb yozilgan, aslida xarajat ulushi.`,
        },
        days.map((_, i) => spendAll[i]! * usdDays[i]!),
        usdRate === null ? zeros() : fakt2Primary,
        100,
      ),
    ],
  })

  // --- Регистрация ----------------------------------------------------------
  const difference = days.map((_, i) => ropLeads[i]! - reg.qualified[i]!)
  blocks.push({
    id: 'registration',
    kind: 'registration',
    title: 'Регистрация',
    subtitle: 'Регистрация voronkasi (dublikatsiz) va ROP larga tarqatilgan lidlar',
    team: null,
    rows: [
      additive(clock, { key: 'reg:leads', label: 'Тушган лид (Регистрация)', unit: 'count', ...planned('', 'reg_leads'), hint: 'Регистрация voronkasida yaratilgan bitimlar, «Дубликат» bosqichidagilarsiz.' }, reg.leads),
      additive(clock, { key: 'reg:duplicates', label: 'Дубликат', unit: 'count', better: 'down' }, reg.duplicates),
      additive(clock, { key: 'reg:ai', label: 'ИИ обработка мурожаатлари', unit: 'count', hint: '«ИИ обработка» voronkasida ochilgan suhbatlar.' }, reg.ai),
      additive(clock, { key: 'reg:qualified', label: 'Квал лид (Сделка успешна)', unit: 'count', tone: 'total', ...planned('', 'reg_qualified'), hint: 'Registrator «Сделка успешна» ga oʻtkazgan lidlar — yopilgan kuni boʻyicha.' }, reg.qualified),
      ratio(clock, { key: 'reg:qualified_pct', label: '% квал лид', unit: 'percent', ...planned('', 'reg_qualified_pct') }, reg.qualified, reg.leads, 100),
      additive(clock, { key: 'reg:distributed', label: 'РОП ларга тарқатилди', unit: 'count', reliableFrom: LEAD_ROP_RELIABLE_FROM, hint: '«Лид таркатилган сана» shu kun va «РОП (Первичка)» ROP jamoasi boʻlgan bitimlar.' }, ropLeads),
      additive(clock, { key: 'reg:undistributed', label: UNDISTRIBUTED, unit: 'count', better: 'down', reliableFrom: LEAD_ROP_RELIABLE_FROM, hint: 'Tarqatilgan sanasi bor, lekin «РОП (Первичка)» da ROP emas (masalan Регистрация boshligʻi) yoki boʻsh.' }, undistributed),
      additive(clock, { key: 'reg:difference', label: 'Разница (РОП лид − квал лид)', unit: 'count', reliableFrom: LEAD_ROP_RELIABLE_FROM }, difference),
    ],
  })

  // --- ROP blocks -----------------------------------------------------------
  for (const rop of teamNames) {
    const t = grid.get(rop)!
    const baseTeam = isBase(rop)
    const reach = baseTeam ? t.calls : t.leads
    const reachFrom = baseTeam ? CALLS_RELIABLE_FROM : LEAD_ROP_RELIABLE_FROM
    /*
      A БАЗА team's «План бажарилиши» prices a CALL, and a call is not a lead:
      the sheet multiplied its calls by the lead's 400 000 and printed 11–18%.
      The row is drawn only once somebody sets that team its own value.
    */
    const ownLeadValue = leadValueRows.some((r) => r.team === rop)
    const leadValue = leadValueDays(rop)
    const expected = days.map((_, i) => reach[i]! * leadValue[i]!)
    const headcount = t.heads.map((s) => s.size)
    const reachLabel = baseTeam ? 'Дозвон (уланган қўнғироқ)' : 'РОП олган лид'
    const reachHint = baseTeam
      ? 'Jamoa xodimlarining ulangan kiruvchi va chiquvchi qoʻngʻiroqlari.'
      : '«Лид таркатилган сана» shu kun, «РОП (Первичка)» shu jamoa boʻlgan bitimlar.'
    const k = `team:${rop}`
    blocks.push({
      id: k,
      kind: 'team',
      title: labelOf(rop) === rop ? `${rop} РОП${baseTeam ? ' — БАЗА' : ''}` : labelOf(rop),
      subtitle: subtitleOf(rop),
      team: rop,
      rows: [
        additive(clock, { key: `${k}:reach`, label: reachLabel, unit: 'count', ...planned(rop, baseTeam ? 'calls' : 'leads'), hint: reachHint, reliableFrom: reachFrom }, reach),
        ratio(clock, { key: `${k}:conv1`, label: baseTeam ? 'Конверсия % от дозвон' : 'Конверсия % от квал лид', unit: 'percent', ...planned(rop, 'conversion'), reliableFrom: reachFrom }, t.fakt1Orders, reach, 100),
        ratio(clock, { key: `${k}:cheque1`, label: 'Ўртача чек (ФАКТ 1)', unit: 'uzs', ...planned(rop, 'avg_cheque1') }, t.fakt1, t.fakt1Orders),
        additive(clock, { key: `${k}:orders1`, label: 'Буюртма сони (ФАКТ 1)', unit: 'count', ...planned(rop, 'orders') }, t.fakt1Orders),
        additive(clock, { key: `${k}:fakt1`, label: 'Сумма ФАКТ 1', unit: 'uzs', tone: 'total', ...planned(rop, 'fakt1'), hint: 'Tasdiqlandi + Tasdiqlanmay chiqdi — Tasdiqlash navbati kogortasi, jamoa bitimdagi «Организация сотрудника» boʻyicha.' }, t.fakt1),
        ...(baseTeam && !ownLeadValue ? [] : [ratio(clock, { key: `${k}:plan_pct`, label: 'План бажарилиши, %', unit: 'percent', ...planned(rop, 'plan_pct'), reliableFrom: reachFrom, hint: `ФАКТ 1 ÷ (${baseTeam ? 'дозвон' : 'lid'} × bitta lid qiymati). Lid qiymati «Rejalar» formasida.` }, t.fakt1, expected, 100)]),
        ...(baseTeam ? [ratio(clock, { key: `${k}:per_call`, label: 'Дозвонга ўртача сумма', unit: 'uzs', reliableFrom: CALLS_RELIABLE_FROM }, t.fakt1, t.calls)] : []),
        level(clock, { key: `${k}:headcount`, label: 'Ходим сони', unit: 'count', ...planned(rop, 'headcount'), reliableFrom: CALLS_RELIABLE_FROM, hint: 'Shu kuni kamida bitta ulangan qoʻngʻirogʻi boʻlgan xodimlar, ROP ning oʻzisiz. Oy ustuni — kunlik oʻrtacha.' }, headcount, 'mean'),
        additive(clock, { key: `${k}:fakt2`, label: 'Сумма ФАКТ 2 (Доставлено)', unit: 'uzs', tone: 'total', ...planned(rop, 'fakt2') }, t.fakt2),
        additive(clock, { key: `${k}:orders2`, label: 'Транзакция ФАКТ 2', unit: 'count', ...planned(rop, 'orders2') }, t.fakt2Orders),
        ratio(clock, { key: `${k}:conv2`, label: 'Конверсия % ФАКТ 2', unit: 'percent', ...planned(rop, 'conversion2'), reliableFrom: reachFrom }, t.fakt2Orders, reach, 100),
        ratio(clock, { key: `${k}:cheque2`, label: 'Ўртача чек (ФАКТ 2)', unit: 'uzs', ...planned(rop, 'avg_cheque2') }, t.fakt2, t.fakt2Orders),
      ],
    })
  }

  // --- Sinolife umumiy ------------------------------------------------------
  blocks.push({
    id: 'company',
    kind: 'company',
    title: 'Sinolife — umumiy',
    subtitle: 'Barcha jamoalar',
    team: null,
    rows: [
      additive(clock, { key: 'co:orders1', label: 'Буюртма сони (ФАКТ 1)', unit: 'count', ...planned('', 'orders') }, fakt1OrdersAll),
      additive(clock, { key: 'co:fakt1', label: 'Сумма ФАКТ 1', unit: 'uzs', tone: 'total', ...planned('', 'fakt1') }, fakt1All),
      additive(clock, { key: 'co:orders2', label: 'Транзакция ФАКТ 2', unit: 'count', ...planned('', 'orders2') }, fakt2OrdersAll),
      additive(clock, { key: 'co:fakt2', label: 'Сумма ФАКТ 2 (Успешка)', unit: 'uzs', tone: 'total', ...planned('', 'fakt2') }, fakt2All),
      ratio(clock, { key: 'co:success', label: 'Успешность, % (ФАКТ 2 ÷ ФАКТ 1)', unit: 'percent', ...planned('', 'success_rate') }, fakt2All, fakt1All, 100),
      additive(clock, { key: 'co:primary_orders2', label: 'Первичка — транзакция ФАКТ 2', unit: 'count', ...planned('', 'primary_orders2'), hint: 'БАЗА jamoalaridan (Charos, Baza) tashqari hamma jamoa.' }, fakt2OrdersPrimary),
      additive(clock, { key: 'co:primary_fakt2', label: 'Первичка — сумма ФАКТ 2', unit: 'uzs', ...planned('', 'primary_fakt2') }, fakt2Primary),
      ratio(clock, { key: 'co:primary_conv', label: 'Конверсия % от квал лид (первичка)', unit: 'percent', ...planned('', 'primary_conversion') }, fakt2OrdersPrimary, reg.qualified, 100),
      ratio(clock, { key: 'co:primary_cheque', label: 'Ўртача чек ФАКТ 2 (первичка)', unit: 'uzs' }, fakt2Primary, fakt2OrdersPrimary),
      additive(clock, { key: 'co:base_fakt2', label: 'База — сумма ФАКТ 2', unit: 'uzs', ...planned('', 'base_fakt2') }, fakt2Base),
      ratio(clock, { key: 'co:base_share', label: '% базы', unit: 'percent' }, fakt2Base, fakt2All, 100),
      ratio(clock, { key: 'co:new_share', label: '% новичков', unit: 'percent' }, fakt2Primary, fakt2All, 100),
    ],
  })

  // --- Склад ----------------------------------------------------------------
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
    rows: [
      additive(clock, { key: 'wh:entered', label: 'Жами заказ сони', unit: 'count', ...planned('', 'warehouse_orders'), hint: 'Shu kuni Доставка voronkasiga birinchi marta tushgan buyurtmalar.' }, entered),
      level(clock, { key: 'wh:not_packed', label: 'Не собран (кун охирида)', unit: 'count', better: 'down', hint: '«Заказ в мой склад» bosqichida kun oxirida turgan buyurtmalar (bugun — hozirgi holat). Oy ustuni — oxirgi kun.' }, notPacked, 'latest'),
      { ...ratio(clock, { key: 'wh:not_packed_pct', label: 'Фоизи, %', unit: 'percent', better: 'down', hint: 'Kun oxiridagi «не собран» ÷ shu kuni tushgan buyurtmalar. Oy uchun hisoblanmaydi: holatlarni qoʻshib boʻlmaydi.' }, notPacked, entered, 100), fact: null, index: null },
    ],
  })

  // --- Логистика ------------------------------------------------------------
  const logisticsRows = (k: string, t: { fakt1: number[]; fakt2: number[]; refused: number[] }, tone: 'total' | 'plain', team: string): RnpRowDto[] => {
    const open = days.map((_, i) => Math.max(0, t.fakt1[i]! - t.fakt2[i]! - t.refused[i]!))
    return [
      additive(clock, { key: `${k}:fakt1`, label: 'Сумма ФАКТ 1', unit: 'uzs', tone }, t.fakt1),
      additive(clock, { key: `${k}:fakt2`, label: 'Успешка сумма ФАКТ 2', unit: 'uzs', tone }, t.fakt2),
      ratio(clock, { key: `${k}:success`, label: 'Успешность, %', unit: 'percent', ...(team === input.noRop ? {} : planned(team, 'success_rate')) }, t.fakt2, t.fakt1, 100),
      additive(clock, { key: `${k}:refused`, label: 'Отказ сумма', unit: 'uzs', better: 'down' }, t.refused),
      ratio(clock, { key: `${k}:refused_pct`, label: 'Отказ, %', unit: 'percent', better: 'down', ...(team === input.noRop ? {} : planned(team, 'refusal_rate')), hint: 'Возврат получен + Отказ (Logistika «Отказ» ustuni) ÷ ФАКТ 1.' }, t.refused, t.fakt1, 100),
      ratio(clock, { key: `${k}:open_pct`, label: 'Жараёнда, %', unit: 'percent', better: 'down', hint: 'Hali yetkazilmagan va rad etilmagan (yoʻlda, pochtada) buyurtmalar ulushi.' }, open, t.fakt1, 100),
    ]
  }
  blocks.push({
    id: 'logistics',
    kind: 'logistics',
    title: 'Логистика — жами',
    subtitle: 'Tasdiqlash navbati kogortasi, buyurtmaning hozirgi bosqichi boʻyicha',
    team: null,
    rows: logisticsRows('lg', { fakt1: fakt1All, fakt2: fakt2All, refused: refusedAll }, 'total', ''),
  })
  for (const rop of withNoRop) {
    const t = grid.get(rop)!
    if (sum(t.fakt1) === 0 && sum(t.fakt2) === 0) continue
    blocks.push({
      id: `logistics:${rop}`,
      kind: 'logistics',
      title: `Логистика — ${labelOf(rop)}`,
      subtitle: rop === input.noRop ? null : subtitleOf(rop),
      team: rop,
      rows: logisticsRows(`lg:${rop}`, t, 'plain', rop),
    })
  }

  // --- Свод -----------------------------------------------------------------
  const companyLeadValue = leadValueDays('')
  const companySalesPlan = days.map((_, i) => reg.qualified[i]! * companyLeadValue[i]!)
  const monthTotal1 = sum(lived(clock, fakt1All))
  const monthTotal2 = sum(lived(clock, fakt2All))
  /* «(ROP yoʻq)» is not a team anyone plans for; a plan typed there would land in team_month_plan. */
  const teamPlan = (rop: string, metric: RnpPlanMetric) => (rop === input.noRop ? {} : planned(rop, metric))
  const shareOf = (row: RnpRowDto, whole: number): RnpRowDto => ({
    ...row,
    share: row.fact !== null && whole > 0 ? (row.fact / whole) * 100 : null,
  })
  blocks.push({
    id: 'summary',
    kind: 'summary',
    title: 'Свод — жамоалар бўйича',
    subtitle: 'Har bir jamoaning ФАКТ 1 va ФАКТ 2 si va umumiydagi ulushi',
    team: null,
    rows: [
      additive(clock, { key: 'sv:reg_qualified', label: 'Квал лид сони (Регистрация)', unit: 'count', ...planned('', 'reg_qualified') }, reg.qualified),
      additive(clock, { key: 'sv:sales_plan', label: 'План продаж (квал лид × лид қиймати)', unit: 'uzs', hint: 'Jadvalning 347-qatori: registratsiya kval lidi × bitta lid qiymati (shu kundagi qiymat, «Rejalar» formasida).' }, companySalesPlan),
      ratio(clock, { key: 'sv:sales_plan_pct', label: 'ФАКТ 1 ÷ План продаж, %', unit: 'percent' }, fakt1All, companySalesPlan, 100),
      additive(clock, { key: 'sv:fakt1', label: 'ФАКТ 1 — жами', unit: 'uzs', tone: 'total', ...planned('', 'fakt1') }, fakt1All),
      ...withNoRop.map((rop) => shareOf(additive(clock, { key: `sv:fakt1:${rop}`, label: `ФАКТ 1 · ${labelOf(rop)}`, unit: 'uzs', ...teamPlan(rop, 'fakt1') }, grid.get(rop)!.fakt1), monthTotal1)),
      additive(clock, { key: 'sv:fakt2', label: 'ФАКТ 2 — жами', unit: 'uzs', tone: 'total', ...planned('', 'fakt2') }, fakt2All),
      ...withNoRop.map((rop) => shareOf(additive(clock, { key: `sv:fakt2:${rop}`, label: `ФАКТ 2 · ${labelOf(rop)}`, unit: 'uzs', ...teamPlan(rop, 'fakt2') }, grid.get(rop)!.fakt2), monthTotal2)),
      additive(clock, { key: 'sv:budget', label: 'Бюджет (Meta), $', unit: 'usd', better: 'down', ...planned('', 'budget'), hint: 'Marketing blokidagi «Жами бюджет» bilan bir xil qator.' }, spendAll),
      additive(clock, { key: 'sv:rop_leads', label: 'РОП олган лид — жами', unit: 'count', reliableFrom: LEAD_ROP_RELIABLE_FROM }, ropLeads),
      additive(clock, { key: 'sv:difference', label: 'Разница', unit: 'count', reliableFrom: LEAD_ROP_RELIABLE_FROM }, difference),
    ],
  })

  return {
    month: input.month,
    days,
    today: input.today,
    elapsedDays: clock.elapsed,
    teams: teamNames.map((rop) => ({ rop, label: labelOf(rop), head: heads.get(rop) ?? null, isBase: isBase(rop) })),
    blocks,
    settings: {
      usdRate,
      leadValues: leadValueRows.sort((a, b) => a.team.localeCompare(b.team) || a.fromDay - b.fromDay),
    },
    canEditPlans: input.canEditPlans,
  }
}
