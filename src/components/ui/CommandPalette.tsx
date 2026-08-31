'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Kbd } from '@/components/ui/Kbd'
import { SearchGlyph } from '@/components/ui/Icons'

/**
 * The ⌘K command palette.
 *
 * Fourteen destinations and a stack of period presets live behind one search
 * box, because the fastest navigation is the one that never touches the
 * sidebar. The recipe is Linear's: 600px panel in the top third, search on
 * top, 40px rows, keycap hints on the right edge, a footer that teaches the
 * keys — opened by the hook below, closed by Esc, backdrop, or selection.
 *
 * This file is deliberately dumb about CONTENT: it receives groups of items
 * and runs `onSelect`. What the commands are — routes, period presets,
 * actions — is the caller's knowledge (Shell wires it), so the palette never
 * imports a router or a query client and stays testable as a pure widget.
 *
 * Search normalisation matters more here than cleverness: the UI is Uzbek,
 * where oʻ is o + U+02BB — a letter nobody's keyboard types. Every
 * apostrophe-like mark is stripped from both sides of the match, so
 * "qongiroq", "qo'ngiroq" and "qoʻngʻiroq" all find Qoʻngʻiroqlar.
 *
 * Entrance and dim are `.palette-enter` / `.backdrop-dim` from globals.css,
 * where they sit behind the house reduced-motion guard. Nothing here animates
 * on its own.
 */

export interface CommandItem {
  readonly id: string
  readonly label: string
  /** Secondary text after the label — a route, a date range, a clarifier. */
  readonly hint?: string
  /** Keycap tokens for the right edge, in Kbd's vocabulary. */
  readonly keys?: readonly string[]
  /** A 12–15px glyph; it inherits muted ink. */
  readonly icon?: ReactNode
  readonly onSelect: () => void
}

export interface CommandGroup {
  readonly label: string
  readonly items: readonly CommandItem[]
  /**
   * Items already matched elsewhere — skip the local filter.
   *
   * The static groups are a fixed list this widget narrows as you type. A
   * group of search results is the opposite: the server has already decided
   * these match, and the words it matched on — a phone number inside an array,
   * a customer's name on an order titled something else — are not necessarily
   * in the label. Filtering them again would hide rows that genuinely match.
   */
  readonly prefiltered?: boolean
}

/**
 * Case-insensitive and apostrophe-blind.
 *
 * U+02BB (the modifier letter oʻ/gʻ are spelled with), U+02BC, curly quotes,
 * backtick and the plain apostrophe all vanish before comparing. Removing
 * rather than unifying them is the point: it forgives the spelling that
 * omits the mark entirely, which is how most people actually type.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[ʻʼ‘’'`]/g, '')
}

const optionId = (base: string, index: number) => `${base}-opt-${index}`

export function CommandPalette({
  open,
  onClose,
  groups,
  placeholder,
  onQueryChange,
  busy,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly groups: readonly CommandGroup[]
  readonly placeholder?: string
  /**
   * Told what is being typed, so a caller can look it up.
   *
   * The palette keeps owning the input — it is transient state that dies with
   * the dialog — and merely reports it. A caller that lifted the value would
   * have to reset it on close, which is the effect this design exists to
   * avoid.
   */
  readonly onQueryChange?: (query: string) => void
  /** A lookup is in flight; say so rather than showing "nothing found". */
  readonly busy?: boolean
}) {
  /*
    Closed means UNMOUNTED, not hidden. The dialog below holds its transient
    state (query, selection) as ordinary component state, and unmounting is
    what resets it — no "clear the search when the palette closes" effect to
    write, and none to get wrong. Every open starts from a blank box, which
    is also the behaviour Linear ships.
  */
  if (!open) return null

  return createPortal(
    <PaletteDialog
      groups={groups}
      onClose={onClose}
      placeholder={placeholder}
      onQueryChange={onQueryChange}
      busy={busy}
    />,
    document.body,
  )
}

function PaletteDialog({
  groups,
  onClose,
  placeholder = 'Qidirish yoki buyruq…',
  onQueryChange,
  busy = false,
}: {
  readonly groups: readonly CommandGroup[]
  readonly onClose: () => void
  readonly placeholder?: string
  readonly onQueryChange?: (query: string) => void
  readonly busy?: boolean
}) {
  const [query, setQuery] = useState('')
  /*
    The selection remembers which QUERY it belongs to. Arrow keys write
    {query, index}; when the query has moved on, the stored index is stale by
    definition and the derived value below falls back to the top row. That
    makes "reset selection on every keystroke" a fact of the data instead of
    an effect that has to chase the input.
  */
  const [selection, setSelection] = useState<{ readonly q: string; readonly i: number }>({
    q: '',
    i: 0,
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const listId = `${id}-list`

  /**
   * Filter and flatten in one pass: `sections` keeps the grouped shape for
   * rendering, `flat` is what the keyboard walks — each row knows its flat
   * index, so hover and arrows move the same selection.
   */
  const { sections, flat } = useMemo(() => {
    const needle = normalize(query.trim())
    const sections: { label: string; rows: { item: CommandItem; index: number }[] }[] = []
    const flat: CommandItem[] = []

    for (const group of groups) {
      const rows: { item: CommandItem; index: number }[] = []
      for (const item of group.items) {
        if (
          !group.prefiltered &&
          needle &&
          !normalize(`${item.label} ${item.hint ?? ''}`).includes(needle)
        ) {
          continue
        }
        rows.push({ item, index: flat.length })
        flat.push(item)
      }
      if (rows.length > 0) sections.push({ label: group.label, rows })
    }

    return { sections, flat }
  }, [groups, query])

  /*
    The selection the render believes: the stored index if it still describes
    this query, the top row if not — clamped, because the filter can shrink
    the list under any index.
  */
  const active = Math.min(
    selection.q === query ? selection.i : 0,
    Math.max(0, flat.length - 1),
  )
  const setActive = (index: number) => setSelection({ q: query, i: index })

  /**
   * Focus discipline. On mount: remember the element that had focus (the ⌘K
   * chip, a table row — whatever) and move into the search box. On unmount:
   * give focus back, so the keyboard user is exactly where they were and not
   * dumped at the top of the document.
   */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => previous?.focus()
  }, [])

  // A modal over a scrollable page must own the wheel; otherwise arrowing
  // through results scrolls the dashboard behind the dim.
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = before
    }
  }, [])

  // Keep the keyboard selection on screen as it walks past the fold.
  useEffect(() => {
    document.getElementById(optionId(id, active))?.scrollIntoView({ block: 'nearest' })
  }, [active, id])

  const run = (item: CommandItem) => {
    // Close first: the cleanup restores focus to the opener, and only then
    // does the command run — so a navigation command leaves no focus stranded
    // inside a dialog that no longer exists.
    onClose()
    item.onSelect()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (flat.length > 0) setActive((active + 1) % flat.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (flat.length > 0) setActive((active - 1 + flat.length) % flat.length)
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(Math.max(0, flat.length - 1))
        break
      case 'Enter': {
        event.preventDefault()
        const item = flat[active]
        if (item) run(item)
        break
      }
      case 'Escape':
        event.preventDefault()
        onClose()
        break
      case 'Tab':
        // The trap. The input is the only tab stop by design — arrows walk
        // the list — so Tab has nowhere honest to go but out of the modal,
        // and out of the modal is what Esc is for.
        event.preventDefault()
        break
    }
  }

  return (
    <div
      className="backdrop-dim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[max(env(safe-area-inset-top),6vh)] sm:px-4 sm:pt-[15vh]"
      // Backdrop click closes — but only the backdrop itself: a click inside
      // the panel bubbles here too, and target === currentTarget tells them apart.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buyruqlar oynasi"
        className="palette-enter w-full max-w-[600px] overflow-hidden border"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          borderRadius: 'var(--radius-panel)',
          /* Ambient in dark (zero-offset glow), --shadow-float in light — the
             palette floats over a dimmed page, so it hums rather than falls. */
          boxShadow: 'var(--shadow-ambient)',
        }}
      >
        <div
          className="flex items-center gap-2.5 border-b px-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <span
            aria-hidden="true"
            className={busy ? 'palette-busy' : undefined}
            style={{ color: busy ? 'var(--ink-secondary)' : 'var(--ink-muted)' }}
          >
            <SearchGlyph size={15} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              onQueryChange?.(event.target.value)
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat.length > 0 ? optionId(id, active) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            // Borderless on purpose — the panel edge is the input's edge.
            // No .focusable either: focus is never anywhere else while the
            // palette is open, so a ring here would only add chrome.
            className="w-full bg-transparent py-3.5 text-[15px] outline-none"
            style={{ color: 'var(--ink-primary)' }}
          />
        </div>

        {/* The count, spoken. A filter that silently empties the list leaves a
            screen-reader user typing into the void. */}
        <p aria-live="polite" className="sr-only">
          {flat.length} ta natija
        </p>

        <div
          id={listId}
          role="listbox"
          aria-label="Buyruqlar"
          className="max-h-[min(400px,45dvh)] overflow-y-auto overscroll-contain p-1.5"
        >
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center">
              {/* "Nothing found" while the lookup is still running is a lie
                  that arrives before the truth and is read first. */}
              <p className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                {busy ? 'Qidirilmoqda…' : 'Hech narsa topilmadi'}
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {busy ? 'Bir soniya' : 'Telefon raqam, ID yoki ism bilan urinib koʻring'}
              </p>
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.label} role="group" aria-label={section.label}>
                <p
                  aria-hidden="true"
                  className="px-2.5 pt-2.5 pb-1 text-[11px] font-medium"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {section.label}
                </p>
                {section.rows.map(({ item, index }) => {
                  const isActive = index === active
                  return (
                    <div
                      key={item.id}
                      id={optionId(id, index)}
                      role="option"
                      aria-selected={isActive}
                      // mouseMOVE, not mouseenter: with mouseenter a parked
                      // cursor recaptures the selection every time the list
                      // scrolls under it, and the arrows fight the mouse.
                      onMouseMove={() => {
                        if (!isActive) setActive(index)
                      }}
                      // Keep the input focused through the click — the blur
                      // would land a frame before run() and flicker focus.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => run(item)}
                      className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5"
                      style={{ background: isActive ? 'var(--grid)' : 'transparent' }}
                    >
                      {item.icon && (
                        <span
                          aria-hidden="true"
                          className="inline-flex w-4 shrink-0 items-center justify-center"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          {item.icon}
                        </span>
                      )}
                      <span
                        className="truncate text-[13px] font-medium"
                        style={{ color: 'var(--ink-primary)' }}
                      >
                        {item.label}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-2.5">
                        {item.hint && (
                          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                            {item.hint}
                          </span>
                        )}
                        {item.keys && <Kbd keys={item.keys} />}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <footer
          className="flex items-center gap-4 border-t px-3.5 py-2 text-[11px]"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface-sunken)',
            color: 'var(--ink-muted)',
          }}
        >
          <span className="flex items-center gap-1.5">
            <Kbd keys={['up', 'down']} /> tanlash
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd keys={['enter']} /> ochish
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd keys={['esc']} /> yopish
          </span>
          <span className="tabular ml-auto">{flat.length} ta</span>
        </footer>
      </div>
    </div>
  )
}

/**
 * Binds ⌘K / Ctrl+K to `openFn`.
 *
 * Lives here so the palette and its shortcut ship together, but it is the
 * CALLER that mounts it (Shell) — the palette itself must not grab global
 * keys, or two palettes on a page would race for one keystroke.
 *
 * Editable targets are left alone: Ctrl+K has meanings inside inputs
 * (readline kill-to-end, editor link dialogs) that a dashboard has no
 * business shadowing while someone is typing.
 *
 * Pass a stable function (useCallback or a setState setter) — the listener
 * rebinds when the identity changes. Harmless, just wasteful.
 */
export function useCommandK(openFn: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.key || event.key.toLowerCase() !== 'k') return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.repeat) return

      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
        return
      }

      event.preventDefault()
      openFn()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openFn])
}
