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
  minLength = 1,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /**
   * How many characters a term needs before it is worth asking the server.
   *
   * One — commit anything — is the right default for a box that filters a list
   * already in the browser. A box that reaches a `pg_trgm` index is a
   * different thing: see the confirmation board's own note where it passes 3.
   * The rule here is only the mechanism; the page owns the number.
   */
  minLength?: number
}) {
  const [local, setLocal] = useState(value)
  const committed = useRef(value)
  const hintId = useId()

  /*
    A TERM TOO SHORT TO ASK ABOUT — held back, not refused.

    The box keeps rendering `local`, so it stays typable and the caret never
    jumps; only the COMMIT waits. Refusing the keystroke instead would be a
    box that eats characters, which reads as a broken input rather than as a
    threshold.
  */
  const term = local.trim()
  const tooShort = term.length > 0 && term.length < minLength

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
    /*
      THE EMPTY STRING ALWAYS COMMITS, and that is the whole trap in this
      guard. Written as a bare `length >= minLength` it also swallows the
      clear: someone who searched, then emptied the box, would be left with
      the old term still in the URL, the old rows still on screen, and an
      empty box saying otherwise — with no way back except a page reload.
    */
    const pending = local.trim()
    if (pending !== '' && pending.length < minLength) return
    const timer = setTimeout(() => {
      committed.current = local
      onChange(local)
    }, 350)
    return () => clearTimeout(timer)
  }, [local, minLength, onChange])

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
        aria-describedby={hintId}
        className="focusable w-full rounded-lg border py-2 pr-2.5 pl-8 text-[13px] outline-none sm:min-w-[200px] sm:py-1.5 sm:text-xs"
        style={{
          background: 'var(--surface-raised)',
          borderColor: 'var(--border-strong)',
          color: 'var(--ink-primary)',
        }}
      />
      {/*
        SAY WHY NOTHING IS HAPPENING YET.

        A threshold with no notice is indistinguishable from a broken search:
        two characters go in, the rows do not move, and the reader's next act
        is to retype the same two. One line under the box turns that into a
        threshold they can see.

        ABSOLUTELY POSITIONED, so it cannot reflow the filter row. The row is
        `flex-wrap`, and a line appearing inside it on the second keystroke —
        and vanishing on the third — would shove the controls beside the box
        sideways twice per search. Same reasoning as the muted period control
        beside it: dim and still, never hidden and moving.

        Always in the document, empty when there is nothing to say: a live
        region that appears already holding its text is a new element to most
        screen readers rather than an update, and goes unannounced. An empty
        absolute span costs no layout, so this is free.
      */}
      <span
        id={hintId}
        aria-live="polite"
        className="pointer-events-none absolute top-full left-0 mt-1 text-[11px] whitespace-nowrap"
        style={{ color: 'var(--ink-muted)' }}
      >
        {tooShort ? `Kamida ${minLength} ta belgi` : ''}
      </span>
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
        /*
          The server and the first client render legitimately disagree here.

          Queries never run server-side, so `options` is always empty in the
          server HTML and this button always renders `disabled`. The shell now
          mounts in the root layout and issues `/meta/filters` immediately,
          while this subtree sits behind the page's Suspense boundary — so the
          payload can land BEFORE this element hydrates, and the hydration
          render legitimately reads `disabled={false}` against a server HTML
          that says otherwise.

          This suppresses the WARNING, not the mismatch: React does not patch a
          mismatched attribute during hydration, so the button stays disabled in
          the DOM until the next render commits it. That render is immediate —
          the data is already in the cache — which is why silencing the log is
          the right answer here rather than deferring the disabled state to an
          effect and making every reader wait a frame for a control that is
          ready.
        */
        suppressHydrationWarning
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // Only while the panel exists. Pointing at an id that is not in the
        // document is a dangling reference, not a relationship.
        aria-controls={open ? id : undefined}
        aria-haspopup="listbox"
        /*
          THUMB-SIZED BELOW `sm`, the same ramp the preset chips and the search
          box already use (`py-2 text-[13px] sm:py-1.5 sm:text-xs`).

          This control shares one wrapping row with those two on every screen
          that has filters, and on a phone it was the odd one out: a ~28px
          target sitting directly under a 36px one, in a row that already wraps
          to three or four lines. Matching the ramp makes the row read as one
          control set rather than as two sizes of thing, and it is a ramp
          rather than a flat increase because at `sm` and up the row is one
          line and the compact height is what keeps it there.
        */
        className="focusable flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors disabled:opacity-50 sm:py-1.5 sm:text-xs"
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
  pageSize,
  onPageSize,
  sizes = [25, 50, 100],
}: {
  page: number
  totalPages: number
  totalItems: number
  onPage: (page: number) => void
  /**
   * Rows per page. Omit this and `onPageSize` for a pager with no size
   * control — which is every caller but the confirmation queue.
   */
  pageSize?: number
  onPageSize?: (size: number) => void
  /**
   * DELIBERATELY NO 200, even though the API's schemas accept it.
   *
   * `confirmationOrders` pages FIRST and decorates afterwards, so every row
   * that survives the LIMIT costs one LATERAL over `deal_item` and one
   * correlated pass over the stage history. Two hundred of those per request,
   * on a board that polls every minute against a single vCPU shared with the
   * sync worker, is a different query from the one that was measured. The
   * ceiling lives here so the decision is in one place rather than in each
   * caller's list.
   */
  sizes?: readonly number[]
}) {
  if (totalItems === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      {/* The count and the size control are one group on the left, so the
          pager keeps its buttons on the right at every width. */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
          {formatNumber(totalItems)} ta yozuv · {page}/{totalPages}
        </p>
        {pageSize !== undefined && onPageSize && (
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            aria-label="Sahifadagi qatorlar"
            className="focusable rounded-lg border px-2 py-1 text-[11px]"
            style={{
              background: 'var(--surface-raised)',
              borderColor: 'var(--border-strong)',
              color: 'var(--ink-secondary)',
            }}
          >
            {/* THE CURRENT SIZE IS ALWAYS AN OPTION. `pageSize` rides in the
                URL, so a pasted link can carry a value this list does not
                offer — and a native select whose value matches no option
                renders BLANK, leaving a control that cannot say what it is
                set to over a table paged by it. */}
            {(sizes.includes(pageSize) ? sizes : [...sizes, pageSize].sort((a, b) => a - b)).map(
              (size) => (
                <option key={size} value={size}>
                  {size} ta
                </option>
              ),
            )}
          </select>
        )}
      </div>
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
