'use client'

import { type ReactNode, memo, useCallback, useMemo, useRef, useState } from 'react'

import { ArrowDownGlyph, ArrowUpGlyph, CheckCircleGlyph, ChevronGlyph, TriangleGlyph } from '@/components/ui/Icons'
import { dayMonthYear } from '@/features/rnp/rnpDerive'
import { figureText } from '@/features/rnp/rnpFigures'
import { useDragScroll } from '@/features/rnp/useDragScroll'
import {
  DayHead,
  RULE,
  SUMMARY_CELL,
  SUMMARY_HEAD,
  VRULE,
  crosshairHandlers,
  dayCellStyle,
  inkOf,
  layers,
  markScrolledX,
  mix,
  usePinnedColumns,
} from '@/features/shared/sheetGrid'
import { PRODUCT_TONE } from '@/features/target/targetTheme'

import { type KpiSheetBasis, type KpiSheetLine, type KpiSheetScope, type KpiSheetSide, type KpiSheetValueLine, groupDiffers } from './kpiSheetApi'

/** What a day cell opens: that day's orders, under the row's brand and FAKT figure. */
export interface KpiSheetDrill {
  readonly day: string
  readonly scope: KpiSheetScope
  readonly basis: KpiSheetBasis
}

const STYLE_ID = 'kpi-sheet-x'

/**
 * «KPI jadvali» AS A SHEET — the RNP grid's shape (the client, 2026-10-23:
 * «rnp jadvali visualidagi jadval koʻrinishida … excel jadvaldek»): a row per
 * figure and system, a column per day, the month's «Jami» pinned beside the
 * label, one scroll box with the header frozen on top and the label frozen on
 * the left — the frame `sheetGrid.tsx` shares with «Maosh jadvali».
 *
 * A FIGURE IS THREE ROWS: Bitrix24, MoySklad, and «Farq» (MoySklad −
 * Bitrix24). The name is printed once, on the Bitrix24 row; each row says
 * which system it is with a chip at the label's right edge, so the chips
 * stand in one column like the sheet's column B. A figure whose «Farq» is not
 * nought somewhere in the month carries ⚠ beside its name.
 *
 * A DIFFERENCE IS A MARK, NOT A SIGNED NUMBER — the KPI cards' rule
 * (`reconcile.tsx`): nought is a quiet «—», a gap a red pill with ▲ (more in
 * MoySklad) or ▼ (more in Bitrix24). An empty cell is a day not lived yet, or
 * one before MoySklad held orders.
 *
 * «YANADA ANIQROQ» (the client, the same day, after seeing it):
 *   - the column under the pointer lights up across the sheet (`crosshair`),
 *     the row's own hover does the other arm;
 *   - a block's heading sticks under the header while its rows scroll, so the
 *     reader always knows whose figures these are, and says in one chip
 *     whether everything in it agrees («✓ mos») or how many figures do not;
 *   - a heading folds its block away and opens it again;
 *   - a date that holds any difference carries a red dot.
 *
 * EVERY DAY CELL OPENS THAT DAY'S ORDERS (`onOpen`): each order on both
 * systems with its products — so any figure here is checked against its deals.
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
  const crosshair = useMemo(() => crosshairHandlers(STYLE_ID), [])
  usePinnedColumns(box, 2)
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback(
    (key: string) =>
      setFolded((now) => {
        const next = new Set(now)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    [],
  )

  const { marks, blockGaps, dayFlags } = useMemo(() => readSheet(lines, days.length), [lines, days.length])
  const shown = useMemo(() => unfolded(lines, folded), [lines, folded])
  const span = days.length + 1

  return (
    <div
      ref={box}
      id={`${STYLE_ID}-box`}
      data-rnp-grid=""
      role="region"
      aria-label="KPI jadvali"
      // A scroll box a keyboard can reach and scroll with the arrow keys.
      tabIndex={0}
      className="focusable relative h-full min-h-0 cursor-grab overflow-auto overscroll-contain data-[panning]:cursor-grabbing data-[panning]:select-none data-[panning]:[&_td]:cursor-grabbing"
      {...dragScroll}
      {...crosshair}
      onScroll={markScrolledX}
    >
      <style id={STYLE_ID} />
      <table className="border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          KPI jadvali, {days[0] ? dayMonthYear(days[0]) : ''} – {days.at(-1) ? dayMonthYear(days.at(-1)!) : ''}
        </caption>
        <thead>
          <tr style={{ color: 'var(--ink-secondary)' }}>
            <th
              scope="col"
              className={`thead-sticky tcol-sticky rnp-label ${LABEL_WIDTH} ${RULE} h-12 py-2 pr-3 pl-4 text-left text-[12px] leading-tight font-bold sm:pl-5`}
              // `.tcol-sticky` paints the card; the corner belongs to the header band.
              style={{ left: 0, background: 'var(--surface-sunken)', color: 'var(--ink-primary)' }}
            >
              <span className="sr-only">Koʻrsatkich, </span>
              {days[0] && days.at(-1) ? `${dayMonthYear(days[0])} – ${dayMonthYear(days.at(-1)!)}` : 'Koʻrsatkich'}
            </th>
            <th
              scope="col"
              title="Oy boshidan bugungacha, bugun ham hisobda"
              className={`thead-sticky ${TOTAL_PIN} ${RULE} min-w-[128px] px-3 py-2 text-right text-[12px] font-semibold whitespace-nowrap`}
              style={{ background: SUMMARY_HEAD, color: 'var(--ink-primary)' }}
            >
              Jami
            </th>
            {days.map((d, i) => (
              <DayHead
                key={d}
                day={d}
                today={today}
                column={i}
                last={i === days.length - 1}
                flagged={dayFlags[i] ?? false}
                flagTitle="Shu kuni Bitrix24 va MoySklad farq qiladi"
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map(({ line, at }, n) => {
            const prev = n > 0 ? shown[n - 1]!.line : undefined
            const next = shown[n + 1]?.line
            if (line.kind === 'title') {
              const gap = prev ? (prev.scope !== line.scope ? 'scope' : 'block') : null
              return (
                <TitleRow
                  key={line.key}
                  line={line}
                  span={span}
                  gap={gap}
                  gaps={blockGaps.get(line.key) ?? 0}
                  open={!folded.has(line.key)}
                  onToggle={toggle}
                />
              )
            }
            return (
              <ValueRow
                key={line.key}
                line={line}
                days={days}
                today={today}
                differs={line.opens ? (marks.get(at) ?? false) : false}
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

/** A heading's depth: a brand's block (1) holds its product blocks (2). */
function levelOf(line: Extract<KpiSheetLine, { kind: 'title' }>): number {
  return line.key.includes(':products:') ? 2 : 1
}

/** The lines a fold leaves on screen, each with its place in `lines` (the marks are keyed by it). */
function unfolded(lines: readonly KpiSheetLine[], folded: ReadonlySet<string>): { line: KpiSheetLine; at: number }[] {
  const out: { line: KpiSheetLine; at: number }[] = []
  let hiddenBelow: number | null = null
  lines.forEach((line, at) => {
    if (line.kind === 'title') {
      const level = levelOf(line)
      if (hiddenBelow !== null && level > hiddenBelow) return
      hiddenBelow = folded.has(line.key) ? level : null
      out.push({ line, at })
      return
    }
    if (hiddenBelow === null) out.push({ line, at })
  })
  return out
}

/**
 * What the sheet says about itself, read once per payload: which figures
 * differ somewhere in the month (`marks`, by the figure's first row), how many
 * do in each block — a brand's block counting its product blocks too
 * (`blockGaps`) — and which days hold any difference (`dayFlags`).
 */
function readSheet(lines: readonly KpiSheetLine[], dayCount: number) {
  const marks = new Map<number, boolean>()
  const blockGaps = new Map<string, number>()
  const dayFlags: boolean[] = Array.from({ length: dayCount }, () => false)
  const open: string[] = []
  lines.forEach((line, i) => {
    if (line.kind === 'title') {
      open.length = levelOf(line) - 1
      open.push(line.key)
      blockGaps.set(line.key, 0)
      return
    }
    if (line.opens) {
      const differs = groupDiffers(lines, i)
      marks.set(i, differs)
      if (differs) for (const key of open) blockGaps.set(key, (blockGaps.get(key) ?? 0) + 1)
    }
    if (line.side === 'diff' || line.side === 'mismatch') {
      line.days.forEach((v, d) => {
        if (v !== null && Math.round(v) !== 0) dayFlags[d] = true
      })
    }
  })
  return { marks, blockGaps, dayFlags }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const LABEL_WIDTH = 'w-[184px] min-w-[184px] max-w-[184px] sm:w-[330px] sm:min-w-[330px] sm:max-w-[330px]'
const TOTAL_PIN = 'tcol-sticky rnp-pin rnp-edge left-[var(--sheet-left-1)]'
/** A heading sticks under the header while its block scrolls — over the rows, under the header. */
const STICK = { top: 'var(--sheet-head-h)' } as const

type TitleLine = Extract<KpiSheetLine, { kind: 'title' }>

/** The band's colour: the two brands in their colours everywhere else, both together in the company's green. */
function hueOf(scope: KpiSheetScope): string {
  return scope === 'all' ? 'var(--status-good)' : PRODUCT_TONE[scope]
}

/**
 * A heading band — sticky under the header, a button that folds its block,
 * and the block's verdict beside its name. A new brand opens with the RNP
 * sheet's wide, sunken gap; a block inside it with a narrow one.
 */
const TitleRow = memo(function TitleRow({
  line,
  span,
  gap,
  gaps,
  open,
  onToggle,
}: {
  line: TitleLine
  span: number
  gap: 'scope' | 'block' | null
  /** Figures in the block whose two systems disagree somewhere in the month. */
  gaps: number
  open: boolean
  onToggle: (key: string) => void
}) {
  const hue = hueOf(line.scope)
  const ground = mix(hue, 18, 'var(--surface-raised)')
  const band = mix(hue, 9, 'var(--surface-raised)')
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
          className={`tcol-sticky rnp-label ${LABEL_WIDTH} ${RULE} p-0 text-left leading-snug`}
          style={{ ...STICK, left: 0, zIndex: 2, background: ground, color: inkOf(hue) }}
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: hue }} />
          <button
            type="button"
            aria-expanded={open}
            onClick={() => onToggle(line.key)}
            title={open ? 'Blokni yigʻish' : 'Blokni ochish'}
            className="focusable flex w-full items-center gap-1.5 py-2 pr-3 pl-4 text-left sm:pl-5"
          >
            <ChevronGlyph direction={open ? 'down' : 'right'} size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 text-[12.5px] font-bold tracking-wide uppercase">{line.label}</span>
            <BlockChip gaps={gaps} />
          </button>
        </th>
        {/* The band under the pinned «Jami» pins with it, opaque, so the days pass beneath. */}
        <td className={`${TOTAL_PIN} ${RULE}`} style={{ ...STICK, zIndex: 2, backgroundColor: band }} />
        <td colSpan={span - 1} className={`sticky ${RULE}`} style={{ ...STICK, zIndex: 1, background: band }} />
      </tr>
    </>
  )
})

/** «✓ mos» or «⚠ N farq» — the block's verdict, so a folded block still says whether it needs a look. */
function BlockChip({ gaps }: { gaps: number }) {
  const matched = gaps === 0
  const color = matched ? 'var(--status-good)' : 'var(--status-critical)'
  const Glyph = matched ? CheckCircleGlyph : TriangleGlyph
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-normal whitespace-nowrap normal-case"
      style={{ background: mix(color, 14, 'var(--surface-raised)'), color }}
      title={matched ? 'Bu blokda Bitrix24 va MoySklad hamma kuni mos' : `Bu blokda ${gaps} ta koʻrsatkich farq qiladi`}
    >
      <Glyph size={10} className="shrink-0" />
      {matched ? 'mos' : `${gaps} farq`}
    </span>
  )
}

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
        const open = value !== null && day !== ''
        return (
          <td
            key={day || i}
            data-c={i}
            title={open ? `${dayMonthYear(day)} — buyurtmalarni ochish` : undefined}
            onClick={open ? () => onOpen({ day, scope: line.scope, basis: line.basis }) : undefined}
            className={`tabular ${rule} ${VRULE} h-9 px-3 py-1.5 text-right whitespace-nowrap ${open ? 'cursor-pointer' : ''} ${i === days.length - 1 ? 'pr-5' : ''}`}
            style={{ color: 'var(--ink-primary)', ...dayCellStyle(day, today) }}
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

/** The «Farq» rows sit a shade down, so each figure's three rows read as one block. */
const DIFF_BAND = mix('var(--ink-muted)', 5)
