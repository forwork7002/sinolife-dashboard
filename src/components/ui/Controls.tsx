'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/Button'
import { MultiplyGlyph } from '@/components/ui/Icons'
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
            // Red, like every clear and delete in the application — the client
            // asked on 2026-09-11 for all of them to be findable at a glance
            // («barcha tozalash va oʻchirish funksiyalari aniqroq koʻrinsin»).
            // As a ghost it was grey text above the list and read as a label.
            <Button
              variant="danger"
              size="sm"
              className="mb-1 w-full"
              icon={<MultiplyGlyph size={12} />}
              onClick={() => onChange([])}
            >
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
/** `w-60`, stated as a number so the side can be chosen before it is drawn. */
const PANEL_WIDTH = 240

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
  /**
   * Where the panel is drawn, in VIEWPORT pixels — null until first measured.
   *
   * THE PANEL IS PORTALLED TO <body> AND FIXED, and both halves were forced by
   * production. It used to hang inside the header cell, and that cell is
   * `.thead-sticky`: `position: sticky` with a z-index, which makes it a
   * stacking context. The panel's own z-40 then only counted INSIDE that cell,
   * so every later header cell — same z-index, later in the document — painted
   * over it: the top of the РОП panel, its search box, sat under САНА and
   * ID СДЕЛКИ. And it hung inside the table's `overflow: auto` scroll box, which
   * CLIPPED it: filter the board down to one ROP and the table is one row
   * tall, so the panel showed two names of fifteen and the rest could not be
   * reached. Measured on production 2026-09-11 — «ROP filter qilsam eng
   * tepadagi ustun tagida boʻlib qolayapti». No z-index inside the table can fix
   * the clip, so the panel leaves the table.
   *
   * WHICH SIDE is still measured, never assumed. A static `right-0` shipped
   * broken on 2026-09-09: anchored to the right of the LEFTMOST column, 186px of
   * the 240px РОП panel fell outside the table. The table scrolls sideways, so
   * one column is near either edge depending on the scroll — the side is chosen
   * from the room inside the nearest clipping box at the moment of opening, so
   * the panel stays over the table rather than over the sidebar.
   */
  const [place, setPlace] = useState<{
    top: number
    left: number
    side: 'left' | 'right'
  } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  /*
    BEFORE PAINT, so the panel never appears in the wrong place and jumps —
    and again on every scroll and resize while it is open, because a fixed
    panel does not travel with the header it belongs to on its own. The scroll
    listener is a CAPTURE listener: scroll does not bubble, and the thing that
    scrolls here is `main` or the table, never the window.
  */
  useLayoutEffect(() => {
    if (!open) return

    const measure = () => {
      const trigger = containerRef.current?.getBoundingClientRect()
      if (!trigger) return

      /*
        The nearest ancestor that CLIPS, found by asking rather than by knowing.
        Keying on DataTable's `.overflow-x-auto` would have made this component
        wrong the first time it was used inside anything else; the viewport is
        the backstop when nothing clips.
      */
      let clip = containerRef.current?.parentElement ?? null
      while (clip) {
        const { overflowX, overflowY } = getComputedStyle(clip)
        if (`${overflowX}${overflowY}`.includes('auto') || `${overflowX}${overflowY}`.includes('scroll')) break
        clip = clip.parentElement
      }
      const bounds = clip ? clip.getBoundingClientRect() : { left: 0, right: window.innerWidth }

      // Right-anchored means the panel extends LEFTWARD from the funnel.
      const roomLeftward = trigger.right - bounds.left
      const roomRightward = bounds.right - trigger.left
      const side = roomLeftward >= PANEL_WIDTH || roomLeftward >= roomRightward ? 'right' : 'left'

      // Never off the screen, whatever the table's box says.
      const anchored = side === 'right' ? trigger.right - PANEL_WIDTH : trigger.left
      const left = Math.max(8, Math.min(anchored, window.innerWidth - PANEL_WIDTH - 8))

      // Below the funnel; above it only when below cannot hold it and above can.
      const height = panelRef.current?.offsetHeight ?? 0
      const below = window.innerHeight - trigger.bottom
      const top =
        below < height + 12 && trigger.top > below ? trigger.top - 4 - height : trigger.bottom + 4

      setPlace((previous) =>
        previous && previous.top === top && previous.left === left && previous.side === side
          ? previous
          : { top, left, side },
      )
    }

    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    // The РЕГИОН list arrives after the panel opens and changes its height.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (panelRef.current) observer?.observe(panelRef.current)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [open])

  /*
    INTO THE PANEL ON OPEN, BACK TO THE FUNNEL ON ESCAPE. In the header cell
    the panel followed its button in the tab order; portalled to the end of
    <body> it no longer does, so focus is carried across by hand — and it lands
    on the search box when there is one, which is where a hand that opened a
    fifteen-name list goes next anyway.

    ONLY ONCE THE PANEL IS PLACED. Until the first measurement it is
    `visibility: hidden`, and a browser refuses focus to a hidden element — on
    the first open the focus simply stayed on the funnel. jsdom does not model
    that, so this was caught in a real browser, not by the suite.
  */
  const placed = place !== null
  useEffect(() => {
    if (!open || !placed) return
    panelRef.current
      ?.querySelector<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])')
      ?.focus({ preventScroll: true })
  }, [open, placed])

  /*
    The same two listeners `MultiSelect` installs, and installed only while the
    panel exists. The panel is outside the funnel's box in the DOM now, so a
    press inside EITHER counts as inside.
  */
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus({ preventScroll: true })
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
        ref={buttonRef}
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

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-label={`${label} — filtr`}
            data-side={place?.side}
            /*
              `z-40` clears the page's own dropdowns and the mobile rail; the
              command palette (z-50) and tooltips (60) still go over it.
              Hidden until measured — one frame — so it never flashes at 0,0.
            */
            className="z-40 w-60 rounded-[var(--radius-panel)] border p-1 text-left text-xs"
            style={{
              position: 'fixed',
              top: place?.top ?? 0,
              left: place?.left ?? 0,
              visibility: place ? 'visible' : 'hidden',
              background: 'var(--surface-raised)',
              borderColor: 'var(--border-strong)',
              boxShadow: 'var(--shadow-float)',
            }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
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
        // Red — see MultiSelect's clear, which this matches.
        <Button
          variant="danger"
          size="sm"
          className="mb-1 w-full"
          icon={<MultiplyGlyph size={12} />}
          onClick={() => onChange([])}
        >
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
  const [invalid, setInvalid] = useState(false)

  /**
   * Whole soʻm, grouped however the reader writes a number — or `null` when
   * it is not one. Empty is `undefined`: an open end, not an error.
   *
   * DOTS ARE GROUP SEPARATORS HERE. «1.600.000» is how this floor writes a
   * sum, and `Number()` reads it as NaN — which used to become `undefined`
   * and drop the bound SILENTLY, so the popover closed on the whole month as
   * if the filter did not work (production, 2026-09-11). Spaces (no-break
   * ones too, which a spreadsheet copy carries), commas and apostrophes are
   * separators as well. A trailing `,00` / `.00` is zero tiyin and goes
   * first, so «1600000.00» is not read as a hundred and sixty million.
   */
  const parse = (value: string): number | undefined | null => {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const digits = trimmed.replace(/[.,]0{1,2}$/, '').replace(/[\s.,'’_]/g, '')
    return /^\d+$/.test(digits) ? Number(digits) : null
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
        const low = parse(from)
        const high = parse(to)
        // Nothing is applied from a half-read form: dropping the bad bound and
        // applying the rest is exactly the silent failure described above.
        if (low === null || high === null) {
          setInvalid(true)
          return
        }
        setInvalid(false)
        onApply({ min: low, max: high })
      }}
    >
      <div className="flex items-center gap-1.5">
        <label className="flex-1">
          <span className="sr-only">Eng kam summa</span>
          <input
            type="text"
            inputMode="numeric"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setInvalid(false)
            }}
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
            onChange={(e) => {
              setTo(e.target.value)
              setInvalid(false)
            }}
            placeholder="gacha"
            className={box}
            style={boxStyle}
          />
        </label>
      </div>

      {invalid ? (
        <p role="alert" className="mt-1 px-0.5 text-[10.5px]" style={{ color: 'var(--status-critical)' }}>
          Faqat raqam kiriting, masalan 1600000 yoki 1.600.000
        </p>
      ) : (
        <p className="mt-1 px-0.5 text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
          {unit}
          {/* The one thing this form cannot say by itself: how to ask for one exact sum. */}
          {' · bitta summa uchun ikkalasiga bir xil son'}
        </p>
      )}

      <div className="mt-1.5 flex gap-1.5">
        <Button type="submit" variant="primary" size="sm" className="flex-1">
          Qoʻllash
        </Button>
        {(min !== undefined || max !== undefined) && (
          // Red — see MultiSelect's clear, which this matches.
          <Button
            type="button"
            variant="danger"
            size="sm"
            icon={<MultiplyGlyph size={12} />}
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
