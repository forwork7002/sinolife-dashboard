'use client'

import { useEffect, useRef, useState } from 'react'

import { t } from '@/lib/messages'

/**
 * The global period control.
 *
 * A single source of truth for the reporting window, held in the URL so every
 * card and chart on screen answers for the same dates and a filtered view is a
 * shareable link.
 *
 * Six presets cover what gets asked twenty times a day. Anything else — a
 * particular day, a month last spring, a whole year, an arbitrary range — goes
 * through the picker, which resolves to `preset=custom` with explicit bounds.
 * The API has always accepted that; what was missing was a way to say it.
 */

export const PERIOD_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'previous_month',
  'this_year',
] as const

export type PeriodPreset = (typeof PERIOD_PRESETS)[number] | 'custom'

export interface PeriodSelection {
  readonly preset: PeriodPreset
  /** `YYYY-MM-DD`, inclusive. Present only when preset is 'custom'. */
  readonly from?: string
  /** `YYYY-MM-DD`, INCLUSIVE — the API expands it to end-of-day. */
  readonly to?: string
}

export function PeriodFilter({
  value,
  from,
  to,
  onChange,
}: {
  value: PeriodPreset
  from?: string
  to?: string
  onChange: (selection: PeriodSelection) => void
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  // Dismiss on an outside click or Escape — a popover that can only be closed
  // by re-clicking its own trigger is a trap on a dense page.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={container} className="relative flex items-center gap-1.5">
      <div
        className="flex items-center gap-0.5 rounded-lg border p-0.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
        role="group"
        aria-label={t.period.label}
      >
        {PERIOD_PRESETS.map((preset) => {
          const active = preset === value
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange({ preset })}
              aria-pressed={active}
              className="focusable rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
              style={{
                background: active ? 'var(--ink-primary)' : 'transparent',
                color: active ? 'var(--surface)' : 'var(--ink-secondary)',
              }}
            >
              {t.period[preset]}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t.period.pick}
        className="focusable flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors"
        style={{
          borderColor: value === 'custom' ? 'var(--accent)' : 'var(--border)',
          background: value === 'custom' ? 'var(--accent-soft)' : 'var(--surface-raised)',
          color: value === 'custom' ? 'var(--ink-primary)' : 'var(--ink-secondary)',
        }}
      >
        <CalendarIcon />
        {value === 'custom' && from ? shortRange(from, to) : t.period.pick}
      </button>

      {open && (
        <PeriodPicker
          from={from}
          to={to}
          onPick={(selection) => {
            onChange(selection)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

type Mode = 'day' | 'month' | 'year' | 'range'

/**
 * Day, month, year or an arbitrary range.
 *
 * Native `<input type="date">` and `type="month"` rather than a calendar
 * component: they are keyboard accessible, localised by the browser, work on a
 * phone, and cost nothing. A hand-built calendar would be a week of work to
 * reach the same place worse.
 */
function PeriodPicker({
  from,
  to,
  onPick,
}: {
  from?: string
  to?: string
  onPick: (selection: PeriodSelection) => void
}) {
  const [mode, setMode] = useState<Mode>('day')
  const [day, setDay] = useState(from ?? todayIso())
  const [month, setMonth] = useState((from ?? todayIso()).slice(0, 7))
  const [year, setYear] = useState(Number((from ?? todayIso()).slice(0, 4)))
  const [rangeFrom, setRangeFrom] = useState(from ?? todayIso())
  const [rangeTo, setRangeTo] = useState(to ?? todayIso())

  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i)

  const apply = () => {
    switch (mode) {
      case 'day':
        return onPick({ preset: 'custom', from: day, to: day })
      case 'month':
        return onPick({ preset: 'custom', from: `${month}-01`, to: lastDayOfMonth(month) })
      case 'year':
        return onPick({ preset: 'custom', from: `${year}-01-01`, to: `${year}-12-31` })
      case 'range':
        // Swap rather than reject: someone who picks the end first meant a
        // range, and refusing it teaches them to distrust the control.
        return onPick(
          rangeFrom <= rangeTo
            ? { preset: 'custom', from: rangeFrom, to: rangeTo }
            : { preset: 'custom', from: rangeTo, to: rangeFrom },
        )
    }
  }

  const MODES: readonly { id: Mode; label: string }[] = [
    { id: 'day', label: t.period.day },
    { id: 'month', label: t.period.month },
    { id: 'year', label: t.period.year },
    { id: 'range', label: t.period.range },
  ]

  return (
    <div
      role="dialog"
      aria-label={t.period.pick}
      className="absolute top-full right-0 z-50 mt-2 w-72 rounded-[var(--radius)] border p-3"
      style={{
        background: 'var(--surface-raised)',
        borderColor: 'var(--border-strong)',
        boxShadow: 'var(--shadow-float)',
      }}
    >
      <div
        className="mb-3 flex gap-0.5 rounded-lg p-0.5"
        style={{ background: 'var(--grid)' }}
        role="tablist"
      >
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={mode === option.id}
            onClick={() => setMode(option.id)}
            className="focusable flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors"
            style={{
              background: mode === option.id ? 'var(--surface-raised)' : 'transparent',
              color: mode === option.id ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'day' && (
        <Field label={t.period.day}>
          <input type="date" value={day} max={todayIso()} onChange={(e) => setDay(e.target.value)} />
        </Field>
      )}

      {mode === 'month' && (
        <Field label={t.period.month}>
          <input
            type="month"
            value={month}
            max={todayIso().slice(0, 7)}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      )}

      {mode === 'year' && (
        <Field label={t.period.year}>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      )}

      {mode === 'range' && (
        <div className="space-y-2">
          <Field label={t.period.from}>
            <input
              type="date"
              value={rangeFrom}
              max={todayIso()}
              onChange={(e) => setRangeFrom(e.target.value)}
            />
          </Field>
          <Field label={t.period.to}>
            <input
              type="date"
              value={rangeTo}
              max={todayIso()}
              onChange={(e) => setRangeTo(e.target.value)}
            />
          </Field>
        </div>
      )}

      <button
        type="button"
        onClick={apply}
        className="focusable mt-3 w-full rounded-lg px-3 py-2 text-xs font-medium"
        style={{ background: 'var(--ink-primary)', color: 'var(--surface)' }}
      >
        {t.period.apply}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </span>
      <div
        className="mt-1 [&>*]:w-full [&>*]:rounded-lg [&>*]:border [&>*]:px-2.5 [&>*]:py-1.5 [&>*]:text-xs [&>*]:outline-none"
        style={
          {
            '--tw-border-opacity': 1,
            colorScheme: 'light dark',
          } as React.CSSProperties
        }
      >
        <div
          style={{
            display: 'contents',
          }}
        >
          {children}
        </div>
      </div>
    </label>
  )
}

/** Today in the browser's own calendar, as `YYYY-MM-DD`. */
function todayIso(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function lastDayOfMonth(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number)
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(year!, monthIndex!, 0))
  return last.toISOString().slice(0, 10)
}

/** A range, short enough for a button: `12.08` or `01.08 – 25.08`. */
function shortRange(from: string, to?: string): string {
  const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
  if (!to || to === from) return short(from)
  return `${short(from)} – ${short(to)}`
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
