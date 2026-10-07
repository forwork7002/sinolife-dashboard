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
          focus indicator; `focusable` puts the house ring back.

          The browser's own ✕ is hidden: in Chrome it is a 9px grey mark the
          client never found, and it cleared through the debounce. The red one
          below replaces it.

          A sunken well of glass, the controls' one radius and their two
          heights: 40px under a thumb, 32px on a desk (see SegmentedControl). */}
      <input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`focusable h-10 w-full rounded-[var(--radius-panel-sm)] border pl-8 text-[13px] outline-none sm:h-8 sm:min-w-[200px] sm:text-xs [&::-webkit-search-cancel-button]:appearance-none ${
          local ? 'pr-8' : 'pr-2.5'
        }`}
        style={{
          backgroundColor: 'var(--glass-well)',
          borderColor: 'var(--border-strong)',
          color: 'var(--ink-primary)',
        }}
      />
      {/*
        RED, LIKE EVERY CLEAR IN THE APPLICATION (2026-09-11: «barcha tozalash…
        funksiyalari aniqroq koʻrinsin»), and only while there is text to clear.
        IMMEDIATE, not debounced: typing waits so a word costs one request, but
        a clear is one decision and the table should answer it at once.
      */}
      {local && (
        <button
          type="button"
          aria-label="Qidiruvni tozalash"
          onClick={() => {
            committed.current = ''
            setLocal('')
            onChange('')
          }}
          className="focusable absolute top-1/2 right-1.5 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[var(--status-critical)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--status-critical)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-critical)_10%,transparent)] hover:bg-[color-mix(in_oklab,var(--status-critical)_20%,transparent)]"
        >
          <MultiplyGlyph size={11} />
        </button>
      )}
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
  /**
   * Where the panel is drawn, in VIEWPORT pixels — null until first measured.
   *
   * PORTALLED TO <body> AND FIXED, as ColumnFilter's panel is, and for two
   * reasons production showed. It hung inside the page, and `main` is
   * `overflow-x: hidden`: anchored to its trigger's left edge, the
   * confirmation board's «Барча статус» — last in a right-aligned row — lost
   * about 100px of its 240px list, and the last control of a wrapped row on a
   * phone lost 25–55px. And it hung inside `.page-container`, which dims to
   * 60% while the data behind it is replaced (`stale`) — exactly what ticking
   * an option on Savdo dinamikasi or KPI does — so the list went see-through
   * over the tiles while it was being used.
   *
   * IT OPENS RIGHTWARD FROM THE TRIGGER, as it always has, and ends at the
   * trigger's right edge instead only when the viewport has no room for that;
   * either way it is held 8px inside the screen. Below the trigger, above it
   * only when below cannot hold it and above can.
   */
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()

  /*
    Before paint, so the panel never flashes in the wrong place — and again on
    every scroll (a CAPTURE listener: scroll does not bubble, and what scrolls
    here is `main`, never the window) and resize, because a fixed panel does
    not travel with its trigger on its own.
  */
  useLayoutEffect(() => {
    if (!open) return

    const measure = () => {
      const trigger = buttonRef.current?.getBoundingClientRect()
      if (!trigger) return
      const width = panelRef.current?.offsetWidth || PANEL_WIDTH
      const rightward = trigger.left + width <= window.innerWidth - 8
      const anchored = rightward ? trigger.left : trigger.right - width
      const left = Math.max(8, Math.min(anchored, window.innerWidth - width - 8))

      const height = panelRef.current?.offsetHeight ?? 0
      const below = window.innerHeight - trigger.bottom
      const top =
        below < height + 12 && trigger.top > below ? trigger.top - 4 - height : trigger.bottom + 4

      setPlace((previous) =>
        previous && previous.top === top && previous.left === left ? previous : { top, left },
      )
    }

    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (panelRef.current) observer?.observe(panelRef.current)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [open])

  /*
    Into the list on open, back to the trigger on Escape: portalled to the end
    of <body>, the panel no longer follows its button in the tab order. The
    FIRST CHECKBOX, not the first control — with a selection the first control
    is the red «Tozalash», and a Space pressed on arrival would clear it.
    Only once placed: until then the panel is `visibility: hidden`, and a
    browser refuses focus to a hidden element (see ColumnFilter).
  */
  const placed = place !== null
  useEffect(() => {
    if (!open || !placed) return
    const panel = panelRef.current
    const first =
      panel?.querySelector<HTMLElement>('input[type="checkbox"]') ?? panel?.querySelector<HTMLElement>('button')
    first?.focus({ preventScroll: true })
  }, [open, placed])

  useEffect(() => {
    if (!open) return
    // The panel is outside the trigger's box in the DOM now, so a press inside
    // EITHER counts as inside.
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

  /*
    …and back to the trigger when Tab leaves either end of the list. At the
    end of <body>, Tab past the last option left the page and Shift+Tab
    before the first landed on whatever the page ends with — and the panel
    stayed open over the screen with focus somewhere else.
  */
  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('input, button')]
    const edge = event.shiftKey ? stops[0] : stops[stops.length - 1]
    if (document.activeElement !== edge) return
    event.preventDefault()
    setOpen(false)
    buttonRef.current?.focus({ preventScroll: true })
  }

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
        ref={buttonRef}
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // Only while the panel exists. Pointing at an id that is not in the
        // document is a dangling reference, not a relationship.
        aria-controls={open ? id : undefined}
        aria-haspopup="listbox"
        /*
          A raised chip of glass, like a secondary Button — and SUNK into the
          well while it holds a selection, the state the count badge names.
          Colour, not `background`, inline: the hover wash is an image layer a
          shorthand would wipe. The lit edge is a (layered) class, never an
          inline box-shadow: inline, `none` included, it beats
          `.focusable:focus-visible` and the keyboard ring is gone.
        */
        className={`focusable flex h-8 items-center gap-1.5 rounded-[var(--radius-panel-sm)] border px-2.5 text-xs font-medium whitespace-nowrap transition-colors hover:bg-[image:linear-gradient(var(--glass-hover),var(--glass-hover))] disabled:opacity-50 ${selected.length ? '' : 'shadow-[var(--glass-highlight)]'}`}
        style={{
          backgroundColor: selected.length ? 'var(--glass-well)' : 'var(--glass-raised)',
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

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            onKeyDown={onPanelKeyDown}
            // `z-40`, ColumnFilter's: over the page and the mobile rail, under
            // the command palette (50) and tooltips (60). Hidden until measured.
            // Frosted (`.glass-float`): the tiles repaint under it while a
            // ticked option refetches.
            className="glass-float z-40 max-h-72 w-60 overflow-y-auto rounded-[var(--radius-panel)] border p-1"
            style={{
              position: 'fixed',
              top: place?.top ?? 0,
              left: place?.left ?? 0,
              visibility: place ? 'visible' : 'hidden',
              borderColor: 'var(--border-strong)',
              // Floating chrome: the directional float stack in light, an
              // offset-free halo in dark (see --shadow-ambient).
              boxShadow: 'var(--shadow-ambient)',
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
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * Single-choice segmented control.
 *
 * The active segment is a raised chip sitting in a sunken well, the same
 * recipe the period presets and the date picker's tabs use. The previous
 * solid-ink block was the heaviest mark on any toolbar it appeared in, which
 * handed the strongest ink on the screen to a CONTROL; the chip says "you are
 * here" with elevation instead of weight, and the well provides the boundary
 * the border used to.
 *
 * GLASS («Shisha», 2026-10-06): the well is --glass-well and the chip
 * --glass-raised with the lit top, so the control is a pane on the card or
 * the page and not an opaque patch. ONE RADIUS for every control,
 * --radius-panel-sm (the Button's), the chip two pixels less inside the
 * well's two-pixel padding; TWO HEIGHTS, 32px — this, a Button, MultiSelect,
 * the period control and the search box on a desk — and 40px for the period
 * control and the search box under a thumb. They were 28, 30, 32 and 34px in
 * one filter row, at 6, 8 and 12px corners.
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
      className="flex items-center gap-0.5 rounded-[var(--radius-panel-sm)] p-0.5"
      style={{ background: 'var(--glass-well)' }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            // The lit chip's shadow is a class so the focus ring can win it.
            className={`focusable h-7 rounded-[calc(var(--radius-panel-sm)-2px)] px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${active ? 'shadow-[var(--glass-highlight),var(--shadow-card)]' : ''}`}
            style={{
              background: active ? 'var(--glass-raised)' : 'transparent',
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
 * dismissal behaviour, the panel's surface and — since 2026-10-06 — where the
 * panel is drawn (portalled to <body>, fixed, measured from the trigger), and
 * those are the parts worth having identical — a reader who learns that
 * Escape closes one has learnt the other. They are kept in step by sitting in
 * one file, not by an abstraction neither of them asked for.
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
              Frosted (`.glass-float`): the table's rows scroll under it.
            */
            className="glass-float z-40 w-60 rounded-[var(--radius-panel)] border p-1 text-left text-xs"
            style={{
              position: 'fixed',
              top: place?.top ?? 0,
              left: place?.left ?? 0,
              visibility: place ? 'visible' : 'hidden',
              borderColor: 'var(--border-strong)',
              boxShadow: 'var(--shadow-ambient)',
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
          className="focusable mb-1 h-7 w-full rounded-[var(--radius-panel-sm)] border px-2 text-xs outline-none"
          style={{
            background: 'var(--glass-well)',
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

  // The search box's well, at the Button's small height inside the panel.
  const box = 'focusable tabular h-7 w-full rounded-[var(--radius-panel-sm)] border px-2 text-xs outline-none'
  const boxStyle = {
    background: 'var(--glass-well)',
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
