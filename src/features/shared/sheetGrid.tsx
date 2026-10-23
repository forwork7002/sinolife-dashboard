'use client'

import { type UIEvent, useLayoutEffect } from 'react'

import { dayMonth, isSunday, weekday } from '@/features/rnp/rnpDerive'

/**
 * THE MONTH SHEETS' SHARED FRAME — «KPI jadvali» and «Maosh jadvali» (the
 * client, 2026-10-23: «huddi shunday jadval usulida»), both drawn in the RNP
 * sheet's manner and on its CSS: `[data-rnp-grid]` with `.rnp-label`,
 * `.rnp-pin` and `.rnp-edge` (globals.css) pin the label and the summary
 * columns beside it, `[data-scrolled-x]` deepens the divider. What is here is
 * what the two sheets would otherwise each carry a copy of: the pinned
 * offsets, the column under the pointer, the day header, the colours.
 *
 * A sheet marks every cell of a figure column with `data-c` (its column
 * index, the header's too) — that is all the crosshair reads.
 */

/** The pinned block's divider deepens once the columns have moved under it. An attribute, not state. */
export function markScrolledX(e: UIEvent<HTMLDivElement>) {
  const box = e.currentTarget
  const scrolled = box.scrollLeft > 0
  if (scrolled !== box.hasAttribute('data-scrolled-x')) box.toggleAttribute('data-scrolled-x', scrolled)
}

/** Room the pinned block must leave for the scrolling columns; less and only the label pins. */
const ROOM_FOR_COLUMNS = 260

/**
 * Measures the first `pinned` header cells and writes each next one's `left`
 * on the box (`--sheet-left-1`, `--sheet-left-2` …, the label being 0), the
 * header's height (`--sheet-head-h`, under which a block's heading sticks),
 * and `data-pin-wide` when there is room to pin them all — on a phone only the
 * label pins, as on the RNP sheet. The frozen parts are the box's scroll
 * padding too, so «Bugun» brings today clear of them. Straight onto the DOM:
 * a resize re-measures without redrawing a cell.
 */
export function usePinnedColumns(ref: { readonly current: HTMLDivElement | null }, pinned: number) {
  useLayoutEffect(() => {
    const box = ref.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const heads = Array.from(box.querySelectorAll<HTMLElement>('thead th')).slice(0, pinned)
    if (heads.length === 0) return
    const measure = () => {
      const widths = heads.map((th) => th.getBoundingClientRect().width)
      let left = 0
      widths.forEach((w, i) => {
        if (i > 0) setVar(box, `--sheet-left-${i}`, `${left}px`)
        left += w
      })
      const wide = left + ROOM_FOR_COLUMNS <= box.clientWidth
      if (wide !== box.hasAttribute('data-pin-wide')) box.toggleAttribute('data-pin-wide', wide)
      const height = heads[0]!.getBoundingClientRect().height
      setVar(box, '--sheet-head-h', `${height}px`)
      box.style.scrollPaddingLeft = `${wide ? left : (widths[0] ?? 0)}px`
      box.style.scrollPaddingTop = `${height}px`
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    for (const th of heads) observer.observe(th)
    return () => observer.disconnect()
  }, [ref, pinned])
}

function setVar(box: HTMLElement, name: string, value: string): void {
  if (box.style.getPropertyValue(name) !== value) box.style.setProperty(name, value)
}

/**
 * THE COLUMN UNDER THE POINTER LIGHTS UP, the row's own hover does the rest
 * — a crosshair, so a figure thirty columns from its date and three hundred
 * pixels from its name is read without a ruler. One `<style>` rule rewritten
 * on the box, never React state: a re-render of a few thousand cells per
 * pointer move is the freeze the RNP sheet spent a day removing.
 */
export function crosshairHandlers(styleId: string) {
  let last: string | null = null
  const write = (column: string | null) => {
    if (column === last) return
    last = column
    const el = document.getElementById(styleId)
    if (!el) return
    el.textContent =
      column === null
        ? ''
        : `#${styleId}-box td[data-c="${column}"]{position:relative}` +
          `#${styleId}-box [data-c="${column}"]::after{content:"";position:absolute;inset:0;pointer-events:none;` +
          `background:color-mix(in oklab, var(--accent) 9%, transparent)}`
  }
  return {
    onPointerOver: (e: { target: EventTarget }) => {
      const cell = e.target instanceof Element ? e.target.closest('[data-c]') : null
      write(cell?.getAttribute('data-c') ?? null)
    },
    onPointerLeave: () => write(null),
  }
}

/** A day's header cell: the date, the weekday, today's accent, Sunday's shade, and a mark when the day differs. */
export function DayHead({
  day,
  today,
  column,
  last,
  flagged = false,
  flagTitle,
}: {
  day: string
  today: string
  /** The cell's `data-c`. */
  column: number
  last: boolean
  /** A small red dot under the date: something on this day does not agree. */
  flagged?: boolean
  flagTitle?: string
}) {
  const isToday = day === today
  const sunday = isSunday(day)
  return (
    <th
      scope="col"
      data-c={column}
      aria-current={isToday ? 'date' : undefined}
      title={isToday ? 'Bugun' : sunday ? 'Yakshanba' : undefined}
      className={`thead-sticky tabular ${RULE} min-w-[84px] px-3 py-1.5 text-right whitespace-nowrap ${last ? 'pr-5' : ''}`}
      style={isToday ? { background: TODAY_HEAD, color: 'var(--accent-ink)', boxShadow: TODAY_HEAD_RULE } : sunday ? { background: SUNDAY_HEAD } : undefined}
    >
      <span className={`block text-[13px] leading-tight ${isToday ? 'font-bold' : 'font-semibold'}`}>{dayMonth(day)}</span>
      <span className="flex items-center justify-end gap-1 text-[10px] leading-tight font-medium tracking-wide uppercase" style={isToday ? undefined : { color: 'var(--ink-muted)' }}>
        {flagged && (
          <span
            role="img"
            aria-label={flagTitle ?? 'farq bor'}
            title={flagTitle}
            className="inline-block size-[6px] rounded-full"
            style={{ background: 'var(--status-critical)' }}
          />
        )}
        {weekday(day)}
      </span>
    </th>
  )
}

/** A day cell's ground: today's accent column, Sunday's shade. */
export function dayCellStyle(day: string, today: string): { background?: string; boxShadow?: string } {
  if (day === today) return { background: TODAY_CELL, boxShadow: TODAY_RULE }
  return isSunday(day) ? { background: SUNDAY_CELL } : {}
}

/** A CSV in the browser's downloads — `;`-separated with a BOM, so Excel opens it into columns. */
export function downloadCsv(name: string, rows: readonly (readonly string[])[]): void {
  const cell = (text: string) => (/[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)
  const text = `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Colour — tokens only, mixed, so light and dark both carry it (the RNP sheet's)
// ---------------------------------------------------------------------------

export function mix(color: string, pct: number, base = 'transparent'): string {
  return `color-mix(in oklab, ${color} ${pct}%, ${base})`
}

/** Colours stacked as background layers, the first on top — over a pinned cell's own card colour. */
export function layers(...colors: (string | undefined)[]): string {
  return colors
    .filter((c): c is string => c !== undefined)
    .map((c) => `linear-gradient(${c}, ${c})`)
    .join(', ')
}

/** Text in a hue, pulled towards the ink so it reads on its own tint in either theme. */
export function inkOf(hue: string): string {
  return mix(hue, 68, 'var(--ink-primary)')
}

/** Every cell's rule: separate borders travel with a sticky cell, collapsed ones do not. */
export const RULE = 'border-b border-[var(--border)]'
export const RULE_STRONG = 'border-b border-[var(--border-strong)]'
/** The faint column rule between figures, for reading down a day. */
export const VRULE = 'border-r border-r-[var(--grid)]'
/** The pinned summary columns' header band and cells. */
export const SUMMARY_HEAD = mix('var(--accent)', 12, 'var(--surface-sunken)')
export const SUMMARY_CELL = mix('var(--ink-muted)', 5)
export const TODAY_HEAD = mix('var(--accent)', 24, 'var(--surface-sunken)')
export const TODAY_HEAD_RULE = 'inset 0 -2px 0 var(--accent)'
export const TODAY_CELL = mix('var(--accent)', 13)
export const TODAY_RULE = 'inset 1px 0 0 var(--accent-line), inset -1px 0 0 var(--accent-line)'
export const SUNDAY_HEAD = mix('var(--ink-muted)', 12, 'var(--surface-sunken)')
export const SUNDAY_CELL = mix('var(--ink-muted)', 6)
