'use client'

import { type InputHTMLAttributes, useState } from 'react'

/**
 * A DATE FIELD THAT ONLY EVER HANDS OVER A WHOLE DAY INSIDE ITS BOUNDS.
 *
 * The user, 2026-10-14: «vaqtni tanlashda notoʻgʻri vaqt tanlanib ketmasligi
 * zarur». A native `<input type="date">` reports every keystroke: typing the
 * year «2026» reports 0002-…, 0020-…, 0202-… on the way, and a typed day past
 * `max` (the browser only enforces it in its own calendar) is reported too.
 * Wired straight to state, «Lid kogortasi» asked the API for year 202 while
 * somebody typed, and the day cards' picker refused those values — which put
 * the old day back into the box under the typing hand.
 *
 * So the box keeps what is typed as a DRAFT and `onCommit` hears only a real
 * calendar day within [`min`, `max`]; a blur puts the committed day back, the
 * way «RNP jadvali»'s month box does. A day picked in the browser's calendar
 * is whole and in range, so it commits at once, as before.
 */
export function DateInput({
  value,
  min,
  max,
  onCommit,
  onBlur,
  ...rest
}: {
  /** The committed day, `YYYY-MM-DD`. */
  value: string
  min?: string
  max?: string
  onCommit: (day: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      {...rest}
      type="date"
      value={draft ?? value}
      min={min}
      max={max}
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
    />
  )
}

/** A real calendar day, `YYYY-MM-DD`, inside the bounds given — «2026-02-30» and a half-typed year are not. */
export function isDayWithin(day: string, min?: string, max?: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const date = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return false
  return (min === undefined || day >= min) && (max === undefined || day <= max)
}
