'use client'

import { type ReactNode, useState } from 'react'

import { InfoTip } from '@/components/ui/Tooltip'
import { formatCompactUzs, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import type { RnpBlockDto, RnpRowDto, RnpUnit } from './rnpApi'
import { TableCard, muted } from '@/features/reklama/reklamaUi'

/**
 * One block of the «РНП» sheet: a metric per row, and across it the month's
 * plan, the daily plan, the fact, the forecast, the index, then every day.
 *
 * NOT `DataTable`. The sheet needs things a column-rendered table cannot say:
 * today's COLUMN washed from header to last row, and a row's days before its
 * `reliableFrom` drawn muted cell by cell. It borrows DataTable's classes
 * instead — `.thead-sticky`, `.tcol-sticky` — so it scrolls, pins and hovers
 * the way every other table in the product does.
 */
export function RnpBlockTable({
  block,
  days,
  today,
}: {
  block: RnpBlockDto
  days: readonly string[]
  today: string
}) {
  // The divider on the pinned column is drawn only once the days have moved.
  const [scrolledX, setScrolledX] = useState(false)
  const withShare = block.rows.some((r) => r.share !== null)
  const edge = `tcol-sticky is-edge${scrolledX ? ' is-scrolled-x' : ''}`

  return (
    <TableCard title={block.title} hint={block.subtitle ?? undefined}>
      <div
        className="relative overflow-x-auto pb-3"
        onScroll={(e) => {
          const next = e.currentTarget.scrollLeft > 0
          if (next !== scrolledX) setScrolledX(next)
        }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ color: 'var(--ink-muted)' }}>
              <th scope="col" className={`thead-sticky ${edge} py-2 pr-2 pl-5 text-left text-[11px] font-medium tracking-wide uppercase`}
                // `.tcol-sticky` paints the card; the corner belongs to the header band.
                style={{ left: 0, background: 'var(--surface-sunken)' }}
              >
                Koʻrsatkich
              </th>
              {SUMMARY.filter((c) => withShare || c.key !== 'share').map((c) => (
                <th key={c.key} scope="col" className="thead-sticky px-2 py-2 text-right text-[11px] font-medium tracking-wide whitespace-nowrap uppercase">
                  {c.header}
                </th>
              ))}
              {days.map((d, i) => {
                const isToday = d === today
                return (
                  <th
                    key={d}
                    scope="col"
                    aria-current={isToday ? 'date' : undefined}
                    className={`thead-sticky px-2 py-2 text-right text-[11px] font-medium whitespace-nowrap ${i === days.length - 1 ? 'pr-5' : ''}`}
                    style={isToday ? { background: TODAY_HEAD, color: 'var(--ink-primary)' } : undefined}
                  >
                    {Number(d.slice(8, 10))} {weekday(d)}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <Row key={row.key} row={row} days={days} today={today} withShare={withShare} edge={edge} />
            ))}
          </tbody>
        </table>
      </div>
    </TableCard>
  )
}

function Row({
  row,
  days,
  today,
  withShare,
  edge,
}: {
  row: RnpRowDto
  days: readonly string[]
  today: string
  withShare: boolean
  edge: string
}) {
  const total = row.tone === 'total'
  const unreliable = row.reliableFrom ? `Bitrix24 da bu maydon ${dayMonth(row.reliableFrom)} dan toʻliq` : undefined

  return (
    <tr
      className={`border-t transition-colors hover:bg-[var(--surface-sunken)] ${total ? 'font-semibold' : ''}`}
      style={{ borderColor: 'var(--border)' }}
    >
      <th
        scope="row"
        className={`${edge} min-w-[10rem] max-w-[12rem] py-2 pr-2 pl-5 text-left text-[13px] leading-snug sm:max-w-[20rem] ${total ? 'font-semibold' : 'font-medium'}`}
        style={{ left: 0, color: 'var(--ink-primary)' }}
      >
        <span className="inline-flex items-start gap-1">
          <span>{row.label}</span>
          {row.hint && <InfoTip content={row.hint} label={`${row.label} — izoh`} className="-my-0.5" />}
        </span>
      </th>
      <Cell>{full(row.plan, row.unit)}</Cell>
      <Cell>{full(row.dayPlan, row.unit)}</Cell>
      <Cell strong>{full(row.fact, row.unit)}</Cell>
      <Cell>{full(row.forecast, row.unit)}</Cell>
      <Cell>{index(row.index, row.better)}</Cell>
      {withShare && <Cell>{row.share === null ? dash : formatPercent(row.share)}</Cell>}
      {row.days.map((value, i) => {
        const day = days[i] ?? ''
        const early = row.reliableFrom !== null && day < row.reliableFrom
        return (
          <td
            key={day || i}
            title={early ? unreliable : undefined}
            className={`tabular px-2 py-2 text-right whitespace-nowrap ${i === days.length - 1 ? 'pr-5' : ''}`}
            style={{
              color: early ? 'var(--ink-muted)' : total ? 'var(--ink-primary)' : 'var(--ink-secondary)',
              background: day === today ? TODAY_CELL : undefined,
            }}
          >
            {compact(value, row.unit)}
          </td>
        )
      })}
    </tr>
  )
}

function Cell({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <td
      className="tabular px-2 py-2 text-right whitespace-nowrap"
      style={{ color: strong ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
    >
      {children}
    </td>
  )
}

// ---------------------------------------------------------------------------

const SUMMARY = [
  { key: 'plan', header: 'Reja' },
  { key: 'dayPlan', header: 'Kunlik reja' },
  { key: 'fact', header: 'Fakt' },
  { key: 'forecast', header: 'Prognoz' },
  { key: 'index', header: 'Indeks' },
  { key: 'share', header: 'Ulush' },
] as const

/** Today's column: the page accent, opaque in the header so rows cannot show through. */
const TODAY_HEAD = 'color-mix(in oklab, var(--accent) 14%, var(--surface-sunken))'
const TODAY_CELL = 'var(--accent-soft)'

const WEEKDAYS = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'] as const

/** «Du» for a Monday — read at noon UTC so no zone can move the date. */
function weekday(day: string): string {
  return WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()] ?? ''
}

/** `2026-09-16` → «16.09». */
function dayMonth(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`
}

const dash = <span style={muted}>—</span>

/** Dollars to one decimal, «$1,234.5». */
export function formatUsd(value: number): string {
  return `$${formatNumber(Math.round(value * 10) / 10)}`
}

/** The plan, fact and forecast columns: money to the last soʻm. */
function full(value: number | null, unit: RnpUnit): ReactNode {
  if (value === null) return dash
  if (unit === 'uzs') return formatFullUzs(value)
  return compact(value, unit)
}

/** A day cell: money compact («12.4 mln»), everything else as the column reads. */
function compact(value: number | null, unit: RnpUnit): ReactNode {
  if (value === null) return dash
  switch (unit) {
    case 'uzs':
      return formatCompactUzs(value)
    case 'usd':
      return formatUsd(value)
    case 'percent':
      return formatPercent(value)
    case 'count':
      return formatNumber(Math.round(value))
  }
}

/**
 * The index, coloured by which way is good. A cost (`better: 'down'`) under
 * its plan is on track; over it by a fifth is the alarm.
 */
function index(value: number | null, better: 'up' | 'down'): ReactNode {
  if (value === null) return dash
  const tone =
    better === 'up'
      ? value >= 100
        ? 'var(--status-good)'
        : value >= 80
          ? 'var(--status-warning)'
          : 'var(--status-critical)'
      : value <= 100
        ? 'var(--status-good)'
        : value <= 120
          ? 'var(--status-warning)'
          : 'var(--status-critical)'
  return (
    <span className="font-medium" style={{ color: tone }}>
      {formatPercent(value)}
    </span>
  )
}
