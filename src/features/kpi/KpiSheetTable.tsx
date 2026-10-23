'use client'

import { type ReactNode, type UIEvent, memo, useLayoutEffect, useMemo, useRef } from 'react'

import { ArrowDownGlyph, ArrowUpGlyph, TriangleGlyph } from '@/components/ui/Icons'
import { dayMonth, dayMonthYear, isSunday, weekday } from '@/features/rnp/rnpDerive'
import { figureText } from '@/features/rnp/rnpFigures'
import { useDragScroll } from '@/features/rnp/useDragScroll'
import { PRODUCT_TONE } from '@/features/target/targetTheme'

import { type KpiSheetBasis, type KpiSheetLine, type KpiSheetScope, type KpiSheetSide, type KpiSheetValueLine, groupDiffers } from './kpiSheetApi'

/** What a day cell opens: that day's orders, under the row's brand and FAKT figure. */
export interface KpiSheetDrill {
  readonly day: string
  readonly scope: KpiSheetScope
  readonly basis: KpiSheetBasis
}

/**
 * «KPI jadvali» AS A SHEET — the RNP grid's shape (the client, 2026-10-23:
 * «rnp jadvali visualidagi jadval koʻrinishida … excel jadvaldek»): a row per
 * figure and system, a column per day, the month's «Jami» pinned beside the
 * label, one scroll box with the header frozen on top and the label frozen on
 * the left. It borrows the RNP sheet's whole frame — `[data-rnp-grid]` and
 * its `.rnp-label` / `.rnp-pin` / `.rnp-edge` rules in globals.css, the drag
 * to scroll, the today and Sunday columns — so the two sheets read alike.
 *
 * A FIGURE IS THREE ROWS: Bitrix24, MoySklad, and «Farq» (MoySklad −
 * Bitrix24). The name is printed once, on the Bitrix24 row; each row says
 * which system it is with a chip at the label's right edge, so the chips
 * stand in one column like the sheet's column B. A figure whose «Farq» is not
 * nought somewhere in the month carries ⚠ beside its name — the label is the
 * one column always on screen.
 *
 * A DIFFERENCE IS A MARK, NOT A SIGNED NUMBER — the KPI cards' rule
 * (`reconcile.tsx`): nought is a quiet «—», a gap a red pill with ▲ (more in
 * MoySklad) or ▼ (more in Bitrix24). An empty cell is a day not lived yet, or
 * one before MoySklad held orders.
 *
 * EVERY DAY CELL OPENS THAT DAY'S ORDERS (`onOpen`): each order on both
 * systems with its products, the differences first — so any figure here is
 * checked against the deals it was counted from.
 */
export function KpiSheetTable({
  lines,
  days,
  today,
  onOpen,
}: {
  readonly lines: readonly KpiSheetLine[]
  readonly days: readonly string[]
  readonly today: string
  readonly onOpen: (drill: KpiSheetDrill) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const dragScroll = useDragScroll<HTMLDivElement>()
  usePinnedTotal(box)
  // Which group of sides each value line belongs to: its opener's index.
  const marks = useMemo(() => {
    const out = new Map<number, boolean>()
    lines.forEach((line, i) => {
      if (line.kind === 'value' && line.opens) out.set(i, groupDiffers(lines, i))
    })
    return out
  }, [lines])
  const span = days.length + 1

  return (
    <div
      ref={box}
      data-rnp-grid=""
      role="region"
      aria-label="KPI jadvali"
      // A scroll box a keyboard can reach and scroll with the arrow keys.
      tabIndex={0}
      className="focusable relative h-full min-h-0 cursor-grab overflow-auto overscroll-contain data-[panning]:cursor-grabbing data-[panning]:select-none data-[panning]:[&_td]:cursor-grabbing"
      {...dragScroll}
      onScroll={markScrolledX}
    >
      <table className="border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          KPI jadvali, {days[0] ? dayMonthYear(days[0]) : ''} – {days.at(-1) ? dayMonthYear(days.at(-1)!) : ''}
        </caption>
        <Head days={days} today={today} />
        <tbody>
          {lines.map((line, i) => {
            const prev = i > 0 ? lines[i - 1] : undefined
            const next = lines[i + 1]
            const gap = line.kind === 'title' && prev ? (prev.scope !== line.scope ? 'scope' : 'block') : null
            return line.kind === 'title' ? (
              <TitleRow key={line.key} line={line} span={span} gap={gap} />
            ) : (
              <ValueRow
                key={line.key}
                line={line}
                days={days}
                today={today}
                differs={line.opens ? (marks.get(i) ?? false) : false}
                closes={next === undefined || next.kind === 'title' || next.opens}
                onOpen={onOpen}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The pinned block's divider deepens once the days have moved under it —
 * `[data-scrolled-x]` on the box, the RNP sheet's attribute and rules.
 */
function markScrolledX(e: UIEvent<HTMLDivElement>) {
  const el = e.currentTarget
  const scrolled = el.scrollLeft > 0
  if (scrolled !== el.hasAttribute('data-scrolled-x')) el.toggleAttribute('data-scrolled-x', scrolled)
}

/** Room the pinned block must leave for days, about three of them; less and only the label pins. */
const ROOM_FOR_DAYS = 260

/**
 * Measures the label column and writes the «Jami» column's `left` on the box
 * (`--kpi-left-total`), and `data-pin-wide` when there is room to pin both —
 * on a phone only the label pins, as on the RNP sheet (`usePinnedSummary`).
 * The frozen parts are the box's scroll padding too, so «Bugun» brings
 * today's column clear of them.
 */
function usePinnedTotal(ref: { readonly current: HTMLDivElement | null }) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const [label, total] = Array.from(el.querySelectorAll<HTMLElement>('thead th')).slice(0, 2)
    if (!label || !total) return
    const measure = () => {
      const corner = label.getBoundingClientRect()
      const totalWidth = total.getBoundingClientRect().width
      const wide = corner.width + totalWidth + ROOM_FOR_DAYS <= el.clientWidth
      const left = `${corner.width}px`
      if (el.style.getPropertyValue('--kpi-left-total') !== left) el.style.setProperty('--kpi-left-total', left)
      if (wide !== el.hasAttribute('data-pin-wide')) el.toggleAttribute('data-pin-wide', wide)
      el.style.scrollPaddingLeft = `${wide ? corner.width + totalWidth : corner.width}px`
      el.style.scrollPaddingTop = `${corner.height}px`
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(label)
    observer.observe(total)
    return () => observer.disconnect()
  }, [ref])
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

const LABEL_WIDTH = 'w-[184px] min-w-[184px] max-w-[184px] sm:w-[330px] sm:min-w-[330px] sm:max-w-[330px]'
const TOTAL_PIN = 'tcol-sticky rnp-pin rnp-edge left-[var(--kpi-left-total)]'

const Head = memo(function Head({ days, today }: { days: readonly string[]; today: string }) {
  const first = days[0]
  const last = days.at(-1)
  return (
    <thead>
      <tr style={{ color: 'var(--ink-secondary)' }}>
        <th
          scope="col"
          className={`thead-sticky tcol-sticky rnp-label ${LABEL_WIDTH} ${RULE} h-12 py-2 pr-3 pl-4 text-left text-[12px] leading-tight font-bold sm:pl-5`}
          // `.tcol-sticky` paints the card; the corner belongs to the header band.
          style={{ left: 0, background: 'var(--surface-sunken)', color: 'var(--ink-primary)' }}
        >
          <span className="sr-only">Koʻrsatkich, </span>
          {first && last ? `${dayMonthYear(first)} – ${dayMonthYear(last)}` : 'Koʻrsatkich'}
        </th>
        <th
          scope="col"
          title="Oy boshidan bugungacha, bugun ham hisobda"
          className={`thead-sticky ${TOTAL_PIN} ${RULE} min-w-[128px] px-3 py-2 text-right text-[12px] font-semibold whitespace-nowrap`}
          style={{ background: SUMMARY_HEAD, color: 'var(--ink-primary)' }}
        >
          Jami
        </th>
        {days.map((d, i) => {
          const isToday = d === today
          const sunday = isSunday(d)
          return (
            <th
              key={d}
              scope="col"
              aria-current={isToday ? 'date' : undefined}
              title={isToday ? 'Bugun' : sunday ? 'Yakshanba' : undefined}
              className={`thead-sticky tabular ${RULE} min-w-[84px] px-3 py-1.5 text-right whitespace-nowrap ${i === days.length - 1 ? 'pr-5' : ''}`}
              style={
                isToday
                  ? { background: TODAY_HEAD, color: 'var(--accent-ink)', boxShadow: TODAY_HEAD_RULE }
                  : sunday
                    ? { background: SUNDAY_HEAD }
                    : undefined
              }
            >
              <span className={`block text-[13px] leading-tight ${isToday ? 'font-bold' : 'font-semibold'}`}>{dayMonth(d)}</span>
              <span className="block text-[10px] leading-tight font-medium tracking-wide uppercase" style={isToday ? undefined : { color: 'var(--ink-muted)' }}>
                {weekday(d)}
              </span>
            </th>
          )
        })}
      </tr>
    </thead>
  )
})

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type TitleLine = Extract<KpiSheetLine, { kind: 'title' }>

/** The band's colour: the two brands in their colours everywhere else, both together in the company's green. */
function hueOf(scope: KpiSheetScope): string {
  return scope === 'all' ? 'var(--status-good)' : PRODUCT_TONE[scope]
}

/**
 * A heading band. A new brand opens with the RNP sheet's wide, sunken gap —
 * each brand reads as its own table inside the one grid — a block inside it
 * with a narrow one.
 */
const TitleRow = memo(function TitleRow({ line, span, gap }: { line: TitleLine; span: number; gap: 'scope' | 'block' | null }) {
  const hue = hueOf(line.scope)
  return (
    <>
      {gap === 'block' && (
        <tr aria-hidden="true">
          <td colSpan={span + 1} className="h-3 p-0" />
        </tr>
      )}
      {gap === 'scope' && (
        <tr aria-hidden="true">
          <td colSpan={span + 1} className="h-6 border-y border-[var(--border-strong)] p-0" style={{ background: 'var(--surface-sunken)' }} />
        </tr>
      )}
      <tr data-line="title">
        <th
          scope="row"
          className={`tcol-sticky rnp-label ${LABEL_WIDTH} ${RULE} py-2 pr-3 pl-4 text-left leading-snug sm:pl-5`}
          style={{ left: 0, background: mix(hue, 18, 'var(--surface-raised)'), color: inkOf(hue) }}
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: hue }} />
          <span className="text-[12.5px] font-bold tracking-wide uppercase">{line.label}</span>
        </th>
        {/* The band under the pinned «Jami» pins with it, opaque, so the days pass beneath. */}
        <td className={`${TOTAL_PIN} ${RULE}`} style={{ backgroundColor: 'var(--surface-raised)', backgroundImage: layers(mix(hue, 9)) }} />
        <td colSpan={span - 1} className={RULE} style={{ background: mix(hue, 9) }} />
      </tr>
    </>
  )
})

const ValueRow = memo(function ValueRow({
  line,
  days,
  today,
  differs,
  closes,
  onOpen,
}: {
  line: KpiSheetValueLine
  days: readonly string[]
  today: string
  /** The figure's «Farq» is not nought somewhere in the month — its name carries ⚠. */
  differs: boolean
  /** The last row of its group: the group's rule under it is the stronger one. */
  closes: boolean
  onOpen: (drill: KpiSheetDrill) => void
}) {
  const rule = closes ? 'border-b border-[var(--border-strong)]' : 'border-b border-[var(--grid)]'
  const quiet = line.side === 'diff' || line.side === 'mismatch'
  const band = quiet ? DIFF_BAND : undefined
  const strongTotal = line.side !== 'diff'

  return (
    <tr data-line="value" data-side={line.side} className="transition-colors hover:bg-[var(--surface-sunken)]" style={band ? { backgroundImage: layers(band) } : undefined}>
      <th
        scope="row"
        className={`tcol-sticky rnp-label ${LABEL_WIDTH} ${rule} py-1.5 pr-3 pl-4 text-left text-[13px] leading-snug sm:pl-5 ${line.opens ? 'font-semibold' : 'font-medium'}`}
        style={{ left: 0, color: 'var(--ink-primary)', ...(band ? { backgroundImage: layers(band) } : {}) }}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            {line.label &&
              (differs ? (
                <span className="inline-flex items-start gap-1.5">
                  <span className="mt-[3px] inline-flex shrink-0" style={{ color: 'var(--status-critical)' }} title="Bu oy Bitrix24 va MoySklad farq qiladi">
                    <TriangleGlyph size={11} />
                  </span>
                  <span>{line.label}</span>
                </span>
              ) : (
                line.label
              ))}
          </span>
          {line.side !== 'mismatch' && <SideChip side={line.side} />}
        </span>
      </th>
      <td
        className={`${TOTAL_PIN} tabular ${rule} h-9 px-3 py-1.5 text-right whitespace-nowrap ${strongTotal ? 'font-semibold' : ''}`}
        style={{ color: 'var(--ink-primary)', backgroundImage: layers(SUMMARY_CELL, band) }}
      >
        <Figure line={line} value={line.total} />
      </td>
      {line.days.map((value, i) => {
        const day = days[i] ?? ''
        const isToday = day === today
        const open = value !== null && day !== ''
        return (
          <td
            key={day || i}
            title={open ? `${dayMonthYear(day)} — buyurtmalarni ochish` : undefined}
            onClick={open ? () => onOpen({ day, scope: line.scope, basis: line.basis }) : undefined}
            className={`tabular ${rule} ${VRULE} h-9 px-3 py-1.5 text-right whitespace-nowrap ${open ? 'cursor-pointer hover:bg-[var(--glass-hover)]' : ''} ${i === days.length - 1 ? 'pr-5' : ''}`}
            style={{
              color: 'var(--ink-primary)',
              background: isToday ? TODAY_CELL : isSunday(day) ? SUNDAY_CELL : undefined,
              boxShadow: isToday ? TODAY_RULE : undefined,
            }}
          >
            <Figure line={line} value={value} />
          </td>
        )
      })}
    </tr>
  )
})

/** «Bitrix24» / «MoySklad» / «Farq» — which system a row reads, at the label's right edge. */
function SideChip({ side }: { side: Exclude<KpiSheetSide, 'mismatch'> }) {
  const chip = SIDE_CHIP[side]
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-[5px] border px-1.5 text-[10.5px] leading-[17px] font-semibold whitespace-nowrap"
      style={
        chip.hue
          ? { borderColor: mix(chip.hue, 45, 'var(--border)'), background: mix(chip.hue, 14), color: inkOf(chip.hue) }
          : { borderColor: 'var(--border-strong)', color: 'var(--ink-secondary)' }
      }
      title={chip.title}
    >
      <span className="sm:hidden">{chip.short}</span>
      <span className="max-sm:hidden">{chip.label}</span>
    </span>
  )
}

const SIDE_CHIP: Record<Exclude<KpiSheetSide, 'mismatch'>, { label: string; short: string; hue: string | null; title: string }> = {
  bitrix: { label: 'Bitrix24', short: 'B24', hue: 'var(--series-1)', title: 'Bitrix24 boʻyicha' },
  moysklad: { label: 'MoySklad', short: 'MS', hue: 'var(--series-3)', title: 'MoySklad boʻyicha' },
  diff: { label: 'Farq', short: 'Farq', hue: null, title: 'MoySklad − Bitrix24: ▲ MoySkladʼda koʻp, ▼ Bitrix24ʼda koʻp' },
}

/** One cell's figure, in its row's unit and its side's manner. */
function Figure({ line, value }: { line: KpiSheetValueLine; value: number | null }): ReactNode {
  if (value === null) return null
  if (line.side === 'diff') return <Gap value={value} line={line} />
  if (line.side === 'mismatch') {
    if (value === 0) return <span style={{ color: 'var(--ink-muted)' }}>—</span>
    return (
      <span className="font-semibold" style={{ color: 'var(--status-critical)' }}>
        {figureText(value, 'count')}
      </span>
    )
  }
  if (value === 0) return <span style={{ color: 'var(--ink-muted)' }}>0</span>
  return <>{figureText(value, line.unit)}</>
}

/** The difference as the KPI cards draw it: «—» when nought, else a red pill with its direction. */
function Gap({ value, line }: { value: number; line: KpiSheetValueLine }) {
  const whole = line.unit === 'usd' ? Math.round(value * 100) / 100 : Math.round(value)
  if (whole === 0) {
    return (
      <span style={{ color: 'var(--ink-muted)' }} aria-label="farq yoʻq">
        —
      </span>
    )
  }
  const Arrow = whole > 0 ? ArrowUpGlyph : ArrowDownGlyph
  const text = figureText(Math.abs(whole), line.unit)
  return (
    <span
      className="-mr-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] leading-4 font-semibold"
      style={{ background: mix('var(--status-critical)', 14), color: 'var(--status-critical)' }}
      aria-label={`farq ${whole > 0 ? '+' : '−'}${text}`}
    >
      <Arrow size={10} className="shrink-0" />
      {text}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Colour — tokens only, mixed, so light and dark both carry it (the RNP sheet's)
// ---------------------------------------------------------------------------

function mix(color: string, pct: number, base = 'transparent'): string {
  return `color-mix(in oklab, ${color} ${pct}%, ${base})`
}

function layers(...colors: (string | undefined)[]): string {
  return colors
    .filter((c): c is string => c !== undefined)
    .map((c) => `linear-gradient(${c}, ${c})`)
    .join(', ')
}

function inkOf(hue: string): string {
  return mix(hue, 68, 'var(--ink-primary)')
}

const RULE = 'border-b border-[var(--border)]'
const VRULE = 'border-r border-r-[var(--grid)]'
const SUMMARY_HEAD = mix('var(--accent)', 12, 'var(--surface-sunken)')
const SUMMARY_CELL = mix('var(--ink-muted)', 5)
/** The «Farq» rows sit a shade down, so each figure's three rows read as one block. */
const DIFF_BAND = mix('var(--ink-muted)', 5)
const TODAY_HEAD = mix('var(--accent)', 24, 'var(--surface-sunken)')
const TODAY_HEAD_RULE = 'inset 0 -2px 0 var(--accent)'
const TODAY_CELL = mix('var(--accent)', 13)
const TODAY_RULE = 'inset 1px 0 0 var(--accent-line), inset -1px 0 0 var(--accent-line)'
const SUNDAY_HEAD = mix('var(--ink-muted)', 12, 'var(--surface-sunken)')
const SUNDAY_CELL = mix('var(--ink-muted)', 6)
