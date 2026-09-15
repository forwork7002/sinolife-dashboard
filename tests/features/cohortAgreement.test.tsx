// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CohortHeatmap, columnAverage, type CohortMatrixRow } from '@/components/charts/Heatmap'
import { ReturnAnswer } from '@/features/cohort/ReturnAnswer'

/**
 * ONE PAYLOAD, TWO RENDERINGS, AND THEY MAY NOT DISAGREE.
 *
 * This is the property the whole «Oddiy» / «Batafsil» design rests on: both
 * modes read ONE `/insights/cohorts` response, mapped once in `CohortPage`, so
 * a manager and an analyst looking at the same screen cannot come away with
 * different numbers. `cohortReturnAnswer.test.tsx` already pins what the
 * manager's block prints; what is left unguarded is the AGREEMENT — that the
 * figure over «+1 oy» is the same figure the grid's «Jami · oʻrtacha» row
 * draws under its own «+1» column, character for character.
 *
 * Two cases, and they guard the property from opposite sides. The first
 * compares the two RENDERINGS, which is the failure a reader would see. The
 * second reads the SOURCE, because the first cannot fail while both figures
 * come from one function — a second implementation would agree on the day it
 * was written and drift on the first change to either, and by then the test
 * that was supposed to catch it is passing.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/features/cohort/ReturnAnswer.tsx'),
  'utf8',
)

/**
 * Deliberately uneven sizes, and three of them.
 *
 * Uneven, because a weighted and an unweighted mean coincide on equal cohorts:
 * the wrong implementation has to print a WRONG FIGURE here, not a tie.
 * Weighted over +1 this is (60 + 21 + 9) / (240 + 70 + 10) = 28.125%, which
 * the grid prints as 28.1; unweighted it is (25 + 30 + 90) / 3 = 48.3%.
 * Three cohorts, because
 * `MIN_COHORTS_FOR_AVERAGE` is 3 and a milestone standing on fewer prints a
 * refusal instead of a number — the assertion could never run.
 */
const money = {
  revenue: [],
  orders: [],
  revenueTotal: '6.3 mln',
  revenueTotalExact: '6 300 000',
  revenueTotalAmount: 6_300_000,
  revenuePerCustomer: '26.2 ming',
  revenuePerCustomerExact: '26 250',
  ageMonths: 12,
} as const

const rows: readonly CohortMatrixRow[] = [
  {
    cohort: '2025-08-01',
    size: 240,
    returned: 91,
    cumulative: [0, 25, 29, 38],
    cumulativeCustomers: [0, 60, 70, 91],
    retention: [100, 25, 29, 38],
    customers: [240, 60, 70, 91],
    ...money,
  },
  {
    cohort: '2025-11-01',
    size: 70,
    returned: 27,
    cumulative: [0, 30, 34, 39],
    cumulativeCustomers: [0, 21, 24, 27],
    retention: [100, 30, 34, 39],
    customers: [70, 21, 24, 27],
    ...money,
  },
  {
    cohort: '2026-06-01',
    size: 10,
    returned: 9,
    cumulative: [0, 90, null, null],
    cumulativeCustomers: [0, 9, null, null],
    retention: [100, 90, null, null],
    customers: [10, 9, null, null],
    ...money,
  },
]

describe('the two readings of one payload', () => {
  it('prints the same +1 figure in the manager’s milestone and the grid’s summary row', () => {
    const weighted = columnAverage(rows, 1, 'cumulative').percent!
    /* 28.1%, not 48.3% — see the fixture comment. */
    expect(weighted).toBeCloseTo(28.125, 3)

    const manager = render(
      <ReturnAnswer data={{ repeatCustomers: 127, totalCustomers: 320, rows }} />,
    )
    const milestone = manager.container.querySelector('[aria-label*="+1 oy"]')!.textContent!
    expect(milestone).toMatch(/28[.,]1/)

    /*
      THE SAME NUMBER OUT OF THE OTHER MODE. The grid states its summary in the
      cell's accessible name — «Oʻrtacha, +1 oy: 28,1% — …» — which is the one
      place the whole fraction is spelled out; the tile itself prints a rounded
      «28» because the column is scanned, not reconciled. Reading the label is
      therefore reading what the grid CLAIMS, at the precision the milestone
      claims it.
    */
    const analyst = render(<CohortHeatmap rows={rows} view="cumulative" />)
    const summaryCell = within(analyst.container).getByLabelText(/^Oʻrtacha, \+1 oy:/)
    expect(summaryCell.getAttribute('aria-label')).toMatch(/28[,.]1/)
  })

  it('computes no average of its own', () => {
    /*
      The regression this guards is a future edit folding a quick mean inline
      rather than importing the grid's. Two functions would agree on the day
      they were written and drift on the first change to either — and the case
      above would keep passing throughout, because it compares two renderings
      and not two implementations.
    */
    expect(SOURCE).toContain('columnAverage')
    /* A mean of the ROWS — the shape a hand-written column average takes. The
       block's own reduce over `data.rows.map(r => r.cumulative.length)` is a
       Math.max, not a division, so it is not what this matches. */
    expect(SOURCE).not.toMatch(/reduce\([^)]*\/\s*(rows|arr|list|data\.rows)\.length/)
    expect(SOURCE).not.toMatch(/\/\s*(rows|data\.rows)\.length/)
  })
})
