'use client'

import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref, useMemo, useRef } from 'react'


import {
  DEFAULT_WIDTH,
  RNP_COLUMN_KINDS,
  type RnpColumnKind,
  clampWidth,
  maxWidth,
  minWidth,
  resetColumnWidth,
  setColumnWidth,
  useColumnWidths,
  minVar,
  useStoredWidth,
  widthCss,
  widthVar,
} from './rnpColumnWidths'

/**
 * The element every «RNP» grid on the page reads its column widths from.
 *
 * The widths are CSS custom properties set HERE, once, and each grid's
 * `<col>` reads them (`widthCss`). That is the whole performance story of the
 * resize: a drag writes one property on this element per frame and the
 * browser re-lays the tables — React renders nothing until the pointer is
 * released, and then only this element's `style` and the handles of the kind
 * that changed. Forty blocks × twenty rows × thirty-six cells never re-render
 * for a width.
 *
 * Only STORED widths are set; the defaults are the `var()` fallbacks, except
 * the label column's, which is narrower under `sm`: the class below spells
 * out 168px / 240px because Tailwind cannot read a constant — keep the wide
 * one in step with `DEFAULT_WIDTH.label`.
 */
export function RnpColumnScope({
  children,
  className = '',
  minWidths,
  ref,
}: {
  children: ReactNode
  className?: string
  /** The narrowest each kind may be without clipping a figure (`contentMinWidths`). */
  minWidths?: Partial<Record<RnpColumnKind, number>>
  ref?: Ref<HTMLDivElement>
}) {
  const widths = useColumnWidths()
  const style = useMemo(() => {
    const out: Record<string, string> = {}
    for (const kind of RNP_COLUMN_KINDS) {
      const px = widths[kind]
      if (px !== undefined) out[widthVar(kind)] = `${px}px`
      const min = minWidths?.[kind]
      if (min !== undefined) out[minVar(kind)] = `${min}px`
    }
    return out as CSSProperties
  }, [widths, minWidths])
  return (
    <div
      ref={ref}
      data-rnp-cols=""
      className={`[--rnp-w-label:168px] sm:[--rnp-w-label:240px] ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}

const STEP = 8

/**
 * The drag handle on a header cell's right edge — a vertical `separator`,
 * which is what ARIA calls a focusable splitter with a value.
 *
 * Mouse, pen and touch alike through pointer events with capture, so a drag
 * that leaves the header keeps going; `touch-action: none` stops a finger's
 * drag from scrolling the table instead. ←/→ move it by 8px, a double click
 * puts the column back to its default.
 *
 * During the drag the width is written straight onto `RnpColumnScope`'s style
 * (see there) and committed to the store — and to storage — on release.
 *
 * `tabbable` is false for every day column but the first: all thirty move
 * together, and thirty tab stops per block, forty blocks deep, would make the
 * keyboard walk through the page unusable. Every handle still takes a pointer.
 */
export function ColumnResizer({
  kind,
  name,
  tabbable = true,
}: {
  kind: RnpColumnKind
  /** What the column is called, for the handle's label. */
  name: string
  tabbable?: boolean
}) {
  const stored = useStoredWidth(kind)
  const drag = useRef<{
    startX: number
    startW: number
    width: number
    floor: number
    frame: number
    /** The table's own width at the start, and the style it had — restored on release. */
    table: { el: HTMLTableElement; startW: number; style: string } | null
  } | null>(null)

  /**
   * The column's width as laid out now. Measured first: a stored width under
   * the widest figure is drawn at that figure's width, and a drag has to start
   * from what is on screen.
   */
  const current = (handle: HTMLElement): number => {
    const cell = handle.parentElement
    const measured = cell ? cell.getBoundingClientRect().width : 0
    return measured > 0 ? Math.round(measured) : (stored ?? DEFAULT_WIDTH[kind])
  }

  /** The widest figure this kind prints (`--rnp-min-*` on the scope), 0 when unknown. */
  const contentMin = (handle: HTMLElement): number => {
    const px = Number.parseFloat(getComputedStyle(scopeOf(handle)).getPropertyValue(minVar(kind)))
    return Number.isFinite(px) ? px : 0
  }

  /** The kind's width, clamped — and never under the widest figure it prints, so a drag cannot cut a number. */
  const clampFor = (px: number, floor: number): number => clampWidth(kind, Math.max(px, floor))

  const scopeOf = (handle: HTMLElement): HTMLElement =>
    handle.closest<HTMLElement>('[data-rnp-cols]') ?? handle.closest<HTMLElement>('[data-rnp-grid]') ?? handle

  const show = (handle: HTMLElement, px: number) => {
    scopeOf(handle).style.setProperty(widthVar(kind), `${px}px`)
    handle.setAttribute('aria-valuenow', String(px))
  }

  /*
    DURING A DRAG THE WIDTH GOES ON THE <col> ELEMENTS, NOT THE VARIABLE.
    The variable sits on the page wrapper and every one of the sheet's ~9 700
    cells inherits it, so changing it re-styles them all — 160–180 ms a frame
    on the full sheet (measured 2026-09-30). A <col>'s own width re-lays the
    table without touching a cell's style. The variable is written once, on
    release, and the columns go back to reading it.
  */
  const colsOf = (handle: HTMLElement) =>
    scopeOf(handle).querySelectorAll<HTMLTableColElement>(`col[data-col-kind="${kind}"]`)
  const showLive = (handle: HTMLElement, px: number) => {
    const cols = colsOf(handle)
    for (const col of cols) col.style.width = `${px}px`
    // The table's width is a sum of the variables; move it by hand too, or a
    // narrower column only hands its space back to the others until release.
    const t = drag.current?.table
    if (t) t.el.style.width = `${t.startW + (px - (drag.current?.startW ?? px)) * cols.length}px`
    handle.setAttribute('aria-valuenow', String(px))
  }
  const releaseCols = (handle: HTMLElement, table: { el: HTMLTableElement; style: string } | null) => {
    for (const col of colsOf(handle)) col.style.width = widthCss(kind)
    if (table) table.el.style.width = table.style
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    handle.setPointerCapture?.(e.pointerId)
    const startW = current(handle)
    const el = scopeOf(handle).querySelector('table')
    drag.current = {
      startX: e.clientX,
      startW,
      width: startW,
      floor: contentMin(handle),
      frame: 0,
      table: el ? { el, startW: el.getBoundingClientRect().width, style: el.style.width } : null,
    }
    handle.dataset.dragging = ''
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const handle = e.currentTarget
    d.width = clampFor(d.startW + e.clientX - d.startX, d.floor)
    // One write per frame, however many moves the pointer reports.
    if (d.frame) return
    d.frame = requestAnimationFrame(() => {
      d.frame = 0
      showLive(handle, d.width)
    })
  }

  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.frame) cancelAnimationFrame(d.frame)
    const handle = e.currentTarget
    delete handle.dataset.dragging
    handle.releasePointerCapture?.(e.pointerId)
    // Always settle the page on the final width: a frame already painted may
    // hold a width the drag later came back from.
    show(handle, d.width)
    releaseCols(handle, d.table)
    if (d.width === d.startW) return
    setColumnWidth(kind, d.width)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowRight' ? STEP : e.key === 'ArrowLeft' ? -STEP : 0
    if (delta === 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const next = clampFor(current(handle) + delta, contentMin(handle))
    show(handle, next)
    setColumnWidth(kind, next)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Ustun kengligi: ${name}`}
      aria-valuenow={stored ?? DEFAULT_WIDTH[kind]}
      aria-valuemin={minWidth(kind)}
      aria-valuemax={maxWidth(kind)}
      title="Kengligini oʻzgartirish uchun torting · ikki marta bosish — asl holi"
      tabIndex={tabbable ? 0 : -1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={(e) => {
        e.preventDefault()
        scopeOf(e.currentTarget).style.removeProperty(widthVar(kind))
        resetColumnWidth(kind)
      }}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.currentTarget.setAttribute('aria-valuenow', String(current(e.currentTarget)))}
      className={[
        'focusable group/rs absolute top-0 -right-px z-[4] flex h-full w-3 cursor-col-resize touch-none justify-end select-none',
        // A finger needs more than twelve pixels to find an edge.
        'pointer-coarse:w-6',
      ].join(' ')}
    >
      {/* The rule itself: a hairline at rest, the accent while pointed at, focused or dragged. */}
      <span
        aria-hidden="true"
        className={[
          'pointer-events-none h-full w-px bg-[var(--border-strong)] transition-[background-color,width] duration-150',
          'group-hover/rs:w-0.5 group-hover/rs:bg-[var(--accent)]',
          'group-focus-visible/rs:w-0.5 group-focus-visible/rs:bg-[var(--accent)]',
          'group-data-[dragging]/rs:w-0.5 group-data-[dragging]/rs:bg-[var(--accent)]',
        ].join(' ')}
      />
    </div>
  )
}
