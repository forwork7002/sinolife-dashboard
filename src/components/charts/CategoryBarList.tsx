'use client'

import { formatPercent } from '@/lib/format'

/**
 * A short list of named categories, drawn as bars beside their own numbers.
 *
 * HAND-DRAWN, AND FOR THE SAME REASON `StatusCompositionBar` IS: eight fixed
 * rows compared against each other need a bar and a number, not a chart
 * library. It works at 360px, it prints, it needs no absolute-fill sandwich,
 * and every figure stays on screen instead of behind a hover.
 *
 * TWO MODES, AND THE DIFFERENCE IS THE DENOMINATOR:
 *
 *   magnitude — the bar is the value against the largest value in the list.
 *               One hue for every row, because the rows are the same KIND of
 *               thing and colouring them differently would imply a category
 *               that is not there.
 *
 *   rate      — the bar is a percentage of its own hundred, graded on the
 *               house thresholds (85 / 60) so it agrees with every Meter and
 *               RingGauge on the dashboard. Null renders an em dash and no
 *               bar: «nothing has resolved yet» is not «zero per cent».
 *
 * STACKED PANELS, NEVER A SECOND AXIS. Two of these under one heading, in the
 * SAME row order, is how volume and rate are compared here — a dual-axis chart
 * can be rescaled to imply any relationship between them, which is why this
 * codebase forbids one. The second panel must NOT be re-sorted: the whole
 * mechanism is that the reader's eye runs straight down one column of labels.
 */

export interface CategoryBarRow {
  readonly key: string
  readonly label: string
  /** The bar's value. In `rate` mode a percentage, or null for "no answer yet". */
  readonly value: number | null
  /** Printed at the right, already formatted. */
  readonly display: string
  /** A second line under the label — order counts, median days. */
  readonly meta?: string
}

function toneFor(value: number | null): string {
  if (value === null) return 'var(--axis)'
  if (value >= 85) return 'var(--status-good)'
  if (value >= 60) return 'var(--status-warning)'
  return 'var(--status-critical)'
}

export function CategoryBarList({
  rows,
  mode,
  status,
  emptyBody,
}: {
  rows: readonly CategoryBarRow[]
  mode: 'magnitude' | 'rate'
  status: 'loading' | 'error' | 'ready'
  emptyBody?: string
}) {
  if (status === 'loading') {
    return (
      <div className="skeleton h-[220px] w-full rounded-lg" role="status">
        <span className="sr-only">Yuklanmoqda</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--status-critical)' }}>
        Olinmadi
      </p>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
        {emptyBody ?? 'Maʼlumot yoʻq.'}
      </p>
    )
  }

  /*
    The magnitude scale is the list's own maximum, not the window's total: this
    panel answers "which of these is biggest", and scaling eight post offices
    against ЗАКАЗ would flatten all of them into slivers. The composition bar
    above is the one that answers the share question.
  */
  const peak =
    mode === 'magnitude'
      ? Math.max(1, ...rows.map((row) => (row.value === null ? 0 : row.value)))
      : 100

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const value = row.value
        const width = value === null ? 0 : Math.min(100, (value / peak) * 100)
        const colour = mode === 'rate' ? toneFor(value) : 'var(--seq-450)'
        return (
          <li key={row.key}>
            <div className="flex items-baseline gap-3">
              <span
                className="min-w-0 flex-1 truncate text-[12.5px]"
                style={{ color: 'var(--ink-secondary)' }}
                title={row.label}
              >
                {row.label}
              </span>
              <span
                className="shrink-0 text-[12.5px] tabular-nums"
                style={{ color: value === null ? 'var(--ink-muted)' : 'var(--ink-primary)' }}
              >
                {mode === 'rate' ? formatPercent(value) : row.display}
              </span>
            </div>
            <div
              className="mt-1 h-2 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--grid)' }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${width}%`, background: colour }}
              />
            </div>
            {row.meta && (
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {row.meta}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
