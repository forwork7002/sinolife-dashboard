'use client'

import { type ReactNode, type UIEvent, memo, useLayoutEffect, useMemo, useRef } from 'react'

import { InfoTip, Tooltip } from '@/components/ui/Tooltip'

import {
  RNP_ADDED_TEAM_NOTE,
  type RnpBlockDto,
  type RnpLabelTone,
  type RnpLine,
  type RnpManual,
  type RnpRowDto,
  type RnpUnit,
} from './rnpApi'
import { CostDayCell } from './RnpCostCell'
import { ColumnResizer } from './RnpColumnResizer'
import { type RnpColumnKind, widthCss } from './rnpColumnWidths'
import { type RnpTone, TONE_COLOR, dayMonth, dayMonthYear, dayTone, indexTone, isSunday, weekday } from './rnpDerive'
import { figureText, formatUsd, rnpGrade, rnpNumber, rnpPercent, rnpUzs } from './rnpFigures'
import { useDragScroll } from './useDragScroll'

/**
 * «RNP jadvali» AS THE CLIENT'S SHEET — «СентябрРНП 26», row by row, in ONE
 * grid (the client, 2026-09-30: «faqat jadval … to'liqligicha»).
 *
 * The rows are `data.lines`, built on the server (`rnpSheetView.ts`): a
 * heading band, or a metric row whose figures are the `RnpRowDto` its `key`
 * names. A row the sheet has and Bitrix24 cannot supply (`key: null`) keeps
 * its place, empty, hatched and marked «Bitrix24ʼda yoʻq». The columns are
 * the sheet's, in its order since the client reshaped it (2026-09-30): A the
 * label (with column B's text — the ROP, «без квал», «факт1» — beside it),
 * then План обший, Факт, Прогноз, Индекс, Кунлик план, then every day.
 *
 * THE TYPED EXCEPTIONS: a row with `manual` — the P&L's five cost lines
 * (2026-09-30) and each ROP's «Ходим сони» (2026-10-01) — wears a «qoʻlda»
 * chip, and for a `kpi:manage` account each of its days up to today is a
 * `CostDayCell` — an always-open field, typed straight into. Only those ~22
 * rows are interactive; every other cell stays a plain `<td>`. Their summary
 * columns stay computed.
 *
 * ONE SCROLL BOX, FROZEN LIKE THE SHEET. The box takes the height the page
 * leaves it (`PageShell`'s `fill`) and scrolls both ways inside it: the
 * column headers stay on top over ~370 rows (the sheet's frozen row 3), the
 * label column stays on the left over thirty days. It borrows DataTable's
 * `.thead-sticky` / `.tcol-sticky` so it pins and hovers like every table in
 * the product.
 *
 * План обший, Факт and Прогноз pin beside the label too (the client,
 * 2026-10-01: «plan obshiy va fakt va prognoz gacha zakrepit qilish kerak»),
 * so a day far to the right still reads against its month. Their `left`
 * offsets are MEASURED from the header (`usePinnedSummary`) — a column grows
 * with its widest figure, so the declared widths are not the answer — and
 * they pin only while the box has room for days beside them; on a phone the
 * four would cover the screen, so there only the label pins, as before.
 *
 * NO FIGURE IS EVER CUT (2026-09-29, «sonlar to'liq yozilishi kerak»). Every
 * number is written in full (`rnpFigures.ts`); each column is at least as
 * wide as the widest figure its kind prints (`--rnp-min-*` on the scope), and
 * the layout is `table-layout: auto` with `nowrap` cells, so a figure that
 * estimate missed widens its column rather than being clipped. The widths are
 * CSS variables set once on `RnpColumnScope`: a column drag re-lays the table
 * and re-renders no cell.
 *
 * COLOUR ONLY WHERE IT IS READ (the client, 2026-10-01: «plan bajarish,
 * fakt 1, konversiya shularga rang berilsin, qolganiga rang kerak emas»):
 * the headings keep the sheet's bands (orange section, blue team, green
 * company), and of the figure rows only three kinds are tinted — «План
 * бажарилиши» blue with its plan figures violet, «Сумма факт 1» green, every
 * «Конверсия» teal — with their index pill; of them only a summed row
 * («Сумма факт 1») also tints its days against the day plan (`dayTone`), a
 * ratio row («План бажарилиши», «Конверсия») carries the pill alone. Every
 * other row is plain ink on the card. Today's and Sunday's
 * columns stay marked: they are where in the month, not a row's colour.
 * The pinned label column stays plain on «Сумма факт 1» and «Конверсия» —
 * only their figures are tinted («chapdagi panel boʻyalmasin», 2026-10-01);
 * the ROP's «План бажарилиши» heading keeps its label tint, and each
 * logistics block's heading takes its green, ROP chip too (2026-10-02).
 * Every tint is a `color-mix`, opaque over the card in the pinned column so
 * the days cannot show through it.
 *
 * PERFORMANCE. ~370 lines × ~36 cells. Each line is memoised on its line
 * object and its row object, both stable for one payload, so nothing but a
 * refetch redraws a line; the «scrolled sideways» divider is a data attribute
 * on the box (see `markScrolledX`), not React state, so the first sideways
 * scroll does not redraw thirteen thousand cells.
 */
export function RnpSheetTable({
  lines,
  blocks,
  days,
  today,
  editCostsFor = null,
}: {
  lines: readonly RnpLine[]
  blocks: readonly RnpBlockDto[]
  days: readonly string[]
  today: string
  /** The month typed P&L costs are saved under; null (the default) = read-only. */
  editCostsFor?: string | null
}) {
  // Built once per payload: every value line looks its figures up here.
  const rows = useMemo(() => rowsByKey(blocks), [blocks])
  const width = useMemo(
    () => `calc(${[widthCss('label'), ...SUMMARY.map((c) => widthCss(c.key))].join(' + ')} + ${days.length} * ${widthCss('day')})`,
    [days.length],
  )
  const span = SUMMARY.length + days.length
  const dragScroll = useDragScroll<HTMLDivElement>()
  const box = useRef<HTMLDivElement>(null)
  usePinnedSummary(box)

  return (
    <div
      ref={box}
      data-rnp-grid=""
      role="region"
      aria-label="RNP jadvali"
      // A scroll box a keyboard can reach and scroll with the arrow keys.
      tabIndex={0}
      className="focusable relative h-full min-h-0 overflow-auto overscroll-contain [&_td]:cursor-grab data-[panning]:cursor-grabbing data-[panning]:select-none data-[panning]:[&_td]:cursor-grabbing"
      {...dragScroll}
      onScroll={markScrolledX}
    >
      <table className="table-auto border-separate border-spacing-0 text-sm" style={{ width }}>
        <caption className="sr-only">
          RNP jadvali, {days[0] ? dayMonthYear(days[0]) : ''} – {days.at(-1) ? dayMonthYear(days.at(-1)!) : ''}
        </caption>
        <colgroup>
          <col data-col-kind="label" style={{ width: widthCss('label') }} />
          {SUMMARY.map((c) => (
            <col key={c.key} data-col-kind={c.key} style={{ width: widthCss(c.key) }} />
          ))}
          {days.map((d) => (
            <col key={d} data-col-kind="day" style={{ width: widthCss('day') }} />
          ))}
        </colgroup>
        <Head days={days} today={today} />
        <tbody>
          {lines.map((line, i) => {
            const row = line.kind === 'value' && line.key !== null ? (rows.get(line.key) ?? null) : null
            return (
              <Line
                // The lines are one payload's, in a fixed order: the index is their identity.
                key={i}
                line={line}
                row={row}
                gap={i > 0 ? gapBefore(line, lines[i - 1]!) : null}
                days={days}
                today={today}
                span={span}
                // Only a row with a typed cell gets the month, so every other line's memo is untouched by it.
                editMonth={row?.manual || row?.planInput ? editCostsFor : null}
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
 * `[data-scrolled-x]` on the box, read by `.rnp-edge` / `.rnp-label` in
 * globals.css. An attribute and not state: state would redraw every line.
 */
function markScrolledX(e: UIEvent<HTMLDivElement>) {
  const box = e.currentTarget
  const scrolled = box.scrollLeft > 0
  if (scrolled !== box.hasAttribute('data-scrolled-x')) box.toggleAttribute('data-scrolled-x', scrolled)
}

/**
 * The summary columns that pin beside the label, and the CSS that places them:
 * each `left` is a custom property `usePinnedSummary` writes on the box. Class
 * strings in full, so Tailwind sees them.
 */
const PINNED = ['plan', 'fact', 'forecast'] as const
type PinnedKey = (typeof PINNED)[number]
const PIN_LEFT: Record<PinnedKey, string> = {
  plan: 'left-[var(--rnp-left-plan)]',
  fact: 'left-[var(--rnp-left-fact)]',
  forecast: 'left-[var(--rnp-left-forecast)]',
}

function isPinned(key: RnpColumnKind): key is PinnedKey {
  return (PINNED as readonly string[]).includes(key)
}

/** A pinned summary cell's classes; the last of them carries the divider (`.rnp-edge` in globals.css). */
function pinClass(key: PinnedKey): string {
  return `tcol-sticky rnp-pin ${PIN_LEFT[key]}${key === PINNED.at(-1) ? ' rnp-edge' : ''}`
}

/** Room the pinned block must leave for days, about three of them; less and only the label pins. */
const ROOM_FOR_DAYS = 280

/**
 * Measures the label and the pinned summary headers and writes their running
 * offsets on the box (`--rnp-left-*`), and `data-pin-wide` when the box is
 * wide enough to pin them. Straight onto the DOM, like `markScrolledX`: a
 * column drag or a window resize re-measures without redrawing a cell.
 *
 * The frozen parts are the box's scroll padding too (2026-10-02): a field Tab
 * reaches is scrolled clear of the pinned block (the label alone when narrow)
 * and of the header row, not merely into the box, under them.
 */
function usePinnedSummary(ref: { readonly current: HTMLDivElement | null }) {
  useLayoutEffect(() => {
    const box = ref.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const heads = Array.from(box.querySelectorAll<HTMLElement>('thead th')).slice(0, 1 + PINNED.length)
    const measure = () => {
      let left = 0
      heads.forEach((th, i) => {
        if (i > 0) box.style.setProperty(`--rnp-left-${PINNED[i - 1]}`, `${left}px`)
        left += th.getBoundingClientRect().width
      })
      const wide = left + ROOM_FOR_DAYS <= box.clientWidth
      if (wide !== box.hasAttribute('data-pin-wide')) box.toggleAttribute('data-pin-wide', wide)
      const corner = heads[0]?.getBoundingClientRect()
      box.style.scrollPaddingLeft = `${wide ? left : (corner?.width ?? 0)}px`
      box.style.scrollPaddingTop = `${corner?.height ?? 0}px`
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    for (const th of heads) observer.observe(th)
    return () => observer.disconnect()
  }, [ref])
}

/**
 * Scrolls the grid so today's column sits just right of the frozen block —
 * the toolbar's «Bugun» (2026-10-02), for the 25th, when today is twenty-odd
 * columns to the right. The frozen width is the scroll padding
 * `usePinnedSummary` keeps. A month without today has nothing to scroll to.
 */
export function scrollToToday(box: HTMLElement): void {
  const today = box.querySelector<HTMLElement>('thead th[aria-current="date"]')
  if (!today) return
  const frozen = Number.parseFloat(box.style.scrollPaddingLeft) || 0
  box.scrollLeft = Math.max(0, box.scrollLeft + today.getBoundingClientRect().left - box.getBoundingClientRect().left - frozen)
}

function rowsByKey(blocks: readonly RnpBlockDto[]): Map<string, RnpRowDto> {
  const out = new Map<string, RnpRowDto>()
  for (const block of blocks) for (const row of block.rows) if (!out.has(row.key)) out.set(row.key, row)
  return out
}

/**
 * The sheet leaves blank rows between its blocks: a heading after figures
 * opens with a gap — a title band, a team's first row, or an orange section
 * row that does not follow the row before it on the sheet («Коллаген
 * проект», «Регистрация COLLAGEN») or follows a line the sheet does not have
 * at all («Свод» after an added team's logistics, 2026-10-02).
 *
 * A ROP's block — its team block or its logistics block — opens with a wider,
 * ruled, sunken gap, even where the sheet runs one ROP's rows into the next, so each ROP reads as its own table
 * inside the one grid (the client, 2026-10-01: «bir jadval bo'lsin … faqat
 * bir biridan sal ajralib turishi kerak»).
 *
 * So does each company-wide table under them — «Свод», «Коллаген проект»,
 * «Зехтра проект» (the client, 2026-10-02: «bitta joy qilib ajratib bersin»).
 */
type Gap = 'block' | 'rop'

/** The sheet rows that open «Свод», «Коллаген проект» and «Зехтра проект». */
const OWN_TABLE_ROWS: ReadonlySet<number> = new Set([346, 394, 421])

function gapBefore(line: RnpLine, prev: RnpLine): Gap | null {
  if (prev.kind !== 'value' || prev.tone === 'team') return null
  // A new ROP's rows — where the sheet has no blank row too, as between the logistics blocks.
  if (line.kind === 'value' && line.team !== null && line.team !== prev.team) return 'rop'
  if (line.row !== null && OWN_TABLE_ROWS.has(line.row)) return 'rop'
  const opens =
    line.kind === 'title' || line.tone === 'team' || (line.tone === 'section' && line.row !== null && (prev.row === null || line.row - prev.row > 1))
  return opens ? 'block' : null
}

// ---------------------------------------------------------------------------
// Header — the sheet's frozen row 3
// ---------------------------------------------------------------------------

/**
 * The sheet's order since 2026-09-30: «Кунлик план» after «Индекс», beside the
 * days it is the plan of. Each header says its formula on hover (2026-10-02),
 * so «why ×30 is not the plan» is answered without asking (`rnpSheet.ts`).
 */
const SUMMARY = [
  { key: 'plan', header: 'План обший', hint: 'Oy rejasi (jadvalning C ustuni)' },
  { key: 'fact', header: 'Факт', hint: 'Oy boshidan bugungacha, bugun ham hisobda' },
  { key: 'forecast', header: 'Прогноз', hint: 'Fakt ÷ oʻtgan kunlar × oydagi kunlar' },
  { key: 'index', header: 'Индекс, %', hint: 'Prognoz ÷ reja; foizli qatorda — fakt ÷ reja' },
  { key: 'dayPlan', header: 'Кунлик план', hint: 'Reja ÷ 27; foizli qatorda — oy rejasining oʻzi' },
] as const satisfies readonly { key: RnpColumnKind; header: string; hint: string }[]

const Head = memo(function Head({ days, today }: { days: readonly string[]; today: string }) {
  const first = days[0]
  const last = days.at(-1)
  return (
    <thead>
      <tr style={{ color: 'var(--ink-secondary)' }}>
        <th
          scope="col"
          className={`thead-sticky tcol-sticky rnp-label ${RULE} h-12 py-2 pr-3 pl-4 text-left text-[12px] leading-tight font-bold sm:pl-5 sm:whitespace-nowrap`}
          // `.tcol-sticky` paints the card; the corner belongs to the header band.
          style={{ left: 0, background: 'var(--surface-sunken)', color: 'var(--ink-primary)' }}
        >
          <span className="sr-only">Koʻrsatkich, </span>
          {first && last ? `${dayMonthYear(first)} – ${dayMonthYear(last)}` : 'Koʻrsatkich'}
          <ColumnResizer kind="label" name="Koʻrsatkich" />
        </th>
        {SUMMARY.map((c, i) => (
          <th
            key={c.key}
            scope="col"
            title={c.hint}
            className={`thead-sticky ${isPinned(c.key) ? pinClass(c.key) : ''} ${RULE} px-3 py-2 text-right text-[12px] font-semibold whitespace-nowrap`}
            style={{
              // Only the pinned panel wears the band; Индекс and Кунлик план scroll with the days and look like them.
              background: isPinned(c.key) ? SUMMARY_HEAD : undefined,
              color: c.key === 'fact' ? 'var(--ink-primary)' : undefined,
              boxShadow: i === SUMMARY.length - 1 ? DIVIDER_RIGHT : undefined,
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
              className={`thead-sticky tabular ${RULE} px-3 py-1.5 text-right whitespace-nowrap ${i === days.length - 1 ? 'pr-5' : ''}`}
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
              <ColumnResizer kind="day" name="kunlar" tabbable={i === 0} />
            </th>
          )
        })}
      </tr>
    </thead>
  )
})

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * One line of the sheet — memoised on the line and its row, which are the
 * payload's own objects, so it redraws only when a refetch hands in new ones.
 */
const Line = memo(function Line({
  line,
  row,
  gap,
  days,
  today,
  span,
  editMonth,
}: {
  line: RnpLine
  row: RnpRowDto | null
  gap: Gap | null
  days: readonly string[]
  today: string
  span: number
  /** Set on a typed row for an editor: the month its days save under. */
  editMonth: string | null
}) {
  return (
    <>
      {gap === 'block' && (
        <tr aria-hidden="true" data-gap="">
          <td colSpan={span + 1} className="h-3 p-0" />
        </tr>
      )}
      {gap === 'rop' && (
        <tr aria-hidden="true" data-gap="rop">
          <td colSpan={span + 1} className="h-6 border-y border-[var(--border-strong)] p-0" style={{ background: 'var(--surface-sunken)' }} />
        </tr>
      )}
      {line.kind === 'title' ? (
        <TitleRow line={line} span={span} />
      ) : row === null ? (
        <MissingRow line={line} span={span} />
      ) : (
        <ValueRow line={line} row={row} days={days} today={today} editMonth={editMonth} />
      )}
    </>
  )
})

type TitleLine = Extract<RnpLine, { kind: 'title' }>
type ValueLine = Extract<RnpLine, { kind: 'value' }>

/** A heading band: the sheet's orange section, blue team or green company row. */
function TitleRow({ line, span }: { line: TitleLine; span: number }) {
  const hue = hueOf(line.tone) ?? 'var(--ink-muted)'
  return (
    <tr data-line="title" data-tone={line.tone}>
      <th
        scope="row"
        className={`tcol-sticky rnp-label ${RULE} py-2 pr-3 pl-4 text-left leading-snug sm:pl-5`}
        style={{ left: 0, background: mix(hue, 18, 'var(--surface-raised)'), color: inkOf(hue) }}
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: hue }} />
        <LabelBody line={line} heading />
      </th>
      {/* The band under the pinned summary pins with it, opaque, so the days pass beneath. */}
      <td
        colSpan={PINNED.length}
        className={`${pinClass('plan')} rnp-edge ${RULE}`}
        style={{ backgroundColor: 'var(--surface-raised)', backgroundImage: layers(mix(hue, 9)) }}
      />
      <td colSpan={span - PINNED.length} className={RULE} style={{ background: mix(hue, 9) }} />
    </tr>
  )
}

/** A row the sheet has and Bitrix24 cannot supply: kept in place, empty, marked. */
function MissingRow({ line, span }: { line: ValueLine; span: number }) {
  return (
    <tr data-line="missing" data-tone={line.tone}>
      <th
        scope="row"
        className={`tcol-sticky rnp-label ${RULE} py-1.5 pr-3 pl-4 text-left text-[13px] leading-snug font-medium sm:pl-5`}
        style={{ left: 0, ...labelStyle(headHue(line)) }}
      >
        <LabelBody line={line} chipHue={logisticsHue(line)} />
      </th>
      {/* The mark sits in the empty span, not under the label, so the row stays one line tall. */}
      <td colSpan={PINNED.length} className={`${pinClass('plan')} rnp-edge ${RULE} px-3 py-1.5`} style={{ backgroundImage: HATCH }}>
        <MissingChip />
      </td>
      <td colSpan={span - PINNED.length} className={RULE} style={{ background: HATCH }} />
    </tr>
  )
}

function ValueRow({
  line,
  row,
  days,
  today,
  editMonth,
}: {
  line: ValueLine
  row: RnpRowDto
  days: readonly string[]
  today: string
  editMonth: string | null
}) {
  const bold = line.bold || line.fact === 'fakt' || line.tone === 'team'
  const accent = accentOf(line)
  const band = accent ? ACCENT[accent].band : undefined
  const unreliable = row.reliableFrom
    ? `Bitrix24 da bu maydon ${dayMonth(row.reliableFrom)} dan toʻliq — bu kun oy fakti va prognoziga kirmaydi`
    : undefined
  const planTint = accent === 'plan' ? ACCENT.plan.fact : undefined
  const head = headHue(line)

  return (
    <tr
      data-line="value"
      data-tone={line.tone}
      data-accent={accent ?? undefined}
      className={`transition-colors hover:bg-[var(--surface-sunken)] ${bold ? 'font-semibold' : ''}`}
      // An image, not the colour: an inline colour beat the hover class, and the days of a tinted row never lit up.
      style={band ? { backgroundImage: layers(band) } : undefined}
    >
      <th
        scope="row"
        className={`tcol-sticky rnp-label ${RULE} py-1.5 pr-3 pl-4 text-left text-[13px] leading-snug sm:pl-5 ${bold ? 'font-semibold' : 'font-medium'}`}
        style={{ left: 0, ...labelStyle(head) }}
      >
        {head !== null && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: head }} />}
        <LabelBody line={line} hint={row.hint} manual={row.manual?.kind ?? null} chipHue={logisticsHue(line)} />
      </th>
      {editMonth !== null && row.planInput !== null ? (
        // One of the sheet's typed plans (column C): an open field, like the typed days. Keyed by what it
        // saves, so a field's typed text never outlives a month or a ROP switch into another plan.
        <CostDayCell
          key={`${editMonth}:${row.key}`}
          month={editMonth}
          day=""
          manual={{ kind: 'plan', team: row.planInput.team, metric: row.planInput.metric, unit: row.planUnit ?? row.unit }}
          label={`${row.planInput.team || 'Kompaniya'} · ${line.label || row.label}`}
          value={row.plan}
          className={`${pinClass('plan')} tabular ${RULE} ${VRULE} h-9 text-right whitespace-nowrap ${planTint !== undefined ? 'font-semibold' : ''}`}
          style={{ color: 'var(--ink-primary)', backgroundImage: layers(planTint ?? SUMMARY_CELL, band) }}
        />
      ) : (
        <Cell pin="plan" band={band} tint={planTint} strong={planTint !== undefined}>
          {/* A plan may be in its own unit: the brand P&L's success share over a soʻm row. */}
          {figure(row.plan, row.planUnit ?? row.unit)}
        </Cell>
      )}
      <Cell pin="fact" band={band} tint={accent ? ACCENT[accent].fact : undefined} strong>
        {figure(row.fact, row.unit)}
      </Cell>
      <Cell pin="forecast" band={band}>
        {figure(row.forecast, row.unit)}
      </Cell>
      <Cell>{index(row.index, row.better, accent !== null)}</Cell>
      <Cell last>{figure(row.dayPlan, row.unit)}</Cell>
      {row.days.map((value, i) => {
        const day = days[i] ?? ''
        const early = row.reliableFrom !== null && day < row.reliableFrom
        const tone = accent ? dayTone(row, value, day, today) : 'neutral'
        const isToday = day === today
        const title = early ? unreliable : tone !== 'neutral' && row.dayPlan !== null ? `Kunlik reja: ${plain(row.dayPlan, row.unit)}` : undefined
        const className = `tabular ${RULE} ${VRULE} h-9 text-right whitespace-nowrap`
        const style = {
          color: early ? 'var(--ink-muted)' : 'var(--ink-primary)',
          background: isToday ? TODAY_CELL : tone !== 'neutral' ? TINT[tone] : isSunday(day) ? SUNDAY_CELL : undefined,
          boxShadow: isToday ? TODAY_RULE : undefined,
        }
        // A typed row's day, up to today — the server draws no figure for a day not lived yet.
        if (editMonth !== null && row.manual !== null && day !== '' && day <= today) {
          return (
            <CostDayCell
              key={`${row.key}:${day}`}
              month={editMonth}
              day={day}
              manual={row.manual}
              // Twelve «Ходим сони» rows and two «Блогерлар» rows: the owner tells their fields apart.
              label={`${row.manual.kind === 'headcount' ? row.manual.rop : row.manual.project} · ${line.label || row.label}, ${dayMonth(day)}`}
              value={value}
              className={className}
              last={i === days.length - 1}
              style={style}
              title={title}
            />
          )
        }
        return (
          <td key={day || i} title={title} className={`${className} px-3 py-1.5 ${i === days.length - 1 ? 'pr-5' : ''}`} style={style}>
            {figure(value, row.unit)}
          </td>
        )
      })}
    </tr>
  )
}

/**
 * A summary cell. A pinned one (`pin`) is opaque — the card under its tint and
 * its row's `band`, painted as layers so `.tcol-sticky`'s hover still reaches
 * the card colour beneath them.
 */
function Cell({
  children,
  tint,
  strong = false,
  last = false,
  pin,
  band,
}: {
  children: ReactNode
  tint?: string
  strong?: boolean
  last?: boolean
  pin?: PinnedKey
  band?: string
}) {
  const fill = tint ?? (pin ? SUMMARY_CELL : undefined)
  return (
    <td
      className={`${pin ? pinClass(pin) : ''} tabular ${RULE} ${VRULE} h-9 px-3 py-1.5 text-right whitespace-nowrap ${strong ? 'font-semibold' : ''}`}
      style={{
        color: strong ? 'var(--ink-primary)' : 'var(--ink-secondary)',
        ...(pin ? { backgroundImage: layers(fill, band) } : { background: fill }),
        boxShadow: last ? DIVIDER_RIGHT : undefined,
      }}
    >
      {children}
    </td>
  )
}

// ---------------------------------------------------------------------------
// The label cell — column A, with column B's text
// ---------------------------------------------------------------------------

/**
 * What the label cell says. A team's row puts the ROP first — it is what the
 * reader scans for — with the sheet's label under it; a heading's owner
 * («Хаёт», «Жавохир») is a dark pill, the sheet's black cell; an empty label
 * with a sub («квал», «квал %») is the sub, indented under its group.
 */
function LabelBody({
  line,
  heading = false,
  hint = null,
  manual = null,
  chipHue = null,
}: {
  line: RnpLine
  heading?: boolean
  hint?: string | null
  /** A row typed by hand (`RnpRowDto.manual`): says so, and what is typed, with a chip. */
  manual?: RnpManual['kind'] | null
  /** The owner chip's colour; plain when null. */
  chipHue?: string | null
}) {
  // An added team's block says so on its first line (`added`); an older payload's heading carried the note as its sub.
  const legacy = line.sub === RNP_ADDED_TEAM_NOTE
  const added = legacy || line.added === true
  const sub = legacy ? null : line.sub
  const extras = (
    <>
      {added && <AddedChip />}
      {manual && <ManualChip kind={manual} />}
      {hint && <InfoTip content={hint} label={`${line.label || line.sub || ''} — izoh`} className="-my-0.5" />}
    </>
  )

  if (line.tone === 'team' && sub) {
    return (
      <span className="flex flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[14px] font-bold tracking-tight">{sub}</span>
          {extras}
        </span>
        {line.label && (
          <span className="text-[11px] font-medium tracking-wide uppercase">{line.label}</span>
        )}
      </span>
    )
  }

  if (heading) {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* Upper case like the sheet's headings, «Таргет Zextra» (blue) too; a ROP's own heading (no sheet row) keeps its case. */}
        <span className={`text-[12.5px] font-bold tracking-wide ${line.tone === 'team' && line.row === null ? '' : 'uppercase'}`}>{line.label}</span>
        {sub && (
          <span
            className="rounded-[5px] px-1.5 py-px text-[11.5px] font-semibold"
            // The sheet's black owner cell, inverted with the theme.
            style={{ background: 'var(--ink-primary)', color: 'var(--surface-raised)' }}
          >
            {sub}
          </span>
        )}
        {extras}
      </span>
    )
  }

  if (!line.label && sub) {
    return (
      <span className="flex flex-wrap items-center gap-1.5 pl-3" style={{ color: 'var(--ink-secondary)' }}>
        <span>{sub}</span>
        {extras}
      </span>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span>{line.label}</span>
      {sub && (
        <span
          className={`rounded-[5px] border px-1.5 text-[11px] leading-[18px] ${chipHue ? 'font-semibold' : 'font-medium'}`}
          style={
            chipHue
              ? { borderColor: mix(chipHue, 50, 'var(--border)'), background: mix(chipHue, 20), color: inkOf(chipHue) }
              : { borderColor: 'var(--border-strong)', color: 'var(--ink-secondary)' }
          }
        >
          {sub}
        </span>
      )}
      {extras}
    </span>
  )
}

const MISSING_NOTE = 'Bu qator Bitrix24 da yoʻq — qoʻlda kiritilmaydi'

/** «Bitrix24ʼda yoʻq» — the row stays because the sheet has it; nothing fills it. */
function MissingChip() {
  return (
    <Tooltip content={MISSING_NOTE}>
      <span
        role="note"
        aria-label={`Bitrix24ʼda yoʻq. ${MISSING_NOTE}`}
        className="inline-flex items-center rounded-[5px] border border-dashed px-1.5 text-[10.5px] leading-[17px] font-medium whitespace-nowrap"
        style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-muted)' }}
      >
        Bitrix24ʼda yoʻq
      </span>
    </Tooltip>
  )
}

/** What a typed row's chip says is typed: a cost line's soʻm, a team's head count. */
const MANUAL_NOTE: Record<RnpManual['kind'], string> = {
  cost: 'Bitrix24 dan emas — kunlik summa qoʻlda kiritiladi',
  headcount: 'Bitrix24 dan emas — har kuni xodimlar soni qoʻlda kiritiladi',
}

/** «qoʻlda» — the P&L cost lines and «Ходим сони» are typed in, not read from Bitrix24. */
function ManualChip({ kind }: { kind: RnpManual['kind'] }) {
  const note = MANUAL_NOTE[kind]
  return (
    <span
      title={note}
      className="inline-flex items-center rounded-[5px] border px-1.5 text-[10.5px] leading-[17px] font-medium whitespace-nowrap"
      style={{ borderColor: mix('var(--accent)', 45, 'var(--border)'), color: inkOf('var(--accent)') }}
    >
      qoʻlda<span className="sr-only">, {note}</span>
    </span>
  )
}

/** A team the sheet has no block for: added after the sheet's own, and said so on its block's first line. */
function AddedChip() {
  return (
    <span
      className="inline-flex items-center rounded-[5px] px-1.5 text-[10.5px] leading-[17px] font-semibold tracking-normal whitespace-nowrap normal-case"
      style={{ background: mix('var(--status-warning)', 16), color: inkOf('var(--status-warning)') }}
    >
      {RNP_ADDED_TEAM_NOTE}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Colour — tokens only, mixed, so light and dark both carry it
// ---------------------------------------------------------------------------

function mix(color: string, pct: number, base = 'transparent'): string {
  return `color-mix(in oklab, ${color} ${pct}%, ${base})`
}

/** Colours stacked as background layers, the first on top — over a pinned cell's own card colour. */
function layers(...colors: (string | undefined)[]): string {
  return colors
    .filter((c): c is string => c !== undefined)
    .map((c) => `linear-gradient(${c}, ${c})`)
    .join(', ')
}

/** Text in a tone's hue, pulled towards the ink so it reads on its own tint in either theme. */
function inkOf(hue: string): string {
  return mix(hue, 68, 'var(--ink-primary)')
}

const HUE: Record<Exclude<RnpLabelTone, 'plain'>, string> = {
  section: 'var(--series-2)',
  team: 'var(--series-1)',
  company: 'var(--status-good)',
  brand: 'var(--series-1)',
  alert: 'var(--status-critical)',
}

function hueOf(tone: RnpLabelTone): string | null {
  return tone === 'plain' ? null : HUE[tone]
}

/** The three kinds of figure row that carry colour; every other row is plain. */
type RowAccent = 'plan' | 'fakt1' | 'conversion'

/**
 * Which of them a line is, by the sheet's label (or the server's, on a team
 * the sheet has no block for): «План бажарилиши» is the team row, «Сумма
 * факт 1» / «Логистика Сумма факт1» / «Сумма ФАКТ 1», and any «Конверция» /
 * «Конверсия». Not «Средний чек факт 1» — the client named the sum.
 */
function accentOf(line: ValueLine): RowAccent | null {
  if (line.tone === 'team' || /План бажарилиши/.test(line.label)) return 'plan'
  if (/Сумма (?:факт|ФАКТ) ?1/.test(line.label)) return 'fakt1'
  if (/Конвер[цс]/.test(line.label)) return 'conversion'
  return null
}

/** Each accent's hue, the soft band across its row, and its fact column. */
const ACCENT: Record<RowAccent, { hue: string; band: string; fact: string }> = {
  plan: { hue: 'var(--series-1)', band: mix('var(--series-1)', 8), fact: mix('var(--series-7)', 20) },
  fakt1: { hue: 'var(--status-good)', band: mix('var(--status-good)', 7), fact: mix('var(--status-good)', 22) },
  conversion: { hue: 'var(--series-3)', band: mix('var(--series-3)', 7), fact: mix('var(--series-3)', 18) },
}

/**
 * A logistics block's heading, «Логистика Сумма факт1» beside its ROP: its
 * label and its ROP chip take the row's green (the client, 2026-10-02:
 * «logistika boʻlimiga rang berilsin … rop ismi ham rangli boʻlsin»).
 */
function logisticsHue(line: ValueLine): string | null {
  return /^Логистика/.test(line.label) ? ACCENT.fakt1.hue : null
}

/** The hue of a value line's pinned label: the ROP's «План бажарилиши» and the logistics heading; null — plain. */
function headHue(line: ValueLine): string | null {
  return accentOf(line) === 'plan' ? ACCENT.plan.hue : logisticsHue(line)
}

/** The pinned label cell of a value line: a heading's tint, opaque over the card so the days never show through. */
function labelStyle(hue: string | null): { background?: string; color: string } {
  if (hue === null) return { color: 'var(--ink-primary)' }
  return { background: mix(hue, 16, 'var(--surface-raised)'), color: inkOf(hue) }
}

/** Every cell's rule: separate borders travel with a sticky cell, collapsed ones do not. */
const RULE = 'border-b border-[var(--border)]'
/** The faint column rule between figures, for reading down a day. */
const VRULE = 'border-r border-r-[var(--grid)]'

/** The pinned summary columns' header band: the page accent over the header's own recess, opaque. */
const SUMMARY_HEAD = mix('var(--accent)', 12, 'var(--surface-sunken)')
/** …and their cells: a whisper of ink, so the pinned panel (B…D) reads as one block beside the scrolling columns. */
const SUMMARY_CELL = mix('var(--ink-muted)', 5)
/** The rule between the summary block and the days. A shadow, not a border: see `.tcol-sticky`. */
const DIVIDER_RIGHT = 'inset -1px 0 0 var(--border-strong)'

/** Today's column: the accent, opaque in the header so rows cannot show through, ruled down both sides. */
const TODAY_HEAD = mix('var(--accent)', 24, 'var(--surface-sunken)')
const TODAY_HEAD_RULE = 'inset 0 -2px 0 var(--accent)'
const TODAY_CELL = mix('var(--accent)', 13)
const TODAY_RULE = 'inset 1px 0 0 var(--accent-line), inset -1px 0 0 var(--accent-line)'

/** Sunday: a whisper of ink, opaque in the header for the same reason as today's. */
const SUNDAY_HEAD = mix('var(--ink-muted)', 12, 'var(--surface-sunken)')
const SUNDAY_CELL = mix('var(--ink-muted)', 6)

/** A row nobody fills: a faint diagonal hatch, so «empty» reads as «not available», not as zero. */
const HATCH = `repeating-linear-gradient(135deg, transparent 0 7px, ${mix('var(--ink-muted)', 14)} 7px 8px)`

/** A day against its day plan — soft, one strength for all three, so the figure stays the thing read. */
const TINT: Record<Exclude<RnpTone, 'neutral'>, string> = {
  good: mix('var(--status-good)', 11),
  warning: mix('var(--status-warning)', 13),
  critical: mix('var(--status-critical)', 11),
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

const dash = <span style={{ color: 'var(--ink-muted)' }}>—</span>

/** Any figure of the grid, in full («3.589.815.001», never «3,6 mlrd»): `rnpFigures.ts`. */
function figure(value: number | null, unit: RnpUnit): ReactNode {
  return value === null ? dash : figureText(value, unit)
}

/** The day plan as plain text, for a cell's title. */
function plain(value: number, unit: RnpUnit): string {
  switch (unit) {
    case 'uzs':
      return `${rnpUzs(value)} soʻm`
    case 'usd':
      return formatUsd(value)
    case 'percent':
      return rnpPercent(value)
    case 'count':
      return rnpNumber(Math.round(value * 10) / 10)
    case 'grade':
      return rnpGrade(value)
  }
}

/**
 * The index, coloured by which way is good — on a coloured row only. A cost
 * (`better: 'down'`) under its plan is on track; over it by a fifth is the alarm.
 *
 * Graded on the figure as printed, to one decimal, so a «100,0%» is never amber
 * nor an «80,0%» red; its digits in the tone's ink, which reads on the tint, and
 * on the column's right edge (`-mr-2`: the pill's tint takes the cell's padding).
 */
function index(value: number | null, better: 'up' | 'down', coloured: boolean): ReactNode {
  if (value === null) return dash
  if (!coloured) return rnpPercent(value)
  const tone = TONE_COLOR[indexTone(Math.round(value * 10) / 10, better)]
  return (
    <span
      className="-mr-2 inline-block rounded-full px-2 py-0.5 text-[13px] leading-5 font-semibold"
      style={{ color: inkOf(tone), background: mix(tone, 14) }}
    >
      {rnpPercent(value)}
    </span>
  )
}
