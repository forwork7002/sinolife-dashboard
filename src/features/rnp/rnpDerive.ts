/**
 * «RNP jadvali» — how the sheet's cells read: the index's tone, a day's tint
 * against its day plan, and the calendar words of the header. Pure: no
 * React, no fetch. Nothing here re-measures — every figure is a row the
 * server already built (`rnpSheet.ts`).
 */

import type { RnpLine, RnpRowDto } from './rnpApi'

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

/** `2026-09-16` → «16.09.2026», the sheet's own date format. */
export function dayMonthYear(day: string): string {
  return `${dayMonth(day)}.${day.slice(0, 4)}`
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

/**
 * One ROP's part of the sheet — its block, its logistics, its «Свод» lines —
 * each part under a heading, since cut out of the sheet they lose the rows
 * around them that said what they were. `rop` null = the whole sheet.
 */
export function ropLines(lines: readonly RnpLine[], rop: string | null, label: string): readonly RnpLine[] {
  if (rop === null) return lines
  const part = (key: string | null) => (key?.startsWith('lg:') ? 'logistics' : key?.startsWith('sv:') ? 'svod' : 'team')
  const titles = { team: `${label} — ROP bloki`, logistics: `Логистика — ${label}`, svod: `Свод — ${label}` } as const
  const tones = { team: 'team', logistics: 'section', svod: 'company' } as const
  const out: RnpLine[] = []
  let last: string | null = null
  for (const l of lines) {
    // The sheet's own headings (and an added team's) are replaced by the three below.
    if (l.team !== rop || l.kind !== 'value') continue
    const p = part(l.key)
    if (p !== last) out.push({ kind: 'title', row: null, team: rop, label: titles[p], sub: null, tone: tones[p] })
    last = p
    // Cut out of the sheet, two «Свод» lines under one team name need the sheet's «факт1» / «факт2» to tell apart.
    const svod = /^sv:(fakt[12]):/.exec(l.key ?? '')
    out.push(svod ? { ...l, sub: svod[1] === 'fakt1' ? 'факт1' : 'факт2' } : l)
  }
  return out
}
