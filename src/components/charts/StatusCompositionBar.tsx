'use client'

import { formatFullUzs, formatPercent } from '@/lib/format'

/**
 * Where a window's money stands, as one horizontal bar and a legend of data.
 *
 * HAND-DRAWN, NOT RECHARTS, and that is the point rather than a saving. This
 * is six fixed categories summing to one total: a stacked bar chart library
 * would bring an axis nobody reads, a tooltip that hides the numbers behind a
 * hover, and 379 KB of JavaScript to draw six divs. The legend below the bar
 * carries every figure in full, so the picture and the numbers are the same
 * object — a reader never has to hover to reconcile against the portal.
 *
 * NO MINIMUM SEGMENT WIDTH. A 0.1% segment is 0.1% wide and effectively
 * invisible, which is honest: its number is right there in the legend. Padding
 * small segments up to a legible minimum is how a composition bar starts
 * lying about the thing it exists to show.
 *
 * The segments arrive in the caller's order and are NEVER re-sorted by size —
 * «colour follows the entity, never its rank», and this bar's order is the
 * client's own funnel order so it reads the way their sheet reads.
 */

export interface CompositionSegment {
  readonly key: string
  readonly label: string
  readonly colour: string
  readonly amount: number
  readonly orders: number
  readonly sharePercent: number | null
}

export function StatusCompositionBar({
  segments,
  status,
  total,
}: {
  segments: readonly CompositionSegment[]
  status: 'loading' | 'error' | 'ready'
  /** The server's own total. The bar never re-sums the segments to get it. */
  total: number
}) {
  if (status === 'loading') {
    return (
      <div className="skeleton h-[136px] w-full rounded-lg" role="status">
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

  /*
    A window with no orders draws no bar and says so. An empty grey rail would
    read as "everything is in the first category", which is the one thing an
    empty month is not.
  */
  if (total <= 0) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
        Bu davrda buyurtma yoʻq.
      </p>
    )
  }

  return (
    <div>
      <div
        className="flex h-4 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--grid)' }}
        role="img"
        aria-label={segments.map((s) => `${s.label} ${formatPercent(s.sharePercent)}`).join(', ')}
      >
        {segments.map((segment) => {
          const width = (segment.amount / total) * 100
          if (width <= 0) return null
          return (
            <div
              key={segment.key}
              style={{ width: `${width}%`, background: segment.colour }}
              title={`${segment.label} · ${formatFullUzs(segment.amount)} soʻm`}
            />
          )
        })}
      </div>

      {/*
        THE LEGEND IS THE TABLE'S SHORT FORM, and it is also the phone
        rendering: at 360px the bar's small segments are a few pixels each and
        this list is what is actually read.
      */}
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-baseline gap-2 text-[12px]">
            <span
              aria-hidden
              className="mt-[3px] inline-block size-2 shrink-0 rounded-full"
              style={{ background: segment.colour }}
            />
            <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink-secondary)' }}>
              {segment.label}
            </span>
            <span className="tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {formatPercent(segment.sharePercent)}
            </span>
            <span
              className="w-[7.5rem] shrink-0 text-right tabular-nums"
              style={{ color: 'var(--ink-primary)' }}
            >
              {formatFullUzs(segment.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
