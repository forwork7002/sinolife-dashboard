'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'

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

/*
  useLayoutEffect warns on the server, and this component renders there. The
  house cure is the same one Tooltip uses — see its note: by the time either
  runs in a browser they are equivalent, minus one frame, and the frame is what
  the layout variant is for.
*/
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

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
  /**
   * A control that narrows this column, drawn beside its header.
   *
   * The spreadsheet idiom, and the reason it is a slot rather than a config
   * object: what a column filters by is the caller's business — a checkbox
   * list of ROP names, a soʻm range — and every shape of it would otherwise
   * have to be described to a table that does not care. `ColumnFilter` in
   * `Controls` is what goes here.
   *
   * IT SITS OUTSIDE THE SORT BUTTON, never inside it. A button nested in a
   * button is invalid markup, and clicking the funnel would re-sort the table
   * on the way to opening the popover.
   */
  readonly filter?: ReactNode
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
  /**
   * The last row is a summary of the ones above it — pin it to the bottom of
   * the scroll box.
   *
   * The mirror of `.thead-sticky`. Only a BOUNDED table has a bottom to stick
   * to, which is the same condition `maxHeight` states above; every table has
   * one, `'60dvh'` by default. A sticky element with nothing to stick to
   * renders exactly where it already was, so a short table pays nothing.
   *
   * IGNORED WHILE `initialRows` HAS THE TABLE CAPPED. `slice(0, initialRows)`
   * takes from the FRONT, so under a cap the last VISIBLE row is an ordinary
   * data row — pinning it would put a lie exactly where the reader has been
   * taught to find the total.
   */
  readonly stickyLastRow?: boolean
  /**
   * How many LEADING columns stay put while the rest scroll sideways.
   *
   * For a table too wide for the screen — today Logistika's day sheet, which
   * pins its date. The confirmation queue pinned three and dropped them on
   * 2026-09-11 at the client's request. See `.tcol-sticky` in globals.css.
   *
   * COUNTED, NOT NAMED, and the count must cover a block that reads as one
   * thing: the identity of the row. Pinning half of an identity is worse than
   * pinning none of it.
   *
   * The offsets are MEASURED rather than taken from the declared widths — see
   * `useStickyOffsets` for why summing the widths leaves a visible gap — so a
   * pinned column needs no `width` of its own to sit in the right place.
   *
   * Zero and undefined both mean "nothing pinned", which is every other table
   * in the application — none of them pays a pixel or a class for this.
   */
  readonly stickyColumns?: number
  /**
   * Grab the rows with the mouse and drag them sideways.
   *
   * For a table far wider than the screen — the confirmation queue, 1 860px —
   * where the horizontal scrollbar is the only other way across and it sits
   * under the last row. Asked for on 2026-09-11: «mishka bilan oʻng tomonga
   * sursa oʻsha yerga qarab surilishi kerak». See `useDragScroll`.
   *
   * Opt-in: every other table keeps plain text selection under the mouse.
   */
  readonly dragScroll?: boolean
}

/** How far the mouse travels sideways before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 5

/** A press on one of these is the control's, never the start of a drag. */
const NOT_A_DRAG_HANDLE = 'button, a, input, select, textarea, label, summary, [contenteditable]'

/**
 * Drag the scroll box sideways with the mouse — the rows follow the hand, the
 * way a finger moves them on a phone.
 *
 * MOUSE ONLY. Touch and pen already pan a scroll box natively, and taking
 * their pointer events would fight the browser's own gesture.
 *
 * A PRESS IS NOT A DRAG UNTIL IT MOVES SIDEWAYS. Five pixels, and further
 * across than down: a click, a double-click on an ID to copy it, and a
 * vertical sweep selecting a column of text all behave exactly as before. Only
 * a sideways drag is taken — and the half-started text selection it began is
 * cleared, because the reader was moving the table and not choosing words.
 *
 * Nothing that is itself a control starts one (the eye that unmasks a phone,
 * a column filter), and neither do the scrollbars: a press there is the
 * browser's own drag, and the box's client area is what excludes them.
 *
 * THE CLICK THAT ENDS A DRAG IS SWALLOWED, in the capture phase, so letting go
 * over a clickable row does not open it.
 *
 * NATIVE LISTENERS ON THE BOX, not React props: a column filter's popover is
 * portalled, and React bubbles a portal's events through the component tree —
 * a press inside the popover would otherwise reach this box and start a drag.
 * The DOM only delivers what is really inside it.
 *
 * The box arrives as state for the reason `useStickyOffsets` gives: the table
 * renders a skeleton first, so a `useRef` would give the effect nothing to
 * re-run on when the real box attaches.
 */
function useDragScroll(enabled: boolean): {
  boxRef: (node: HTMLDivElement | null) => void
  canPan: boolean
  dragging: boolean
} {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [canPan, setCanPan] = useState(false)
  const [dragging, setDragging] = useState(false)
  const swallowClick = useRef(false)

  // Whether there is anywhere to drag TO — drives only the grab cursor, so a
  // table that fits its card never advertises a gesture that does nothing.
  useEffect(() => {
    if (!enabled || box === null) return
    const measure = () => setCanPan(box.scrollWidth > box.clientWidth + 1)
    measure()
    // jsdom has none, and the confirmation page's tests render this table.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    if (box.firstElementChild) observer.observe(box.firstElementChild)
    return () => observer.disconnect()
  }, [enabled, box])

  useEffect(() => {
    if (!enabled || box === null) return

    let press: { id: number; x: number; y: number; left: number } | null = null
    let panning = false

    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      if (box.scrollWidth <= box.clientWidth) return
      if (event.target instanceof Element && event.target.closest(NOT_A_DRAG_HANDLE)) return
      const rect = box.getBoundingClientRect()
      const onScrollbar =
        event.clientX - rect.left >= box.clientLeft + box.clientWidth ||
        event.clientY - rect.top >= box.clientTop + box.clientHeight
      if (onScrollbar) return
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.scrollLeft }
      panning = false
    }

    const onMove = (event: PointerEvent) => {
      if (press === null || event.pointerId !== press.id) return
      // Released outside the box before the drag began: no pointerup reached
      // us, so the first move back in with the button up ends the press.
      if ((event.buttons & 1) === 0) {
        press = null
        return
      }
      const dx = event.clientX - press.x
      if (!panning) {
        const dy = event.clientY - press.y
        if (Math.abs(dx) < DRAG_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return
        panning = true
        box.setPointerCapture(event.pointerId)
        window.getSelection()?.removeAllRanges()
        setDragging(true)
      }
      event.preventDefault()
      box.scrollLeft = press.left - dx
    }

    const onEnd = (event: PointerEvent) => {
      if (press === null || event.pointerId !== press.id) return
      if (panning) {
        swallowClick.current = true
        // The click, if one comes, is dispatched in this same turn; one that
        // never comes must not eat the next genuine click.
        setTimeout(() => {
          swallowClick.current = false
        }, 0)
        setDragging(false)
      }
      press = null
      panning = false
    }

    const onClick = (event: MouseEvent) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      event.preventDefault()
      event.stopPropagation()
    }

    box.addEventListener('pointerdown', onDown)
    box.addEventListener('pointermove', onMove)
    box.addEventListener('pointerup', onEnd)
    box.addEventListener('pointercancel', onEnd)
    box.addEventListener('click', onClick, true)
    return () => {
      box.removeEventListener('pointerdown', onDown)
      box.removeEventListener('pointermove', onMove)
      box.removeEventListener('pointerup', onEnd)
      box.removeEventListener('pointercancel', onEnd)
      box.removeEventListener('click', onClick, true)
      setDragging(false)
    }
  }, [enabled, box])

  return { boxRef: setBox, canPan: enabled && canPan, dragging }
}

/**
 * Where each pinned column starts, MEASURED from the laid-out header row.
 *
 * SUMMING THE DECLARED WIDTHS DOES NOT WORK, and the gap it leaves is visible.
 * A `width` on a table cell is a hint: `table-layout: auto` honours it only as
 * far as the content and the table's own width allow, and this table is
 * `w-full` over a `minWidth`, so the browser redistributes. Measured on the
 * confirmation queue on 2026-09-10 — РОП declared 116px and laid out at 113,
 * МИЖОЗ declared 140 and laid out at 153. Pinning the second column at the
 * DECLARED 116 while the first one really ends at 113 leaves a three-pixel
 * slot for the scrolling cells to show through, which is exactly the artefact
 * an opaque pinned cell exists to prevent.
 *
 * So the offsets come from the header cells themselves, which is the layout's
 * own answer. The scroll box is the offset parent (it is `relative`, for the
 * reason written at it) and the table starts flush inside it, so the distance
 * a column has to stick at is just the sum of the widths before it.
 *
 * AND THAT SUM MUST BE FRACTIONAL. `offsetLeft` is the same answer ROUNDED TO
 * A WHOLE PIXEL, and it reopens the very slot the paragraph above closed —
 * one third of a pixel wide instead of three, which is worse, because it does
 * not read as a mistake. A `w-full` table over a `minWidth` lays its columns
 * out at fractions: РОП at 113.44 and № at 56.72 puts САНА at 170.16, which
 * `offsetLeft` reports as 170 — so № really ends at 169.72 and САНА is pinned
 * a quarter-pixel to the RIGHT of it, and the scrolling cells show through
 * the seam. On the confirmation queue that printed a hairline down the header
 * and a column of stray glyph slivers down the rows, one per line of text
 * passing underneath. Reported from production on 2026-09-10.
 *
 * `getBoundingClientRect().width` keeps the fraction, and the widths are
 * ACCUMULATED rather than each cell's own position being read: a pinned cell
 * has already been SHIFTED by the sticky offset by the time this re-measures
 * from the observer, so its own `left` is no longer where the layout put it.
 * A width never moves. Accumulating them makes each pinned cell start exactly
 * where the one before it ends.
 *
 * That closes the geometry, and it is only half the cure — a boundary landing
 * between two device pixels is still a boundary, and a browser that snaps a
 * sticky cell's layer to a whole one can part the pair by a pixel however
 * exactly they were placed. So `.tcol-sticky` in globals.css bleeds each
 * pinned cell's own background one pixel to the RIGHT, under its neighbour.
 * Neither half is redundant: without the fraction the gap is real and can be
 * wider than the bleed, without the bleed the last fraction of a pixel still
 * lets the rows underneath tint the seam.
 *
 * A LAYOUT EFFECT, so the offsets are applied in the same frame the table is
 * first painted in — a `useEffect` would paint one frame of unpinned columns.
 * The observer re-measures when the window, the sidebar or the content changes
 * a column's width; it watches the header ROW, which is the element whose box
 * changes when any of its cells do.
 *
 * THE ROW ARRIVES AS STATE, NOT AS A REF, and that is not a style choice. This
 * component returns a skeleton before it returns a table, so on the render the
 * effect first runs there is no header row to measure — and a `useRef` gives
 * the effect nothing to depend ON, so it never ran again once the rows landed
 * and the columns were never pinned at all. A callback ref sets state when the
 * node attaches, which is a dependency the effect can see.
 *
 * @returns One entry per column: the pixel offset for a pinned one, null for
 *   every other. Empty until the first measurement, so nothing is pinned to a
 *   guess.
 */
function useStickyOffsets(
  count: number,
  columnCount: number,
): { headRef: (node: HTMLTableRowElement | null) => void; offsets: (number | null)[] } {
  const [headRef, setHeadRef] = useState<HTMLTableRowElement | null>(null)
  const [measured, setMeasured] = useState<number[]>([])

  useIsomorphicLayoutEffect(() => {
    const row = headRef
    if (count <= 0 || row === null) {
      // Not a no-op: a table that loses its pinning must not keep the last
      // offsets it measured while it had some.
      setMeasured((previous) => (previous.length === 0 ? previous : []))
      return
    }

    const measure = () => {
      const cells = [...row.children] as HTMLElement[]
      // The base is the first cell's own position — 0 while the table sits
      // flush inside the scroll box, which it does; read rather than assumed
      // so an inset table would still pin against its own left edge.
      let left = cells[0]?.offsetLeft ?? 0
      const next = cells.slice(0, count).map((cell) => {
        const start = left
        left += cell.getBoundingClientRect().width
        return start
      })
      // Same numbers, same array: this runs from a ResizeObserver, and setting
      // fresh state on every observation would re-render the table on every
      // frame of a window drag.
      setMeasured((previous) =>
        previous.length === next.length && previous.every((value, i) => value === next[i])
          ? previous
          : next,
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [count, columnCount, headRef])

  const offsets = Array.from({ length: columnCount }, (_, i) =>
    i < measured.length ? measured[i]! : null,
  )

  return { headRef: setHeadRef, offsets }
}

/**
 * The classes a cell needs to be pinned, and nothing at all when it is not.
 *
 * An empty string for every column of every other table in the application:
 * the pinning costs a class only where it is asked for.
 */
function pinClass(left: number | null, isEdge: boolean, scrolledX: boolean): string {
  if (left === null) return ''
  // The divider belongs to the LAST pinned column and only once the rows have
  // moved — see `.tcol-sticky` in globals.css.
  return `tcol-sticky${isEdge ? ' is-edge' : ''}${isEdge && scrolledX ? ' is-scrolled-x' : ''}`
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
  stickyLastRow,
  stickyColumns = 0,
  dragScroll = false,
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
  /*
    The same reading for the OTHER axis, and it is a separate one on purpose: a
    table can be scrolled down without being scrolled across, and each rule
    belongs to the edge that has actually moved. Read from the same event, so
    the pair costs one handler and no extra listener.
  */
  const [scrolledX, setScrolledX] = useState(false)

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const isScrolled = event.currentTarget.scrollTop > 0
    if (isScrolled !== scrolled) setScrolled(isScrolled)
    /*
      Only measured when something is actually pinned. Without pinned columns
      the class it drives is on nothing, so reading it would be a state update
      per horizontal scroll of every table in the application for no paint.
    */
    if (stickyColumns > 0) {
      const isScrolledX = event.currentTarget.scrollLeft > 0
      if (isScrolledX !== scrolledX) setScrolledX(isScrolledX)
    }
  }

  const { headRef, offsets: pinnedLeft } = useStickyOffsets(stickyColumns, columns.length)
  /*
    The last column that is actually pinned — the one that carries the divider.
    Found rather than assumed to be `stickyColumns - 1`, because before the
    first measurement lands there is nothing pinned at all.
  */
  const lastPinned = pinnedLeft.reduce((last, offset, i) => (offset === null ? last : i), -1)

  const { boxRef, canPan, dragging } = useDragScroll(dragScroll)

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

  /*
    A TABLE WHOSE COLUMNS CARRY FILTERS KEEPS ITS HEADER WHEN IT IS EMPTY.

    The header is where those filters live. Returning the bare empty state
    took the funnels with it, so a column filter that emptied the table — a
    region nobody ordered from this month — left a board saying «clear the
    filters» with the control that set them gone from the screen. Seen on the
    confirmation queue, 2026-09-11. Every other table keeps the bare state.
  */
  const filterable = columns.some((column) => column.filter)
  if (rows.length === 0 && !filterable) {
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
      ref={boxRef}
      className="relative -mx-1 overflow-x-auto"
      style={{
        maxHeight,
        overflowY: 'auto',
        // Only where a drag can go somewhere — see `useDragScroll`. No text is
        // selected mid-drag; between drags selection works as it always has.
        ...(canPan && { cursor: dragging ? 'grabbing' : 'grab' }),
        ...(dragging && { userSelect: 'none' as const }),
      }}
      onScroll={onScroll}
    >
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          {/* `.thead-sticky` sits on the CELLS, not the row: sticky rendering
              on <tr> is still uneven across engines, while cells pin
              everywhere and their contiguous backgrounds read as one band.
              The sunken background keeps a long table's header distinct from
              its rows — and opaque, so rows cannot show through mid-scroll. */}
          <tr ref={headRef} style={{ color: 'var(--ink-muted)' }}>
            {columns.map((column, index) => {
              const sortable = Boolean(column.sortKey && onSort)
              const active = column.sortKey && sort === column.sortKey
              const left = pinnedLeft[index]

              return (
                <th
                  key={column.key}
                  scope="col"
                  style={left === null ? { width: column.width } : { width: column.width, left }}
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
                  className={`thead-sticky ${scrolled ? 'is-scrolled' : ''} ${pinClass(left, index === lastPinned, scrolledX)} px-2 py-2 text-[11px] font-medium tracking-wide uppercase ${
                    column.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {/*
                    A flex line ONLY when there is a filter to place. Every
                    header without one keeps the plain text node it has always
                    had, so no existing table's header can shift by a pixel —
                    `inline-flex` on a right-aligned numeric header would have
                    changed where the label sits.
                  */}
                  <span
                    className={
                      column.filter
                        ? `inline-flex max-w-full items-center gap-0.5 ${
                            column.align === 'right' ? 'justify-end' : ''
                          }`
                        : undefined
                    }
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
                  {column.filter}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {visible.map((row, index) => {
            /*
              `!capped` is the whole of the guard the prop documents: under an
              `initialRows` cap the last visible row is an ordinary data row,
              and pinning it would put a lie where the reader looks for the
              total.
            */
            const pinned = stickyLastRow === true && !capped && index === visible.length - 1

            return (
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
              {columns.map((column, colIndex) => {
                const Cell = column.rowHeader ? 'th' : 'td'
                const left = pinnedLeft[colIndex]
                const ink = column.rowHeader ? 'var(--ink-primary)' : 'var(--ink-secondary)'
                return (
                  <Cell
                    key={column.key}
                    scope={column.rowHeader ? 'row' : undefined}
                    /* `.tfoot-sticky` sits on the CELLS and not the row, for
                       the same reason `.thead-sticky` does above — and so does
                       `.tcol-sticky`, which is the same idea turned ninety
                       degrees. A cell in the bottom-left corner of a table with
                       both wears both, which is why neither sets `position`
                       twice over the other. */
                    className={`${pinned ? 'tfoot-sticky ' : ''}${pinClass(left, colIndex === lastPinned, scrolledX)} px-2 py-2.5 ${
                      column.rowHeader ? 'font-medium' : 'font-normal'
                    } ${column.align === 'right' ? 'text-right' : 'text-left'} ${
                      column.numeric ? 'tabular' : ''
                    }`}
                    // Row identity leads: the name column in primary ink, the
                    // figures beside it a step quieter.
                    style={left === null ? { color: ink } : { color: ink, left }}
                  >
                    {column.render(row)}
                  </Cell>
                )
              })}
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>

    {rows.length === 0 && <EmptyState title={emptyTitle} body={emptyBody} />}

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
