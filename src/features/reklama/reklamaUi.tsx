'use client'

import type { ReactNode } from 'react'

import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { formatDate, formatNumber, formatPercent } from '@/lib/format'
import { usd } from '@/features/target/targetTheme'

/**
 * The pieces the three «Reklama samarasi» sheets share: the day cell, the
 * figures printed the way the client's sheets print them, and the picker that
 * chooses which page or targetolog a day table shows.
 */

export type Status = 'loading' | 'error' | 'ready'

export const muted = { color: 'var(--ink-muted)' }

/** A row of a day table: one day, or the window's total at the foot. */
export interface DayRow<T> {
  readonly key: string
  /** `YYYY-MM-DD`, or null for the «Jami» row. */
  readonly date: string | null
  readonly cells: T
}

/** The day rows, then the total — the sheet's layout, «Итог» at the bottom. */
export function dayRows<T>(days: readonly (T & { date: string })[] | undefined, total: T | undefined): DayRow<T>[] {
  if (!days || !total || days.length === 0) return []
  return [
    ...days.map((d) => ({ key: d.date, date: d.date, cells: d })),
    { key: 'total', date: null, cells: total },
  ]
}

export function DayCell({ date }: { date: string | null }) {
  return date === null ? (
    <span className="eyebrow">Jami</span>
  ) : (
    <span className="whitespace-nowrap">{formatDate(`${date}T12:00:00Z`)}</span>
  )
}

/** A count, with a zero drawn as a quiet dash — the sheet leaves them blank. */
export function count(value: number): ReactNode {
  return value === 0 ? <span style={muted}>—</span> : formatNumber(value)
}

export function money(value: number | null): ReactNode {
  return value === null || value === 0 ? <span style={muted}>—</span> : usd(value)
}

export function pct(value: number | null): ReactNode {
  return value === null ? <span style={muted}>—</span> : formatPercent(value)
}

/**
 * Which slice a day table shows. A SegmentedControl in a scroll box, so seven
 * pages fit a phone without wrapping into a second row of buttons.
 */
export function SlicePicker<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
      <div className="inline-flex">
        <SegmentedControl<T> value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} />
      </div>
    </div>
  )
}

/** A dollar tile — the StatTile units are soʻm and counts. */
export function UsdTile({
  label,
  value,
  hint,
  status,
}: {
  label: string
  value: number | null
  hint?: string
  status: Status
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs" style={muted}>
        {label}
      </p>
      {status === 'loading' ? (
        <div className="skeleton h-7 w-28 rounded" />
      ) : (
        <p
          className="display tabular text-[22px] leading-tight font-semibold"
          style={{ color: 'var(--ink-primary)' }}
          title={value === null ? undefined : usd(value, true)}
        >
          {status === 'error' ? '—' : usd(value)}
        </p>
      )}
      {hint && (
        <p className="text-[11px]" style={muted}>
          {hint}
        </p>
      )}
    </Card>
  )
}

/** A card with a heading, a line under it, and a slot beside the heading. */
export function TableCard({
  title,
  hint,
  action,
  children,
  footer,
}: {
  title: string
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card className="min-w-0 p-0">
      <header className="flex min-w-0 flex-col gap-2 px-5 pt-4 pb-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            {title}
          </h3>
          {hint && (
            <p className="mt-0.5 text-xs" style={muted}>
              {hint}
            </p>
          )}
        </div>
        {action}
      </header>
      {children}
      {footer && (
        <footer className="px-5 pt-2 pb-4 text-[11px]" style={muted}>
          {footer}
        </footer>
      )}
    </Card>
  )
}
