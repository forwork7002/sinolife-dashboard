'use client'

import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref, useMemo, useRef } from 'react'

import { Button } from '@/components/ui/Button'

import {
  DEFAULT_WIDTH,
  RNP_COLUMN_KINDS,
  type RnpColumnKind,
  clampWidth,
  maxWidth,
  minWidth,
  resetColumnWidth,
  resetColumnWidths,
  setColumnWidth,
  useColumnWidths,
  useStoredWidth,
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
  ref,
}: {
  children: ReactNode
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  const widths = useColumnWidths()
  const style = useMemo(() => {
    const out: Record<string, string> = {}
    for (const kind of RNP_COLUMN_KINDS) {
      const px = widths[kind]
      if (px !== undefined) out[widthVar(kind)] = `${px}px`
    }
    return out as CSSProperties
  }, [widths])
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
  const drag = useRef<{ startX: number; startW: number; width: number; frame: number } | null>(null)

  /** The column's width as laid out now — the stored one, or the default CSS resolved to. */
  const current = (handle: HTMLElement): number => {
    const cell = handle.parentElement
    const measured = cell ? cell.getBoundingClientRect().width : 0
    return stored ?? (measured > 0 ? Math.round(measured) : DEFAULT_WIDTH[kind])
  }

  const scopeOf = (handle: HTMLElement): HTMLElement =>
    handle.closest<HTMLElement>('[data-rnp-cols]') ?? handle.closest<HTMLElement>('[data-rnp-grid]') ?? handle

  const show = (handle: HTMLElement, px: number) => {
    scopeOf(handle).style.setProperty(widthVar(kind), `${px}px`)
    handle.setAttribute('aria-valuenow', String(px))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    handle.setPointerCapture?.(e.pointerId)
    const startW = current(handle)
    drag.current = { startX: e.clientX, startW, width: startW, frame: 0 }
    handle.dataset.dragging = ''
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const handle = e.currentTarget
    d.width = clampWidth(kind, d.startW + e.clientX - d.startX)
    // One write per frame, however many moves the pointer reports.
    if (d.frame) return
    d.frame = requestAnimationFrame(() => {
      d.frame = 0
      show(handle, d.width)
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
    if (d.width === d.startW) return
    setColumnWidth(kind, d.width)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowRight' ? STEP : e.key === 'ArrowLeft' ? -STEP : 0
    if (delta === 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const next = clampWidth(kind, current(handle) + delta)
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

/**
 * «Kengliklarni tiklash» — every column back to its default. Disabled while
 * nothing is stored, so it never offers to undo what was never done. Its own
 * component so the page does not re-render when a width is committed.
 */
export function ResetColumnWidths() {
  const widths = useColumnWidths()
  const any = Object.keys(widths).length > 0
  return (
    <Button
      variant="ghost"
      className="max-sm:h-11"
      disabled={!any}
      onClick={() => {
        // The drag writes the properties by hand; take those off with the stored ones.
        for (const el of document.querySelectorAll<HTMLElement>('[data-rnp-cols], [data-rnp-grid]')) {
          for (const kind of RNP_COLUMN_KINDS) el.style.removeProperty(widthVar(kind))
        }
        resetColumnWidths()
      }}
    >
      Kengliklarni tiklash
    </Button>
  )
}
