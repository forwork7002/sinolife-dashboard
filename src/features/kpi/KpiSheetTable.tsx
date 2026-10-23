'use client'

import { type ReactNode, memo, useCallback, useMemo, useRef, useState } from 'react'

import { ArrowDownGlyph, ArrowUpGlyph, CheckCircleGlyph, ChevronGlyph, TriangleGlyph } from '@/components/ui/Icons'
import { dayMonthYear } from '@/features/rnp/rnpDerive'
import { figureText, rnpPercent } from '@/features/rnp/rnpFigures'
import { useDragScroll } from '@/features/rnp/useDragScroll'
import {
  DayHead,
  RULE,
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

import { type KpiGroup, type KpiPair, type KpiSheetBasis, type KpiSheetLine, type KpiSheetScope, type KpiSheetValueLine, sheetGroups, wholeGap } from './kpiSheetApi'

/** What a day cell opens: that day's orders, under the row's brand and FAKT figure. */
export interface KpiSheetDrill {
  readonly day: string
  readonly scope: KpiSheetScope
  readonly basis: KpiSheetBasis
}

const STYLE_ID = 'kpi-sheet-x'

/**
 * «KPI jadvali» — its own sheet, not the RNP's (the client, 2026-10-23, after
 * the first version: «aynan huddi rnp jadvalidek emas … visual darajasida
 * oʻzgacharoq va yaxshiroq … maksimal darajada»).
 *
 * A FIGURE IS A PAIR OF ROWS — Bitrix24 over MoySklad — and the difference
 * lives IN the MoySklad cell instead of on a third row that was «—» nine days
 * in ten. A day that agrees prints MoySklad's figure quietly; a day that does
 * not turns red and grows a ▲ / ▼ chip with the gap under its figure (▲ more
 * in MoySklad), so a row with a difference is taller and redder than its
 * neighbours and the eye goes straight to it. The server's «Farq» rows stay
 * in the payload and in the Excel file (`kpiSheetCsv`).
 *
 * BESIDE THE NAME: «Jami» and «Moslik» — how much of the month the two
 * systems agree on (`matchOf`: the days' absolute gaps over Bitrix24's
 * figure, so a −3 and a +3 do not cancel), with a bar; under the name, the
 * month's line of Bitrix24's figure. All three stay pinned while the days
 * scroll (`sheetGrid.tsx`).
 *
 * KEPT FROM THE FIRST VERSION: the column under the pointer lights up; a
 * block's heading sticks under the header with «✓ mos» or «N farq» and folds
 * its block; a date holding a difference carries a red dot; every day cell
 * opens that day's orders (`onOpen`), so any figure is checked against its
 * deals.
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
  usePinnedColumns(box, 3)
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

  const groups = useMemo(() => sheetGroups(lines), [lines])
  const { blockGaps, dayFlags } = useMemo(() => readSheet(groups, days.length), [groups, days.length])
  const shown = useMemo(() => unfolded(groups, folded), [groups, folded])
  const span = days.length + 2

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
              className={`thead-sticky tcol-sticky rnp-label ${LABEL_WIDTH} ${RULE} h-12 py-2 pr-3 pl-4 text-left leading-tight sm:pl-5`}
              // `.tcol-sticky` paints the card; the corner belongs to the header band.
              style={{ left: 0, background: 'var(--surface-sunken)', color: 'var(--ink-primary)' }}
            >
              <span className="block text-[12px] font-bold">
                <span className="sr-only">Koʻrsatkich, </span>
                {days[0] && days.at(-1) ? `${dayMonthYear(days[0])} – ${dayMonthYear(days.at(-1)!)}` : 'Koʻrsatkich'}
              </span>
              <span className="mt-0.5 flex items-center gap-3 text-[10.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                <SourceTag side="bitrix" /> <SourceTag side="moysklad" />
              </span>
            </th>
            <th
              scope="col"
              title="Oy boshidan bugungacha, bugun ham hisobda"
              className={`thead-sticky ${PIN_TOTAL} ${RULE} min-w-[136px] px-3 py-2 text-right text-[12px] font-semibold whitespace-nowrap`}
              style={{ background: SUMMARY_HEAD, color: 'var(--ink-primary)' }}
            >
              Jami
            </th>
            <th
              scope="col"
              title="Oyning qancha qismi mos: kunlik farqlar (ishorasiz) ÷ Bitrix24 raqami. 100% — hamma kun mos"
              className={`thead-sticky ${PIN_MATCH} ${RULE} min-w-[96px] px-3 py-2 text-right text-[12px] font-semibold whitespace-nowrap`}
              style={{ background: SUMMARY_HEAD, color: 'var(--ink-primary)' }}
            >
              Moslik
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
          {shown.map(({ group, zebra }, n) => {
            const prev = n > 0 ? shown[n - 1]!.group : undefined
            if (group.kind === 'title') {
              const gap = prev ? (scopeOf(prev) !== group.line.scope ? 'scope' : 'block') : null
              return (
                <TitleRow
                  key={group.line.key}
                  line={group.line}
                  span={span}
                  gap={gap}
                  gaps={blockGaps.get(group.line.key) ?? 0}
                  open={!folded.has(group.line.key)}
                  onToggle={toggle}
                />
              )
            }
            if (group.kind === 'pair') {
              return <PairRows key={group.key} pair={group} days={days} today={today} zebra={zebra} onOpen={onOpen} />
            }
            return <SingleRow key={group.line.key} line={group.line} days={days} today={today} zebra={zebra} onOpen={onOpen} />
          })}
        </tbody>
      </table>
    </div>
  )
}

function scopeOf(group: KpiGroup): KpiSheetScope {
  return group.kind === 'pair' ? group.scope : group.line.scope
}

/** A heading's depth: a brand's block (1) holds its product blocks (2). */
function levelOf(line: Extract<KpiSheetLine, { kind: 'title' }>): number {
  return line.key.includes(':products:') ? 2 : 1
}

/** The groups a fold leaves on screen; every other figure in a block is shaded (`zebra`). */
function unfolded(groups: readonly KpiGroup[], folded: ReadonlySet<string>): { group: KpiGroup; zebra: boolean }[] {
  const out: { group: KpiGroup; zebra: boolean }[] = []
  let hiddenBelow: number | null = null
  let n = 0
  for (const group of groups) {
    if (group.kind === 'title') {
      const level = levelOf(group.line)
      if (hiddenBelow !== null && level > hiddenBelow) continue
      hiddenBelow = folded.has(group.line.key) ? level : null
      n = 0
      out.push({ group, zebra: false })
      continue
    }
    if (hiddenBelow !== null) continue
    out.push({ group, zebra: n % 2 === 1 })
    n += 1
  }
  return out
}

/**
 * What the sheet says about itself, once per payload: how many figures differ
 * in each block — a brand's block counting its product blocks too — and which
 * days hold any difference.
 */
function readSheet(groups: readonly KpiGroup[], dayCount: number) {
  const blockGaps = new Map<string, number>()
  const dayFlags: boolean[] = Array.from({ length: dayCount }, () => false)
  const open: string[] = []
  for (const group of groups) {
    if (group.kind === 'title') {
      open.length = levelOf(group.line) - 1
      open.push(group.line.key)
      blockGaps.set(group.line.key, 0)
      continue
    }
    if (group.kind !== 'pair') continue
    if (group.differs) for (const key of open) blockGaps.set(key, (blockGaps.get(key) ?? 0) + 1)
    group.gaps.forEach((gap, d) => {
      if (gap !== null && wholeGap(gap, group.unit) !== 0) dayFlags[d] = true
    })
  }
  return { blockGaps, dayFlags }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const LABEL_WIDTH = 'w-[184px] min-w-[184px] max-w-[184px] sm:w-[320px] sm:min-w-[320px] sm:max-w-[320px]'
const PIN_TOTAL = 'tcol-sticky rnp-pin left-[var(--sheet-left-1)]'
const PIN_MATCH = 'tcol-sticky rnp-pin rnp-edge left-[var(--sheet-left-2)]'
/** A heading sticks under the header while its block scrolls — over the rows, under the header. */
const STICK = { top: 'var(--sheet-head-h)' } as const

type TitleLine = Extract<KpiSheetLine, { kind: 'title' }>

/** The band's colour: the two brands in their colours everywhere else, both together in the company's green. */
function hueOf(scope: KpiSheetScope): string {
  return scope === 'all' ? 'var(--status-good)' : PRODUCT_TONE[scope]
}

/**
 * A heading band — sticky under the header, a button that folds its block,
 * and the block's verdict beside its name. A new brand opens with a wide,
 * sunken gap; a block inside it with a narrow one.
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
  const ground = `linear-gradient(90deg, ${mix(hue, 30, 'var(--surface-raised)')}, ${mix(hue, 12, 'var(--surface-raised)')})`
  const band = mix(hue, 8, 'var(--surface-raised)')
  return (
    <>
      {gap === 'block' && (
        <tr aria-hidden="true">
          <td colSpan={span + 1} className="h-4 p-0" />
        </tr>
      )}
      {gap === 'scope' && (
        <tr aria-hidden="true">
          <td colSpan={span + 1} className="h-8 border-y border-[var(--border-strong)] p-0" style={{ background: 'var(--surface-sunken)' }} />
        </tr>
      )}
      <tr data-line="title">
        <th
          scope="row"
          className={`tcol-sticky rnp-label ${LABEL_WIDTH} ${RULE} p-0 text-left leading-snug`}
          style={{ ...STICK, left: 0, zIndex: 2, backgroundColor: 'var(--surface-raised)', backgroundImage: ground, color: inkOf(hue) }}
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[4px]" style={{ background: hue }} />
          <button
            type="button"
            aria-expanded={open}
            onClick={() => onToggle(line.key)}
            title={open ? 'Blokni yigʻish' : 'Blokni ochish'}
            className="focusable flex w-full items-center gap-2 py-2.5 pr-3 pl-4 text-left sm:pl-5"
          >
            <span
              className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px]"
              style={{ background: mix(hue, 22, 'transparent'), color: inkOf(hue) }}
            >
              <ChevronGlyph direction={open ? 'down' : 'right'} size={11} />
            </span>
            <span className="min-w-0 flex-1 text-[13px] font-bold tracking-wide uppercase">{line.label}</span>
            <BlockChip gaps={gaps} />
          </button>
        </th>
        {/* The bands under the pinned «Jami» and «Moslik» pin with them, opaque, so the days pass beneath. */}
        <td className={`${PIN_TOTAL} ${RULE}`} style={{ ...STICK, zIndex: 2, backgroundColor: band }} />
        <td className={`${PIN_MATCH} ${RULE}`} style={{ ...STICK, zIndex: 2, backgroundColor: band }} />
        <td colSpan={span - 2} className={`sticky ${RULE}`} style={{ ...STICK, zIndex: 1, background: band }} />
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
      style={{ background: mix(color, 16, 'var(--surface-raised)'), color, boxShadow: `inset 0 0 0 1px ${mix(color, 30)}` }}
      title={matched ? 'Bu blokda Bitrix24 va MoySklad hamma kuni mos' : `Bu blokda ${gaps} ta koʻrsatkich farq qiladi`}
    >
      <Glyph size={10} className="shrink-0" />
      {matched ? 'mos' : `${gaps} farq`}
    </span>
  )
}

/** Every other figure in a block, a shade down — the pair reads as one band. */
const ZEBRA = mix('var(--ink-muted)', 4)

/**
 * One figure: its Bitrix24 row and its MoySklad row. The name, the month's
 * line and the «Moslik» sit on the first; the second carries MoySklad's
 * figures with each gap where it happened.
 */
const PairRows = memo(function PairRows({
  pair,
  days,
  today,
  zebra,
  onOpen,
}: {
  pair: KpiPair
  days: readonly string[]
  today: string
  zebra: boolean
  onOpen: (drill: KpiSheetDrill) => void
}) {
  const band = zebra ? ZEBRA : undefined
  const open = (day: string) => onOpen({ day, scope: pair.scope, basis: pair.basis })
  const totalGap = pair.gapTotal === null ? 0 : wholeGap(pair.gapTotal, pair.unit)
  return (
    <>
      <tr data-line="value" data-side="bitrix" className="transition-colors hover:bg-[var(--surface-sunken)]" style={band ? { backgroundImage: layers(band) } : undefined}>
        <th
          scope="row"
          className={`tcol-sticky rnp-label ${LABEL_WIDTH} border-b border-dashed border-[var(--grid)] pt-2 pr-3 pb-1 pl-4 text-left align-top text-[13px] leading-snug font-semibold sm:pl-5`}
          style={{ left: 0, color: 'var(--ink-primary)', ...(band ? { backgroundImage: layers(band) } : {}) }}
        >
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-1.5">
                {pair.differs && (
                  <span className="mt-[3px] inline-flex shrink-0" style={{ color: 'var(--status-critical)' }} title="Bu oy Bitrix24 va MoySklad farq qiladi">
                    <TriangleGlyph size={11} />
                  </span>
                )}
                <span>{pair.label}</span>
              </span>
              <Sparkline values={pair.bitrix.days} />
            </span>
            <SourceTag side="bitrix" />
          </span>
        </th>
        <td
          className={`${PIN_TOTAL} tabular border-b border-dashed border-[var(--grid)] px-3 py-1.5 text-right text-[13.5px] font-bold whitespace-nowrap`}
          style={{ color: 'var(--ink-primary)', backgroundImage: layers(TOTAL_CELL, band) }}
        >
          <Value value={pair.bitrix.total} unit={pair.unit} />
        </td>
        <td rowSpan={2} className={`${PIN_MATCH} ${GROUP_RULE} px-3 py-1.5 text-right align-middle`} style={{ backgroundImage: layers(TOTAL_CELL, band) }}>
          <Match value={pair.match} />
        </td>
        {pair.bitrix.days.map((value, i) => {
          const day = days[i] ?? ''
          return (
            <td
              key={day || i}
              data-c={i}
              title={value !== null ? `${dayMonthYear(day)} · Bitrix24 — buyurtmalarni ochish` : undefined}
              onClick={value !== null ? () => open(day) : undefined}
              className={`tabular border-b border-dashed border-[var(--grid)] ${VRULE} px-3 py-1.5 text-right text-[13px] whitespace-nowrap ${value !== null ? 'cursor-pointer' : ''} ${i === days.length - 1 ? 'pr-5' : ''}`}
              style={{ color: 'var(--ink-primary)', ...dayCellStyle(day, today) }}
            >
              <Value value={value} unit={pair.unit} />
            </td>
          )
        })}
      </tr>
      <tr data-line="value" data-side="moysklad" className="transition-colors hover:bg-[var(--surface-sunken)]" style={band ? { backgroundImage: layers(band) } : undefined}>
        <th
          scope="row"
          className={`tcol-sticky rnp-label ${LABEL_WIDTH} ${GROUP_RULE} pt-1 pr-3 pb-2 pl-4 text-left text-[12px] leading-snug font-medium sm:pl-5`}
          style={{ left: 0, color: 'var(--ink-secondary)', ...(band ? { backgroundImage: layers(band) } : {}) }}
        >
          <span className="flex items-center justify-end">
            <span className="sr-only">{pair.label}, </span>
            <SourceTag side="moysklad" />
          </span>
        </th>
        <td
          className={`${PIN_TOTAL} tabular ${GROUP_RULE} px-3 py-1.5 text-right text-[13px] font-semibold whitespace-nowrap`}
          style={{ color: totalGap === 0 ? 'var(--ink-secondary)' : 'var(--status-critical)', backgroundImage: layers(TOTAL_CELL, band) }}
        >
          <span className="flex flex-col items-end gap-0.5">
            <Value value={pair.moysklad.total} unit={pair.unit} />
            {totalGap !== 0 && <GapChip gap={totalGap} unit={pair.unit} />}
          </span>
        </td>
        {pair.moysklad.days.map((value, i) => {
          const day = days[i] ?? ''
          const gap = pair.gaps[i] ?? null
          const off = gap !== null && wholeGap(gap, pair.unit) !== 0
          const base = dayCellStyle(day, today)
          return (
            <td
              key={day || i}
              data-c={i}
              title={
                value === null
                  ? undefined
                  : off
                    ? `${dayMonthYear(day)} · MoySklad ${figureText(value, pair.unit)}, Bitrix24 ${figureText(pair.bitrix.days[i] ?? 0, pair.unit)} — buyurtmalarni ochish`
                    : `${dayMonthYear(day)} · MoySklad — buyurtmalarni ochish`
              }
              onClick={value !== null ? () => open(day) : undefined}
              className={`tabular ${GROUP_RULE} ${VRULE} px-3 py-1.5 text-right text-[13px] whitespace-nowrap ${value !== null ? 'cursor-pointer' : ''} ${i === days.length - 1 ? 'pr-5' : ''}`}
              style={
                off
                  ? { ...base, color: 'var(--status-critical)', background: OFF_CELL, boxShadow: `inset 2px 0 0 var(--status-critical)${base.boxShadow ? `, ${base.boxShadow}` : ''}` }
                  : { ...base, color: 'var(--ink-secondary)' }
              }
            >
              {value === null ? null : off ? (
                <span className="flex flex-col items-end gap-0.5">
                  <span className="font-semibold">{figureText(value, pair.unit)}</span>
                  <GapChip gap={wholeGap(gap ?? 0, pair.unit)} unit={pair.unit} />
                </span>
              ) : (
                <Value value={value} unit={pair.unit} />
              )}
            </td>
          )
        })}
      </tr>
    </>
  )
})

/** «Farqli buyurtmalar» — one row, a count: red where there are any, a quiet dash where none. */
const SingleRow = memo(function SingleRow({
  line,
  days,
  today,
  zebra,
  onOpen,
}: {
  line: KpiSheetValueLine
  days: readonly string[]
  today: string
  zebra: boolean
  onOpen: (drill: KpiSheetDrill) => void
}) {
  const band = zebra ? ZEBRA : undefined
  const count = (value: number | null) =>
    value === null ? null : value === 0 ? (
      <span style={{ color: 'var(--ink-muted)' }}>—</span>
    ) : (
      <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--status-critical)' }}>
        <TriangleGlyph size={9} className="shrink-0" />
        {figureText(value, 'count')}
      </span>
    )
  return (
    <tr data-line="value" data-side="mismatch" className="transition-colors hover:bg-[var(--surface-sunken)]" style={band ? { backgroundImage: layers(band) } : undefined}>
      <th
        scope="row"
        className={`tcol-sticky rnp-label ${LABEL_WIDTH} ${GROUP_RULE} py-2 pr-3 pl-4 text-left text-[13px] leading-snug font-semibold sm:pl-5`}
        style={{ left: 0, color: 'var(--ink-primary)', ...(band ? { backgroundImage: layers(band) } : {}) }}
      >
        {line.label}
        <span className="block text-[10.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>
          ikki tizimda bir xil chiqmagan buyurtmalar
        </span>
      </th>
      <td className={`${PIN_TOTAL} tabular ${GROUP_RULE} px-3 py-1.5 text-right text-[13.5px] whitespace-nowrap`} style={{ backgroundImage: layers(TOTAL_CELL, band) }}>
        {count(line.total)}
      </td>
      <td className={`${PIN_MATCH} ${GROUP_RULE}`} style={{ backgroundImage: layers(TOTAL_CELL, band) }} />
      {line.days.map((value, i) => {
        const day = days[i] ?? ''
        return (
          <td
            key={day || i}
            data-c={i}
            title={value ? `${dayMonthYear(day)} — farqli buyurtmalarni ochish` : undefined}
            onClick={value !== null ? () => onOpen({ day, scope: line.scope, basis: line.basis }) : undefined}
            className={`tabular ${GROUP_RULE} ${VRULE} px-3 py-1.5 text-right text-[13px] whitespace-nowrap ${value !== null ? 'cursor-pointer' : ''} ${i === days.length - 1 ? 'pr-5' : ''}`}
            style={value ? { ...dayCellStyle(day, today), background: OFF_CELL } : dayCellStyle(day, today)}
          >
            {count(value)}
          </td>
        )
      })}
    </tr>
  )
})

// ---------------------------------------------------------------------------
// Cell pieces
// ---------------------------------------------------------------------------

/** «Bitrix24» / «MoySklad» — a dot in the system's colour and its name, quiet. */
function SourceTag({ side }: { side: 'bitrix' | 'moysklad' }) {
  const hue = side === 'bitrix' ? BITRIX_HUE : MOYSKLAD_HUE
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] font-semibold tracking-wide whitespace-nowrap" style={{ color: inkOf(hue) }}>
      <span aria-hidden="true" className="inline-block size-[7px] rounded-full" style={{ background: hue }} />
      <span className="sm:hidden">{side === 'bitrix' ? 'B24' : 'MS'}</span>
      <span className="max-sm:hidden">{side === 'bitrix' ? 'Bitrix24' : 'MoySklad'}</span>
    </span>
  )
}

const BITRIX_HUE = 'var(--series-1)'
const MOYSKLAD_HUE = 'var(--series-3)'

/** A figure in full, a nought quiet. */
function Value({ value, unit }: { value: number | null; unit: KpiPair['unit'] }): ReactNode {
  if (value === null) return null
  if (value === 0) return <span style={{ color: 'var(--ink-muted)' }}>0</span>
  return <>{figureText(value, unit)}</>
}

/** The gap as a small red pill with its direction: ▲ more in MoySklad, ▼ more in Bitrix24. */
function GapChip({ gap, unit }: { gap: number; unit: KpiPair['unit'] }) {
  const Arrow = gap > 0 ? ArrowUpGlyph : ArrowDownGlyph
  const text = figureText(Math.abs(gap), unit)
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10.5px] leading-[16px] font-bold"
      style={{ background: mix('var(--status-critical)', 18), color: 'var(--status-critical)' }}
      aria-label={`farq ${gap > 0 ? '+' : '−'}${text}`}
    >
      <Arrow size={9} className="shrink-0" />
      {text}
    </span>
  )
}

/** «Moslik»: the per cent and a bar, green when every day agrees, amber from 99%, red under it. */
function Match({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--ink-muted)' }}>—</span>
  const whole = value >= 99.995
  const tone = whole ? 'var(--status-good)' : value >= 99 ? 'var(--status-warning)' : 'var(--status-critical)'
  return (
    <span className="inline-flex flex-col items-end gap-1" title={whole ? 'Hamma kun mos' : `Oyning ${rnpPercent(value)} qismi mos`}>
      <span className="tabular inline-flex items-center gap-1 text-[12.5px] font-bold" style={{ color: mix(tone, 80, 'var(--ink-primary)') }}>
        {whole && <CheckCircleGlyph size={11} className="shrink-0" />}
        {whole ? '100%' : rnpPercent(Math.floor(value * 10) / 10)}
      </span>
      <span className="block h-[4px] w-[56px] overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
        {/* The bar starts at 90%: under it every bar would read full, and over it a 99,7% is what needs seeing. */}
        <span className="block h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, (value - 90) * 10))}%`, background: tone }} />
      </span>
    </span>
  )
}

/** The month's line of a figure, Bitrix24's days so far — its shape, not its scale. */
function Sparkline({ values }: { values: readonly (number | null)[] }) {
  const points = values.flatMap((v, i) => (v === null ? [] : [{ i, v }]))
  if (points.length < 2) return null
  const max = Math.max(...points.map((p) => p.v))
  const min = Math.min(...points.map((p) => p.v))
  const W = 84
  const H = 14
  const last = values.length - 1 || 1
  const x = (i: number) => (i / last) * W
  const y = (v: number) => (max === min ? H / 2 : H - 1 - ((v - min) / (max - min)) * (H - 2))
  const d = points.map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const end = points[points.length - 1]!
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="mt-1 block overflow-visible" style={{ color: BITRIX_HUE }}>
      <path d={d} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(end.i)} cy={y(end.v)} r={1.8} fill="currentColor" />
    </svg>
  )
}

/** The rule under a whole figure — the pair's own rule inside it is dashed. */
const GROUP_RULE = 'border-b border-[var(--border)]'
/** The pinned «Jami» and «Moslik» cells: a whisper of ink, so the pinned block reads as one panel. */
const TOTAL_CELL = mix('var(--ink-muted)', 6)
/** A day the two systems disagree on. */
const OFF_CELL = mix('var(--status-critical)', 11)
