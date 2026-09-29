'use client'

import { type ReactNode, memo, useId, useMemo, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { ChevronDownGlyph } from '@/components/ui/Icons'
import { InfoTip } from '@/components/ui/Tooltip'
import { formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import type { RnpBlockDto, RnpRowDto, RnpUnit } from './rnpApi'
import { ColumnResizer } from './RnpColumnResizer'
import { type RnpColumnKind, widthCss } from './rnpColumnWidths'
import { type RnpTone, TONE_COLOR, dayMonth, dayTone, indexTone, isSunday, weekday } from './rnpDerive'
import { figureText, formatUsd } from './rnpFigures'
import { useDragScroll } from './useDragScroll'
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

/**
 * THE GRID, 2026-09-29 («professional, tushunarli, rangli … raqamlar kattaroq,
 * har bir ustunni kengaytirish mumkin boʻlsin»).
 *
 * A `<colgroup>` whose widths are CSS variables set once on the page
 * (`RnpColumnScope`), and the table as wide as its columns summed — never
 * `width: 100%`, which would hand the spare width out unevenly and knock
 * «Fakt» in one block out of line with «Fakt» in the next. Every header cell
 * carries a `ColumnResizer` on its right edge; all the day columns share one
 * width (`rnpColumnWidths.ts` says why).
 *
 * NO FIGURE IS EVER CUT (2026-09-29, «sonlar to'liq yozilishi kerak»). Every
 * number is written in full (`rnpFigures.ts`), each column is at least as wide
 * as the widest figure its kind prints anywhere on the page (`--rnp-min-*`,
 * so the blocks stay in line), and the layout is `table-layout: auto` with
 * `nowrap` cells — so even a figure that estimate missed widens its column
 * rather than being clipped. The mouse can grab the figures and pan the month
 * sideways (`useDragScroll`).
 *
 * Colour is tokens only, and each tint is a `color-mix` against transparent
 * or against the surface, so the light and the dark palette both carry it:
 * the summary columns (C…F) sit on a faint accent band with an accent-washed
 * header, a stronger rule divides them from the days, today is the accent
 * with a rule down both sides, a total row is washed and ruled on top, and
 * the index is a pill in its status colour.
 *
 * Memoised on the block object: a re-render of the page that keeps the same
 * payload (a width reset, a team switch) skips the grids that kept theirs. A
 * refetch hands in new objects, so every grid redraws then.
 */
const Grid = memo(function Grid({ block, days, today }: { block: RnpBlockDto; days: readonly string[]; today: string }) {
  // The divider on the pinned column is drawn only once the days have moved.
  const [scrolledX, setScrolledX] = useState(false)
  const withShare = block.rows.some((r) => r.share !== null)
  const summary = useMemo(() => SUMMARY.filter((c) => withShare || c.key !== 'share'), [withShare])
  const edge = `tcol-sticky is-edge${scrolledX ? ' is-scrolled-x' : ''}`
  const width = useMemo(
    () => `calc(${[widthCss('label'), ...summary.map((c) => widthCss(c.key))].join(' + ')} + ${days.length} * ${widthCss('day')})`,
    [summary, days.length],
  )

  const dragScroll = useDragScroll<HTMLDivElement>()

  return (
    <div
      data-rnp-grid=""
      // The figures are the handle: grab them to pan the month sideways (`useDragScroll`).
      className="relative max-h-[min(72vh,46rem)] overflow-auto pb-3 [&_td]:cursor-grab data-[panning]:cursor-grabbing data-[panning]:select-none data-[panning]:[&_td]:cursor-grabbing"
      {...dragScroll}
      onScroll={(e) => {
        const next = e.currentTarget.scrollLeft > 0
        if (next !== scrolledX) setScrolledX(next)
      }}
    >
      <table className="table-auto border-collapse text-[13px] sm:text-sm" style={{ width }}>
        <colgroup>
          <col style={{ width: widthCss('label') }} />
          {summary.map((c) => (
            <col key={c.key} style={{ width: widthCss(c.key) }} />
          ))}
          {days.map((d) => (
            <col key={d} style={{ width: widthCss('day') }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ color: 'var(--ink-muted)' }}>
            <th
              scope="col"
              className={`thead-sticky ${edge} h-12 py-2 pr-3 pl-4 text-left text-[11px] font-semibold tracking-wide uppercase sm:pl-5`}
              // `.tcol-sticky` paints the card; the corner belongs to the header band.
              style={{ left: 0, background: 'var(--surface-sunken)' }}
            >
              Koʻrsatkich
              <ColumnResizer kind="label" name="Koʻrsatkich" />
            </th>
            {summary.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                title={c.header}
                className="thead-sticky px-3 py-2 text-right text-[11px] font-semibold tracking-wide whitespace-nowrap uppercase"
                style={{
                  background: SUMMARY_HEAD,
                  color: c.key === 'fact' ? 'var(--accent-ink)' : 'var(--ink-secondary)',
                  boxShadow: i === summary.length - 1 ? DIVIDER_RIGHT : undefined,
                }}
              >
                {c.header}
                <ColumnResizer kind={c.key} name={c.header} />
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
                  title={isToday ? 'Bugun' : sunday ? 'Yakshanba' : undefined}
                  className={`thead-sticky tabular px-3 py-1.5 text-right whitespace-nowrap ${i === days.length - 1 ? 'pr-5' : ''}`}
                  style={
                    isToday
                      ? { background: TODAY_HEAD, color: 'var(--accent-ink)', boxShadow: TODAY_HEAD_RULE }
                      : sunday
                        ? { background: SUNDAY_HEAD, color: 'var(--ink-secondary)' }
                        : undefined
                  }
                >
                  <span className={`block text-[13px] leading-tight ${isToday ? 'font-bold' : 'font-semibold'}`} style={isToday || sunday ? undefined : { color: 'var(--ink-secondary)' }}>
                    {Number(d.slice(8, 10))}
                  </span>
                  <span className="block text-[10px] leading-tight font-medium tracking-wide uppercase">{weekday(d)}</span>
                  <ColumnResizer kind="day" name="kunlar" tabbable={i === 0} />
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
})

const Row = memo(function Row({
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
      style={total ? { borderColor: 'var(--border-strong)', background: TOTAL_ROW } : { borderColor: 'var(--border)' }}
    >
      <th
        scope="row"
        title={row.label}
        className={`${edge} py-2 pr-3 pl-4 text-left text-[13px] leading-snug break-words sm:pl-5 ${total ? 'font-semibold' : 'font-medium'}`}
        // A total's label cell takes the row's wash, opaque, or the days would show through it.
        style={{ left: 0, color: 'var(--ink-primary)', ...(total ? { background: TOTAL_LABEL } : {}) }}
      >
        {total && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: 'var(--accent)' }} />}
        <span className="inline-flex items-start gap-1">
          <span>{row.label}</span>
          {row.hint && <InfoTip content={row.hint} label={`${row.label} — izoh`} className="-my-0.5" />}
        </span>
      </th>
      <Cell>{figure(row.plan, row.unit)}</Cell>
      <Cell>{figure(row.dayPlan, row.unit)}</Cell>
      <Cell strong>{figure(row.fact, row.unit)}</Cell>
      <Cell>{figure(row.forecast, row.unit)}</Cell>
      <Cell last={!withShare}>{index(row.index, row.better)}</Cell>
      {withShare && <Cell last>{row.share === null ? dash : formatPercent(row.share)}</Cell>}
      {row.days.map((value, i) => {
        const day = days[i] ?? ''
        const early = row.reliableFrom !== null && day < row.reliableFrom
        const tone = dayTone(row, value, day, today)
        const isToday = day === today
        return (
          <td
            key={day || i}
            title={early ? unreliable : tone !== 'neutral' && row.dayPlan !== null ? `Kunlik reja: ${plain(row.dayPlan, row.unit)}` : undefined}
            className={`tabular h-10 px-3 py-1.5 text-right whitespace-nowrap ${i === days.length - 1 ? 'pr-5' : ''}`}
            style={{
              color: early ? 'var(--ink-muted)' : 'var(--ink-primary)',
              background: isToday ? TODAY_CELL : tone !== 'neutral' ? TINT[tone] : isSunday(day) ? SUNDAY_CELL : undefined,
              boxShadow: isToday ? TODAY_RULE : undefined,
            }}
          >
            {figure(value, row.unit)}
          </td>
        )
      })}
    </tr>
  )
})

function Cell({ children, strong = false, last = false }: { children: ReactNode; strong?: boolean; last?: boolean }) {
  return (
    <td
      className={`tabular h-10 px-3 py-1.5 text-right whitespace-nowrap ${strong ? 'font-semibold' : ''}`}
      style={{
        color: strong ? 'var(--ink-primary)' : 'var(--ink-secondary)',
        background: strong ? FACT_CELL : SUMMARY_CELL,
        boxShadow: last ? DIVIDER_RIGHT : undefined,
      }}
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
] as const satisfies readonly { key: RnpColumnKind; header: string }[]

/** The summary columns' header band: the page accent over the header's own recess, opaque. */
const SUMMARY_HEAD = 'color-mix(in oklab, var(--accent) 12%, var(--surface-sunken))'
/** …and their cells: a whisper of the same, so C…F read as one block beside the days. */
const SUMMARY_CELL = 'color-mix(in oklab, var(--accent) 4%, transparent)'
const FACT_CELL = 'color-mix(in oklab, var(--accent) 8%, transparent)'
/** The rule between the summary block and the days. A shadow, not a border: see `.tcol-sticky`. */
const DIVIDER_RIGHT = 'inset -1px 0 0 var(--border-strong)'

/** Today's column: the accent, opaque in the header so rows cannot show through, ruled down both sides. */
const TODAY_HEAD = 'color-mix(in oklab, var(--accent) 24%, var(--surface-sunken))'
const TODAY_HEAD_RULE = 'inset 0 -2px 0 var(--accent)'
const TODAY_CELL = 'color-mix(in oklab, var(--accent) 13%, transparent)'
const TODAY_RULE = 'inset 1px 0 0 var(--accent-line), inset -1px 0 0 var(--accent-line)'

/** Sunday: a whisper of ink, opaque in the header for the same reason as today's. */
const SUNDAY_HEAD = 'color-mix(in oklab, var(--ink-muted) 12%, var(--surface-sunken))'
const SUNDAY_CELL = 'color-mix(in oklab, var(--ink-muted) 6%, transparent)'

/** A total row: washed with the accent and ruled on top; its pinned label cell opaque. */
const TOTAL_ROW = 'color-mix(in oklab, var(--accent) 7%, transparent)'
const TOTAL_LABEL = 'color-mix(in oklab, var(--accent) 7%, var(--surface-raised))'

/** A day against its day plan — soft, one strength for all three, so the figure stays the thing read. */
const TINT: Record<Exclude<RnpTone, 'neutral'>, string> = {
  good: 'color-mix(in oklab, var(--status-good) 11%, transparent)',
  warning: 'color-mix(in oklab, var(--status-warning) 13%, transparent)',
  critical: 'color-mix(in oklab, var(--status-critical) 11%, transparent)',
}

const dash = <span style={muted}>—</span>

/** Any figure of the grid, in full («3,589,815,001», never «3.6 mlrd»): `rnpFigures.ts`. */
function figure(value: number | null, unit: RnpUnit): ReactNode {
  return value === null ? dash : figureText(value, unit)
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

/**
 * The index, coloured by which way is good. A cost (`better: 'down'`) under
 * its plan is on track; over it by a fifth is the alarm.
 */
function index(value: number | null, better: 'up' | 'down'): ReactNode {
  if (value === null) return dash
  const tone = TONE_COLOR[indexTone(value, better)]
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[12px] leading-5 font-semibold sm:text-[13px]"
      style={{ color: tone, background: `color-mix(in oklab, ${tone} 14%, transparent)` }}
    >
      {formatPercent(value)}
    </span>
  )
}
