'use client'

import { useState, type MouseEvent } from 'react'

import { ChartTooltipPanel, type ChartTooltipRow } from '@/components/charts/chartTooltip'
import {
  NO_VALUE,
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
 *   `Kogorta tushumi` — every month of that cohort's money, added up;
 *   `1 mijozga`   — that money divided by the cohort — money TO DATE, which is
 *                   why both headings say «hozirgacha» and why a cohort under
 *                   `MONEY_YOUNG_MONTHS` prints greyed;
 *   column `+N`   — N months after that first purchase.
 *
 * THE MONEY DOES NOT COMPARE DOWN THE PER-CUSTOMER COLUMN, and a column of
 * figures is an invitation to compare down it. See `MONEY_YOUNG_MONTHS` for the
 * three defences and the measurement behind the floor.
 *
 * TWO READINGS OF THE SAME CUSTOMERS, and the default is the cumulative one.
 *
 * «Jami qaytgan» — of this cohort, how many have come back at least once BY
 * month N. «Oylik» — of this cohort, how many bought again IN month N.
 * The monthly reading was the only one for a long time and it is the weaker of
 * the two on this portal: repeat purchase here runs 0-4% a month, so 250 cells
 * land in two indistinguishable shades and the grid says almost nothing. The
 * same customers read cumulatively run 0-37%, which is a curve with a shape.
 * The monthly reading is kept because it answers a different question — WHEN
 * they come back, not how many — and it is one press away.
 *
 * The cumulative reading drops the `0` column instead of printing a row of
 * zeros: nobody has RETURNED in the month they first bought. Its last drawn
 * cell in each row equals that row's «Qaytgan» share by construction, which is
 * the check a reader can make without leaving the table.
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

/** Which of the two readings the grid is drawing. */
export type CohortView = 'cumulative' | 'monthly'

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
  /** Share that had come back at least once by each offset. Monotonic. */
  readonly cumulative: readonly (number | null)[]
  /** The headcount behind each cumulative share, same offsets, same nulls. */
  readonly cumulativeCustomers: readonly (number | null)[]
  /** What that offset's purchases were worth. */
  readonly revenue: readonly { readonly amount: number }[]
  /**
   * Revenue-bearing WON deals per offset — ORDERS, where `customers` counts
   * PEOPLE. Same offsets, same nulls, so a hover can say «3 mijoz · 4 ta
   * buyurtma» without the reader having to guess which of the two a cell meant.
   */
  readonly orders: readonly (number | null)[]
  /**
   * Every month of this cohort's money added up. PRE-FORMATTED for display.
   *
   * The DTO carries a `MoneyDto`; this carries a string, and the boundary is
   * deliberate — every other figure on this grid arrives formatted, and handing
   * a chart a currency would put currency logic inside a presentation
   * component. `toMatrixRow` in `CohortPage.tsx` is where the crossing happens,
   * beside the `formatUzs` that already lives there.
   */
  readonly revenueTotal: string
  /** `revenueTotal / size`, formatted. See `ageMonths` — it does NOT compare across rows. */
  readonly revenuePerCustomer: string
  /** Whole months this cohort has lived. Under `MONEY_YOUNG_MONTHS`, the figure above is noise. */
  readonly ageMonths: number
}

/*
  THE PINNED BLOCK IS ONE ORDERED LIST, AND EVERY OFFSET IS DERIVED FROM IT.

  Fixed widths, and the table is `table-layout: fixed`. The left columns are
  sticky, so their `left` offsets have to equal the widths that precede them
  EXACTLY — a pixel of disagreement shows as a sliver of a scrolling cell under
  a pinned one.

  That invariant used to be kept BY HAND. Three constants (`W_COHORT`,
  `W_SIZE`, `W_RETURNED`) were added up at nine sites — three `<col>`s, three
  headings, two body cells, the summary row and one `const pinned = A + B + C`
  — so a fourth column meant writing nine more sums into the file whose own
  comment names the failure they cause. Adding the two money columns would have
  doubled that. The list below is now the single declaration; `leftOf` sums the
  widths BEFORE a column and `LEFT` / `WIDTH` / `PINNED_WIDTH` are read off it,
  so the offsets cannot disagree with the widths. Adding a pinned column is one
  entry here plus the cells that draw it — nothing in this file adds a width up.
*/
const PINNED = [
  { key: 'cohort', width: 112 },
  { key: 'size', width: 72 },
  { key: 'returned', width: 84 },
  /*
    MEASURED, not guessed, because these cells are `whitespace-nowrap`: too
    narrow and a cohort's money spills out over the heat tiles passing
    underneath instead of wrapping. Inter at 12px with `tabular-nums`, plus the
    cell's own 16px of padding: «1,234,567,890 soʻm» (a ten-digit month, which
    this portal has) is 117.8 + 16, and «12,450,000 soʻm» per customer is
    99.1 + 16. Both are the widest figure `formatUzs` can print in the column.
  */
  { key: 'revenueTotal', width: 136 },
  { key: 'revenuePerCustomer', width: 116 },
] as const

type PinnedKey = (typeof PINNED)[number]['key']

/** The sticky `left` of the column at `index` — every width before it, summed. */
function leftOf(index: number): number {
  return PINNED.slice(0, index).reduce((sum, column) => sum + column.width, 0)
}

/** `left` and `width` by name, so no call site writes a sum of its own. */
const LEFT = Object.fromEntries(PINNED.map((column, i) => [column.key, leftOf(i)])) as Record<
  PinnedKey,
  number
>
const WIDTH = Object.fromEntries(PINNED.map((column) => [column.key, column.width])) as Record<
  PinnedKey,
  number
>

/** What the pinned block costs. The months share whatever is left of the card. */
const PINNED_WIDTH = leftOf(PINNED.length)

const W_MONTH = 44
/*
  AND HOW WIDE A MONTH MAY GROW.

  With the window down to twelve columns the table stopped filling its card —
  796px of matrix floating in 1888px of hero panel, which reads as a rendering
  fault rather than as a choice. The month columns now share whatever the card
  gives them, between these two bounds: below 44 the figures collide, and past
  64 the cells stretch into bars and the grid stops reading as a grid.
*/
const W_MONTH_MAX = 72

/**
 * Below this many customers a «Jami · oʻrtacha» cell is printed but not painted.
 *
 * The same floor `WAIT_BAND_MIN_ORDERS` uses on Logistika, for the same
 * argument: at thirty, one person moves the figure by more than the gap
 * between two neighbouring bands, so the colour would be claiming a precision
 * the sample cannot carry. See the `thin` branch of `HeatCell`.
 */
const SUMMARY_MIN_BASE = 30

/**
 * Under this many months a cohort's money-to-date is greyed, and says why.
 *
 * A column of per-customer figures is an invitation to rank the rows against
 * each other, and ranking them on money-to-date ranks them on AGE: a
 * thirteen-month-old cohort has had thirteen months to spend and a one-month-old
 * has had one. Read that way the column says «new customers are worse», which
 * is the opposite of the finding this screen exists to show.
 *
 * Three is MEASURED, not chosen: the median inter-purchase gap on this portal
 * is 37.5 days and p75 is 73.9, so under three months most of a cohort has not
 * yet had its second chance and the figure is mostly noise. The figure is still
 * PRINTED — it is true, it is simply not comparable — the same treatment the
 * summary row's thin cells get, and for the same reason.
 */
const MONEY_YOUNG_MONTHS = 3

/**
 * Five steps, not a continuous gradient — and a different five per reading.
 *
 * Banding is a feature: it makes "roughly the same" cells read as the same,
 * which is how a matrix is actually scanned. A continuous ramp invites the eye
 * to distinguish 4% from 5%, a difference that is noise at these cohort sizes.
 *
 * The thresholds are set to THIS business, not to a textbook, and the two
 * readings live on different scales so they cannot share one set. Monthly
 * repeat purchase here runs 0–16%; the usual SaaS bands (40/25/12/4) would
 * paint every cell in the lightest step. Cumulative return runs 0–37%, and
 * reusing the monthly bands on it would paint almost every measured cell in
 * the darkest step — the same blank grid, at the other end of the ramp.
 *
 * Both sets are printed in the legend rather than left implicit, because a
 * colour a reader cannot convert back into a number is decoration.
 */
const MONTHLY_BANDS = [
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

const CUMULATIVE_BANDS = [
  {
    label: '0–5%',
    background: 'color-mix(in oklab, var(--seq-250) 22%, var(--surface))',
    dark: false,
  },
  {
    label: '5–10%',
    background: 'color-mix(in oklab, var(--seq-250) 55%, var(--surface))',
    dark: false,
  },
  { label: '10–20%', background: 'var(--seq-350)', dark: false },
  { label: '20–30%', background: 'var(--seq-550)', dark: true },
  { label: '30% va undan koʻp', background: 'var(--seq-650)', dark: true },
] as const

function bandsFor(view: CohortView): readonly { label: string; background: string; dark: boolean }[] {
  return view === 'monthly' ? MONTHLY_BANDS : CUMULATIVE_BANDS
}

/*
  ONE HEAT FIELD, NOT 250 CHIPS.

  Every tile used to sit in a `p-px` cell with a `rounded` corner, so the grid
  read as a scatter of separate marks: the eye had to assemble a row out of
  them instead of following it. The tiles now meet, and the separation is a
  hairline drawn in the card's own colour — which is what makes a heatmap
  scannable along a row and down a column at the same time.
*/
const GRID_LINE = 'inset -1px 0 0 var(--surface-raised), inset 0 -1px 0 var(--surface-raised)'

/*
  The crosshair. Hovering lifts a row AND a column out of eighteen of each,
  which is most of what makes a wide matrix answerable — «2025-avg × +3» is a
  cell nobody can find by counting. The row half is also painted on the pinned
  cells, which the scrolling tiles pass underneath; this is the half that runs
  across the grid itself.
*/
const CROSS = 'color-mix(in oklab, var(--ink-primary) 45%, transparent)'

function crosshair(litRow: boolean, litCol: boolean): string {
  const edges = [
    litCol ? `inset 1px 0 0 ${CROSS}, inset -1px 0 0 ${CROSS}` : null,
    litRow ? `inset 0 1px 0 ${CROSS}, inset 0 -1px 0 ${CROSS}` : null,
    GRID_LINE,
  ].filter(Boolean)
  return edges.join(', ')
}

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
function bandOf(view: CohortView, value: number): number {
  return view === 'monthly'
    ? value >= 12
      ? 4
      : value >= 7
        ? 3
        : value >= 4
          ? 2
          : value >= 2
            ? 1
            : 0
    : value >= 30
      ? 4
      : value >= 20
        ? 3
        : value >= 10
          ? 2
          : value >= 5
            ? 1
            : 0
}

/** The two money columns, hovered. Not a month, so it is off the offset scale. */
const MONEY_COL = -2

/** Which fact the hover panel is currently describing. */
interface Hot {
  /** Row index; `-1` is the summary row. */
  readonly row: number
  /**
   * Month offset; `-1` is the row's own label — the whole-cohort panel — and
   * `MONEY_COL` is the pair of money columns, which have a panel of their own
   * because the caveat they need (the cohort's age) belongs to no month.
   */
  readonly col: number
  readonly x: number
  readonly y: number
  /** Panel below the anchor instead of above it, for the topmost rows. */
  readonly below: boolean
}

export function CohortHeatmap({
  rows,
  view = 'cumulative',
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
  /*
    HOW MANY MONTHS AFTER THE FIRST PURCHASE THE GRID DRAWS. `null` is all of
    them.

    Counted as an OFFSET, not as a column count, because the two readings draw
    a different number of columns for the same span: cumulative drops the `0`
    column and monthly keeps it. A window counted in columns would end on
    «+12» in one reading and «+11» in the other, under the same label.

    Twelve by default. The page asks for eighteen months of cohorts, so the
    grid drew up to nineteen columns — and only the oldest cohort has lived
    long enough to fill them, which made the right half of the table a field of
    hatch that a reader had to scroll sideways through. The far columns still
    exist; they are no longer what the screen opens on.
  */
  months = 12,
}: {
  readonly rows: readonly CohortMatrixRow[]
  /** Which reading to draw. See the module comment; cumulative is the default. */
  readonly view?: CohortView
  maxColumns?: number
  readonly months?: number | null
}) {
  const [hot, setHot] = useState<Hot | null>(null)

  if (rows.length === 0) return null

  const span = Math.min(
    maxColumns,
    rows.reduce((max, r) => Math.max(max, r.retention.length), 0),
  )
  /*
    THE CUMULATIVE READING HAS NO `0` COLUMN.

    Offset 0 is the month the cohort is defined by. Monthly, that is 100% by
    construction and worth printing as the anchor every other cell is read
    against; cumulatively it is 0% for every row there has ever been — a column
    of zeros beside a «Yangi mijoz» count, which reads as a finding and is not
    one. Dropping it also takes the reader straight to the first month that
    measures anything.
  */
  const offsets = Array.from({ length: span }, (_, i) => i).filter(
    (i) => (view === 'monthly' || i > 0) && (months === null || i <= months),
  )
  const columns = offsets.length
  const width = PINNED_WIDTH + columns * W_MONTH
  const maxWidth = PINNED_WIDTH + columns * W_MONTH_MAX

  /** The array this reading draws from. One place decides, everything follows. */
  const valuesOf = (row: CohortMatrixRow) => (view === 'monthly' ? row.retention : row.cumulative)
  const countsOf = (row: CohortMatrixRow) =>
    view === 'monthly' ? row.customers : row.cumulativeCustomers

  const averages = new Map(offsets.map((i) => [i, columnAverage(rows, i, view)]))
  const totalSize = rows.reduce((sum, r) => sum + r.size, 0)
  const totalReturned = rows.reduce((sum, r) => sum + r.returned, 0)
  const totalShare = totalSize > 0 ? (totalReturned / totalSize) * 100 : null

  /*
    WHETHER THE LEGEND MAY STILL OFFER ITS CROSS-CHECK.

    «Qator oxiridagi katak «Qaytgan» ustuni bilan bir xil boʻladi» is the one
    check a reader can make without leaving the table — and it is true only of
    the LAST MEASURED cell, not of the last DRAWN one. With the window on, an
    old cohort's row ends mid-curve and the claim quietly becomes false: the
    reader compares a twelve-month figure against an eighteen-month one and
    finds the table contradicting itself.
  */
  const truncated = months !== null && span - 1 > months

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
    /* The table flexes between `width` and `maxWidth`, so the clamp has to ask
       it how wide it actually came out; the constant it used to clamp against
       was the MINIMUM, and on a wide card it pulled the right-hand columns'
       panels away from the cells they describe. */
    const tableWidth = el.closest('table')?.offsetWidth ?? width
    setHot({
      row,
      col,
      // Clamped to half a panel from either edge, so the first and last
      // columns do not open a tip that is cut off by the scroll box.
      x: Math.min(Math.max(el.offsetLeft + el.offsetWidth / 2, 120), tableWidth - 120),
      y: below ? el.offsetTop + el.offsetHeight + 6 : el.offsetTop - 6,
      below,
    })
  }

  const panel = hot ? panelFor(hot, rows, averages, view) : null

  return (
    <div className="space-y-3">
      <div className="relative overflow-x-auto" onMouseLeave={() => setHot(null)}>
        <table
          className="tabular"
          style={{
            /* The pinned columns keep the fixed widths `PINNED` declares —
               every sticky `left` is derived from them — and only the months
               flex. With five of them the block is 520px wide, so a 1280px
               screen with the rail open gives the twelve months less than
               their 44px floor and the card scrolls sideways by ~95px; the
               pinned block is sticky, so the labels stay while it does, and
               from ~1375px (or with the rail collapsed) it fits again. */
            width: '100%',
            minWidth: width,
            maxWidth,
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
            {view === 'monthly'
              ? 'Kogorta matritsasi: har bir qator — mijozlar birinchi marta xarid qilgan oy, har bir ustun — oʻsha oydan keyin oʻtgan oylar soni, katakdagi foiz — oʻsha oyda qayta xarid qilgan mijozlar ulushi.'
              : 'Kogorta matritsasi: har bir qator — mijozlar birinchi marta xarid qilgan oy, har bir ustun — oʻsha oydan keyin oʻtgan oylar soni, katakdagi foiz — oʻsha oyga kelib kamida bir marta qaytib kelgan mijozlar ulushi.'}
          </caption>

          <colgroup>
            {PINNED.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
            {offsets.map((i) => (
              <col key={i} />
            ))}
          </colgroup>

          <thead>
            <tr>
              <HeadCell rowSpan={2} left={LEFT.cohort} width={WIDTH.cohort} align="left">
                Kogorta oyi
              </HeadCell>
              <HeadCell rowSpan={2} left={LEFT.size} width={WIDTH.size} align="right">
                Yangi mijoz
              </HeadCell>
              {/* Two lines on purpose: «Qaytgan» alone leaves the reader to
                  guess whether the percentage beside it is of the cohort or of
                  the company. */}
              <HeadCell rowSpan={2} left={LEFT.returned} width={WIDTH.returned} align="right">
                Qaytgan
                <span className="block text-[10px] font-normal">shu guruhdan</span>
              </HeadCell>
              {/*
                «HOZIRGACHA» IS THE FIRST OF THE THREE DEFENCES.

                Both of these are money TO DATE, and the second one especially
                does not compare down the column: see `MONEY_YOUNG_MONTHS`. The
                word is in the heading rather than only in the hover because the
                comparison is made by the eye, before anything is hovered.
              */}
              <HeadCell
                rowSpan={2}
                left={LEFT.revenueTotal}
                width={WIDTH.revenueTotal}
                align="right"
              >
                Kogorta tushumi
                <span className="block text-[10px] font-normal">hozirgacha</span>
              </HeadCell>
              <HeadCell
                rowSpan={2}
                left={LEFT.revenuePerCustomer}
                width={WIDTH.revenuePerCustomer}
                align="right"
                edge
              >
                1 mijozga
                <span className="block text-[10px] font-normal">hozirgacha</span>
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
                {view === 'monthly'
                  ? 'Birinchi xariddan keyin oʻtgan oylar — oʻsha oyda qayta xarid qilganlar ulushi, %'
                  : 'Birinchi xariddan keyin oʻtgan oylar — shu oyga kelib qaytganlar ulushi, %'}
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
              /* The third defence. See `MONEY_YOUNG_MONTHS`: the figure still
                 prints, it simply stops looking like one of the comparable ones. */
              const young = row.ageMonths < MONEY_YOUNG_MONTHS

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

                  <PinnedCell left={LEFT.size} lit={lit} align="right" onMouseEnter={enter(r, -1)}>
                    {formatNumber(row.size)}
                  </PinnedCell>

                  {/*
                    THE SHARE, NOT THE PAIR.

                    This cell used to print «117 · 3%» — two numbers in two
                    formats in one right-aligned column, the noisiest thing in
                    the pinned block. The share is what a reader compares down
                    the column; the count is evidence for it, and it is now in
                    the cell's label and in the row's hover panel rather than
                    competing with the figure it supports.
                  */}
                  <PinnedCell
                    left={LEFT.returned}
                    lit={lit}
                    align="right"
                    onMouseEnter={enter(r, -1)}
                    ariaLabel={`${formatMonth(row.cohort)} kogortasi: ${formatNumber(
                      row.size,
                    )} mijozdan ${formatNumber(row.returned)} tasi qaytgan${
                      share === null ? '' : ` — ${Math.round(share)}%`
                    }`}
                  >
                    {share === null ? NO_VALUE : `${Math.round(share)}%`}
                  </PinnedCell>

                  {/*
                    THE MONEY, AND THE ONE READING IT MUST NOT INVITE.

                    The whole-cohort figure adds up down the column and the
                    per-customer one does not — it is money TO DATE over an age
                    that differs by a year from the top of the table to the
                    bottom. Both open the same panel (`MONEY_COL`), which states
                    the cohort's age; the second one also carries that age in
                    its own label, for a reader who cannot hover.
                  */}
                  <PinnedCell
                    left={LEFT.revenueTotal}
                    lit={lit}
                    align="right"
                    onMouseEnter={enter(r, MONEY_COL)}
                    ariaLabel={`${formatMonth(row.cohort)} kogortasi: kogorta tushumi hozirgacha ${
                      row.revenueTotal
                    }`}
                  >
                    {row.revenueTotal}
                  </PinnedCell>

                  <PinnedCell
                    left={LEFT.revenuePerCustomer}
                    lit={lit}
                    align="right"
                    edge
                    young={young}
                    onMouseEnter={enter(r, MONEY_COL)}
                    ariaLabel={
                      young
                        ? `1 mijozga hozirgacha ${row.revenuePerCustomer} — kogorta ${formatNumber(
                            row.ageMonths,
                          )} oylik, boshqa qatorlar bilan solishtirib boʻlmaydi`
                        : `1 mijozga hozirgacha ${row.revenuePerCustomer} — kogorta ${formatNumber(
                            row.ageMonths,
                          )} oylik`
                    }
                  >
                    {row.revenuePerCustomer}
                  </PinnedCell>

                  {offsets.map((i) => (
                    <HeatCell
                      key={i}
                      view={view}
                      value={valuesOf(row)[i] ?? null}
                      customers={countsOf(row)[i] ?? null}
                      size={row.size}
                      cohort={row.cohort}
                      offset={i}
                      litRow={lit}
                      litCol={hot?.col === i}
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
                left={LEFT.size}
                lit={hot?.row === -1}
                align="right"
                summary
                onMouseEnter={enter(-1, -1)}
              >
                {formatNumber(totalSize)}
              </PinnedCell>

              <PinnedCell
                left={LEFT.returned}
                lit={hot?.row === -1}
                align="right"
                summary
                onMouseEnter={enter(-1, -1)}
                ariaLabel={`Jami: ${formatNumber(totalSize)} mijozdan ${formatNumber(
                  totalReturned,
                )} tasi qaytgan${totalShare === null ? '' : ` — ${Math.round(totalShare)}%`}`}
              >
                {totalShare === null ? NO_VALUE : `${Math.round(totalShare)}%`}
              </PinnedCell>

              {/*
                THE MONEY COLUMNS HAVE NO «JAMI», AND THAT IS THE HONEST CELL.

                Two reasons, and either one alone would be enough. The grid is
                handed money already FORMATTED — the crossing happens once, in
                `toMatrixRow` — so there is no number here to add; and the
                per-customer column may not be summed or averaged in any case,
                because each of its figures covers a different span of months.
                A total under them would be the cross-row comparison the whole
                column is built to discourage, printed as a fact. Each cohort's
                money is on its own row, where it is a measurement.
              */}
              <PinnedCell
                left={LEFT.revenueTotal}
                lit={hot?.row === -1}
                align="right"
                summary
                onMouseEnter={enter(-1, -1)}
                label={MONEY_NOT_SUMMED}
              >
                {NO_VALUE}
              </PinnedCell>

              <PinnedCell
                left={LEFT.revenuePerCustomer}
                lit={hot?.row === -1}
                align="right"
                summary
                edge
                onMouseEnter={enter(-1, -1)}
                label={MONEY_NOT_SUMMED}
              >
                {NO_VALUE}
              </PinnedCell>

              {offsets.map((i) => {
                const avg = averages.get(i)
                return (
                  <HeatCell
                    key={i}
                    view={view}
                    summary
                    value={avg?.percent ?? null}
                    customers={avg?.returned ?? null}
                    size={avg?.base ?? 0}
                    cohort={null}
                    offset={i}
                    litRow={hot?.row === -1}
                    litCol={hot?.col === i}
                    onMouseEnter={enter(-1, i)}
                  />
                )
              })}
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

      <Legend view={view} truncated={truncated} />
    </div>
  )
}

/** Why the summary row's two money cells are blank. Said on hover, not in a figure. */
const MONEY_NOT_SUMMED =
  'Pul ustunlari qator boʻyicha oʻqiladi: har bir kogortaning puli oʻz yoshiga bogʻliq, shuning uchun bu yerda jamlanmaydi.'

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
 * One of the pinned columns of a body or summary row — see `PINNED`.
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
  young,
  onMouseEnter,
  label,
  ariaLabel,
}: {
  readonly children: React.ReactNode
  readonly left: number
  readonly lit: boolean
  readonly align: 'left' | 'right'
  readonly header?: boolean
  readonly summary?: boolean
  readonly edge?: boolean
  /**
   * A figure that is true but not comparable with the ones above and below it.
   *
   * Only «1 mijozga hozirgacha» sets it, and only under `MONEY_YOUNG_MONTHS`.
   * Greyed rather than withheld, and `data-young` is on the cell itself so the
   * rule is checkable — the ink alone is a claim no test can read. Left
   * UNDEFINED by every other column: a `data-young="false"` on «Qaytgan» would
   * claim the rule applies there and happens not to bite.
   */
  readonly young?: boolean
  readonly onMouseEnter?: (event: MouseEvent<HTMLElement>) => void
  /** Hover text. On a `<td>` it is the only place a blank cell can say why. */
  readonly label?: string
  /**
   * The whole fact, for a cell that prints only part of it.
   *
   * «Qaytgan» shows the share; the distinct count it divides is here, so a
   * reader who cannot hover is not left with a percentage whose numerator the
   * table never states.
   */
  readonly ariaLabel?: string
}) {
  const style = {
    left,
    /* `--grid` is the house hover tint; `--surface-sunken` is DARKER than the
       card in dark mode, so it painted the hovered row as a black bar. */
    background: lit ? 'var(--grid)' : 'var(--surface-raised)',
    color: young
      ? 'var(--ink-muted)'
      : summary || header
        ? 'var(--ink-primary)'
        : 'var(--ink-secondary)',
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
    <td
      className={className}
      style={style}
      onMouseEnter={onMouseEnter}
      title={label}
      aria-label={ariaLabel}
      data-young={young === undefined ? undefined : String(young)}
    >
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
  view,
  value,
  customers,
  size,
  cohort,
  offset,
  summary = false,
  litRow = false,
  litCol = false,
  onMouseEnter,
}: {
  readonly view: CohortView
  readonly value: number | null
  readonly customers: number | null
  readonly size: number
  readonly cohort: string | null
  readonly offset: number
  readonly summary?: boolean
  /** The two halves of the crosshair. See `crosshair`. */
  readonly litRow?: boolean
  readonly litCol?: boolean
  readonly onMouseEnter: (event: MouseEvent<HTMLElement>) => void
}) {
  if (value === null) {
    return (
      <td
        className="h-6 p-0"
        style={{ borderTop: summary ? '1px solid var(--border-strong)' : undefined }}
        onMouseEnter={onMouseEnter}
        aria-label="hali oʻtmagan oy — oʻlchanmagan"
      >
        <div
          className="h-full min-h-6"
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
          /* The crosshair runs through the unmeasured months too, or it stops
             dead halfway down a column and reads as the end of the data. */
          style={{ background: UNMEASURED, boxShadow: crosshair(litRow, litCol) }}
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
  /*
    AND NEITHER IS A SUMMARY CELL STANDING ON A HANDFUL OF PEOPLE.

    Seen on production the day this shipped. The «Jami · oʻrtacha» row read
    4 7 9 10 11 11 12 12 13 13 14 19 27 36 **0** — climbing to 36% and then
    falling off a cliff. Every figure was right: each column averages only the
    cohorts old enough to have reached it, so the far right of that row is one
    or two ancient cohorts, and the last column was ONE cohort of ONE customer
    who never came back. Painted on the ramp beside fourteen real averages, it
    reads as a collapse in retention. It is a sample of one.

    The figure stays — «0% of 1» is true and the panel says how many cohorts —
    but it comes off the ramp, the same treatment and for the same reason as
    the `0` column: a cell nobody should read a trend into must not be coloured
    like the cells they should. Thirty is the floor `WAIT_BAND_MIN_ORDERS` uses
    on Logistika, and for the same argument — below it one person moves the
    figure by more than the gap between two bands.
  */
  const thin = summary && size < SUMMARY_MIN_BASE

  const base = (view === 'monthly' && offset === 0) || thin

  const band = bandsFor(view)[bandOf(view, value)] ?? bandsFor(view)[0]
  const shown = value === 0 ? '0' : value < 1 ? '<1' : String(Math.round(value))

  return (
    <td
      className="h-6 p-0"
      style={{ borderTop: summary ? '1px solid var(--border-strong)' : undefined }}
      onMouseEnter={onMouseEnter}
      /* On the CELL, not on the tile inside it: a bare <div aria-label> carries
         no role, and a screen reader announces nothing for it. Here it replaces
         «13%» with the whole fraction, which is the reading a person who cannot
         hover would otherwise have to assemble from the headers. */
      aria-label={cellSentence({ view, cohort, offset, value, customers, size, summary })}
    >
      {/*
        THE UNIT IS SAID ONCE, IN THE HEADER OVER THE COLUMNS.

        A «%» in every cell is 250 glyphs repeating what the column group
        already states — «…qayta xarid qilganlar ulushi, %» — and they were set
        at 8.5px and 62% opacity precisely because they were in the way. The
        cell's own label still spells the figure out as a percentage for anyone
        who cannot see the header it belongs to.
      */}
      <div
        data-heat=""
        className="flex h-full min-h-6 items-center justify-center text-[11px] font-medium"
        style={{
          background: base ? 'var(--surface-sunken)' : band?.background,
          color: base
            ? 'var(--ink-secondary)'
            : band?.dark
              ? 'var(--surface)'
              : 'var(--ink-primary)',
          boxShadow: crosshair(litRow, litCol),
        }}
      >
        {shown}
      </div>
    </td>
  )
}

/** The scale, stated in numbers. A colour a reader cannot convert back is decoration. */
function Legend({
  view,
  truncated = false,
}: {
  readonly view: CohortView
  readonly truncated?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span className="font-medium">Qaytish ulushi:</span>
        {bandsFor(view).map((band) => (
          <span key={band.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-5 rounded-[1px]"
              style={{ background: band.background }}
            />
            {band.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 rounded-[1px]"
            style={{ background: UNMEASURED }}
          />
          hali oʻtmagan oy — oʻlchanmagan
        </span>
      </div>
      {/* ONE sentence, and it changes with the reading. The card used to carry
          a hint, a worked example and two legend lines over one table — four
          blocks of prose around 250 numbers. The hover panel already spells
          out every cell's arithmetic, so this says only what the grid cannot:
          what a cell divides by. */}
      <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {view === 'monthly'
          ? 'Har bir katak = oʻsha oyda qayta xarid qilgan mijozlar ÷ kogortadagi jami mijozlar. «0» ustuni — kogortaning oʻz oyi, u har doim 100%.'
          : truncated
            ? 'Har bir katak = shu oyga kelib kamida bir marta qaytgan mijozlar ÷ kogortadagi jami mijozlar. «Qaytgan» ustuni butun tarixni hisoblaydi, shuning uchun u koʻrsatilgan oynadan kattaroq boʻlishi mumkin.'
            : 'Har bir katak = shu oyga kelib kamida bir marta qaytgan mijozlar ÷ kogortadagi jami mijozlar. Qator oxiridagi katak «Qaytgan» ustuni bilan bir xil boʻladi.'}{' '}
        Katak ustiga sichqonchani olib borsangiz, aniq hisob-kitob chiqadi.
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
function columnAverage(
  rows: readonly CohortMatrixRow[],
  offset: number,
  view: CohortView,
): ColumnAverage {
  let returned = 0
  let base = 0
  let cohorts = 0

  for (const row of rows) {
    const values = view === 'monthly' ? row.retention : row.cumulative
    const counts = view === 'monthly' ? row.customers : row.cumulativeCustomers
    if (values[offset] === null || values[offset] === undefined) continue
    returned += counts[offset] ?? 0
    base += row.size
    cohorts += 1
  }

  return { percent: base > 0 ? (returned / base) * 100 : null, returned, base, cohorts }
}

function panelFor(
  hot: Hot,
  rows: readonly CohortMatrixRow[],
  averages: ReadonlyMap<number, ColumnAverage>,
  view: CohortView,
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
    const avg = averages.get(hot.col)
    if (!avg) return null

    return {
      header: hot.col === 0 ? 'Oʻrtacha — xarid oyi' : `Oʻrtacha — +${hot.col} oy`,
      rows: [
        {
          label: view === 'monthly' ? 'Qaytgan mijozlar' : 'Shu oyga kelib qaytganlar',
          value: `${formatNumber(avg.returned)} / ${formatNumber(avg.base)}`,
        },
        { label: 'Ulush', value: formatPercent(avg.percent) },
        { label: 'Nechta kogortadan', value: `${formatNumber(avg.cohorts)} ta` },
      ],
      /* A thin base is the thing to say FIRST — see the `thin` branch of
         HeatCell for the production row that made this necessary. */
      footer:
        avg.base < SUMMARY_MIN_BASE
          ? `Namuna kichik — bu ustunga atigi ${formatNumber(avg.base)} ta mijoz yetib kelgan, shuning uchun katak rangsiz. Undan tendensiya oʻqimang.`
          : 'Faqat shu oyga yetib ulgurgan kogortalar hisobga olingan.',
    }
  }

  const row = rows[hot.row]
  if (!row) return null

  /*
    THE MONEY COLUMNS, AND THE SECOND OF THE THREE DEFENCES.

    Their own panel rather than the whole-cohort one, because what these two
    figures need said is not a fraction — it is the SPAN they cover. Every
    money hover therefore states the cohort's age, at every age: saying it only
    for the young rows would leave the reader to assume the rest are on equal
    terms with each other, which is the misreading in the first place.
  */
  if (hot.col === MONEY_COL) {
    return {
      header: `${formatMonth(row.cohort)} kogortasi · pul`,
      rows: [
        { label: 'Kogorta tushumi', value: row.revenueTotal },
        { label: '1 mijozga', value: row.revenuePerCustomer },
        { label: 'Mijozlar', value: `${formatNumber(row.size)} mijoz` },
        { label: 'Kogorta yoshi', value: `${formatNumber(row.ageMonths)} oy` },
      ],
      footer:
        row.ageMonths < MONEY_YOUNG_MONTHS
          ? `Kogorta ${formatNumber(
              row.ageMonths,
            )} oylik — bu raqamni eski kogortalar bilan solishtirib boʻlmaydi.`
          : `Kogorta ${formatNumber(row.ageMonths)} oy davomida shuncha olib kelgan.`,
    }
  }

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
        /* The «Kogorta tushumi» column's own string, not a second fold of
           `revenue` — two places computing one figure is two figures. */
        { label: 'Jami tushum', value: row.revenueTotal },
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

  const amount = row.revenue[hot.col]?.amount ?? 0

  /*
    THE CUMULATIVE CELL SAYS BOTH NUMBERS.

    The grid draws "how many have come back by now"; the reader's next question
    is always "did anybody come back THIS month" — and that is the increment,
    which is the monthly reading's whole subject. Stating it here is what lets
    the default view be the cumulative one without the other becoming a
    different screen: a flat stretch of colour is explained in the panel rather
    than by switching the table.
  */
  if (view === 'cumulative') {
    const share = row.cumulative[hot.col]
    if (share === null || share === undefined) return null

    const reached = row.cumulativeCustomers[hot.col] ?? 0
    const before = hot.col > 0 ? (row.cumulativeCustomers[hot.col - 1] ?? 0) : 0
    const added = reached - before

    return {
      header: `${formatMonth(row.cohort)} kogortasi · +${hot.col} oy (${formatMonthOffset(
        row.cohort,
        hot.col,
      )})`,
      rows: [
        /*
          MIJOZ AND BUYURTMA ARE DIFFERENT NUMBERS, and the panel now says
          which is which. The cells always carried both — `customers` counts
          PEOPLE, `orders` counts revenue-bearing wins — and the panel printed
          only the first, under a label that named neither unit. Three people
          placing four orders is the ordinary case, not an edge one.
        */
        {
          label: 'Shu oyga kelib qaytganlar',
          value: `${formatNumber(reached)} / ${formatNumber(row.size)} mijoz`,
        },
        { label: 'Ulush', value: formatPercent(share) },
        { label: 'Shu oyda qoʻshilgan', value: added > 0 ? `+${formatNumber(added)}` : '0' },
        { label: 'Buyurtmalar', value: `${formatNumber(row.orders[hot.col] ?? 0)} ta` },
        { label: 'Shu oydagi tushum', value: formatUzs(amount) },
      ],
      footer:
        added === 0
          ? 'Bu oyda yangi qaytgan mijoz boʻlmagan — ulush oʻzgarmagan.'
          : 'Har bir mijoz bir marta sanaladi: birinchi qaytgan oyida.',
    }
  }

  const value = row.retention[hot.col]
  if (value === null || value === undefined) return null

  const customers = row.customers[hot.col] ?? 0

  if (hot.col === 0) {
    return {
      header: `${formatMonth(row.cohort)} · xarid oyi`,
      rows: [
        { label: 'Birinchi marta xarid qilganlar', value: `${formatNumber(row.size)} mijoz` },
        { label: 'Buyurtmalar', value: `${formatNumber(row.orders[hot.col] ?? 0)} ta` },
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
        value: `${formatNumber(customers)} / ${formatNumber(row.size)} mijoz`,
      },
      { label: 'Ulush', value: formatPercent(value) },
      { label: 'Buyurtmalar', value: `${formatNumber(row.orders[hot.col] ?? 0)} ta` },
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
  view,
  cohort,
  offset,
  value,
  customers,
  size,
  summary,
}: {
  readonly view: CohortView
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
    customers === null
      ? ''
      : view === 'monthly'
        ? ` — ${formatNumber(size)} mijozdan ${formatNumber(customers)} tasi shu oyda qayta xarid qilgan`
        : ` — ${formatNumber(size)} mijozdan ${formatNumber(customers)} tasi shu oyga kelib qaytgan`

  return `${who}, ${when}: ${formatPercent(value)}${fraction}`
}
