'use client'

import { type ReactNode, useId, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { ChevronDownGlyph } from '@/components/ui/Icons'
import { InfoTip } from '@/components/ui/Tooltip'
import { formatCompactUzs, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import type { RnpBlockDto, RnpRowDto, RnpUnit } from './rnpApi'
import { type RnpTone, dayMonth, dayTone, indexTone, isSunday, weekday } from './rnpDerive'
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
 *
 * THE DAYS READ AGAINST THE DAY PLAN. An additive row with a plan tints each
 * finished day faintly — under 80% of the day's share critical, under 100%
 * warning, at or over it good (mirrored for a cost) — so a bad week is found
 * without reading thirty numbers. A row with no plan is never tinted: there
 * is nothing to be under. Sundays are shaded, and the box scrolls on both
 * axes so the day header stays pinned over a long block.
 *
 * `collapsible` turns the heading into a disclosure button; the grid is not
 * rendered at all while closed, and the one-line `summary` stands in for it.
 */
export function RnpBlockTable({
  block,
  days,
  today,
  collapsible,
}: {
  block: RnpBlockDto
  days: readonly string[]
  today: string
  collapsible?: { readonly summary: ReactNode; readonly defaultOpen?: boolean }
}) {
  if (collapsible) {
    return (
      <Collapsible block={block} summary={collapsible.summary} defaultOpen={collapsible.defaultOpen ?? false}>
        <Grid block={block} days={days} today={today} />
      </Collapsible>
    )
  }
  return (
    <TableCard title={block.title} hint={block.subtitle ?? undefined}>
      <Grid block={block} days={days} today={today} />
    </TableCard>
  )
}

function Collapsible({
  block,
  summary,
  defaultOpen,
  children,
}: {
  block: RnpBlockDto
  summary: ReactNode
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  const bodyId = `${id}-body`
  const titleId = `${id}-title`
  const subId = `${id}-sub`
  const sumId = `${id}-sum`
  return (
    <Card className="min-w-0 p-0">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          // Named by the title alone; the subtitle and the folded figures describe it.
          aria-labelledby={titleId}
          aria-describedby={block.subtitle ? `${subId} ${sumId}` : sumId}
          onClick={() => setOpen((v) => !v)}
          className="focusable flex min-h-[52px] w-full min-w-0 items-center gap-3 rounded-[var(--radius-card)] px-5 py-3 text-left transition-colors hover:bg-[var(--surface-sunken)]"
        >
          <span className="shrink-0" style={muted}>
            <ChevronDownGlyph
              size={16}
              className={`transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span id={titleId} className="block text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
              {block.title}
            </span>
            {block.subtitle && (
              <span id={subId} className="mt-0.5 block truncate text-xs font-normal" style={muted}>
                {block.subtitle}
              </span>
            )}
          </span>
          <span aria-hidden="true" className="tabular hidden shrink-0 text-right text-xs font-normal sm:block" style={{ color: 'var(--ink-secondary)' }}>
            {summary}
          </span>
        </button>
      </h3>
      <div id={bodyId} hidden={!open}>
        {open && children}
      </div>
      {/* The phone's copy of the summary, under the heading; also what the button's description reads. */}
      <p id={sumId} hidden={open} className="tabular -mt-1 px-5 pb-3 pl-12 text-xs sm:hidden" style={{ color: 'var(--ink-secondary)' }}>
        {summary}
      </p>
    </Card>
  )
}

function Grid({ block, days, today }: { block: RnpBlockDto; days: readonly string[]; today: string }) {
  // The divider on the pinned column is drawn only once the days have moved.
  const [scrolledX, setScrolledX] = useState(false)
  const withShare = block.rows.some((r) => r.share !== null)
  const edge = `tcol-sticky is-edge${scrolledX ? ' is-scrolled-x' : ''}`

  return (
    <div
      className="relative max-h-[min(72vh,46rem)] overflow-auto pb-3"
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
              const sunday = isSunday(d)
              return (
                <th
                  key={d}
                  scope="col"
                  aria-current={isToday ? 'date' : undefined}
                  title={sunday ? 'Yakshanba' : undefined}
                  className={`thead-sticky tabular px-2 py-2 text-right text-[11px] font-medium whitespace-nowrap ${i === days.length - 1 ? 'pr-5' : ''}`}
                  style={
                    isToday
                      ? { background: TODAY_HEAD, color: 'var(--ink-primary)' }
                      : sunday
                        ? { background: SUNDAY_HEAD, color: 'var(--ink-secondary)' }
                        : undefined
                  }
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
        const tone = dayTone(row, value, day, today)
        return (
          <td
            key={day || i}
            title={early ? unreliable : tone !== 'neutral' && row.dayPlan !== null ? `Kunlik reja: ${plain(row.dayPlan, row.unit)}` : undefined}
            className={`tabular px-2 py-2 text-right whitespace-nowrap ${i === days.length - 1 ? 'pr-5' : ''}`}
            style={{
              color: early ? 'var(--ink-muted)' : total ? 'var(--ink-primary)' : 'var(--ink-secondary)',
              background:
                day === today ? TODAY_CELL : tone !== 'neutral' ? TINT[tone] : isSunday(day) ? SUNDAY_CELL : undefined,
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

/** Sunday: a whisper of ink, opaque in the header for the same reason as today's. */
const SUNDAY_HEAD = 'color-mix(in oklab, var(--ink-muted) 12%, var(--surface-sunken))'
const SUNDAY_CELL = 'color-mix(in oklab, var(--ink-muted) 7%, transparent)'

/** A day against its day plan — faint, so the figure stays the thing read. */
const TINT: Record<Exclude<RnpTone, 'neutral'>, string> = {
  good: 'color-mix(in oklab, var(--status-good) 12%, transparent)',
  warning: 'color-mix(in oklab, var(--status-warning) 14%, transparent)',
  critical: 'color-mix(in oklab, var(--status-critical) 12%, transparent)',
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

/** The day plan as plain text, for a cell's title. */
function plain(value: number, unit: RnpUnit): string {
  switch (unit) {
    case 'uzs':
      return `${formatFullUzs(value)} soʻm`
    case 'usd':
      return formatUsd(value)
    case 'percent':
      return formatPercent(value)
    case 'count':
      return formatNumber(Math.round(value * 10) / 10)
  }
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
  const tone = `var(--status-${indexTone(value, better)})`
  return (
    <span className="font-medium" style={{ color: tone }}>
      {formatPercent(value)}
    </span>
  )
}
