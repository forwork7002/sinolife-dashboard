'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/Controls'
import { DateInput } from '@/components/ui/DateInput'
import { ChevronGlyph } from '@/components/ui/Icons'

import { DayPicker, FIRST_DAY, shiftDay, today } from './LeadSplitCards'

/**
 * «ROP otchet»'s window (2026-10-14, the user: «odatiy sahifalardek kun
 * boʻyicha va oy boʻyicha … oraliq boʻyicha ham»): one day with its arrows as
 * before, a whole month (to today in the current one), or a range of days.
 * Every control hands over only a window the API answers — inside
 * [`FIRST_DAY`, today], `from` ≤ `to`, at most `RANGE_MAX_DAYS` long — so a
 * half-typed field never reaches the request (`DateInput`, the month draft).
 */

export type RopWindowMode = 'day' | 'month' | 'range'

export interface RopWindow {
  readonly mode: RopWindowMode
  /** `YYYY-MM-DD`, inclusive. */
  readonly from: string
  /** `YYYY-MM-DD`, inclusive. */
  readonly to: string
}

/** Mirrors `REPORT_MAX_DAYS` in `app/api/v1/registration/schema.ts`. Nothing checks the mirror. */
export const RANGE_MAX_DAYS = 93

const muted = { color: 'var(--ink-muted)' } as const
const field = 'focusable h-7 rounded-[var(--radius-panel-sm)] border px-2 text-xs'
const fieldStyle = { backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' } as const

export function dayWindow(day: string): RopWindow {
  return { mode: 'day', from: day, to: day }
}

/** A whole month, `YYYY-MM`: its first day to its last, or to today in the current month. */
export function monthWindow(month: string): RopWindow {
  const [year, index] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year!, index!, 0)).toISOString().slice(0, 10)
  const now = today()
  return { mode: 'month', from: `${month}-01`, to: last > now ? now : last }
}

function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number)
  const d = new Date(Date.UTC(year!, index! - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

export function RopWindowPicker({ value, onChange }: { value: RopWindow; onChange: (next: RopWindow) => void }) {
  const switchTo = (mode: RopWindowMode) => {
    if (mode === value.mode) return
    if (mode === 'day') onChange(dayWindow(value.to > today() ? today() : value.to))
    else if (mode === 'month') onChange(monthWindow(value.to.slice(0, 7)))
    else {
      // A range opens on the window on screen (a day ahead pulled back to today), so switching loses nothing.
      const to = value.to > today() ? today() : value.to
      onChange({ mode: 'range', from: value.from > to ? to : value.from, to })
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <SegmentedControl<RopWindowMode>
        ariaLabel="Davr turi"
        value={value.mode}
        onChange={switchTo}
        options={[
          { value: 'day', label: 'Kun' },
          { value: 'month', label: 'Oy' },
          { value: 'range', label: 'Oraliq' },
        ]}
      />
      {value.mode === 'day' && <DayPicker day={value.to} onChange={(day) => onChange(dayWindow(day))} />}
      {value.mode === 'month' && <MonthPicker month={value.from.slice(0, 7)} onChange={(month) => onChange(monthWindow(month))} />}
      {value.mode === 'range' && <RangePicker from={value.from} to={value.to} onChange={(from, to) => onChange({ mode: 'range', from, to })} />}
    </div>
  )
}

/** ‹ month › — the arrows and the box stop at the API's first month and this one. */
function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const first = FIRST_DAY.slice(0, 7)
  const current = today().slice(0, 7)
  // A half-typed or out-of-range month stays in the box until it is one; a blur puts the shown month back.
  const [draft, setDraft] = useState<string | null>(null)
  const goTo = (next: string) => {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(next) && next >= first && next <= current) onChange(next)
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="ghost" aria-label="Oldingi oy" onClick={() => goTo(shiftMonth(month, -1))}>
        <ChevronGlyph direction="left" />
      </Button>
      <label className="flex items-center gap-2 text-xs" style={muted}>
        Oy
        <input
          type="month"
          value={draft ?? month}
          min={first}
          max={current}
          onChange={(e) => {
            const next = e.target.value
            const whole = /^\d{4}-(0[1-9]|1[0-2])$/.test(next) && next >= first && next <= current
            setDraft(whole ? null : next)
            if (whole && next !== month) onChange(next)
          }}
          onBlur={() => setDraft(null)}
          className={field}
          style={fieldStyle}
        />
      </label>
      <Button size="sm" variant="ghost" aria-label="Keyingi oy" onClick={() => goTo(shiftMonth(month, 1))}>
        <ChevronGlyph direction="right" />
      </Button>
      {month !== current && (
        <Button size="sm" variant="ghost" onClick={() => goTo(current)}>
          Shu oy
        </Button>
      )}
    </div>
  )
}

/**
 * «dan» … «gacha». A new end that would leave the range backwards or longer
 * than `RANGE_MAX_DAYS` pulls the other end with it, so every pick is a window
 * the API answers rather than a 400.
 */
function RangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const last = today()
  const span = RANGE_MAX_DAYS - 1
  return (
    <div className="flex flex-wrap items-center gap-2" title={`Eng koʻpi ${RANGE_MAX_DAYS} kun`}>
      <label className="flex items-center gap-2 text-xs" style={muted}>
        dan
        <DateInput
          value={from}
          min={FIRST_DAY}
          max={last}
          onCommit={(next) => {
            const end = next > to ? next : shiftDay(next, span) < to ? shiftDay(next, span) : to
            onChange(next, end)
          }}
          className={field}
          style={fieldStyle}
        />
      </label>
      <label className="flex items-center gap-2 text-xs" style={muted}>
        gacha
        <DateInput
          value={to}
          min={FIRST_DAY}
          max={last}
          onCommit={(next) => {
            const start = next < from ? next : shiftDay(next, -span) > from ? shiftDay(next, -span) : from
            onChange(start, next)
          }}
          className={field}
          style={fieldStyle}
        />
      </label>
    </div>
  )
}
