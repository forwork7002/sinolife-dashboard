import { formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import type { RnpBlockDto, RnpUnit } from './rnpApi'
import type { RnpColumnKind } from './rnpColumnWidths'

/**
 * How the «RNP» screen writes a figure, and how wide the grid must be to
 * write every one of them whole.
 *
 * FULL NUMBERS, EVERYWHERE (the client, 2026-09-29: «sonlar to'liq yozilishi
 * kerak … maksimal cho'zilsa ham farqi yo'q»). Soʻm is written to the last
 * soʻm in every grid cell, KPI card and team chip — «3,589,815,001», never
 * «3.6 mlrd». Only a chart's axis ticks stay compact, for the axis's room;
 * their tooltips are full. Nothing is re-rounded here: the rules below are
 * the ones the grid always used (a count to a whole number, dollars and
 * rates to one decimal).
 */

/** Dollars to one decimal, «$1,234.5». */
export function formatUsd(value: number): string {
  return `$${formatNumber(Math.round(value * 10) / 10)}`
}

/** A figure in its unit, in full. */
export function figureText(value: number, unit: RnpUnit): string {
  switch (unit) {
    case 'uzs':
      return formatFullUzs(value)
    case 'usd':
      return formatUsd(value)
    case 'percent':
      return formatPercent(value)
    case 'count':
      return formatNumber(Math.round(value))
  }
}

// ---------------------------------------------------------------------------

/**
 * The narrowest each column kind may be so that NO cell is clipped — the
 * widest figure that kind prints anywhere in the payload, plus the cell's
 * padding. Computed over EVERY block, not only the ones on screen, so the
 * columns stay in line from block to block and do not jump when a ROP is
 * picked.
 *
 * `measure` is the width of a string in the grid's figure font (a canvas in
 * the browser, see `canvasMeasure`). This is the layout's first answer, not
 * its only one: the table is `table-layout: auto`, so a cell the estimate
 * under-reads still widens its column rather than cutting the figure.
 */
export function contentMinWidths(
  blocks: readonly RnpBlockDto[],
  measure: (text: string, kind: 'figure' | 'pill') => number,
): Partial<Record<RnpColumnKind, number>> {
  const widest: Partial<Record<RnpColumnKind, string>> = {}
  const keep = (kind: RnpColumnKind, text: string) => {
    const now = widest[kind]
    if (now === undefined || text.length > now.length || (text.length === now.length && measure(text, 'figure') > measure(now, 'figure'))) {
      widest[kind] = text
    }
  }
  for (const block of blocks) {
    for (const row of block.rows) {
      if (row.plan !== null) keep('plan', figureText(row.plan, row.unit))
      if (row.dayPlan !== null) keep('dayPlan', figureText(row.dayPlan, row.unit))
      if (row.fact !== null) keep('fact', figureText(row.fact, row.unit))
      if (row.forecast !== null) keep('forecast', figureText(row.forecast, row.unit))
      if (row.index !== null) keep('index', formatPercent(row.index))
      for (const v of row.days) if (v !== null) keep('day', figureText(v, row.unit))
    }
  }

  const out: Partial<Record<RnpColumnKind, number>> = {}
  for (const [kind, text] of Object.entries(widest) as [RnpColumnKind, string][]) {
    // The index is a pill: its own 8px each side on top of the cell's.
    const inner = kind === 'index' ? measure(text, 'pill') + PILL_PADDING : measure(text, 'figure')
    // The last day column carries 8px more on its right (`pr-5`).
    out[kind] = Math.ceil(inner + CELL_PADDING + (kind === 'day' ? 8 : 0) + SLACK)
  }
  return out
}

/** `px-3` on each side. */
const CELL_PADDING = 24
const PILL_PADDING = 16
/** Rounding and sub-pixel glyph overhang. */
const SLACK = 4

/**
 * Width in the grid's own font: 14px Inter, semibold (the fact column and the
 * totals are the heaviest the grid draws, so the widest). Every digit is
 * measured as a «0», because the grid sets tabular figures and a canvas
 * cannot — tabular digits are all the width of the widest.
 */
export function canvasMeasure(fontFamily: string): (text: string, kind: 'figure' | 'pill') => number {
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  return (text, kind) => {
    const tabular = text.replace(/[0-9]/g, '0')
    if (!ctx) return tabular.length * (kind === 'pill' ? 8.2 : 8.8)
    ctx.font = `600 ${kind === 'pill' ? 13 : 14}px ${fontFamily}`
    return ctx.measureText(tabular).width
  }
}
