'use client'

import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

/** Debounced search box. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Qidirish…',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [local, setLocal] = useState(value)
  const committed = useRef(value)

  // Keep in step when the URL changes from outside (back button, reset).
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setLocal(value)
    }
  }, [value])

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    if (local === committed.current) return
    const timer = setTimeout(() => {
      committed.current = local
      onChange(local)
    }, 350)
    return () => clearTimeout(timer)
  }, [local, onChange])

  return (
    <div className="relative w-full sm:w-auto">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
      >
        <circle cx="11" cy="11" r="6.5" stroke="var(--ink-muted)" strokeWidth="1.8" />
        <path d="M16 16l4 4" stroke="var(--ink-muted)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {/* The placeholder is not an accessible name — it disappears the moment
          anyone types. `outline-none` with no replacement removed the only
          focus indicator; `focusable` puts the house ring back. */}
      <input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="focusable w-full rounded-lg border py-2 pr-2.5 pl-8 text-[13px] outline-none sm:min-w-[200px] sm:py-1.5 sm:text-xs"
        style={{
          background: 'var(--surface-raised)',
          borderColor: 'var(--border-strong)',
          color: 'var(--ink-primary)',
        }}
      />
    </div>
  )
}

export interface Option {
  readonly id: string
  readonly label: string
}

/**
 * Multi-select dropdown.
 *
 * A plain popover over checkboxes rather than a combobox library: the option
 * lists here are short and known, and the native controls keep keyboard and
 * screen-reader behaviour for free.
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  disabled,
}: {
  label: string
  options: readonly Option[]
  selected: readonly string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (optionId: string) => {
    onChange(
      selected.includes(optionId)
        ? selected.filter((s) => s !== optionId)
        : [...selected, optionId],
    )
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // Only while the panel exists. Pointing at an id that is not in the
        // document is a dangling reference, not a relationship.
        aria-controls={open ? id : undefined}
        aria-haspopup="listbox"
        className="focusable flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50"
        style={{
          background: selected.length ? 'var(--grid)' : 'var(--surface-raised)',
          borderColor: 'var(--border-strong)',
          color: 'var(--ink-primary)',
        }}
      >
        {label}
        {selected.length > 0 && (
          <span
            className="tabular rounded-full px-1.5 text-[10px]"
            style={{ background: 'var(--series-1)', color: 'var(--ink-on-series)' }}
          >
            {selected.length}
          </span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          id={id}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-[var(--radius-panel)] border p-1"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--border-strong)',
            boxShadow: 'var(--shadow-float)',
          }}
        >
          {selected.length > 0 && (
            // The button kit's ghost: quiet until hovered, so clearing never
            // competes with the options it clears.
            <Button variant="ghost" size="sm" className="mb-1 w-full" onClick={() => onChange([])}>
              Tozalash
            </Button>
          )}
          {options.map((option) => (
            <label
              key={option.id}
              role="option"
              aria-selected={selected.includes(option.id)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--grid)]"
              style={{ color: 'var(--ink-primary)' }}
            >
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={() => toggle(option.id)}
                className="h-3.5 w-3.5"
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Single-choice segmented control.
 *
 * The active segment is a raised chip — `--surface-raised` with the card
 * shadow — sitting in a `--grid` well, the same recipe the period picker's
 * tablist already used. The previous solid-ink block was the heaviest mark
 * on any toolbar it appeared in, which handed the strongest ink on the
 * screen to a CONTROL; the chip says "you are here" with elevation instead
 * of weight, and the well provides the boundary the border used to.
 *
 * Semantics stay native: real buttons with `aria-pressed`, so Tab reaches
 * every option and Space/Enter work for free.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: readonly { readonly value: T; readonly label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 rounded-lg p-0.5"
      style={{ background: 'var(--grid)' }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className="focusable rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
            style={{
              background: active ? 'var(--surface-raised)' : 'transparent',
              boxShadow: active ? 'var(--shadow-card)' : 'none',
              color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Server-driven pagination. */
export function Pagination({
  page,
  totalPages,
  totalItems,
  onPage,
}: {
  page: number
  totalPages: number
  totalItems: number
  onPage: (page: number) => void
}) {
  if (totalItems === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
        {formatNumber(totalItems)} ta yozuv · {page}/{totalPages}
      </p>
      <div className="flex items-center gap-1">
        <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)} label="Oldingi" />
        <PageButton
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          label="Keyingi"
        />
      </div>
    </div>
  )
}

/*
  A thin alias over the button kit. Paging is a workhorse action, so it wears
  `secondary` — the ad-hoc bordered rectangle this used to be was the kit's
  reason to exist.
*/
function PageButton({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean
  onClick: () => void
  label: string
}) {
  return (
    <Button variant="secondary" size="sm" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  )
}

/** Deal / payment status pill. Icon-free but always labelled in words. */
export function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, { bg: string; dot: string; label: string }> = {
    OPEN: { bg: 'var(--grid)', dot: 'var(--seq-350)', label: t.status.OPEN },
    WON: {
      bg: 'color-mix(in oklab, var(--status-good) 14%, transparent)',
      dot: 'var(--status-good)',
      label: t.status.WON,
    },
    LOST: {
      bg: 'color-mix(in oklab, var(--status-critical) 12%, transparent)',
      dot: 'var(--status-critical)',
      label: t.status.LOST,
    },
    PAID: {
      bg: 'color-mix(in oklab, var(--status-good) 14%, transparent)',
      dot: 'var(--status-good)',
      label: 'Toʻlangan',
    },
    PARTIAL: {
      bg: 'color-mix(in oklab, var(--status-warning) 18%, transparent)',
      dot: 'var(--status-warning)',
      label: 'Qisman',
    },
    UNPAID: {
      bg: 'color-mix(in oklab, var(--status-critical) 12%, transparent)',
      dot: 'var(--status-critical)',
      label: 'Toʻlanmagan',
    },
    ACHIEVED: {
      bg: 'color-mix(in oklab, var(--status-good) 14%, transparent)',
      dot: 'var(--status-good)',
      label: t.kpiStatus.ACHIEVED,
    },
    ON_TRACK: {
      bg: 'color-mix(in oklab, var(--status-good) 10%, transparent)',
      dot: 'var(--status-good)',
      label: t.kpiStatus.ON_TRACK,
    },
    AT_RISK: {
      bg: 'color-mix(in oklab, var(--status-warning) 18%, transparent)',
      dot: 'var(--status-warning)',
      label: t.kpiStatus.AT_RISK,
    },
    BEHIND: {
      bg: 'color-mix(in oklab, var(--status-critical) 12%, transparent)',
      dot: 'var(--status-critical)',
      label: t.kpiStatus.BEHIND,
    },
  }

  const style = palette[status] ?? { bg: 'var(--grid)', dot: 'var(--ink-muted)', label: status }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ background: style.bg, color: 'var(--ink-primary)' }}
    >
      {/* Colour plus a word — never colour alone. */}
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: style.dot }}
      />
      {style.label}
    </span>
  )
}

/**
 * A column's own filter, in the shape a spreadsheet taught everybody.
 *
 * Asked for by name on 2026-09-09: «jadvaldagi roplar ustuniga exceldagi
 * filtrga oʻxshab filtr beriladigan boʻlsin». The client reads this board
 * beside a Bitrix24 kanban and an Excel export all day, and an AutoFilter is
 * the one filtering idiom he does not have to be taught — the control lives ON
 * the column it narrows, so there is nothing to learn about which is which.
 *
 * WHY NOT `MultiSelect`, WHICH IS RIGHT ABOVE THIS. That control is a toolbar
 * button: it prints its own label, sizes itself to the text, and opens a panel
 * anchored under a 32px-tall pill. A column header is 11px uppercase in a cell
 * that may be 96px wide, and the trigger has to be a mark rather than a word or
 * it becomes the widest thing in the header. What the two DO share is the
 * dismissal behaviour and the panel's surface, and those are the parts worth
 * having identical — a reader who learns that Escape closes one has learnt the
 * other. They are kept in step by sitting in one file, not by an abstraction
 * neither of them asked for.
 *
 * THE FUNNEL IS FILLED WHEN THE FILTER IS ON, and that is the whole of the
 * state indicator. A count badge was tried and dropped: at 11px beside a
 * Cyrillic header it read as part of the label, and the header row is the one
 * place on this screen with no spare pixels. A filtered column also gets its
 * mark in `--series-1`, so the eye finds WHICH column is narrowed from across
 * the table without reading a single header.
 */
export function ColumnFilter({
  label,
  active,
  children,
}: {
  /** The column's own header text. It names the popover for a screen reader. */
  label: string
  /** Whether anything is currently selected — draws the funnel filled. */
  active: boolean
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const id = useId()

  /*
    The same two listeners `MultiSelect` installs, and installed only while the
    panel exists. A document-level mousedown handler that outlives its popover
    is a listener per column per render, and this table has three.
  */
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative inline-flex" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        // The header itself is not a label a screen reader reaches from here,
        // so the button says which column it belongs to in full.
        aria-label={`${label} — filtr`}
        className="focusable ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--grid)]"
        style={{ color: active ? 'var(--series-1)' : 'var(--ink-muted)' }}
      >
        {/* A funnel, hollow when it filters nothing and filled when it does. */}
        <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M3 5h18l-7 8v6l-4 2v-8L3 5z"
            fill={active ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={`${label} — filtr`}
          /*
            RIGHT-ALIGNED, AND ABOVE EVERYTHING.

            `right-0` because these sit on right-aligned numeric headers near
            the table's right edge, where a left-anchored panel would open off
            the card. `z-40` clears the sticky header (`z-index: 1`) and the
            toolbar's own dropdowns; `text-left` because the header cell it
            inherits from is centred or right-aligned and a form is not.
          */
          className="absolute top-full right-0 z-40 mt-1 w-60 rounded-[var(--radius-panel)] border p-1 text-left normal-case"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--border-strong)',
            boxShadow: 'var(--shadow-float)',
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/**
 * The checkbox list inside a `ColumnFilter` — Excel's own value list.
 *
 * SEARCHABLE ONLY WHEN IT NEEDS TO BE. Fifteen ROP groups and fourteen regions
 * both fit a scroll box without one, and a search field over a list you can
 * already see is a control that costs a line and answers nothing; past
 * `SEARCHABLE_FROM` the list stops being scannable and the field earns itself.
 *
 * COUNTS ARE OPTIONAL AND MUTED. A region with four orders is worth telling
 * apart from one with four hundred before you click it, but the count is not
 * what you are choosing — it never takes the option's own ink.
 */
export function ColumnFilterList({
  options,
  selected,
  onChange,
  emptyLabel = 'Hech narsa topilmadi',
  loading = false,
}: {
  readonly options: readonly { id: string; label: string; count?: number }[]
  readonly selected: readonly string[]
  readonly onChange: (ids: string[]) => void
  readonly emptyLabel?: string
  readonly loading?: boolean
}) {
  const SEARCHABLE_FROM = 12
  const [query, setQuery] = useState('')

  const shown = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])

  return (
    <>
      {options.length >= SEARCHABLE_FROM && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Qidirish…"
          aria-label="Roʻyxatdan qidirish"
          className="focusable mb-1 w-full rounded-md border px-2 py-1.5 text-xs outline-none"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border-strong)',
            color: 'var(--ink-primary)',
          }}
        />
      )}

      {selected.length > 0 && (
        <Button variant="ghost" size="sm" className="mb-1 w-full" onClick={() => onChange([])}>
          Tozalash
        </Button>
      )}

      <div className="max-h-56 overflow-y-auto">
        {loading ? (
          // Three bars, not a spinner: the list is what is coming, so the
          // placeholder is shaped like a list.
          <div className="space-y-1 p-1" role="status">
            <span className="sr-only">Yuklanmoqda</span>
            <div className="skeleton h-5 w-full" />
            <div className="skeleton h-5 w-4/5" />
            <div className="skeleton h-5 w-3/5" />
          </div>
        ) : shown.length === 0 ? (
          <p className="px-2 py-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {emptyLabel}
          </p>
        ) : (
          shown.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--grid)]"
              style={{ color: 'var(--ink-primary)' }}
            >
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={() => toggle(option.id)}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="truncate">{option.label}</span>
              {option.count !== undefined && (
                <span
                  className="tabular ml-auto shrink-0 text-[10.5px]"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {formatNumber(option.count)}
                </span>
              )}
            </label>
          ))
        )}
      </div>
    </>
  )
}

/**
 * The numeric range inside a `ColumnFilter` — Excel's «Number Filters».
 *
 * TWO INDEPENDENT BOUNDS, and either may stand alone: «everything over a
 * million» is the ask this column actually gets, and forcing a ceiling onto it
 * would make the reader invent one.
 *
 * IT COMMITS ON SUBMIT, NOT ON KEYSTROKE. Every other filter on this dashboard
 * applies as you touch it, and that is right for a checkbox — one click, one
 * unambiguous intent. A number is typed a digit at a time, and «1», «10», «100»
 * are three complete requests to a server that answers each of them: the reader
 * would watch the table empty and refill four times on the way to 1 000 000.
 * A form with an explicit «Qoʻllash» also makes Enter work, which is what a
 * hand that has just typed a number expects to press.
 *
 * The two boxes are NOT ordered for the reader. A min above a max returns
 * nothing, and that is a legible answer to a contradictory question — swapping
 * them silently would answer a question they did not ask.
 */
export function ColumnFilterRange({
  min,
  max,
  unit,
  onApply,
}: {
  readonly min?: number
  readonly max?: number
  /** Printed under the boxes, once, so neither of them has to carry it. */
  readonly unit: string
  readonly onApply: (next: { min?: number; max?: number }) => void
}) {
  // Local, because this form is uncommitted until it is submitted. Keyed on
  // the incoming values so a reset from the URL (back button, Tozalash
  // elsewhere) is reflected the next time the popover opens.
  const [from, setFrom] = useState(min === undefined ? '' : String(min))
  const [to, setTo] = useState(max === undefined ? '' : String(max))

  const parse = (value: string): number | undefined => {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const parsed = Number(trimmed.replace(/\s|,/g, ''))
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }

  const box = 'focusable tabular w-full rounded-md border px-2 py-1.5 text-xs outline-none'
  const boxStyle = {
    background: 'var(--surface)',
    borderColor: 'var(--border-strong)',
    color: 'var(--ink-primary)',
  }

  return (
    <form
      className="p-1"
      onSubmit={(event) => {
        event.preventDefault()
        onApply({ min: parse(from), max: parse(to) })
      }}
    >
      <div className="flex items-center gap-1.5">
        <label className="flex-1">
          <span className="sr-only">Eng kam summa</span>
          <input
            type="text"
            inputMode="numeric"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="dan"
            className={box}
            style={boxStyle}
          />
        </label>
        <span aria-hidden="true" style={{ color: 'var(--ink-muted)' }}>
          –
        </span>
        <label className="flex-1">
          <span className="sr-only">Eng koʻp summa</span>
          <input
            type="text"
            inputMode="numeric"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="gacha"
            className={box}
            style={boxStyle}
          />
        </label>
      </div>

      <p className="mt-1 px-0.5 text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
        {unit}
      </p>

      <div className="mt-1.5 flex gap-1.5">
        <Button type="submit" variant="primary" size="sm" className="flex-1">
          Qoʻllash
        </Button>
        {(min !== undefined || max !== undefined) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom('')
              setTo('')
              onApply({})
            }}
          >
            Tozalash
          </Button>
        )}
      </div>
    </form>
  )
}
