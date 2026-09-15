'use client'

import { Sparkline } from '@/components/charts/Sparkline'
import {
  columnAverage,
  MIN_COHORTS_FOR_AVERAGE,
  sharePercentText,
  type AveragableCohortRow,
} from '@/components/charts/Heatmap'
import { InfoTip } from '@/components/ui/Tooltip'

/**
 * «Ular qaytadimi?» — the second of the manager's three questions.
 *
 * ONE AVERAGING IMPLEMENTATION, AND IT IS THE GRID'S. `columnAverage` draws
 * the matrix's own summary row; this block calls it rather than computing a
 * mean of its own, because two renderings of one payload that average
 * separately are two renderings free to disagree. The existing average is
 * weighted by cohort size, and a hand-written one almost certainly would not
 * be — a 40-person month would outvote a 400-person one.
 *
 * `AveragableCohortRow` (in `Heatmap.tsx`) is the five fields `columnAverage`
 * actually reads — this block never needs the money columns, `ageMonths`,
 * `orders`, or any of the grid's other fields beyond these five, so it does
 * not carry them.
 */
const MILESTONES = [1, 3, 6, 12] as const

/*
  THE FLOOR IS THE GRID'S, LIKE THE AVERAGE ABOVE IT.

  `MIN_COHORTS_FOR_AVERAGE` lived here — «below this many cohorts a milestone
  prints no figure», because the +12 column once had exactly one qualifying
  cohort and printed that cohort's number as the company average. The rule was
  right and its ADDRESS was wrong: the grid's summary row draws the same
  averages from the same rows and had only its headcount floor, so one cohort
  of 400 customers was refused here and painted there, one press of the toggle
  apart. It now sits beside `SUMMARY_MIN_BASE` in `Heatmap.tsx` and both modes
  read it — one constant, because two copies of a floor are two floors.
*/

export function ReturnAnswer({
  data,
}: {
  readonly data: {
    readonly repeatCustomers: number
    readonly totalCustomers: number
    readonly rows: readonly AveragableCohortRow[]
  }
}) {
  /*
    THE HEADLINE DENOMINATOR IS WHOLE-HISTORY. `repeatCustomers` /
    `totalCustomers` come from the statement's totals arm, which counts every
    cohort there has ever been. Folding this figure from `data.rows` — the
    windowed rows the curve below reads — would silently drop the oldest
    loyal customers whenever the reporting window is narrower than the whole
    history, which is exactly the repeat business this sentence exists to
    measure. It did, once.
  */
  /* Rounded ONCE, here, at the point of display — not again where it is
     printed. CLAUDE.md already records this exact class of bug: rounding
     twice moved one region across the 85% tone threshold elsewhere on this
     dashboard. */
  const share =
    data.totalCustomers === 0
      ? null
      : Math.round((data.repeatCustomers / data.totalCustomers) * 100)

  /* The curve's full width, for the sparkline. The milestones below read the
     same function at four offsets, so the shape and the figures cannot drift. */
  const width = Math.max(0, ...data.rows.map((r) => r.cumulative.length))
  const curve = Array.from({ length: width }, (_, offset) =>
    columnAverage(data.rows, offset, 'cumulative'),
  )

  /*
    THE CURVE STOPS WHERE THE EVIDENCE DOES, ON THE SAME FLOOR THE MILESTONES
    USE.

    Drawing every offset up to the payload's full width would put a point
    built from a single cohort right beside a milestone that refuses to print
    that very cohort's number, because a sample of one is not an average — the
    line and the refusal would be making opposite claims about the same
    figure. So the sparkline is truncated at the last offset whose own
    `columnAverage(...).cohorts` still clears `MIN_COHORTS_FOR_AVERAGE`, and
    never padded with zeros or interpolated past it — a shorter line is the
    honest one. This is the second time a thin tail has had to be kept off a
    picture on this screen; see `SUMMARY_MIN_BASE` in `Heatmap.tsx` for the
    first, and the production row it was found on.
  */
  /*
    AND A NULL AVERAGE ENDS THE LINE; IT IS NEVER PLOTTED AS A ZERO.

    `columnAverage(...).percent` is null when NO customer reached the offset
    at all — the same distinction the matrix draws between a hatched cell and
    a «0», and the one this block is otherwise strict about. A `?? 0` here
    drew that absence as a collapse to the floor of the chart: the one shape
    a reader is guaranteed to react to, standing on nothing. Unreachable on
    today's payload, which is the only kind of null/zero blur that survives a
    review.

    The points are collected rather than sliced so the values are numbers by
    construction and no default has anywhere to hide. `pending` carries the
    offsets that are inside the line but thin on their own — they are drawn
    only once a later offset qualifies, which is what keeps the line
    contiguous without extending it past its evidence.
  */
  const sparklineValues: number[] = []
  let pending: number[] = []
  for (const point of curve) {
    if (point.percent === null) break
    pending.push(point.percent)
    if (point.cohorts >= MIN_COHORTS_FOR_AVERAGE) {
      sparklineValues.push(...pending)
      pending = []
    }
  }

  return (
    <section>
      <h3
        className="flex items-center gap-1 text-[13px] font-medium"
        style={{ color: 'var(--ink-secondary)' }}
      >
        Ular qaytadimi?{' '}
        <InfoTip
          label="Izoh: qaytish"
          content="Birinchi marta xarid qilgan mijozlarning qanchasi keyin yana xarid qilgan. Yetkazilgan sana boʻyicha, butun tarix."
        />
      </h3>

      {share !== null && (
        <p
          className="mt-2 text-sm leading-snug"
          style={{ color: 'var(--ink-primary)' }}
          role="status"
        >
          Har 100 ta yangi mijozdan <strong>{share}</strong> tasi keyin
          yana xarid qiladi.
        </p>
      )}

      {/* Below two surviving points there is no shape left to draw — see the
          comment on `sparklineValues` above. `Sparkline` itself already
          refuses fewer than two, this just keeps a one-point call from
          reaching it. */}
      {sparklineValues.length >= 2 && (
        <div className="mt-2">
          <Sparkline values={sparklineValues} />
        </div>
      )}

      <dl className="mt-3 grid grid-cols-4 gap-2">
        {MILESTONES.map((offset) => {
          const at = curve[offset]
          const cohorts = at?.cohorts ?? 0
          const enough = cohorts >= MIN_COHORTS_FOR_AVERAGE
          return (
            <div
              key={offset}
              aria-label={`+${offset} oy — ${cohorts} ta kogorta boʻyicha`}
            >
              <dt className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                +{offset} oy
              </dt>
              <dd className="mt-0.5">
                {/* The refusal is a SENTENCE, not a figure, so it does not
                    wear the figure's size — at 15px «yetarli maʼlumot yoʻq»
                    wraps to three lines in a quarter-width column and reads
                    as the answer rather than as its absence. */}
                <span
                  className={
                    enough ? 'figure block text-[15px] font-semibold' : 'block text-[11px]'
                  }
                  style={{ color: enough ? 'var(--ink-primary)' : 'var(--ink-muted)' }}
                >
                  {/*
                    THE GRID'S OWN SPELLING, NOT `formatPercent`. This printed
                    «28,1%» where the summary cell one toggle-press away
                    printed «28» — the same number in two texts, on the one
                    screen built to prove the two modes agree. `sharePercentText`
                    is the cell's own formatter; the exact fraction is still in
                    the grid's hover panel, where a figure is reconciled.
                  */}
                  {enough && at !== undefined && at.percent !== null
                    ? `${sharePercentText(at.percent)}%`
                    : 'yetarli maʼlumot yoʻq'}
                </span>
                {/*
                  VISIBLE, not just in the `aria-label` above. A sighted
                  manager reading «+12 oy · 85%» needs to see how many
                  cohorts stand behind it without a screen reader — an ARIA
                  name on a role-less element is not reliably exposed, and
                  the requirement is that the SCREEN says the width, not
                  just the test.
                */}
                <span className="block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {cohorts} ta kogorta
                </span>
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
