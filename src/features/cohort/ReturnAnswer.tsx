'use client'

import { Sparkline } from '@/components/charts/Sparkline'
import { columnAverage, type AveragableCohortRow } from '@/components/charts/Heatmap'
import { InfoTip } from '@/components/ui/Tooltip'
import { formatPercent } from '@/lib/format'

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
 * actually reads, not the grid's full fourteen-field row — this block never
 * needs the money columns, `ageMonths` or `orders`, so it does not carry them.
 */
const MILESTONES = [1, 3, 6, 12] as const

/**
 * Below this many cohorts a milestone prints no figure.
 *
 * The +12 column once had exactly one qualifying cohort and printed that
 * cohort's number as the company average. A sample of one is not an average,
 * and the manager is the reader least equipped to notice.
 */
const MIN_COHORTS_FOR_AVERAGE = 3

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
  const share =
    data.totalCustomers === 0
      ? null
      : Math.round((data.repeatCustomers / data.totalCustomers) * 1000) / 10

  /* The curve's full width, for the sparkline. The milestones below read the
     same function at four offsets, so the shape and the figures cannot drift. */
  const width = Math.max(0, ...data.rows.map((r) => r.cumulative.length))
  const curve = Array.from({ length: width }, (_, offset) =>
    columnAverage(data.rows, offset, 'cumulative'),
  )

  return (
    <section>
      <h3>
        Ular qaytadimi?{' '}
        <InfoTip
          label="Izoh: qaytish"
          content="Birinchi marta xarid qilgan mijozlarning qanchasi keyin yana xarid qilgan. Yetkazilgan sana boʻyicha, butun tarix."
        />
      </h3>

      {share !== null && (
        <p role="status">
          Har 100 ta yangi mijozdan <strong>{Math.round(share)}</strong> tasi keyin
          yana xarid qiladi.
        </p>
      )}

      <Sparkline values={curve.map((c) => c.percent ?? 0)} />

      <dl>
        {MILESTONES.map((offset) => {
          const at = curve[offset]
          const enough = (at?.cohorts ?? 0) >= MIN_COHORTS_FOR_AVERAGE
          return (
            <div
              key={offset}
              aria-label={`+${offset} oy — ${at?.cohorts ?? 0} ta kogorta boʻyicha`}
            >
              <dt>+{offset} oy</dt>
              <dd>
                {enough && at?.percent !== null && at !== undefined
                  ? formatPercent(Math.round(at.percent * 10) / 10)
                  : 'yetarli maʼlumot yoʻq'}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
