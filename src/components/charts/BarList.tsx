'use client'

import type { ReactNode } from 'react'

import { formatCompactUzs, formatPercent } from '@/lib/format'

/**
 * Ranked magnitude list.
 *
 * A horizontal bar per row, sorted descending. This is the right form for
 * "revenue by product" or "revenue by source": the category labels are words
 * of varying length, which a vertical bar chart either rotates or truncates,
 * and the comparison people actually make is between neighbouring rows.
 *
 * ONE hue for the whole list. The bars encode a single measure, so they are a
 * magnitude scale, not eight categories — giving each row its own colour would
 * imply the rows are different KINDS of thing rather than different sizes of
 * the same thing.
 */

export interface BarListItem {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly sharePercent?: number | null
  readonly meta?: ReactNode
}

export function BarList({
  items,
  max,
  valueFormatter = formatCompactUzs,
  emptyLabel = 'Maʼlumot yoʻq',
}: {
  items: readonly BarListItem[]
  max?: number
  valueFormatter?: (value: number) => string
  emptyLabel?: string
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
        {emptyLabel}
      </p>
    )
  }

  const ceiling = max ?? Math.max(...items.map((i) => i.value), 1)

  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const width = ceiling <= 0 ? 0 : (item.value / ceiling) * 100

        return (
          <li key={item.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className="truncate text-xs font-medium"
                style={{ color: 'var(--ink-primary)' }}
                title={item.label}
              >
                {item.label}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {item.meta}
                <span className="tabular text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
                  {valueFormatter(item.value)}
                </span>
                {item.sharePercent !== undefined && (
                  <span
                    className="tabular w-11 text-right text-[11px]"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {item.sharePercent === null ? '—' : formatPercent(item.sharePercent, 0)}
                  </span>
                )}
              </span>
            </div>

            <div
              className="mt-1 h-2 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--track)' }}
              role="img"
              aria-label={`${item.label}: ${valueFormatter(item.value)}`}
            >
              <div
                className="grow-x h-full rounded-full"
                style={{
                  width: `${Math.max(width, item.value > 0 ? 1.5 : 0)}%`,
                  background: 'var(--series-1)',
                }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
