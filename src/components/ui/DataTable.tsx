'use client'

import { useState, type ReactNode, type UIEvent } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { t } from '@/lib/messages'
import { Button } from '@/components/ui/Button'
import { SortCaretGlyph } from '@/components/ui/Icons'

/**
 * Generic data table.
 *
 * Deliberately not a grid library. What these pages need is sortable headers,
 * alignment and a scroll container — a full grid would add a large dependency
 * and take over sorting and pagination, both of which happen server-side here
 * because the result sets are larger than the page.
 *
 * Wide tables scroll inside their own container so the page body never scrolls
 * horizontally on a laptop.
 */

export interface Column<T> {
  readonly key: string
  readonly header: string
  /** Column this maps to in the API's sort allowlist. Omit to disable sorting. */
  readonly sortKey?: string
  readonly align?: 'left' | 'right'
  /** Numbers that must line up vertically get tabular figures. */
  readonly numeric?: boolean
  readonly width?: string
  /**
   * Render this column as `<th scope="row">`.
   *
   * A table of 144 rows where every cell is a `<td>` has nothing to announce a
   * row BY — a screen reader reads "576 mln" with no idea whose it is. One
   * column per table should be the row's name.
   *
   * The same column leads visually too: primary ink, medium weight. Row
   * identity is what the eye returns to after every number, so it gets the
   * strongest text in the row body.
   */
  readonly rowHeader?: boolean
  readonly render: (row: T) => ReactNode
}

interface DataTableProps<T> {
  readonly columns: readonly Column<T>[]
  readonly rows: readonly T[]
  readonly rowKey: (row: T) => string
  readonly status: 'loading' | 'error' | 'ready'
  readonly errorMessage?: string
  readonly onRetry?: () => void
  readonly onRowClick?: (row: T) => void
  readonly sort?: string
  readonly order?: 'asc' | 'desc'
  readonly onSort?: (sortKey: string) => void
  readonly emptyTitle?: string
  readonly emptyBody?: string
  readonly minWidth?: number
  /**
   * Rows shown before the rest go behind a disclosure.
   *
   * A table with no cap is a table that trusts its data source to be small.
   * The leaderboard's was not: 288 employees produced a 17,400-pixel page —
   * seventeen metres of scroll on a ranking screen — and 162 of those rows
   * were all zeros. The employee list was 16,605px for the same reason.
   *
   * Undefined means no cap, which is right for a table whose length is bounded
   * by something real (twenty regions, nine pipelines).
   */
  readonly initialRows?: number
  /** Label for the disclosure, given the number of rows it hides. */
  readonly moreLabel?: (hidden: number) => string
  /**
   * Cap the table's height and scroll the rows INSIDE the container.
   *
   * Only with a bounded height does the sticky header have anything to stick
   * to — the header cells pin to the container's top edge and the rows slide
   * under them.
   *
   * DEFAULTS TO 60% OF THE SCREEN. The application is exactly one viewport
   * tall and never scrolls as a page, so a table taller than the screen has to
   * scroll inside its own card or its bottom rows can only be reached by
   * scrolling the whole content column past the card's own heading. Sixty
   * percent leaves the page title, the period control and the table's own
   * header on screen while the rows move under them. A short table is
   * unaffected — a cap on a box that is already smaller than it does nothing.
   *
   * A number is pixels; a string is any CSS length, for a caller that wants a
   * different relation to the viewport.
   */
  readonly maxHeight?: number | string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  status,
  errorMessage,
  onRetry,
  onRowClick,
  sort,
  order,
  onSort,
  emptyTitle,
  emptyBody,
  minWidth = 720,
  initialRows,
  moreLabel = (hidden) => `Yana ${hidden} ta qatorni koʻrsatish`,
  maxHeight = '60dvh',
}: DataTableProps<T>) {
  const [expanded, setExpanded] = useState(false)
  /*
    Whether the rows have moved under the header. The hairline under a resting
    header belongs to the first row and scrolls away with it; `.is-scrolled`
    puts one back as a shadow so the header reads as floating — which is what
    it is then actually doing. State, not a class toggle by hand, so React
    owns the DOM as usual.
  */
  const [scrolled, setScrolled] = useState(false)

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const isScrolled = event.currentTarget.scrollTop > 0
    if (isScrolled !== scrolled) setScrolled(isScrolled)
  }

  if (status === 'error') {
    return <ErrorState message={errorMessage} onRetry={onRetry} />
  }

  if (status === 'loading') {
    /*
      SHAPED LIKE THE TABLE IT STANDS FOR. The generic LoadingSkeleton is six
      16px text lines — about 150px standing in for a 300px+ table, so every
      table page jumped when data landed. A header bar plus six row-height
      bars occupies what the loaded table will, and the ready swap stops
      moving the page.
    */
    return (
      <div className="px-1 py-2" role="status" aria-label={t.state.loading}>
        <div className="skeleton h-[30px] w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton mt-2 h-[34px]" style={{ width: `${100 - i * 4}%` }} />
        ))}
        <span className="sr-only">{t.state.loading}</span>
      </div>
    )
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} />
  }

  const capped = initialRows !== undefined && !expanded && rows.length > initialRows
  const visible = capped ? rows.slice(0, initialRows) : rows
  const hidden = rows.length - visible.length

  /*
    Collapsed to nothing means SHOW nothing but the disclosure.

    The zero-rows-visible cap (the unranked-employees card) rendered a full
    column header row above a lone button — eight headings describing no data,
    which reads as a table that failed to load rather than one waiting to be
    asked.
  */
  if (capped && visible.length === 0) {
    return (
      <Button variant="secondary" size="sm" className="w-full" onClick={() => setExpanded(true)}>
        {moreLabel(hidden)}
      </Button>
    )
  }

  const headerGlyphDirection: 'asc' | 'desc' = order === 'asc' ? 'asc' : 'desc'

  return (
    <>
      {/*
        `relative`, and it is load-bearing rather than tidy.

        Overflow clips a descendant only while the scroll box is also its
        containing block. This one was `position: static`, so every
        absolutely-positioned thing inside the table — starting with the
        `sr-only` reading AnimatedNumber puts beside each figure — resolved
        against the CARD instead and escaped the clip entirely. Measured on
        production at 360px: the confirmation table is 2 221px wide, and four
        one-pixel sr-only spans sitting at its far right made `main` 2 034px
        wide against a 328px viewport. Nothing looked wrong — `main` hides its
        overflow — but the page was 1 674px wider than the phone holding it.
      */}
    <div
      className="relative -mx-1 overflow-x-auto"
      style={{ maxHeight, overflowY: 'auto' }}
      onScroll={onScroll}
    >
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          {/* `.thead-sticky` sits on the CELLS, not the row: sticky rendering
              on <tr> is still uneven across engines, while cells pin
              everywhere and their contiguous backgrounds read as one band.
              The sunken background keeps a long table's header distinct from
              its rows — and opaque, so rows cannot show through mid-scroll. */}
          <tr style={{ color: 'var(--ink-muted)' }}>
            {columns.map((column) => {
              const sortable = Boolean(column.sortKey && onSort)
              const active = column.sortKey && sort === column.sortKey

              return (
                <th
                  key={column.key}
                  scope="col"
                  style={{ width: column.width }}
                  // aria-sort belongs on the header cell, not on the button
                  // inside it — the column is what is sorted, not the control.
                  aria-sort={
                    sortable
                      ? active
                        ? order === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined
                  }
                  className={`thead-sticky ${scrolled ? 'is-scrolled' : ''} px-2 py-2 text-[11px] font-medium tracking-wide uppercase ${
                    column.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort!(column.sortKey!)}
                      className="focusable inline-flex items-center gap-1 rounded transition-colors hover:opacity-80"
                      style={{ color: active ? 'var(--ink-primary)' : 'inherit' }}
                    >
                      {column.header}
                      {/* The caret is only rendered for the active column;
                          showing one on every header is visual noise. It is
                          ONE chevron that turns over when the direction flips
                          — see SortCaretGlyph — so re-sorting reads as a
                          change of direction, not a swap of icons. */}
                      {active && (
                        <SortCaretGlyph
                          direction={headerGlyphDirection}
                          size={11}
                          className="shrink-0"
                        />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {visible.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              /*
                A clickable row has to say so.

                It was reachable by Tab and operable by Enter, but announced as
                a plain table row — so a screen-reader user landed on something
                focusable with no indication of what it was or that Space would
                do anything. Space is what a control is expected to answer to,
                and it has to be prevented from scrolling the page first.
              */
              role={onRowClick ? 'button' : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onRowClick(row)
                      }
                    }
                  : undefined
              }
              /*
                Every row highlights under the pointer, clickable or not.

                In a 25-column-wide table the eye tracks a row across half a
                metre of screen; the wash under the cursor is what keeps the
                reading position. Clickable rows get the stronger grid tone so
                affordance still reads as affordance.
              */
              className={`focusable border-t transition-colors ${
                onRowClick
                  ? 'cursor-pointer hover:bg-[var(--grid)]'
                  : 'hover:bg-[var(--surface-sunken)]'
              }`}
              style={{ borderColor: 'var(--border)' }}
            >
              {columns.map((column) => {
                const Cell = column.rowHeader ? 'th' : 'td'
                return (
                  <Cell
                    key={column.key}
                    scope={column.rowHeader ? 'row' : undefined}
                    className={`px-2 py-2.5 ${
                      column.rowHeader ? 'font-medium' : 'font-normal'
                    } ${column.align === 'right' ? 'text-right' : 'text-left'} ${
                      column.numeric ? 'tabular' : ''
                    }`}
                    // Row identity leads: the name column in primary ink, the
                    // figures beside it a step quieter.
                    style={{
                      color: column.rowHeader ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                    }}
                  >
                    {column.render(row)}
                  </Cell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {hidden > 0 && (
      <Button
        variant="secondary"
        size="sm"
        className="mt-2 w-full"
        onClick={() => setExpanded(true)}
      >
        {moreLabel(hidden)}
      </Button>
    )}
    </>
  )
}

/**
 * The 24px initial chip for people tables.
 *
 * A name column of bare text rows gives the eye nothing to land on; a chip
 * per person anchors each row the way an avatar would, without pretending we
 * have photographs. Neutral chrome tones on purpose — a person is not a
 * series, and colouring initials from the palette would invent categories.
 *
 * `aria-hidden`: the chip repeats the first letter of the name printed right
 * beside it, so for a screen reader it is decoration.
 */
export function InitialChip({ name, className = '' }: { name: string; className?: string }) {
  const chars = [...name.trim()]
  // Uzbek initials: oʻ / gʻ are one letter spelled with U+02BB — keep the
  // modifier with its base so "Oʻktam" chips as "Oʻ", not a bare "O".
  const initial = ((chars[0] ?? '·') + (chars[1] === 'ʻ' ? 'ʻ' : '')).toUpperCase()

  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${className}`}
      style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
    >
      {initial}
    </span>
  )
}
