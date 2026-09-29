'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { ChevronDownGlyph, PencilGlyph } from '@/components/ui/Icons'
import { InfoTip } from '@/components/ui/Tooltip'
import { apiWrite } from '@/lib/api'
import { formatCompactUzs, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import type { RnpBlockDto, RnpPlanKey, RnpRowDto, RnpUnit, SaveRnpInputsBody } from './rnpApi'
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
 *
 * TYPED ROWS. A row with an `inputKey` is (partly) typed by a person — the
 * followers, the HR funnel, a ROP's early leads and headcount — and wears a
 * pencil beside its label for everybody. With `canEdit` (the page's
 * `canEditPlans`) each of its days that has begun is edited IN PLACE: the
 * cell becomes a number field of the column's own width, Enter or leaving it
 * saves only a changed figure, Escape gives up, Tab saves and opens the next
 * day. An emptied field clears the cell. Days still to come stay read-only.
 */
export function RnpBlockTable({
  block,
  days,
  today,
  canEdit = false,
  collapsible,
}: {
  block: RnpBlockDto
  days: readonly string[]
  today: string
  /** Whether typed rows may be edited here — the page's `canEditPlans`. */
  canEdit?: boolean
  collapsible?: { readonly summary: ReactNode; readonly defaultOpen?: boolean }
}) {
  const grid = <Grid block={block} days={days} today={today} canEdit={canEdit} />
  if (collapsible) {
    return (
      <Collapsible block={block} summary={collapsible.summary} defaultOpen={collapsible.defaultOpen ?? false}>
        {grid}
      </Collapsible>
    )
  }
  return (
    <TableCard title={block.title} hint={block.subtitle ?? undefined}>
      {grid}
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

function Grid({
  block,
  days,
  today,
  canEdit,
}: {
  block: RnpBlockDto
  days: readonly string[]
  today: string
  canEdit: boolean
}) {
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
            <Row key={row.key} row={row} days={days} today={today} withShare={withShare} edge={edge} canEdit={canEdit} />
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
  canEdit,
}: {
  row: RnpRowDto
  days: readonly string[]
  today: string
  withShare: boolean
  edge: string
  canEdit: boolean
}) {
  const total = row.tone === 'total'

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
          {row.inputKey !== null && (
            <span
              role="img"
              aria-label={TYPED_LABEL}
              title={TYPED_LABEL}
              className="mt-[3px] inline-flex shrink-0"
              style={{ color: 'var(--ink-muted)' }}
            >
              <PencilGlyph size={11} />
            </span>
          )}
          {row.hint && <InfoTip content={row.hint} label={`${row.label} — izoh`} className="-my-0.5" />}
        </span>
      </th>
      <Cell>{full(row.plan, row.unit)}</Cell>
      <Cell>{full(row.dayPlan, row.unit)}</Cell>
      <Cell strong>{full(row.fact, row.unit)}</Cell>
      <Cell>{full(row.forecast, row.unit)}</Cell>
      <Cell>{index(row.index, row.better)}</Cell>
      {withShare && <Cell>{row.share === null ? dash : formatPercent(row.share)}</Cell>}
      {canEdit && row.inputKey !== null ? (
        <TypedDays row={row} inputKey={row.inputKey} days={days} today={today} />
      ) : (
        row.days.map((value, i) => {
          const day = days[i] ?? ''
          const look = dayLook(row, value, day, today, i === days.length - 1)
          return (
            <td key={day || i} title={look.title} className={look.className} style={look.style}>
              {compact(value, row.unit)}
            </td>
          )
        })
      )}
    </tr>
  )
}

const TYPED_LABEL = 'Qoʻlda kiritiladi'

/** How a day cell reads — its title, box and colours — the same whether or not it can be typed. */
function dayLook(
  row: RnpRowDto,
  value: number | null,
  day: string,
  today: string,
  last: boolean,
): { title: string | undefined; className: string; style: CSSProperties } {
  const total = row.tone === 'total'
  const early = row.reliableFrom !== null && day < row.reliableFrom
  const tone = dayTone(row, value, day, today)
  return {
    title: early
      ? `Bitrix24 da bu maydon ${dayMonth(row.reliableFrom ?? day)} dan toʻliq`
      : tone !== 'neutral' && row.dayPlan !== null
        ? `Kunlik reja: ${plain(row.dayPlan, row.unit)}`
        : undefined,
    className: `tabular px-2 py-2 text-right whitespace-nowrap ${last ? 'pr-5' : ''}`,
    style: {
      color: early ? 'var(--ink-muted)' : total ? 'var(--ink-primary)' : 'var(--ink-secondary)',
      background: day === today ? TODAY_CELL : tone !== 'neutral' ? TINT[tone] : isSunday(day) ? SUNDAY_CELL : undefined,
    },
  }
}

// --- typed day cells --------------------------------------------------------

type CellState =
  | { readonly status: 'saving'; readonly value: number | null; readonly seq: number }
  | { readonly status: 'error'; readonly message: string; readonly seq: number }

interface SaveVars {
  readonly i: number
  readonly value: number | null
  readonly seq: number
  readonly body: SaveRnpInputsBody
}

/**
 * The day cells of a typed row, for somebody who may type them. One save per
 * committed cell; the figure being saved stands in the cell, faded, until the
 * sheet has been read again, so nothing flickers back to the old number. A
 * refused save puts the old number back and rings the cell in red, the
 * server's sentence in its title.
 */
function TypedDays({
  row,
  inputKey,
  days,
  today,
}: {
  row: RnpRowDto
  inputKey: RnpPlanKey
  days: readonly string[]
  today: string
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<number | null>(null)
  const [cells, setCells] = useState<ReadonlyMap<number, CellState>>(() => new Map())
  const seq = useRef(0)
  const buttons = useRef(new Map<number, HTMLButtonElement>())
  /** A cell left by the keyboard gets the focus back; one left by a click elsewhere does not. */
  const refocus = useRef<number | null>(null)

  const put = (i: number, state: CellState | null) =>
    setCells((prev) => {
      const next = new Map(prev)
      if (state === null) next.delete(i)
      else next.set(i, state)
      return next
    })
  /** Only the newest save of a cell may settle it. */
  const settle = (i: number, at: number, state: CellState | null) =>
    setCells((prev) => {
      if (prev.get(i)?.seq !== at) return prev
      const next = new Map(prev)
      if (state === null) next.delete(i)
      else next.set(i, state)
      return next
    })

  const save = useMutation({
    mutationFn: (vars: SaveVars) => apiWrite<{ saved: boolean }>('POST', '/rnp/inputs', vars.body),
    onMutate: (vars) => put(vars.i, { status: 'saving', value: vars.value, seq: vars.seq }),
    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['rnp-overview'] })
      settle(vars.i, vars.seq, null)
    },
    onError: (error, vars) =>
      settle(vars.i, vars.seq, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Saqlab boʻlmadi',
        seq: vars.seq,
      }),
  })

  useEffect(() => {
    if (editing !== null || refocus.current === null) return
    buttons.current.get(refocus.current)?.focus()
    refocus.current = null
  }, [editing])

  const open = (i: number) => {
    const day = days[i]
    return day !== undefined && day <= today
  }

  const commit = (i: number, text: string) => {
    const day = days[i]
    if (day === undefined) return
    const value = parseCell(text)
    if (Number.isNaN(value)) {
      put(i, { status: 'error', message: 'Son notoʻgʻri — masalan 12, -16 yoki 3,5', seq: ++seq.current })
      return
    }
    if (value === roundCell(row.days[i] ?? null)) {
      // Nothing changed: the cell is left as it was, and a stale error with it goes.
      if (cells.get(i)?.status === 'error') put(i, null)
      return
    }
    const at = ++seq.current
    save.mutate({ i, value, seq: at, body: { rows: [{ day, team: inputKey.team, metric: inputKey.metric, value }] } })
  }

  const finish = (i: number, text: string | null, how: 'enter' | 'escape' | 'blur' | 'next' | 'prev') => {
    if (text !== null) commit(i, text)
    const target = how === 'next' ? i + 1 : how === 'prev' ? i - 1 : null
    if (target !== null && open(target)) {
      setEditing(target)
      return
    }
    if (how !== 'blur') refocus.current = i
    setEditing(null)
  }

  return (
    <>
      {row.days.map((value, i) => {
        const day = days[i] ?? ''
        const state = cells.get(i)
        const shown = state?.status === 'saving' ? state.value : value
        const look = dayLook(row, shown, day, today, i === days.length - 1)
        if (!open(i)) {
          return (
            <td key={day || i} title={look.title} className={look.className} style={look.style}>
              {compact(value, row.unit)}
            </td>
          )
        }
        const where = `${row.label} · ${dayMonth(day)}`
        const failed = state?.status === 'error' ? state.message : null
        return (
          <td
            key={day || i}
            title={failed ?? look.title}
            aria-busy={state?.status === 'saving' || undefined}
            // The padding moves onto the button, so the whole cell is the target and the column keeps its width.
            className={`${look.className} relative`}
            style={{
              ...look.style,
              padding: 0,
              boxShadow: failed ? 'inset 0 0 0 1.5px var(--status-critical)' : undefined,
            }}
          >
            <button
              type="button"
              ref={(el) => {
                if (el) buttons.current.set(i, el)
                else buttons.current.delete(i)
              }}
              aria-label={`${where}: ${value === null ? 'boʻsh' : plainCell(value, row.unit)} — tahrirlash`}
              // Not `disabled`: that would drop the focus the keyboard just handed back.
              aria-disabled={state?.status === 'saving' || undefined}
              onClick={() => {
                if (state?.status !== 'saving') setEditing(i)
              }}
              onKeyDown={(e) => {
                if (e.key === 'F2' && state?.status !== 'saving') {
                  e.preventDefault()
                  setEditing(i)
                }
              }}
              className={`focusable tabular block w-full cursor-text px-2 py-2 text-right whitespace-nowrap transition-shadow hover:shadow-[inset_0_0_0_1px_var(--border-strong)] aria-disabled:cursor-progress ${i === days.length - 1 ? 'pr-5' : ''} ${editing === i ? 'invisible' : ''}`}
              style={{ color: 'inherit', opacity: state?.status === 'saving' ? 0.55 : undefined }}
            >
              {compact(shown, row.unit)}
            </button>
            {editing === i && (
              <DayInput
                label={where}
                initial={value === null ? '' : String(roundCell(value))}
                onDone={(text, how) => finish(i, text, how)}
              />
            )}
            {failed && (
              <span role="alert" className="sr-only">
                {where}: {failed}
              </span>
            )}
          </td>
        )
      })}
    </>
  )
}

/**
 * The field a typed cell becomes. Laid OVER the cell rather than in it, so the
 * column cannot change width while somebody types. The full keyboard, not the
 * decimal pad: an iPhone's decimal pad has no minus, and a subscriber saldo
 * can be negative.
 */
function DayInput({
  label,
  initial,
  onDone,
}: {
  label: string
  initial: string
  onDone: (text: string | null, how: 'enter' | 'escape' | 'blur' | 'next' | 'prev') => void
}) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  // Enter, Escape and Tab unmount the field, and a browser may blur it on the way out: one ending only.
  const done = useRef(false)
  const end = (value: string | null, how: 'enter' | 'escape' | 'blur' | 'next' | 'prev') => {
    if (done.current) return
    done.current = true
    onDone(value, how)
  }

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      type="text"
      autoComplete="off"
      enterKeyHint="done"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^\d.,\s-]/g, '').slice(0, 16))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          end(text, 'enter')
        } else if (e.key === 'Escape') {
          e.preventDefault()
          end(null, 'escape')
        } else if (e.key === 'Tab') {
          e.preventDefault()
          end(text, e.shiftKey ? 'prev' : 'next')
        }
      }}
      onBlur={() => end(text, 'blur')}
      className="tabular absolute inset-0.5 w-[calc(100%-4px)] min-w-0 rounded-[var(--radius-panel-sm)] border px-1.5 text-right text-sm outline-none"
      style={{ background: 'var(--surface-raised)', borderColor: 'var(--accent)', color: 'var(--ink-primary)' }}
    />
  )
}

/** A typed figure: empty is null (clear the cell); NaN is a typo, never sent. */
export function parseCell(text: string): number | null {
  const clean = text.replace(/\s/g, '').replace(',', '.')
  if (clean === '') return null
  return /^-?\d+(\.\d{1,2})?$/.test(clean) ? Number(clean) : Number.NaN
}

/** A figure as the server keeps it — two decimals — for the «changed?» test and the field. */
function roundCell(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100
}

/** A cell's figure spoken whole — the compact form drops what a person typed. */
function plainCell(value: number, unit: RnpUnit): string {
  return unit === 'count' ? formatNumber(roundCell(value) ?? 0) : plain(value, unit)
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
