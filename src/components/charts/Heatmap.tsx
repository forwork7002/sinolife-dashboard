'use client'

import { useState, type MouseEvent } from 'react'

import { ChartTooltipPanel, type ChartTooltipRow } from '@/components/charts/chartTooltip'
import {
  formatMonth,
  formatMonthOffset,
  formatNumber,
  formatPercent,
  formatUzs,
} from '@/lib/format'

/**
 * The cohort matrix — one table that has to teach itself.
 *
 * It is read by people who do not read cohort matrices for a living, so every
 * claim it makes is stated three ways: the colour bands it in, the printed
 * figure states it, and the hover panel spells out the fraction it came from.
 * Nothing on this table is a number whose denominator the reader has to guess.
 *
 * WHAT EACH PART MEANS
 *   row     — the month a customer bought for the FIRST time;
 *   `Yangi mijoz` — how many people that month is (the denominator of the row);
 *   `Qaytgan`     — how many of them ever came back, counted once each;
 *   column `+N`   — N months after that first purchase;
 *   cell    — of the row's customers, the share who bought again in THAT month.
 *
 * Magnitude is encoded on ONE hue, light to dark, because the value is a
 * quantity and not a category — a rainbow here would invent boundaries the
 * data does not have. A null cell is left blank rather than painted at zero: a
 * cohort three months old has no twelve-month column, and drawing one at 0%
 * would report a collapse that has not happened.
 *
 * Ink flips to white on the darkest two steps to stay above the contrast
 * floor; a fixed ink colour fails at one end of any sequential ramp.
 */

/** Exactly the fields the matrix draws — the DTO's shape, minus what it ignores. */
export interface CohortMatrixRow {
  /** First day of the cohort month, `YYYY-MM-DD`. */
  readonly cohort: string
  readonly size: number
  /** Ever came back, counted once each. Never the sum of `customers`. */
  readonly returned: number
  /** Share of the cohort buying again, by offset. Null = the month has not happened. */
  readonly retention: readonly (number | null)[]
  /** The headcount behind each share, same offsets, same nulls. */
  readonly customers: readonly (number | null)[]
  /** What that offset's purchases were worth. */
  readonly revenue: readonly { readonly amount: number }[]
}

/*
  Fixed widths, and the table is `table-layout: fixed`.

  The three left columns are sticky, so their `left` offsets have to equal the
  widths that precede them EXACTLY — a pixel of disagreement shows as a sliver
  of a scrolling cell under a pinned one. With the widths declared here and the
  layout fixed, the two can never drift apart.
*/
const W_COHORT = 112
const W_SIZE = 72
const W_RETURNED = 96
const W_MONTH = 44

/**
 * Five steps, not a continuous gradient.
 *
 * Banding is a feature: it makes "roughly the same" cells read as the same,
 * which is how a matrix is actually scanned. A continuous ramp invites the eye
 * to distinguish 4% from 5%, a difference that is noise at these cohort sizes.
 *
 * The thresholds are set to THIS business, not to a textbook. Monthly repeat
 * purchase here runs 1–16%; the usual SaaS bands (40/25/12/4) would paint every
 * cell in the lightest step and the matrix would read as a blank grid with a
 * 100% column down the left. They are printed in the legend rather than left
 * implicit, because a colour a reader cannot convert back into a number is
 * decoration.
 */
const BANDS = [
  {
    label: '0–2%',
    background: 'color-mix(in oklab, var(--seq-250) 22%, var(--surface))',
    dark: false,
  },
  {
    label: '2–4%',
    background: 'color-mix(in oklab, var(--seq-250) 55%, var(--surface))',
    dark: false,
  },
  { label: '4–7%', background: 'var(--seq-350)', dark: false },
  { label: '7–12%', background: 'var(--seq-550)', dark: true },
  { label: '12% va undan koʻp', background: 'var(--seq-650)', dark: true },
] as const

/** What an unmeasured month is drawn in — see the null branch of `HeatCell`. */
const UNMEASURED =
  'repeating-linear-gradient(135deg, color-mix(in oklab, var(--ink-muted) 16%, transparent) 0 2px, transparent 2px 5px)'

/*
  The ink flips at step 3, not step 2.

  White on --seq-350 is 2.83:1 — under the 3:1 floor for any text. Dark ink on
  that same step is 7.4:1, so the later flip is better on both sides of the
  boundary. `--surface` rather than a literal white, so the pale ink follows the
  theme instead of staying white on a light card in dark mode.
*/
function bandOf(value: number): number {
  return value >= 12 ? 4 : value >= 7 ? 3 : value >= 4 ? 2 : value >= 2 ? 1 : 0
}

/** Which fact the hover panel is currently describing. */
interface Hot {
  /** Row index; `-1` is the summary row. */
  readonly row: number
  /** Month offset; `-1` is the row's own label — the whole-cohort panel. */
  readonly col: number
  readonly x: number
  readonly y: number
  /** Panel below the anchor instead of above it, for the topmost rows. */
  readonly below: boolean
}

export function CohortHeatmap({
  rows,
  /*
    WIDE ENOUGH FOR THE DATA IT IS GIVEN.

    This was 13, while the page asks for 18 months of cohorts — so the oldest
    rows carried up to 17 offsets and five columns were cut before render, with
    no ellipsis, no note, and nothing the horizontal scroll could reveal
    (`columns` bounds the loop, so the cells were never drawn). A reader
    scanning the oldest row for "did they ever come back" was reading a
    truncation as an answer.

    The table already scrolls horizontally with its left columns pinned, so
    extra width costs nothing. The cap stays as a guard against an unbounded
    payload, not as a display choice.
  */
  maxColumns = 24,
}: {
  readonly rows: readonly CohortMatrixRow[]
  maxColumns?: number
}) {
  const [hot, setHot] = useState<Hot | null>(null)

  if (rows.length === 0) return null

  const columns = Math.min(
    maxColumns,
    rows.reduce((max, r) => Math.max(max, r.retention.length), 0),
  )
  const offsets = Array.from({ length: columns }, (_, i) => i)
  const width = W_COHORT + W_SIZE + W_RETURNED + columns * W_MONTH

  const averages = offsets.map((i) => columnAverage(rows, i))
  const totalSize = rows.reduce((sum, r) => sum + r.size, 0)
  const totalReturned = rows.reduce((sum, r) => sum + r.returned, 0)
  const totalShare = totalSize > 0 ? (totalReturned / totalSize) * 100 : null

  /*
    The anchor is taken from the CELL, not from the cursor.

    `offsetLeft`/`offsetTop` are measured against the positioned wrapper, which
    is also the element that scrolls — so the panel keeps its place when the
    matrix is scrolled sideways, and a cell that is hovered by keyboard-driven
    scrolling gets the same treatment as one under a mouse. A cursor-following
    panel would also have to un-follow itself at the container's edges.
  */
  const enter = (row: number, col: number) => (event: MouseEvent<HTMLElement>) => {
    const el = event.currentTarget
    const below = row <= 1
    setHot({
      row,
      col,
      // Clamped to half a panel from either edge, so the first and last
      // columns do not open a tip that is cut off by the scroll box.
      x: Math.min(Math.max(el.offsetLeft + el.offsetWidth / 2, 120), width - 120),
      y: below ? el.offsetTop + el.offsetHeight + 6 : el.offsetTop - 6,
      below,
    })
  }

  const example = readingExample(rows)
  const panel = hot ? panelFor(hot, rows, averages) : null

  return (
    <div className="space-y-3">
      {example && (
        <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {example}
        </p>
      )}

      <div className="relative overflow-x-auto" onMouseLeave={() => setHot(null)}>
        <table
          className="tabular"
          style={{
            width,
            minWidth: width,
            tableLayout: 'fixed',
            /* `separate` with zero spacing: sticky columns need a separated
               border model, and the 2px gap between heat tiles is drawn by the
               cell's own padding instead — which keeps every sticky offset a
               whole sum of the widths above. */
            borderCollapse: 'separate',
            borderSpacing: 0,
          }}
        >
          <caption className="sr-only">
            Kogorta matritsasi: har bir qator — mijozlar birinchi marta xarid qilgan oy, har bir
            ustun — oʻsha oydan keyin oʻtgan oylar soni, katakdagi foiz — oʻsha oyda qayta xarid
            qilgan mijozlar ulushi.
          </caption>

          <colgroup>
            <col style={{ width: W_COHORT }} />
            <col style={{ width: W_SIZE }} />
            <col style={{ width: W_RETURNED }} />
            {offsets.map((i) => (
              <col key={i} style={{ width: W_MONTH }} />
            ))}
          </colgroup>

          <thead>
            <tr>
              <HeadCell rowSpan={2} left={0} width={W_COHORT} align="left">
                Kogorta oyi
              </HeadCell>
              <HeadCell rowSpan={2} left={W_COHORT} width={W_SIZE} align="right">
                Yangi mijoz
              </HeadCell>
              {/* Two lines on purpose: «Qaytgan» alone leaves the reader to
                  guess whether the percentage beside it is of the cohort or of
                  the company. */}
              <HeadCell rowSpan={2} left={W_COHORT + W_SIZE} width={W_RETURNED} align="right" edge>
                Qaytgan
                <span className="block text-[10px] font-normal">shu guruhdan</span>
              </HeadCell>
              {/*
                The column group says what the numbers under it ARE. «+1 +2 +3»
                over a grid of percentages is a header only to somebody who
                already knows what they are looking at.
              */}
              <th
                scope="colgroup"
                colSpan={columns}
                className="px-2 pt-0.5 pb-1.5 text-center text-[10.5px] leading-snug font-medium"
                style={{ color: 'var(--ink-muted)' }}
              >
                Birinchi xariddan keyin oʻtgan oylar — qayta xarid qilgan mijozlar ulushi, %
              </th>
            </tr>
            <tr>
              {offsets.map((i) => (
                <th
                  key={i}
                  scope="col"
                  className="px-1 pb-1.5 text-center text-[11px] font-medium"
                  style={{
                    color: hot?.col === i ? 'var(--ink-primary)' : 'var(--ink-muted)',
                  }}
                >
                  {i === 0 ? '0' : `+${i}`}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, r) => {
              const lit = hot?.row === r
              const share = row.size > 0 ? (row.returned / row.size) * 100 : null

              return (
                <tr key={row.cohort}>
                  <PinnedCell
                    header
                    left={0}
                    lit={lit}
                    align="left"
                    onMouseEnter={enter(r, -1)}
                    label={`${formatMonth(row.cohort)} kogortasi`}
                  >
                    {formatMonth(row.cohort)}
                  </PinnedCell>

                  <PinnedCell left={W_COHORT} lit={lit} align="right" onMouseEnter={enter(r, -1)}>
                    {formatNumber(row.size)}
                  </PinnedCell>

                  <PinnedCell
                    left={W_COHORT + W_SIZE}
                    lit={lit}
                    align="right"
                    edge
                    onMouseEnter={enter(r, -1)}
                  >
                    {formatNumber(row.returned)}
                    <span className="ml-1" style={{ color: 'var(--ink-muted)' }}>
                      {share === null ? '' : `· ${Math.round(share)}%`}
                    </span>
                  </PinnedCell>

                  {offsets.map((i) => (
                    <HeatCell
                      key={i}
                      value={row.retention[i] ?? null}
                      customers={row.customers[i] ?? null}
                      size={row.size}
                      cohort={row.cohort}
                      offset={i}
                      onMouseEnter={enter(r, i)}
                    />
                  ))}
                </tr>
              )
            })}
          </tbody>

          {/*
            THE SUMMARY ROW STATES TWO DIFFERENT OPERATIONS, so it names both.

            The left columns are sums — every first-time buyer in the matrix,
            and every one of them who came back. The month columns are not: they
            are averages weighted by cohort size, over the cohorts that have
            actually LIVED that long. Adding percentages would let a 40-person
            cohort outvote a 400-person one, and averaging over cohorts too young
            to have reached the column would divide by months nobody measured.
          */}
          <tfoot>
            <tr>
              <PinnedCell
                header
                left={0}
                lit={hot?.row === -1}
                align="left"
                summary
                onMouseEnter={enter(-1, -1)}
                label="Jami va oʻrtacha"
              >
                Jami · oʻrtacha
              </PinnedCell>

              <PinnedCell
                left={W_COHORT}
                lit={hot?.row === -1}
                align="right"
                summary
                onMouseEnter={enter(-1, -1)}
              >
                {formatNumber(totalSize)}
              </PinnedCell>

              <PinnedCell
                left={W_COHORT + W_SIZE}
                lit={hot?.row === -1}
                align="right"
                summary
                edge
                onMouseEnter={enter(-1, -1)}
              >
                {formatNumber(totalReturned)}
                <span className="ml-1" style={{ color: 'var(--ink-muted)' }}>
                  {totalShare === null ? '' : `· ${Math.round(totalShare)}%`}
                </span>
              </PinnedCell>

              {offsets.map((i) => (
                <HeatCell
                  key={i}
                  summary
                  value={averages[i].percent}
                  customers={averages[i].returned}
                  size={averages[i].base}
                  cohort={null}
                  offset={i}
                  onMouseEnter={enter(-1, i)}
                />
              ))}
            </tr>
          </tfoot>
        </table>

        {panel && hot && (
          <div
            className="pointer-events-none absolute z-30"
            style={{
              left: hot.x,
              top: hot.y,
              transform: `translate(-50%, ${hot.below ? '0' : '-100%'})`,
            }}
          >
            <ChartTooltipPanel header={panel.header} rows={panel.rows} footer={panel.footer} />
          </div>
        )}
      </div>

      <Legend />
    </div>
  )
}

/**
 * The edge of the pinned block.
 *
 * Without it, a half-scrolled heat tile sits flush against «Qaytgan» and reads
 * as a clipped column of the table rather than as content passing underneath.
 * A hairline shadow rather than a border, so it costs no layout width and the
 * sticky offsets stay whole sums of the column widths.
 */
const PINNED_EDGE = '2px 0 4px -2px color-mix(in oklab, var(--ink-primary) 22%, transparent)'

/** A pinned heading in the header band — the three left columns. */
function HeadCell({
  children,
  left,
  width,
  align,
  rowSpan,
  edge = false,
}: {
  readonly children: React.ReactNode
  readonly left: number
  readonly width: number
  readonly align: 'left' | 'right'
  readonly rowSpan?: number
  readonly edge?: boolean
}) {
  return (
    <th
      scope="col"
      rowSpan={rowSpan}
      className={`sticky z-20 px-2 pb-1.5 align-bottom text-[11px] leading-snug font-medium ${
        align === 'left' ? 'text-left' : 'text-right'
      }`}
      style={{
        left,
        width,
        background: 'var(--surface-raised)',
        color: 'var(--ink-muted)',
        boxShadow: edge ? PINNED_EDGE : undefined,
      }}
    >
      {children}
    </th>
  )
}

/**
 * One of the three pinned columns of a body or summary row.
 *
 * `lit` is the row half of the crosshair: hovering anywhere in a row lifts its
 * own label out of eighteen identical ones, which is most of what makes a wide
 * matrix followable. The pinned cells carry an opaque background by necessity —
 * the scrolling cells pass underneath them — so the highlight has to be painted
 * here rather than on the `<tr>`.
 */
function PinnedCell({
  children,
  left,
  lit,
  align,
  header = false,
  summary = false,
  edge = false,
  onMouseEnter,
  label,
}: {
  readonly children: React.ReactNode
  readonly left: number
  readonly lit: boolean
  readonly align: 'left' | 'right'
  readonly header?: boolean
  readonly summary?: boolean
  readonly edge?: boolean
  readonly onMouseEnter?: (event: MouseEvent<HTMLElement>) => void
  readonly label?: string
}) {
  const style = {
    left,
    /* `--grid` is the house hover tint; `--surface-sunken` is DARKER than the
       card in dark mode, so it painted the hovered row as a black bar. */
    background: lit ? 'var(--grid)' : 'var(--surface-raised)',
    color: summary || header ? 'var(--ink-primary)' : 'var(--ink-secondary)',
    borderTop: summary ? '1px solid var(--border-strong)' : undefined,
    boxShadow: edge ? PINNED_EDGE : undefined,
  } as const

  const className = `sticky z-10 px-2 py-1 text-xs whitespace-nowrap ${
    align === 'left' ? 'text-left' : 'text-right'
  } ${summary || header ? 'font-medium' : ''}`

  return header ? (
    <th scope="row" className={className} style={style} onMouseEnter={onMouseEnter} title={label}>
      {children}
    </th>
  ) : (
    <td className={className} style={style} onMouseEnter={onMouseEnter}>
      {children}
    </td>
  )
}

/**
 * One cell — a share, its heat, and the arithmetic behind it in words.
 *
 * The `aria-label` is the whole sentence rather than the printed figure: a
 * screen reader gets the same fraction the hover panel shows, from the one
 * place both are derived.
 */
function HeatCell({
  value,
  customers,
  size,
  cohort,
  offset,
  summary = false,
  onMouseEnter,
}: {
  readonly value: number | null
  readonly customers: number | null
  readonly size: number
  readonly cohort: string | null
  readonly offset: number
  readonly summary?: boolean
  readonly onMouseEnter: (event: MouseEvent<HTMLElement>) => void
}) {
  if (value === null) {
    return (
      <td
        className="p-px"
        style={{ borderTop: summary ? '1px solid var(--border-strong)' : undefined }}
        aria-label="hali oʻtmagan oy — oʻlchanmagan"
      >
        <div
          className="h-[22px] rounded"
          /*
            HATCHED, NOT PALE.

            The distinction this matrix most needs to keep is «nobody came
            back» against «this month has not happened yet», and a flat light
            tile is exactly what the bottom of a light-to-dark ramp looks like:
            the 0–2% step and an unmeasured month were two faint squares one
            legend row apart. Texture is not on the ramp at all, so it cannot
            be mistaken for a small value at any step — and it survives print,
            forced colours and a colourblind reader, none of which the tint did.
          */
          style={{ background: UNMEASURED }}
        />
      </td>
    )
  }

  /*
    THE FIRST COLUMN IS NOT A MEASUREMENT.

    Offset 0 is the cohort buying in the month it was defined by — 100% of it,
    always, by construction. Painted on the ramp it is the darkest column on the
    table and the eye reads a finding into it; every cell to its right then has
    to compete with a column that says nothing. It keeps its figure, because a
    row that starts at 100% is how a reader anchors the ones that follow, and
    loses its heat.
  */
  const base = offset === 0

  const band = BANDS[bandOf(value)]
  const shown = value === 0 ? '0' : value < 1 ? '<1' : String(Math.round(value))

  return (
    <td
      className="p-px"
      style={{ borderTop: summary ? '1px solid var(--border-strong)' : undefined }}
      onMouseEnter={onMouseEnter}
      /* On the CELL, not on the tile inside it: a bare <div aria-label> carries
         no role, and a screen reader announces nothing for it. Here it replaces
         «13%» with the whole fraction, which is the reading a person who cannot
         hover would otherwise have to assemble from the headers. */
      aria-label={cellSentence({ cohort, offset, value, customers, size, summary })}
    >
      <div
        data-heat=""
        className="flex h-[22px] items-center justify-center rounded text-[11px] font-medium"
        style={{
          background: base ? 'var(--surface-sunken)' : band.background,
          color: base
            ? 'var(--ink-secondary)'
            : band.dark
              ? 'var(--surface)'
              : 'var(--ink-primary)',
        }}
      >
        {shown}
        {/* The unit, said in every cell but never competing with the digits:
            a bare «13» in a grid beside a «45 mijoz» column is a count to
            anyone who has not read the header. */}
        <span className="ml-px text-[8.5px]" style={{ opacity: 0.62 }}>
          %
        </span>
      </div>
    </td>
  )
}

/** The scale, stated in numbers. A colour a reader cannot convert back is decoration. */
function Legend() {
  return (
    <div className="space-y-1.5">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span className="font-medium">Qaytish ulushi:</span>
        {BANDS.map((band) => (
          <span key={band.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-5 rounded-[3px]"
              style={{ background: band.background }}
            />
            {band.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 rounded-[3px]"
            style={{ background: UNMEASURED }}
          />
          hali oʻtmagan oy — oʻlchanmagan
        </span>
      </div>
      <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Har bir katak = oʻsha oyda qayta xarid qilgan mijozlar ÷ kogortadagi jami mijozlar. «0»
        ustuni — kogortaning oʻz oyi, u har doim 100%. Katak ustiga sichqonchani olib borsangiz,
        aniq hisob-kitob — nechta mijozdan nechtasi va qancha tushum — chiqadi.
      </p>
    </div>
  )
}

/** Panel content, derived from what is hot. One source for the tip and the labels. */
interface TipPanel {
  readonly header: string
  readonly rows: readonly ChartTooltipRow[]
  readonly footer?: string
}

interface ColumnAverage {
  readonly percent: number | null
  /** Customers who came back, over the cohorts that reached this offset. */
  readonly returned: number
  /** The denominator — those cohorts' sizes. */
  readonly base: number
  /** How many cohorts that is. The claim is only as wide as this number. */
  readonly cohorts: number
}

/**
 * The weighted average of one column.
 *
 * Weighted by cohort size, over the cohorts that have reached the offset. The
 * unweighted mean of the percentages would let a 40-person month outvote a
 * 400-person one; including cohorts that have not lived that long would divide
 * by months nobody has measured yet.
 */
function columnAverage(rows: readonly CohortMatrixRow[], offset: number): ColumnAverage {
  let returned = 0
  let base = 0
  let cohorts = 0

  for (const row of rows) {
    if (row.retention[offset] === null || row.retention[offset] === undefined) continue
    returned += row.customers[offset] ?? 0
    base += row.size
    cohorts += 1
  }

  return { percent: base > 0 ? (returned / base) * 100 : null, returned, base, cohorts }
}

function panelFor(
  hot: Hot,
  rows: readonly CohortMatrixRow[],
  averages: readonly ColumnAverage[],
): TipPanel | null {
  // The summary row's own label, and its two sums.
  if (hot.row === -1 && hot.col === -1) {
    const totalSize = rows.reduce((sum, r) => sum + r.size, 0)
    const totalReturned = rows.reduce((sum, r) => sum + r.returned, 0)

    return {
      header: `Jami — ${formatNumber(rows.length)} ta kogorta`,
      rows: [
        { label: 'Yangi mijozlar', value: formatNumber(totalSize) },
        {
          label: 'Ulardan qaytganlar',
          value: `${formatNumber(totalReturned)} / ${formatNumber(totalSize)}`,
        },
        {
          label: 'Qaytish ulushi',
          value: formatPercent(totalSize > 0 ? (totalReturned / totalSize) * 100 : null),
        },
      ],
      footer:
        'Chapdagi ikki ustun — jami. Oylar boʻyicha qator — mijozlar soniga tortilgan oʻrtacha ulush.',
    }
  }

  // One column of the summary row.
  if (hot.row === -1) {
    const avg = averages[hot.col]
    if (!avg) return null

    return {
      header: hot.col === 0 ? 'Oʻrtacha — xarid oyi' : `Oʻrtacha — +${hot.col} oy`,
      rows: [
        {
          label: 'Qaytgan mijozlar',
          value: `${formatNumber(avg.returned)} / ${formatNumber(avg.base)}`,
        },
        { label: 'Ulush', value: formatPercent(avg.percent) },
        { label: 'Nechta kogortadan', value: `${formatNumber(avg.cohorts)} ta` },
      ],
      footer: 'Faqat shu oyga yetib ulgurgan kogortalar hisobga olingan.',
    }
  }

  const row = rows[hot.row]
  if (!row) return null

  // A whole cohort — hovering its label or either of its two figures.
  if (hot.col === -1) {
    const total = row.revenue.reduce((sum, m, i) => (row.retention[i] === null ? sum : sum + m.amount), 0)
    const repeat = row.revenue.reduce(
      (sum, m, i) => (i === 0 || row.retention[i] === null ? sum : sum + m.amount),
      0,
    )

    return {
      header: `${formatMonth(row.cohort)} kogortasi`,
      rows: [
        { label: 'Birinchi marta xarid qilganlar', value: formatNumber(row.size) },
        {
          label: 'Ulardan qaytganlar',
          value: `${formatNumber(row.returned)} / ${formatNumber(row.size)}`,
        },
        {
          label: 'Qaytish ulushi',
          value: formatPercent(row.size > 0 ? (row.returned / row.size) * 100 : null),
        },
        { label: 'Jami tushum', value: formatUzs(total) },
        {
          label: 'Shundan takroriy',
          value: `${formatUzs(repeat)}${
            total > 0 ? ` · ${formatPercent((repeat / total) * 100)}` : ''
          }`,
        },
      ],
      footer:
        'Qaytganlar bir marta sanaladi: ikki oyda ikki marta qaytgan mijoz ham bitta mijoz. Tushum — shu kogorta mijozlarining barcha xaridlari.',
    }
  }

  const value = row.retention[hot.col]
  if (value === null || value === undefined) return null

  const customers = row.customers[hot.col] ?? 0
  const amount = row.revenue[hot.col]?.amount ?? 0

  if (hot.col === 0) {
    return {
      header: `${formatMonth(row.cohort)} · xarid oyi`,
      rows: [
        { label: 'Birinchi marta xarid qilganlar', value: formatNumber(row.size) },
        { label: 'Tushum', value: formatUzs(amount) },
      ],
      footer: 'Kogortaning oʻz oyi — shuning uchun har doim 100%.',
    }
  }

  return {
    header: `${formatMonth(row.cohort)} kogortasi · +${hot.col} oy (${formatMonthOffset(
      row.cohort,
      hot.col,
    )})`,
    rows: [
      {
        label: 'Qayta xarid qilganlar',
        value: `${formatNumber(customers)} / ${formatNumber(row.size)}`,
      },
      { label: 'Ulush', value: formatPercent(value) },
      { label: 'Tushum', value: formatUzs(amount) },
    ],
    footer:
      customers === 0
        ? 'Bu oyda bu kogortadan hech kim qaytmagan — oʻlchangan nol, maʼlumot yoʻqligi emas.'
        : undefined,
  }
}

/** The same sentence the hover panel says, for a reader who cannot hover. */
function cellSentence({
  cohort,
  offset,
  value,
  customers,
  size,
  summary,
}: {
  readonly cohort: string | null
  readonly offset: number
  readonly value: number
  readonly customers: number | null
  readonly size: number
  readonly summary: boolean
}): string {
  const who = summary ? 'Oʻrtacha' : cohort ? `${formatMonth(cohort)} kogortasi` : ''
  const when = offset === 0 ? 'xarid oyi' : `+${offset} oy`
  const fraction =
    customers === null ? '' : ` — ${formatNumber(size)} mijozdan ${formatNumber(customers)} tasi`

  return `${who}, ${when}: ${formatPercent(value)}${fraction}`
}

/**
 * One worked example, from the reader's own data.
 *
 * A legend explains the encoding; it does not teach the reading. The largest
 * cohort that has lived at least one month is the clearest instance of the
 * sentence every other cell is a copy of, and it names the column it is in so
 * the eye can go and find it.
 */
function readingExample(rows: readonly CohortMatrixRow[]): string | null {
  const candidates = rows.filter(
    (row) => row.size > 0 && row.retention[1] !== null && row.retention[1] !== undefined,
  )
  if (candidates.length === 0) return null

  const row = candidates.reduce((best, r) => (r.size > best.size ? r : best))
  const value = row.retention[1] as number
  const customers = row.customers[1] ?? Math.round((value / 100) * row.size)

  /* The cell the sentence points at is rounded to a whole percent, so the
     sentence says so. A reader who checks the example against the cell and
     finds 25.7% over a cell reading 26% has been given a reason to distrust
     every other figure on the table. */
  return `Qanday oʻqiladi: ${formatMonth(row.cohort)} oyida ${formatNumber(
    row.size,
  )} ta mijoz birinchi marta xarid qilgan; keyingi oyda ulardan ${formatNumber(
    customers,
  )} tasi yana xarid qilgan — bu ${formatPercent(value)}. Shu qatordagi «+1» ustunida u ${Math.round(
    value,
  )}% deb yaxlitlangan.`
}
