'use client'

import { type CSSProperties, type InputHTMLAttributes, type MouseEvent, useState } from 'react'

import { dottedDay } from '@/lib/format'

/**
 * A DATE FIELD THAT ONLY EVER HANDS OVER A WHOLE DAY INSIDE ITS BOUNDS, AND
 * READS IT AS «01.10.2026».
 *
 * THE DAY IS PRINTED BY US, NOT BY THE BROWSER (2026-10-14, the user, over a
 * screenshot of «10/01/2026» after picking 1 October). A native
 * `<input type="date">` draws its value in the BROWSER's locale — an English
 * Chrome writes month/day/year, so 1 October read as «10/01/2026», which an
 * Uzbek reader takes for 10 January — and no attribute on the page changes
 * that. So the box shows the day as kun.oy.yil, and the native field lies over
 * it, invisible: a click opens the browser's own calendar (`showPicker`, the
 * one Chrome otherwise keeps behind its small icon), a phone opens its wheel,
 * the keyboard still types into it.
 *
 * A native field reports every keystroke: typing the year «2026» reports
 * 0002 → 0020 → 0202 on the way, and a typed day past `max` (the browser only
 * enforces it in its own calendar) is reported too. So what is typed is a
 * DRAFT and `onCommit` hears only a real calendar day within [`min`, `max`];
 * a blur puts the committed day back, as «RNP jadvali»'s month box does. A day
 * picked in the calendar is whole and in range, so it commits at once.
 *
 * `className` and `style` dress the BOX (border, height, padding); every other
 * prop — `aria-label`, `id` — goes to the field, which a wrapping `<label>`
 * names.
 */
export function DateInput({
  value,
  min,
  max,
  onCommit,
  onBlur,
  className,
  style,
  ...rest
}: {
  /** The committed day, `YYYY-MM-DD`; empty while none is known. */
  value: string
  min?: string
  max?: string
  onCommit: (day: string) => void
  className?: string
  style?: CSSProperties
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max' | 'onChange' | 'className' | 'style'>) {
  const [draft, setDraft] = useState<string | null>(null)
  // A draft that already reads as a day is shown as typed; a half-typed one shows the committed day.
  const shown = draft !== null && dottedDay(draft) !== null ? draft : value
  return (
    <span className={`relative inline-flex items-center justify-between gap-1.5 ${className ?? ''}`} style={style}>
      {/*
        Drawn from an attribute, not as text: text here would join the wrapping
        `<label>`'s name («Kun14.10.2026»); the field itself is what a screen
        reader names and reads, value included.
      */}
      <span
        aria-hidden
        className="tabular whitespace-nowrap before:content-[attr(data-day)]"
        data-day={dottedDay(shown) ?? 'kk.oo.yyyy'}
      />
      <CalendarGlyph />
      <input
        {...rest}
        type="date"
        value={draft ?? value}
        min={min}
        max={max}
        onClick={openPicker}
        onChange={(e) => {
          const next = e.target.value
          if (isDayWithin(next, min, max)) {
            setDraft(null)
            if (next !== value) onCommit(next)
          } else setDraft(next)
        }}
        onBlur={(e) => {
          setDraft(null)
          onBlur?.(e)
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </span>
  )
}

/** The browser's calendar on a click anywhere in the box — Chrome opens it only from its own icon. */
function openPicker(event: MouseEvent<HTMLInputElement>): void {
  try {
    event.currentTarget.showPicker?.()
  } catch {
    // Already open, or not allowed here: the field still takes focus and the keyboard.
  }
}

/** A real calendar day, `YYYY-MM-DD`, inside the bounds given — «2026-02-30» and a half-typed year are not. */
export function isDayWithin(day: string, min?: string, max?: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const date = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return false
  return (min === undefined || day >= min) && (max === undefined || day <= max)
}

function CalendarGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 opacity-70">
      <rect x="3" y="5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
