'use client'

import { useState, type MouseEvent } from 'react'

import { ChartTooltipPanel, type ChartTooltipRow } from '@/components/charts/chartTooltip'
import {
  NO_VALUE,
  formatCompactUzs,
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

/**
 * Which of the THREE readings the grid is drawing.
 *
 * Two of them count PEOPLE and divide by the cohort, so they share a scale, a
 * ramp and a cell. The third counts MONEY and shares none of the three — see
 * `MONEY_BANDS` and `MoneyCell`, which are its half of this file.
 */
export type CohortView = 'cumulative' | 'monthly' | 'money'

/** True for the two readings that print a share of the cohort. */
function isShareView(view: CohortView): view is 'cumulative' | 'monthly' {
  return view !== 'money'
}

/**
 * Exactly the five fields `columnAverage` reads — so a caller that only wants
 * the grid's column average (see `ReturnAnswer`) does not have to construct a
 * whole matrix row for the fields beyond these five, which it would never
 * look at.
 */
interface AveragableCohortRow {
  readonly size: number
  /** Share of the cohort buying again, by offset. Null = the month has not happened. */
  readonly retention: readonly (number | null)[]
  /** The headcount behind each share, same offsets, same nulls. */
  readonly customers: readonly (number | null)[]
  /** Share that had come back at least once by each offset. Monotonic. */
  readonly cumulative: readonly (number | null)[]
  /** The headcount behind each cumulative share, same offsets, same nulls. */
  readonly cumulativeCustomers: readonly (number | null)[]
}

/** Exactly the fields the matrix draws — the DTO's shape, minus what it ignores. */
export interface CohortMatrixRow extends AveragableCohortRow {
  /** First day of the cohort month, `YYYY-MM-DD`. */
  readonly cohort: string
  /** Ever came back, counted once each. Never the sum of `customers`. */
  readonly returned: number
  /** What that offset's purchases were worth. */
  readonly revenue: readonly { readonly amount: number }[]
  /**
   * Revenue-bearing WON deals per offset — ORDERS, where `customers` counts
   * PEOPLE. Same offsets, same nulls, so a hover can say «3 mijoz · 4 ta
   * buyurtma» without the reader having to guess which of the two a cell meant.
   */
  readonly orders: readonly (number | null)[]
  /**
   * Every month of this cohort's money added up — COMPACT, «6.3 mln», for the
   * column. PRE-FORMATTED, like every other figure on this grid.
   *
   * The DTO carries a `MoneyDto`; this carries strings, and the boundary is
   * deliberate — handing a chart a currency would put currency logic inside a
   * presentation component. `toMatrixRow` in `CohortPage.tsx` is where the
   * crossing happens, beside the formatters that already live there.
   */
  readonly revenueTotal: string
  /**
   * The same figure to the last soʻm, for the hover and the cell's own label.
   *
   * Precision is DEFERRED, never lost: a money column is scanned, and
   * «6,300,000» beside «412,350,000» is two shapes the eye has to parse before
   * it can compare them. Both strings so the grid never rounds anything itself.
   */
  readonly revenueTotalExact: string
  /**
   * The number behind those two strings — major units, lossy, ratios ONLY.
   *
   * The whole-cohort panel divides «Shundan takroriy» by this rather than by a
   * fold of its own, so the share and the total it is a share OF are one base.
   * Never printed: the two strings above are what the screen says.
   */
  readonly revenueTotalAmount: number
  /** `revenueTotal / size`, compact. See `ageMonths` — it does NOT compare across rows. */
  readonly revenuePerCustomer: string
  /** The same figure to the last soʻm. See `revenueTotalExact`. */
  readonly revenuePerCustomerExact: string
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
    COMPACT MONEY, AND THE WIDTHS ARE MEASURED FROM IT.

    A money COLUMN is compact everywhere in this application — Yalpi marja and
    Logistika both print `formatCompactUzs` in the cell — and the full-digit
    exception belongs to the sellers board, whose whole job is to reconcile
    digit-for-digit against a Bitrix24 board and a Telegram channel. Nothing
    reconciles a cohort's lifetime revenue; no portal screen prints it at all.
    Full precision is one hover away, in the panel and in the cell's own label.

    Measured in Inter 12px with `tabular-nums`, plus the cell's own 16px of
    padding, because these cells are `whitespace-nowrap` and an over-long
    figure spills out over the heat tiles instead of wrapping: «999.9 mln» is
    58.0 and «12.3 mlrd» 54.8, so 104 carries the widest total with room for
    the «Kogorta tushumi» heading (86.6) on one line; «262.5 ming» is 65.4, so
    88 carries the per-customer figure. Full-digit money needed 136 + 116, and
    that 52px is sideways scroll this grid now does not do at 1280px.
  */
  { key: 'revenueTotal', width: 104 },
  { key: 'revenuePerCustomer', width: 88 },
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

/*
  A MONTH COLUMN CARRIES TWO FIGURES NOW, AND THAT IS WHAT SET THIS WIDTH.

  Until 2026-09-16 a cell printed the share alone, and 44px held it. The
  headcount that share was computed from was reachable only by hovering —
  which is to say, not reachable at all on the screen this table is actually
  read on, where a manager scans a column and never touches the mouse. Every
  other rate on this dashboard prints the fraction it came from beside itself;
  this one deferred it to a tooltip and to an `aria-label`, and the module's
  own opening claim — «nothing on this table is a number whose denominator the
  reader has to guess» — was true only of a reader with a pointer.

  «12 · 47» states both in the cell. The unit is still said once, in the
  column group's heading, and the second figure is set smaller and lighter so
  the eye takes the share first and the count second.

  MEASURED, not chosen. Inter 11px tabular carries «100» in 20.5px and the
  separator in 5px; the count at 9px carries five digits and a separating
  space — «11 500» — in 32px, which is the SUMMARY row's «Oylik +0» cell,
  every first-time buyer in the matrix at once. 57.5px of glyph plus the 6px
  the tiles need to stay apart is 63.5, so 66 holds the widest cell this grid
  can produce.

  WHAT IT COSTS IS SIDEWAYS SCROLL, and the cost was taken deliberately.
  Twelve months at 66 plus the 460px pinned block is 1 252px against the
  card's ~988 on a 1280px laptop with the rail open, so that screen scrolls by
  ~264px where it used to scroll by ~10. The pinned block is sticky, so the
  cohort, its size and its «Qaytgan» share stay on screen the whole way across,
  and «6 oy» is one press away. On the 27-inch screen this page is read on the
  table still fits whole.
*/
const W_MONTH = 66
/*
  AND HOW WIDE A MONTH MAY GROW.

  With the window down to twelve columns the table stopped filling its card —
  796px of matrix floating in 1888px of hero panel, which reads as a rendering
  fault rather than as a choice. The month columns now share whatever the card
  gives them, between these two bounds: below 66 the two figures collide, and
  past 92 the cells stretch into bars and the grid stops reading as a grid.
*/
const W_MONTH_MAX = 92

/*
  AND THE MONEY READING NEEDS TWELVE MORE PIXELS THAN THE SHARE ONES.

  A share cell's widest pair is «100 · 11 500»; a money cell's is
  «12,3 mlrd · ×2,4», and a compact money figure carries a unit word the
  share does not. Measured the same way: 46px for the figure at 11px tabular,
  5 for the separator, 20 for the multiple at 9px, 6 of padding — 77.

  It is a THIRD width rather than one width for all three readings because the
  money view is opt-in and the two share readings are what the page opens on.
  Charging every reader of the default view twelve pixels of sideways scroll
  for a view they have not asked for is the trade the wrong way round.
*/
const W_MONTH_MONEY = 78
const W_MONTH_MONEY_MAX = 104

/** The month-column bounds for a reading. One place decides; the table follows. */
function widthsFor(view: CohortView): { readonly min: number; readonly max: number } {
  return view === 'money'
    ? { min: W_MONTH_MONEY, max: W_MONTH_MONEY_MAX }
    : { min: W_MONTH, max: W_MONTH_MAX }
}

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
 * And below this many COHORTS it is printed but not painted either.
 *
 * TWO FLOORS, ONE HAZARD, AND THE SECOND ONE USED TO EXIST IN ONLY ONE MODE.
 * `SUMMARY_MIN_BASE` above asks how many PEOPLE reached a column;
 * this asks how many COHORTS were averaged to get there, and a column can
 * clear one floor while failing the other — a single cohort of 400 customers
 * is 400 people and a sample of ONE month, which is exactly the shape the +12
 * column takes as the oldest rows fall out of the window.
 *
 * It lived in `ReturnAnswer.tsx`, where «Oddiy» refuses the milestone
 * outright, while the grid beside it painted the same evidence on the ramp:
 * «yetarli maʼlumot yoʻq» and a coloured figure, one press of the toggle
 * apart, about one number. Exported and read by both, so the two modes refuse
 * on the SAME evidence — which is the invariant this screen is built on
 * (spec §8.2), not a nicety.
 *
 * Three, because two cohorts is a pair and a pair has no middle.
 */
const MIN_COHORTS_FOR_AVERAGE = 3

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

/**
 * The money reading's five steps — BANDED ON THE MULTIPLE, NOT ON THE SOʼM.
 *
 * A cell prints what one customer of the cohort had brought by that month, and
 * soʼm cannot be banded: the figure depends on the product mix and on
 * inflation, and a fixed set of thresholds in soʼm would paint the whole grid
 * one colour the first time either moved. The multiple — that figure over the
 * SAME cohort's first month — is scale-free, is what the column is actually
 * asked («how much more did they bring us after the first sale»), and is
 * printed in the cell beside the money, so the colour converts back into a
 * number the reader can see.
 *
 * ×1,00 IS THE FLOOR AND IT IS A REAL VALUE, not an empty cell: it is a
 * cohort that has bought once and not come back. Every row starts there at
 * offset 0 by construction, which is why that column comes off the ramp
 * exactly as the monthly reading's «0» column does.
 *
 * THE THRESHOLDS ARE NOT MEASURED AGAINST PRODUCTION, and this note is the
 * honest half of shipping them. The customer readings' bands were set from
 * measured ranges (monthly 0–16%, cumulative 0–37%); nothing in this
 * repository has yet read the money curve on the live portal, so these are
 * derived from what the customer curve implies — a 37% cumulative return rate
 * at an order value near the cohort's first cannot put many rows past ×1,5 —
 * and they should be re-cut against the first production reading. A ramp with
 * every cell in one step is the symptom; the fix is these five numbers and
 * nothing else.
 */
const MONEY_BANDS = [
  {
    label: 'birinchi xariddan oshmagan',
    background: 'color-mix(in oklab, var(--seq-250) 22%, var(--surface))',
    dark: false,
  },
  {
    label: '×1,02–×1,1',
    background: 'color-mix(in oklab, var(--seq-250) 55%, var(--surface))',
    dark: false,
  },
  { label: '×1,1–×1,25', background: 'var(--seq-350)', dark: false },
  { label: '×1,25–×1,5', background: 'var(--seq-550)', dark: true },
  { label: '×1,5 va undan koʻp', background: 'var(--seq-650)', dark: true },
] as const

function bandsFor(view: CohortView): readonly { label: string; background: string; dark: boolean }[] {
  return view === 'money' ? MONEY_BANDS : view === 'monthly' ? MONTHLY_BANDS : CUMULATIVE_BANDS
}

/** Which `MONEY_BANDS` step a multiple falls in. See that table for the cuts. */
function bandOfMultiple(multiple: number): number {
  return multiple >= 1.5 ? 4 : multiple >= 1.25 ? 3 : multiple >= 1.1 ? 2 : multiple >= 1.02 ? 1 : 0
}

/**
 * One money cell: what a customer of this cohort had brought in by month N.
 *
 * CUMULATIVE, ALWAYS — there is no monthly money reading and that is a
 * decision, not an omission. A cohort's money in a single later month is
 * 0–4% of its customers times one order each; read down a column those cells
 * are noise, and read across a row they are a sawtooth. The question the money
 * view exists for is «what is a customer of this month worth by now», and that
 * is a running total.
 */
interface MoneyPoint {
  /** Revenue through this offset ÷ the cohort. Major units, lossy, for display. */
  readonly perCustomer: number
  /** That figure over the same cohort's offset 0. Exactly 1 at offset 0. */
  readonly multiple: number | null
}

/**
 * The money curve of one row, offset by offset.
 *
 * REACHABILITY IS TAKEN FROM `retention`, not from `revenue`. The two arrays
 * are the same length and the same nulls mean the same thing, but a month that
 * HAPPENED and in which nobody bought is a measured zero — the running total
 * simply does not move — while a month that has not happened has no cell at
 * all. Reading `revenue[i]` for the distinction would merge them, which is the
 * same null-is-not-zero rule `rateBp` keeps on the server.
 */
function moneyPointsOf(row: CohortMatrixRow): readonly (MoneyPoint | null)[] {
  const points: (MoneyPoint | null)[] = []
  let running = 0
  let first: number | null = null

  for (let i = 0; i < row.retention.length; i += 1) {
    if (row.retention[i] === null || row.retention[i] === undefined) {
      points.push(null)
      continue
    }
    running += row.revenue[i]?.amount ?? 0
    const perCustomer = row.size > 0 ? running / row.size : 0
    if (first === null) first = perCustomer
    points.push({
      perCustomer,
      multiple: first > 0 ? perCustomer / first : null,
    })
  }

  return points
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
  The crosshair. Hovering lifts a row AND a column out of the dozens of each
  the grid draws, which is most of what makes a wide matrix answerable —
  «2025-avg × +3» is a cell nobody can find by counting. (It said «out of
  eighteen of each»; the query asks for eighteen months but the columns have
  defaulted to twelve since the window landed, and the row count is whatever
  the payload holds. The point does not depend on either number.) The row half is also painted on the pinned
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
  totalRevenue,
}: {
  readonly rows: readonly CohortMatrixRow[]
  /** Which reading to draw. See the module comment; cumulative is the default. */
  readonly view?: CohortView
  maxColumns?: number
  readonly months?: number | null
  /**
   * «Kogorta tushumi», added up over the rows this grid was given.
   *
   * IT IS THE COLUMN, SUMMED — nothing wider. A footer cell's grammar already
   * promises exactly that, and it is the one promise this slot cannot be
   * talked out of: the figure carries no visible marker (its hover and its
   * accessible name are all there is), so a sighted reader scanning the
   * column sees a number under a column and reads it as that column's total.
   * A company-wide figure here would be a different fact wearing the same
   * shape, and this screen prints no revenue tile anywhere else that could
   * have told them otherwise.
   *
   * Well-defined because `months` bounds COLUMNS, not rows: every row the
   * caller hands over is drawn, whichever width the reader picks, so the sum
   * does not move under the 6 / 12 / Hammasi control.
   *
   * TWO STRINGS, compact and exact, exactly like the column above it — the
   * grid is handed money already formatted and has no currency, no locale and
   * no rounding rule of its own. The caller crosses that boundary once, in
   * `toMatrixRow`'s neighbourhood. Omitted, the cell stays blank and says why
   * on hover.
   */
  readonly totalRevenue?: {
    readonly compact: string
    readonly exact: string
  }
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
  /* The money reading keeps its `0` column for the opposite reason the
     cumulative one drops it: there it is a zero for every row there has ever
     been, here it is the denominator every other cell divides by. */
  const offsets = Array.from({ length: span }, (_, i) => i).filter(
    (i) => (view !== 'cumulative' || i > 0) && (months === null || i <= months),
  )
  const columns = offsets.length
  const bounds = widthsFor(view)
  const width = PINNED_WIDTH + columns * bounds.min
  const maxWidth = PINNED_WIDTH + columns * bounds.max

  /** The array this reading draws from. One place decides, everything follows. */
  const valuesOf = (row: CohortMatrixRow) => (view === 'monthly' ? row.retention : row.cumulative)
  const countsOf = (row: CohortMatrixRow) =>
    view === 'monthly' ? row.customers : row.cumulativeCustomers

  /*
    TWO SUMMARY MAPS, AND ONLY THE ONE THIS READING USES IS BUILT.

    `columnAverage` reads `retention`/`cumulative` and would answer the money
    view with the cumulative share — a real number, of the wrong fact, printed
    under a money heading. The branch is here rather than inside that function
    so the share readings' own helper keeps taking a `CohortView` it can
    actually satisfy, and so `ReturnAnswer`, which calls it from outside this
    file, cannot be handed a view it has no milestone for.
  */
  const averages = isShareView(view)
    ? new Map(offsets.map((i) => [i, columnAverage(rows, i, view)]))
    : new Map<number, ColumnAverage>()
  const moneyAverages =
    view === 'money'
      ? new Map(offsets.map((i) => [i, columnMoneyAverage(rows, i)]))
      : new Map<number, MoneyColumnAverage>()
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
  const truncated = view === 'cumulative' && months !== null && span - 1 > months

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

  const panel = hot ? panelFor(hot, rows, averages, moneyAverages, view) : null

  return (
    <div className="space-y-3">
      <div className="relative overflow-x-auto" onMouseLeave={() => setHot(null)}>
        <table
          className="tabular"
          style={{
            /* The pinned columns keep the fixed widths `PINNED` declares —
               every sticky `left` is derived from them — and only the months
               flex. With five of them the block is 460px wide, so a 1280px
               screen with the rail OPEN is ~35px short of the twelve months'
               44px floor and the card scrolls sideways by that much; the
               pinned block is sticky, so every label stays on screen while it
               does. With the rail collapsed, or from ~1315px, it fits. */
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
            {view === 'money'
              ? 'Kogorta matritsasi: har bir qator — mijozlar birinchi marta xarid qilgan oy, har bir ustun — oʻsha oydan keyin oʻtgan oylar soni, katakdagi summa — oʻsha oyga kelib shu guruhning bitta mijozi olib kelgan jami tushum.'
              : view === 'monthly'
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
                {view === 'money'
                  ? 'Birinchi xariddan keyin oʻtgan oylar — shu oyga kelib 1 mijoz olib kelgan jami tushum'
                  : view === 'monthly'
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
                    left={LEFT.cohort}
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
                      row.revenueTotalExact
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
                        ? `1 mijozga hozirgacha ${
                            row.revenuePerCustomerExact
                          } — kogorta ${formatNumber(
                            row.ageMonths,
                          )} oylik, boshqa qatorlar bilan solishtirib boʻlmaydi`
                        : `1 mijozga hozirgacha ${
                            row.revenuePerCustomerExact
                          } — kogorta ${formatNumber(row.ageMonths)} oylik`
                    }
                  >
                    {row.revenuePerCustomer}
                  </PinnedCell>

                  {offsets.map((i) =>
                    view === 'money' ? (
                      <MoneyCell
                        key={i}
                        point={moneyPointsOf(row)[i] ?? null}
                        base={row.size}
                        cohort={row.cohort}
                        offset={i}
                        litRow={lit}
                        litCol={hot?.col === i}
                        onMouseEnter={enter(r, i)}
                      />
                    ) : (
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
                    ),
                  )}
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
                left={LEFT.cohort}
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
                ONE MONEY COLUMN TOTALS AND THE OTHER MAY NOT, so they are two
                different cells now rather than one blank repeated.

                «Kogorta tushumi» adds up, and what it adds up is THE COLUMN
                ABOVE IT — the rows this grid was handed, which is every row
                the caller sent. The figure is computed where the formatting
                already happens (`CohortPage`), because the grid is handed
                money as text and has no number to add.

                «1 mijozga» still prints «—», and that stays. Each of its
                figures covers a different span of months, so a mean of them is
                the cross-row comparison the whole column is built to
                discourage, printed as a fact. Each cohort's per-customer money
                is on its own row, where it is a measurement. The two cells
                read better side by side now than they did as one blank
                repeated: they cover the same rows, and one of them says why it
                cannot be folded.
              */}
              <PinnedCell
                left={LEFT.revenueTotal}
                lit={hot?.row === -1}
                align="right"
                summary
                onMouseEnter={enter(-1, -1)}
                label={totalRevenue ? totalRevenue.exact : MONEY_NOT_SUMMED}
                ariaLabel={
                  totalRevenue ? `Kogorta tushumi jami: ${totalRevenue.exact}` : undefined
                }
              >
                {totalRevenue ? totalRevenue.compact : NO_VALUE}
              </PinnedCell>

              <PinnedCell
                left={LEFT.revenuePerCustomer}
                lit={hot?.row === -1}
                align="right"
                summary
                edge
                onMouseEnter={enter(-1, -1)}
                label={MONEY_NOT_SUMMED}
                /* THE SAME SENTENCE, OUT LOUD. `label` is a `title` — hover
                   text, and hovering is the one thing a screen-reader user is
                   not doing. Without this the cell announced «—» and stopped,
                   which reads as a missing figure rather than as a refusal;
                   its neighbour «Kogorta tushumi» has said why since it
                   started summing. */
                ariaLabel={MONEY_NOT_SUMMED}
              >
                {NO_VALUE}
              </PinnedCell>

              {offsets.map((i) => {
                if (view === 'money') {
                  const avg = moneyAverages.get(i)
                  return (
                    <MoneyCell
                      key={i}
                      summary
                      point={
                        avg && avg.perCustomer !== null
                          ? { perCustomer: avg.perCustomer, multiple: avg.multiple }
                          : null
                      }
                      base={avg?.base ?? 0}
                      cohorts={avg?.cohorts ?? 0}
                      cohort={null}
                      offset={i}
                      litRow={hot?.row === -1}
                      litCol={hot?.col === i}
                      onMouseEnter={enter(-1, i)}
                    />
                  )
                }
                const avg = averages.get(i)
                return (
                  <HeatCell
                    key={i}
                    view={view}
                    summary
                    value={avg?.percent ?? null}
                    customers={avg?.returned ?? null}
                    size={avg?.base ?? 0}
                    cohorts={avg?.cohorts ?? 0}
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

/**
 * Why a summary money cell is blank. Said on hover, not in a figure.
 *
 * SINGULAR, AND IT HAS TO BE. It read «Pul ustunlari … jamlanmaydi» — money
 * columnS, plural — from the day both of them were blank. «Kogorta tushumi»
 * now visibly sums one cell to its left, so the plural would be a sentence
 * the screen itself contradicts. «1 mijozga» always carries this; «Kogorta
 * tushumi» carries it only when a caller sends no total, and on this product
 * the page always does.
 */
const MONEY_NOT_SUMMED =
  'Bu ustun qator boʻyicha oʻqiladi: har bir kogortaning bir mijozga toʻgʻri keladigan puli oʻz yoshiga bogʻliq, shuning uchun bu yerda jamlanmaydi.'

/**
 * The edge of the pinned block.
 *
 * Without it, a half-scrolled heat tile sits flush against «1 mijozga» and reads
 * as a clipped column of the table rather than as content passing underneath.
 * A hairline shadow rather than a border, so it costs no layout width and the
 * sticky offsets stay whole sums of the column widths.
 */
const PINNED_EDGE = '2px 0 4px -2px color-mix(in oklab, var(--ink-primary) 22%, transparent)'

/** A pinned heading in the header band — one per entry in `PINNED`. */
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
 * own label out of a column of identical ones, which is most of what makes a
 * wide matrix followable. The pinned cells carry an opaque background by necessity —
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
    /*
      AND A MARKER THAT IS NOT A COLOUR.

      Muted ink alone made this the one rule on this screen carried by colour
      and nothing else — every other distinction here has a second, non-colour
      carrier: the unmeasured month is HATCHED rather than pale, a thin summary
      cell comes off the ramp onto the flat `--surface-sunken`, the legend
      prints the bands as numbers. `data-young` and the cell's `aria-label`
      already cover the machine and the screen reader; this covers the reader
      who is looking at it, in forced-colours mode, on a projector, or with a
      colour vision deficiency that flattens muted grey against body ink.

      A dotted underline rather than a glyph: it marks the figure without
      joining it, so «26.2 ming†» cannot be misread as part of the money, and
      text decoration survives `forced-colors` where a tint does not.
    */
    textDecoration: young ? 'underline dotted' : undefined,
    textUnderlineOffset: young ? '3px' : undefined,
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
  cohorts = 0,
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
  /**
   * How many cohorts were averaged into this cell — summary cells only.
   *
   * A body cell is one cohort by definition and is never taken off the ramp
   * for it, so the prop is only read under `summary`.
   */
  readonly cohorts?: number
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
  /*
    AND THE SAME CELL COMES OFF THE RAMP WHEN THE SAMPLE IS ONE MONTH WIDE.

    Headcount was the only floor here until 2026-09-15, and «Oddiy» beside it
    had the other one: a column averaged over a single 400-person cohort
    cleared thirty customers, so the grid painted it, while the milestone at
    that offset printed «yetarli maʼlumot yoʻq» from
    `MIN_COHORTS_FOR_AVERAGE`. One number, two modes, opposite claims, one
    press of the toggle apart. Both floors are read here now and both are read
    by the milestone, so whatever one mode refuses the other refuses too.
  */
  const thin = summary && (size < SUMMARY_MIN_BASE || cohorts < MIN_COHORTS_FOR_AVERAGE)

  const base = (view === 'monthly' && offset === 0) || thin

  const band = bandsFor(view)[bandOf(view, value)] ?? bandsFor(view)[0]
  const shown = sharePercentText(value)

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
        THE UNIT IS SAID ONCE, IN THE HEADER OVER THE COLUMNS — BUT THE
        DENOMINATOR IS NOT, SO THE COUNT IS PRINTED HERE.

        A «%» in every cell is 250 glyphs repeating what the column group
        already states — «…qayta xarid qilganlar ulushi, %» — and they were set
        at 8.5px and 62% opacity precisely because they were in the way. That
        stays true of the unit and was never true of the HEADCOUNT: «12» and
        «12 · 47» are not the same claim, and the second is the one every other
        rate on this dashboard makes. A 3% cell on a 45-person cohort is one
        customer, and a reader who cannot see that is being invited to read a
        trend into a single person changing their mind.

        TWO SIZES, NOT TWO CELLS. The share keeps 11px and the weight; the
        count is 9px at 72% opacity, which is enough to read and not enough to
        compete. Baseline-aligned, so the digits sit on one line rather than
        the small text floating in the middle of the tile.

        The opacity is applied to the span and not baked into a colour because
        the ink underneath it flips — white on the darkest two bands, ink
        elsewhere — and a second hard-coded colour would fail at one end of the
        ramp exactly as a fixed ink colour does.
      */}
      <div
        data-heat=""
        className="flex h-full min-h-6 items-baseline justify-center gap-[3px] text-[11px] font-medium leading-6"
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
        {/*
          `data-share` AND `data-count` ARE ADDRESSES, NOT DECORATION.

          A tile used to hold one string, so «the grid's figure» was
          `[data-heat]`'s whole `textContent` — which is what
          `cohortAgreement.test.tsx` compares against «Oddiy»'s milestone to
          pin the invariant this screen is built on: two modes, one number,
          spelled the same. With two figures in the tile that comparison reads
          «28· 90» against «28%» and fails for a reason that has nothing to do
          with the invariant. The share is marked so the pin keeps pointing at
          the figure it is about, and the count is marked beside it so a test
          can assert the denominator is PRESENT rather than infer it from a
          concatenation.
        */}
        <span data-share="">{shown}</span>
        {customers === null ? null : (
          <span data-count="" className="text-[9px] font-normal" style={{ opacity: 0.72 }}>
            {'· '}
            {formatNumber(customers)}
          </span>
        )}
      </div>
    </td>
  )
}

/**
 * One cell of the money reading.
 *
 * ITS OWN COMPONENT RATHER THAN A BRANCH INSIDE `HeatCell`, because almost
 * nothing is shared: a different value, a different ramp, a different pair of
 * printed figures and a different sentence. What IS shared — the hatched
 * unmeasured month, the crosshair, the summary rule and the two floors — is
 * shared by calling the same helpers, not by threading a third mode through a
 * component whose every comment is about the two.
 *
 * THE COLUMN COMPARES DOWN, AND THAT IS THE WHOLE POINT OF THIS VIEW.
 *
 * The pinned «1 mijozga» column does NOT compare down — `MONEY_YOUNG_MONTHS`
 * exists because a thirteen-month-old cohort has had thirteen months to spend
 * and a one-month-old has had one, so ranking that column ranks the rows by
 * age. A MATRIX column has no such defect: every cell in «+6» is a cohort at
 * exactly six months old. The comparison the pinned column spends three
 * defences discouraging is the one this grid is built to allow, which is why
 * the young-cohort greying is deliberately NOT applied here.
 */
function MoneyCell({
  point,
  cohorts = 0,
  cohort,
  offset,
  base: cohortSize,
  summary = false,
  litRow = false,
  litCol = false,
  onMouseEnter,
}: {
  readonly point: MoneyPoint | null
  /** Summary cells only — see `HeatCell`'s prop of the same name. */
  readonly cohorts?: number
  readonly cohort: string | null
  readonly offset: number
  /** The cohort behind the figure, or the summed cohorts on the summary row. */
  readonly base: number
  readonly summary?: boolean
  readonly litRow?: boolean
  readonly litCol?: boolean
  readonly onMouseEnter: (event: MouseEvent<HTMLElement>) => void
}) {
  if (point === null) {
    return (
      <td
        className="h-6 p-0"
        style={{ borderTop: summary ? '1px solid var(--border-strong)' : undefined }}
        onMouseEnter={onMouseEnter}
        aria-label="hali oʻtmagan oy — oʻlchanmagan"
      >
        <div
          className="h-full min-h-6"
          style={{ background: UNMEASURED, boxShadow: crosshair(litRow, litCol) }}
        />
      </td>
    )
  }

  /*
    OFFSET 0 IS THE ANCHOR HERE TOO, AND FOR A STRICTER REASON.

    Every other reading's «0» column is 100% by construction; this one is ×1,00
    by DEFINITION — it is the denominator every other cell in the row divides
    by. Painted at the bottom of the ramp it would read as fifteen cohorts that
    never came back. It keeps its money, which is the first purchase's value
    per customer and the one figure a reader needs to make sense of the row,
    and comes off the ramp.
  */
  const thin = summary && (cohortSize < SUMMARY_MIN_BASE || cohorts < MIN_COHORTS_FOR_AVERAGE)
  const flat = offset === 0 || point.multiple === null || thin

  const band = MONEY_BANDS[bandOfMultiple(point.multiple ?? 1)] ?? MONEY_BANDS[0]

  return (
    <td
      className="h-6 p-0"
      style={{ borderTop: summary ? '1px solid var(--border-strong)' : undefined }}
      onMouseEnter={onMouseEnter}
      aria-label={moneyCellSentence({ cohort, offset, point, summary })}
    >
      <div
        data-heat=""
        className="flex h-full min-h-6 items-baseline justify-center gap-[3px] text-[11px] font-medium leading-6"
        style={{
          background: flat ? 'var(--surface-sunken)' : band?.background,
          color: flat
            ? 'var(--ink-secondary)'
            : band?.dark
              ? 'var(--surface)'
              : 'var(--ink-primary)',
          boxShadow: crosshair(litRow, litCol),
        }}
      >
        {/* `data-money` and `data-multiple` are addresses, exactly as
            `data-share` and `data-count` are on the share cell. */}
        <span data-money="">{formatCompactUzs(point.perCustomer)}</span>
        {/* ×1,00 IS NOT A MEASUREMENT AT OFFSET 0. It is the definition of the
            denominator, true of every row there has ever been, and printed it
            would be a column of identical figures competing with the money
            beside them for a 78px cell. The anchor keeps its soʼm alone. */}
        {point.multiple === null || offset === 0 ? null : (
          <span data-multiple="" className="text-[9px] font-normal" style={{ opacity: 0.72 }}>
            {'· '}
            {multipleText(point.multiple)}
          </span>
        )}
      </div>
    </td>
  )
}

/** The whole claim of a money cell, for a reader who cannot hover. */
function moneyCellSentence({
  cohort,
  offset,
  point,
  summary,
}: {
  readonly cohort: string | null
  readonly offset: number
  readonly point: MoneyPoint
  readonly summary: boolean
}): string {
  const who = summary ? 'Oʻrtacha' : cohort ? `${formatMonth(cohort)} kogortasi` : ''
  const when = offset === 0 ? 'xarid oyi' : `+${offset} oy`
  const grown =
    point.multiple === null || offset === 0
      ? ''
      : ` — birinchi oyga nisbatan ${multipleText(point.multiple)}`
  return `${who}, ${when}: 1 mijozga ${formatUzs(point.perCustomer)}${grown}`
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
        {/* THE RAMP NAMES WHAT IT ENCODES, and in the money reading that is
            NOT the figure the cell prints first. The tile leads with soʼm and
            is coloured by the multiple, so a legend reading «Qaytish ulushi»
            over ×-labelled swatches would be two mislabels in one line. */}
        <span className="font-medium">
          {view === 'money' ? 'Birinchi oyga nisbatan:' : 'Qaytish ulushi:'}
        </span>
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
        {view === 'money' ? (
          <>
            Har bir katak = kogortaning birinchi xariddan shu oygacha boʻlgan jami
            tushumi ÷ kogortadagi mijozlar soni. «0» ustuni — birinchi xarid oyi,
            qatordagi qolgan kataklar shunga nisbatan oʻlchanadi.{' '}
            {/*
              THE ONE COMPARISON THIS SCREEN OTHERWISE FORBIDS, PERMITTED HERE
              — and said out loud, because the pinned column two inches to the
              left forbids it. «1 mijozga hozirgacha» cannot be read down its
              column (`MONEY_YOUNG_MONTHS`); a matrix column can, because every
              cell in it is a cohort at the same age. A reader who has taken
              the first rule to heart will not assume the exception.
            */}
            Bu ustunlarni solishtirsa boʻladi: bitta ustundagi barcha kogortalar
            bir xil yoshda.{' '}
            <strong>Har katakda: summa</strong> ·{' '}
            <strong>birinchi oyga nisbatan necha barobar</strong>. Katak ustiga
            sichqonchani olib borsangiz, aniq hisob-kitob chiqadi.
          </>
        ) : (
          <>
            {view === 'monthly'
              ? 'Har bir katak = oʻsha oyda qayta xarid qilgan mijozlar ÷ kogortadagi jami mijozlar. «0» ustuni — kogortaning oʻz oyi, u har doim 100%.'
              : truncated
                ? 'Har bir katak = shu oyga kelib kamida bir marta qaytgan mijozlar ÷ kogortadagi jami mijozlar. «Qaytgan» ustuni butun tarixni hisoblaydi, shuning uchun u koʻrsatilgan oynadan kattaroq boʻlishi mumkin.'
                : 'Har bir katak = shu oyga kelib kamida bir marta qaytgan mijozlar ÷ kogortadagi jami mijozlar. Qator oxiridagi katak «Qaytgan» ustuni bilan bir xil boʻladi.'}{' '}
            {/*
              WHAT THE SECOND NUMBER IN A CELL IS, SAID ONCE.

              «12 · 47» is two figures in one tile and the column heading names
              only the first. Without this line the small one reads as a
              decimal, a rank, or the month's order count — every one of which
              is a number this screen also has somewhere.
            */}
            <strong>Har katakda: ulush, %</strong> · <strong>mijoz soni</strong>.
            Katak ustiga sichqonchani olib borsangiz, aniq hisob-kitob chiqadi.
          </>
        )}
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
 *
 * Exported so a caller outside this grid (`ReturnAnswer`) can read the same
 * average rather than writing a second one — see that file's header comment
 * for why a hand-written mean is the one thing this design forbids. The
 * parameter is narrowed to `AveragableCohortRow` rather than the full
 * `CohortMatrixRow` so such a caller does not have to construct a grid row
 * just to hand this function the five fields it actually reads.
 */
function columnAverage(
  rows: readonly AveragableCohortRow[],
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

/** One column of the money reading's «Jami · oʻrtachaʻ row. */
interface MoneyColumnAverage {
  /** Every reaching cohort's money through this offset ÷ all their customers. */
  readonly perCustomer: number | null
  /** The same two sums at offset 0, divided into it. */
  readonly multiple: number | null
  /** The denominator — those cohorts' sizes. Read by the thin-cell floor. */
  readonly base: number
  /** How many cohorts that is. The claim is only as wide as this number. */
  readonly cohorts: number
}

/**
 * The money column's average, weighted the same way the share column's is.
 *
 * TWO SUMS DIVIDED, NEVER A MEAN OF THE ROWS' OWN FIGURES. Averaging
 * per-customer money across cohorts would weight a 40-person month the same
 * as a 400-person one; the multiple is likewise the ratio of two company-wide
 * sums, not the mean of fifteen ratios. Same argument as `columnAverage`,
 * which is directly above this, and the same floors apply to the cell.
 *
 * It walks `moneyPointsOf` again per row rather than taking a prepared array,
 * because there are tens of rows and one definition of the curve is worth more
 * than the walk it saves.
 */
function columnMoneyAverage(
  rows: readonly CohortMatrixRow[],
  offset: number,
): MoneyColumnAverage {
  let money = 0
  let firstMoney = 0
  let base = 0
  let cohorts = 0

  for (const row of rows) {
    const points = moneyPointsOf(row)
    const point = points[offset]
    const anchor = points[0]
    if (!point || !anchor) continue
    money += point.perCustomer * row.size
    firstMoney += anchor.perCustomer * row.size
    base += row.size
    cohorts += 1
  }

  return {
    perCustomer: base > 0 ? money / base : null,
    multiple: firstMoney > 0 ? money / firstMoney : null,
    base,
    cohorts,
  }
}

/**
 * How a MULTIPLE is printed — one function, the cell and the legend both.
 *
 * Two decimals below ×1,1 and one above it. The band edges down there are
 * ×1,02 and ×1,1, so a single decimal would print ×1,0 on either side of the
 * first cut and the ramp would appear to disagree with the figure it is
 * encoding; past ×1,1 the second decimal is precision nobody scans in a 78px
 * cell. The comma is the decimal mark this application prints everywhere.
 */
function multipleText(multiple: number): string {
  return `×${multiple.toFixed(multiple < 1.1 ? 2 : 1).replace('.', ',')}`
}

/**
 * How a share is PRINTED on this screen — one function, both modes.
 *
 * `columnAverage` already guarantees the two readings compute the same
 * number; this guarantees they SPELL it the same. They did not: the grid
 * printed «28» and «Oddiy»'s milestone printed «28,1%» from `formatPercent`,
 * one press of the toggle apart, on a screen whose whole premise is that the
 * two modes cannot disagree. A reader has no way to know that two texts are
 * one number.
 *
 * WHOLE PERCENT IS THE ONE THEY CAN BOTH KEEP. The grid's cells are 44px
 * wide and there are 250 of them — a decimal there is a precision nobody
 * scans and a column that no longer fits — so the sentence rounds to the
 * grid rather than the grid stretching to the sentence. The decimal is not
 * lost: the cell's own accessible name and the hover panel still spell the
 * whole fraction out through `formatPercent`, which is where a figure gets
 * reconciled rather than scanned.
 *
 * `<1` rather than `0` under one percent, because «nobody came back» and
 * «almost nobody came back» are different findings and rounding merges them.
 * The unit is said once in the column header, so this returns the digits
 * alone and a caller outside the grid appends its own «%».
 */
function sharePercentText(value: number): string {
  return value === 0 ? '0' : value < 1 ? '<1' : String(Math.round(value))
}

function panelFor(
  hot: Hot,
  rows: readonly CohortMatrixRow[],
  averages: ReadonlyMap<number, ColumnAverage>,
  moneyAverages: ReadonlyMap<number, MoneyColumnAverage>,
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
      /*
        IT NAMES THE RULE, NOT THE COUNT.

        This read «Chapdagi ikki ustun — jami» and was written when the pinned
        block was cohort / size / returned. There are four figure columns
        there now and «Kogorta tushumi» visibly adds up, so the sentence was
        counting to two over a block of four. A sentence that has to be
        re-counted every time a column is added will eventually be left
        behind by one — as this one was — so it states what the left columns
        DO and what the exception looks like on screen, which stays true
        whatever the next column is.
      */
      footer:
        'Chapdagi ustunlar — shu kogortalar boʻyicha jami; jamlab boʻlmaydigan ustun «—» koʻrsatadi. Oylar boʻyicha qator — mijozlar soniga tortilgan oʻrtacha ulush.',
    }
  }

  // One column of the summary row, money reading.
  if (hot.row === -1 && view === 'money') {
    const avg = moneyAverages.get(hot.col)
    if (!avg || avg.perCustomer === null) return null

    return {
      header: hot.col === 0 ? 'Oʻrtacha — xarid oyi' : `Oʻrtacha — +${hot.col} oy`,
      rows: [
        { label: '1 mijozga jami', value: formatUzs(avg.perCustomer) },
        {
          label: 'Birinchi oyga nisbatan',
          value: avg.multiple === null ? NO_VALUE : multipleText(avg.multiple),
        },
        { label: 'Nechta mijozdan', value: `${formatNumber(avg.base)} mijoz` },
        { label: 'Nechta kogortadan', value: `${formatNumber(avg.cohorts)} ta` },
      ],
      footer:
        avg.base < SUMMARY_MIN_BASE
          ? `Namuna kichik — bu ustunga atigi ${formatNumber(avg.base)} ta mijoz yetib kelgan, shuning uchun katak rangsiz. Undan tendensiya oʻqimang.`
          : avg.cohorts < MIN_COHORTS_FOR_AVERAGE
            ? `Namuna tor — bu ustunga atigi ${formatNumber(avg.cohorts)} ta kogorta yetib kelgan, shuning uchun katak rangsiz. Undan tendensiya oʻqimang.`
            : 'Faqat shu oyga yetib ulgurgan kogortalar hisobga olingan; summalar mijozlar soniga tortilgan.',
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
         HeatCell for the production row that made this necessary. Two floors,
         and the panel names the one that bit: «thirty people» and «three
         cohorts» are different complaints about a cell, and a reader told the
         wrong one goes looking for the wrong fix. */
      footer:
        avg.base < SUMMARY_MIN_BASE
          ? `Namuna kichik — bu ustunga atigi ${formatNumber(avg.base)} ta mijoz yetib kelgan, shuning uchun katak rangsiz. Undan tendensiya oʻqimang.`
          : avg.cohorts < MIN_COHORTS_FOR_AVERAGE
            ? `Namuna tor — bu ustunga atigi ${formatNumber(avg.cohorts)} ta kogorta yetib kelgan, shuning uchun katak rangsiz. Undan tendensiya oʻqimang.`
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
        /* The panel is where the compact column's precision comes back. */
        { label: 'Kogorta tushumi', value: row.revenueTotalExact },
        { label: '1 mijozga', value: row.revenuePerCustomerExact },
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
    /*
      ONE BASE FOR THE TOTAL AND FOR THE SHARE OF IT.

      «Jami tushum» prints the server's own sum and «Shundan takroriy» is a
      percentage OF that sum, so the two may not come from different
      arithmetic. They did: the total was re-folded here over the offsets whose
      `retention` is non-null, a narrower set than the server adds up, so the
      percentage could be computed against a base the line above it did not
      state. The numerator is still folded — repeat money is «everything after
      the cohort's own month», which the payload carries nowhere else — but it
      is divided by `revenueTotalAmount`, the number behind the printed figure.
    */
    const total = row.revenueTotalAmount
    const repeat = row.revenue.reduce((sum, m, i) => (i === 0 ? sum : sum + m.amount), 0)

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
        /* The «Kogorta tushumi» column's own figure, to the last soʻm, not a
           second fold of `revenue` — two places computing one number is two
           numbers. The row under it divides by exactly this. */
        { label: 'Jami tushum', value: row.revenueTotalExact },
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
    THE MONEY CELL SAYS THE RUNNING TOTAL AND THE MONTH THAT MOVED IT.

    The tile prints a cumulative figure, so the reader's next question is the
    same one the cumulative share view gets: did anything happen THIS month.
    The increment is `revenue[hot.col]`, which the panel already had in hand.
  */
  if (view === 'money') {
    const point = moneyPointsOf(row)[hot.col]
    if (!point) return null

    return {
      header: `${formatMonth(row.cohort)} kogortasi · ${
        hot.col === 0 ? 'xarid oyi' : `+${hot.col} oy (${formatMonthOffset(row.cohort, hot.col)})`
      }`,
      rows: [
        { label: '1 mijozga shu oyga kelib', value: formatUzs(point.perCustomer) },
        {
          label: 'Birinchi oyga nisbatan',
          value: point.multiple === null || hot.col === 0 ? NO_VALUE : multipleText(point.multiple),
        },
        { label: 'Shu oydagi tushum', value: formatUzs(amount) },
        { label: 'Shu oydagi buyurtmalar', value: `${formatNumber(row.orders[hot.col] ?? 0)} ta` },
        { label: 'Kogorta', value: `${formatNumber(row.size)} mijoz` },
      ],
      footer:
        hot.col === 0
          ? 'Kogortaning oʻz oyi — qatordagi boshqa kataklar shu summaga nisbatan oʻlchanadi.'
          : 'Jamlangan summa: birinchi xariddan shu oygacha boʻlgan barcha xaridlar, kogortadagi mijozlar soniga boʻlingan.',
    }
  }

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
        /*
          «SHU OYDAGI», because this is the only per-offset number in a
          cumulative panel. `orders` has no cumulative counterpart, so beside
          «3 / 24 mijoz» — a running total — an unqualified «Buyurtmalar» is
          the same people-versus-orders blur one row over: at +2 the panel
          would read five customers and three orders.
        */
        { label: 'Shu oydagi buyurtmalar', value: `${formatNumber(row.orders[hot.col] ?? 0)} ta` },
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
