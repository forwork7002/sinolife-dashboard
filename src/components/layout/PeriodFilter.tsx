'use client'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { isCustomWindow } from '@/lib/customWindow'
import { APP_TIME_ZONE } from '@/lib/format'
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

/**
 * The presets that get a BUTTON. A subset, deliberately.
 *
 * All six above remain valid windows — the API resolves them, links carry
 * them, and `?preset=this_year` typed by hand still works. What changed is
 * how many of them earn a permanent place on every page.
 *
 * The three here are the ones asked for many times a day. The three dropped
 * — shu hafta, oʻtgan oy, shu yil — are each one selection away in the picker
 * (Kun · Oy · Yil · Oraliq), and keeping them cost a row that ran about 470px
 * and scrolled sideways on a phone.
 *
 * ONE LIST, read by both surfaces that offer presets: this control and the
 * command palette. Two lists drift, and the drift is invisible until somebody
 * reaches for a window on one surface that the other has stopped offering.
 */
export const VISIBLE_PRESETS = ['today', 'yesterday', 'this_month'] as const

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

  /*
    What the one remaining control says it is showing.

    A custom window reads as its dates; every other window reads as its name.
    The `from` guard matters: `preset=custom` with no bounds is a URL somebody
    typed, and `useDashboardFilters` already falls back to the default for it,
    so this only has to avoid printing an empty range on the way past.
  */
  const label =
    value === 'custom'
      ? from
        ? shortRange(from, to)
        : t.period.pick
      : // A window with no button of its own — arrived by link, or chosen in
        // the picker's Oy/Yil mode — is named here, or nothing on the row
        // would say what is on screen.
        (VISIBLE_PRESETS as readonly string[]).includes(value)
        ? t.period.pick
        : t.period[value]

  // Dismiss on an outside click or Escape — a popover that can only be closed
  // by re-clicking its own trigger is a trap on a dense page.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // `defaultPrevented` is the layering contract with the ⌘K palette: its
      // Escape is preventDefault-ed before this document-level listener runs
      // (React's delegated handlers were registered first), so one keypress
      // closes the palette without also folding this popover underneath it.
      if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    /*
      FULL WIDTH ON A PHONE, ITS OWN WIDTH ON A DESK.

      Three presets and the picker fit a phone's ~360px content column flat,
      so the row no longer scrolls. It did while it carried six presets: about
      470px, which ran past the edge of every page (see VISIBLE_PRESETS).

      The picker popover hangs off THIS wrapper, so it spans the row on a
      phone and anchors to its right edge on a desk.
    */
    <div ref={container} className="relative w-full sm:w-auto">
      <div className="flex w-full items-center gap-1.5 sm:w-auto">
        {/*
          SegmentedControl's look, not its own: a glass well with the chosen
          preset as the raised chip. It wore the solid-ink block that control
          retired — the heaviest mark on the row — beside BrandSwitch's chip,
          and a border that made it 34px in a row of 32s.
        */}
        <div
          className="flex shrink-0 items-center gap-0.5 rounded-[var(--radius-panel-sm)] p-0.5"
          style={{ background: 'var(--glass-well)' }}
          role="group"
          aria-label={t.period.label}
        >
          {VISIBLE_PRESETS.map((preset) => {
            const active = preset === value
            return (
              <button
                key={preset}
                type="button"
                onClick={() => onChange({ preset })}
                aria-pressed={active}
                // Taller under a thumb than under a pointer: a 36px chip in
                // the well (40px with it) on a phone, the smallest target
                // that is reliably hit; 28px (32) suits a mouse. The lit chip's
                // shadow is a (layered) class, never inline: an inline
                // box-shadow, `none` included, beats `.focusable:focus-visible`
                // and the keyboard ring went with it.
                className={`focusable h-9 rounded-[calc(var(--radius-panel-sm)-2px)] px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors sm:h-7 sm:text-xs ${active ? 'shadow-[var(--glass-highlight),var(--shadow-card)]' : ''}`}
                style={{
                  background: active ? 'var(--glass-raised)' : 'transparent',
                  color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                }}
              >
                {t.period[preset]}
              </button>
            )
          })}
        </div>

        {/*
          The picker, and the name of any window the three buttons cannot show.

          It used to read a flat "Sana" whenever the preset was not custom,
          which was safe while all six presets had a button lit beside it. With
          three, a window like "Shu yil" — reachable by link, or through the
          picker's own Yil mode — would otherwise leave nothing on this row
          saying what is on screen.
        */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`${t.period.label}: ${label}`}
          title={t.period.pick}
          // A raised glass chip, the well's height beside it; the page's
          // accent wash while a custom window is on. Colour, not `background`,
          // inline: the hover wash is an image layer a shorthand would wipe.
          // The lit edge is a class for the focus ring's sake (see the chips).
          className={`focusable flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-panel-sm)] border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-[image:linear-gradient(var(--glass-hover),var(--glass-hover))] sm:h-8 sm:text-xs ${value === 'custom' ? '' : 'shadow-[var(--glass-highlight)]'}`}
          style={{
            borderColor: value === 'custom' ? 'var(--accent)' : 'var(--border-strong)',
            backgroundColor: value === 'custom' ? 'var(--accent-soft)' : 'var(--glass-raised)',
            color: value === 'custom' ? 'var(--ink-primary)' : 'var(--ink-secondary)',
          }}
        >
          <CalendarIcon />
          {label}
        </button>
      </div>

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

  // From the app's calendar, like every other bound in this picker.
  const thisYear = Number(todayIso().slice(0, 4))
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i)

  /** What «Qoʻllash» applies for the fields as they stand, or null — see below. */
  const chosen = (): PeriodSelection | null => {
    /*
      NEVER PAST TODAY.

      "Oy → Sentabr" on the 2nd used to resolve to 1–30 September: twenty-eight
      days that have not happened yet, sitting in the window. The totals were
      unchanged — there is no data in the future — but the comparison is a
      window of equal LENGTH immediately before, so two days of September were
      measured against a full thirty days of August and every card on the page
      reported a collapse of ninety per cent. The same trap sat under
      "Yil → 2026", against eight months of 2025.

      The day and range inputs have carried `max={todayIso()}` all along; these
      two modes generate their bounds instead of reading them off an input, so
      the clamp has to be applied here.
    */
    const notFuture = (iso: string) => (iso > todayIso() ? todayIso() : iso)

    /*
      A FIELD HALF TYPED OR CLEARED APPLIES NOTHING. Firefox and Safari on a
      desk draw `type="month"` as plain text, so «2026-9» reached the API as
      `from=2026-9-01` (a 400 on every request, then remembered for every
      screen), and «09.2026» or an emptied field threw a RangeError out of
      `lastDayOfMonth`. This runs on every render now, so the month guard
      below is what keeps a half-typed field from taking the popover down.
    */
    const pick = (selection: PeriodSelection) => (isCustomWindow(selection.from, selection.to) ? selection : null)

    switch (mode) {
      case 'day':
        return pick({ preset: 'custom', from: day, to: day })
      case 'month':
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
        return pick({
          preset: 'custom',
          from: `${month}-01`,
          to: notFuture(lastDayOfMonth(month)),
        })
      case 'year':
        return pick({
          preset: 'custom',
          from: `${year}-01-01`,
          to: notFuture(`${year}-12-31`),
        })
      case 'range':
        // Swap rather than reject: someone who picks the end first meant a
        // range, and refusing it teaches them to distrust the control.
        return pick(
          rangeFrom <= rangeTo
            ? { preset: 'custom', from: rangeFrom, to: rangeTo }
            : { preset: 'custom', from: rangeTo, to: rangeFrom },
        )
    }
  }

  /*
    AND «QOʻLLASH» SAYS SO: disabled while nothing would apply. Pressable, it
    did nothing and left the popover open with no reason given — for a month
    typed as text, a future month (its end, clamped to today, falls before its
    start) or a range over ten years.
  */
  const selection = chosen()

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
      // Spans the row on a phone — anchored right on a desk it would hang off
      // the left edge of a 360px screen and lose its first field. Frosted
      // (`.glass-float`): it opens over the cards under the filter row.
      className="glass-float absolute top-full right-0 left-0 z-50 mt-2 rounded-[var(--radius-panel)] border p-3 sm:left-auto sm:w-72"
      style={{
        borderColor: 'var(--border-strong)',
        // Floating chrome — see --shadow-ambient.
        boxShadow: 'var(--shadow-ambient)',
      }}
    >
      <div
        className="mb-3 flex gap-0.5 rounded-[var(--radius-panel-sm)] p-0.5"
        style={{ background: 'var(--glass-well)' }}
        role="tablist"
      >
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={mode === option.id}
            onClick={() => setMode(option.id)}
            className={`focusable h-7 flex-1 rounded-[calc(var(--radius-panel-sm)-2px)] px-2 text-[11px] font-medium transition-colors ${mode === option.id ? 'shadow-[var(--glass-highlight),var(--shadow-card)]' : ''}`}
            style={{
              background: mode === option.id ? 'var(--glass-raised)' : 'transparent',
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

      {/* The kit's primary — the popover's ONE leading action. The old
          hand-rolled ink fill was the same idea minus the hover, active and
          press states the kit standardises. */}
      <Button
        variant="primary"
        onClick={() => {
          if (selection) onPick(selection)
        }}
        disabled={selection === null}
        className="mt-3 w-full"
      >
        {t.period.apply}
      </Button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </span>
      {/*
        No `display: contents` wrapper between this div and the input.
        
        `[&>*]` compiles to a direct-child selector, and `display: contents`
        removes an element's BOX but not the element — so the wrapper still
        matched the selector, silently absorbed every style meant for the
        input, and painted nothing. The date fields rendered completely
        unstyled: no border, no radius, no padding, browser default size.
      */}
      <div
        className="mt-1 [&>*]:h-8 [&>*]:w-full [&>*]:rounded-[var(--radius-panel-sm)] [&>*]:border [&>*]:border-[var(--border-strong)] [&>*]:bg-[var(--glass-well)] [&>*]:px-2.5 [&>*]:text-xs [&>*]:outline-none [&>*]:focusable"
        style={{
          colorScheme: 'light dark',
        }}
      >
        {children}
      </div>
    </label>
  )
}

/**
 * Today in the APPLICATION's calendar, as `YYYY-MM-DD`.
 *
 * Not the device's. The server resolves every window in `APP_TIME_ZONE`, so a
 * phone left on UTC offered a picker whose "today" was yesterday between
 * midnight and 05:00 Tashkent — and capped the date inputs there too, putting
 * the current day out of reach on the one screen built to select it.
 */
function todayIso(): string {
  // `en-CA` is ISO order, which is what the date inputs and this comparison
  // both want; the zone is what actually matters here.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
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
