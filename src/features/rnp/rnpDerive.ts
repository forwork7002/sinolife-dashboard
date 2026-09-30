/**
 * «RNP jadvali» — the readings the page draws ABOVE the sheet, derived from
 * the one `/rnp/overview` payload. Pure: no React, no fetch.
 *
 * NOTHING HERE RE-MEASURES. Every figure is a row the server already built
 * (`rnpSheet.ts`) — a KPI card is a row's fact, plan, forecast and index; a
 * ranking column is the same row of each team's block. The only arithmetic
 * of its own is the funnel, which sums lived days over the window where
 * every step can be trusted, and says which window that is.
 */

import type { RnpBlockDto, RnpOverviewDto, RnpRowDto, RnpTeamDto } from './rnpApi'

export type RnpTone = 'good' | 'warning' | 'critical' | 'neutral'

/**
 * How an index reads. Up-is-good: ≥100 on track, 80–100 a look, below 80 the
 * alarm. A cost (`better: 'down'`) mirrors it: ≤100 on track, ≤120 a look.
 */
export function indexTone(value: number | null, better: 'up' | 'down'): RnpTone {
  if (value === null || !Number.isFinite(value)) return 'neutral'
  if (better === 'up') return value >= 100 ? 'good' : value >= 80 ? 'warning' : 'critical'
  return value <= 100 ? 'good' : value <= 120 ? 'warning' : 'critical'
}

export const TONE_COLOR: Record<RnpTone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  neutral: 'var(--ink-muted)',
}

function blockById(data: RnpOverviewDto, id: string): RnpBlockDto | null {
  return data.blocks.find((b) => b.id === id) ?? null
}

export function rowByKey(block: RnpBlockDto | null, key: string): RnpRowDto | null {
  return block?.rows.find((r) => r.key === key) ?? null
}

/** A row anywhere in the payload, by its key. */
export function findRow(data: RnpOverviewDto, key: string): RnpRowDto | null {
  for (const b of data.blocks) {
    const r = b.rows.find((x) => x.key === key)
    if (r) return r
  }
  return null
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export interface RnpTeamSummary {
  readonly team: RnpTeamDto
  /** 1-based, in the server's order (FAKT 1 for the month, highest first). */
  readonly rank: number
  readonly block: RnpBlockDto | null
  readonly logistics: RnpBlockDto | null
  /** «РОП олган лид», or a БАЗА team's «Дозвон». */
  readonly reach: RnpRowDto | null
  readonly conversion: RnpRowDto | null
  readonly orders: RnpRowDto | null
  readonly fakt1: RnpRowDto | null
  readonly fakt2: RnpRowDto | null
  readonly planPct: RnpRowDto | null
  readonly headcount: RnpRowDto | null
  /** «Успешность, %» of the team's logistics block. */
  readonly success: RnpRowDto | null
}

export function teamSummaries(data: RnpOverviewDto): RnpTeamSummary[] {
  return data.teams.map((team, i) => {
    const block = blockById(data, `team:${team.rop}`)
    const logistics = blockById(data, `logistics:${team.rop}`)
    const k = `team:${team.rop}`
    return {
      team,
      rank: i + 1,
      block,
      logistics,
      reach: rowByKey(block, `${k}:reach`),
      conversion: rowByKey(block, `${k}:conv1`),
      orders: rowByKey(block, `${k}:orders1`),
      fakt1: rowByKey(block, `${k}:fakt1`),
      fakt2: rowByKey(block, `${k}:fakt2`),
      planPct: rowByKey(block, `${k}:plan_pct`),
      headcount: rowByKey(block, `${k}:headcount`),
      success: rowByKey(logistics, `lg:${team.rop}:success`),
    }
  })
}

/** The lived days of a row as numbers — a sparkline has no use for the future. */
export function livedValues(row: RnpRowDto | null, days: readonly string[], today: string): number[] {
  if (!row) return []
  const out: number[] = []
  row.days.forEach((v, i) => {
    const d = days[i]
    if (d !== undefined && d <= today && v !== null) out.push(v)
  })
  return out
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export interface RnpFunnelStep {
  readonly key: string
  readonly label: string
  readonly value: number
  /** This step ÷ the previous one, in percent; null for the first or a zero. */
  readonly conversion: number | null
}

export interface RnpFunnel {
  /** First and last day summed, `YYYY-MM-DD`; null when no day qualifies. */
  readonly from: string | null
  readonly to: string | null
  readonly days: number
  readonly steps: readonly RnpFunnelStep[]
}

/**
 * Tushgan lid → Kval lid → ROP larga tarqatildi → Buyurtma → Yetkazildi.
 *
 * ONE WINDOW FOR EVERY STEP. «РОП ларга тарқатилди» is complete only from its
 * `reliableFrom` (16.09 in September), so the month's registration beside a
 * half-month of handed-out leads would print a conversion that is an artefact
 * of the calendar. Every step is summed over the same lived days, from the
 * latest `reliableFrom` among them to today.
 *
 * THE ORDERS ARE THE PRIMARY TEAMS' — a БАЗА team sells to existing customers
 * from calls, not from these leads, so its orders would inflate the last two
 * steps. «Yetkazildi» is FAKT 2 transactions on the queue cohort's day.
 */
export function leadFunnel(data: RnpOverviewDto): RnpFunnel {
  const primary = teamSummaries(data).filter((s) => !s.team.isBase)
  const sumRows = (rows: readonly (RnpRowDto | null)[]): (number | null)[] =>
    data.days.map((_, i) => {
      let total: number | null = null
      for (const r of rows) {
        const v = r?.days[i] ?? null
        if (v !== null) total = (total ?? 0) + v
      }
      return total
    })

  const leads = findRow(data, 'reg:leads')
  const qualified = findRow(data, 'reg:qualified')
  const distributed = findRow(data, 'reg:distributed')
  const series: { key: string; label: string; values: readonly (number | null)[]; reliableFrom: string | null }[] = [
    { key: 'leads', label: 'Tushgan lid', values: leads?.days ?? [], reliableFrom: leads?.reliableFrom ?? null },
    { key: 'qualified', label: 'Kval lid', values: qualified?.days ?? [], reliableFrom: qualified?.reliableFrom ?? null },
    {
      key: 'distributed',
      label: 'ROP larga tarqatildi',
      values: distributed?.days ?? [],
      reliableFrom: distributed?.reliableFrom ?? null,
    },
    { key: 'orders', label: 'Buyurtma (FAKT 1)', values: sumRows(primary.map((s) => s.orders)), reliableFrom: null },
    {
      key: 'delivered',
      label: 'Yetkazildi (FAKT 2)',
      values: sumRows(primary.map((s) => rowByKey(s.block, `team:${s.team.rop}:orders2`))),
      reliableFrom: null,
    },
  ]
  const start = series.reduce<string>((acc, s) => (s.reliableFrom && s.reliableFrom > acc ? s.reliableFrom : acc), '')
  const window = data.days.filter((d) => d >= start && d <= data.today)
  const idx = window.map((d) => data.days.indexOf(d))

  let prev: number | null = null
  const steps = series.map((s) => {
    let value = 0
    for (const i of idx) value += s.values[i] ?? 0
    const conversion = prev !== null && prev > 0 ? (value / prev) * 100 : null
    prev = value
    return { key: s.key, label: s.label, value, conversion }
  })
  return { from: window[0] ?? null, to: window.at(-1) ?? null, days: window.length, steps }
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'] as const

/** «Du» for a Monday — read at noon UTC so no zone can move the date. */
export function weekday(day: string): string {
  return WEEKDAYS[weekdayIndex(day)] ?? ''
}

export function isSunday(day: string): boolean {
  return weekdayIndex(day) === 0
}

function weekdayIndex(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay()
}

/** `2026-09-16` → «16.09». */
export function dayMonth(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`
}

/**
 * A day cell against its day plan, for the grid's heat tint: only an
 * additive row with a plan, only a finished day (today is still running).
 */
export function dayTone(row: RnpRowDto, value: number | null, day: string, today: string): RnpTone {
  if (!row.additive || row.dayPlan === null || row.dayPlan <= 0 || value === null) return 'neutral'
  if (day >= today) return 'neutral'
  if (row.reliableFrom !== null && day < row.reliableFrom) return 'neutral'
  return indexTone((value / row.dayPlan) * 100, row.better)
}
