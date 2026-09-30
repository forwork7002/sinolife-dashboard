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
 * One ROP's part of the sheet — its block and its logistics — each under a
 * heading, since cut out of the sheet they lose the rows around them that
 * said what they were. `rop` null = the whole sheet.
 */
export function ropLines(lines: readonly RnpLine[], rop: string | null, label: string): readonly RnpLine[] {
  if (rop === null) return lines
  const out: RnpLine[] = []
  let last: 'team' | 'logistics' | null = null
  for (const l of lines) {
    // The sheet's own headings (and an added team's) are replaced by the two below.
    if (l.team !== rop || l.kind !== 'value') continue
    const part = l.key?.startsWith('lg:') ? 'logistics' : 'team'
    if (part !== last) {
      out.push(
        part === 'team'
          ? { kind: 'title', row: null, team: rop, label: `${label} — ROP bloki`, sub: null, tone: 'team' }
          : { kind: 'title', row: null, team: rop, label: `Логистика — ${label}`, sub: null, tone: 'section' },
      )
    }
    last = part
    out.push(l)
  }
  return out
}
