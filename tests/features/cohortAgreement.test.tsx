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
    const milestone = manager.container
      .querySelector('[aria-label*="+1 oy"]')!
      .querySelector('.figure')!.textContent!

    /*
      THE SAME NUMBER OUT OF THE OTHER MODE, AND NOW THE SAME TEXT.

      The grid states its summary twice: the tile prints the figure a reader
      SCANS, and the cell's accessible name spells the whole fraction out —
      «Oʻrtacha, +1 oy: 28,1% — …» — which is where a figure is reconciled.
      Both are asserted, and the first is asserted as an equality against the
      milestone rather than as two regexes that happen to agree: this printed
      «28,1%» beside the grid's «28» until 2026-09-15, which no regex pair
      could have caught, because each side matched its own.
    */
    const analyst = render(<CohortHeatmap rows={rows} view="cumulative" />)
    const summaryCell = within(analyst.container).getByLabelText(/^Oʻrtacha, \+1 oy:/)
    const tile = summaryCell.querySelector('[data-heat]')!.textContent!

    expect(milestone).toBe(`${tile}%`)
    expect(milestone).toBe('28%')
    expect(summaryCell.getAttribute('aria-label')).toMatch(/28[,.]1/)
  })

  it('refuses the same column in both modes when one cohort is all the evidence there is', () => {
    /*
      TWO FLOORS GUARDING ONE HAZARD, AND ONLY ONE MODE USED TO HAVE THE
      STRICT ONE.

      «Oddiy» has always refused a milestone standing on fewer than three
      cohorts (`MIN_COHORTS_FOR_AVERAGE`). The grid only took a summary cell
      off the ramp when it was thin by HEADCOUNT (`SUMMARY_MIN_BASE`, thirty
      customers) — so a column averaged over two cohorts of 310 customers
      between them printed a painted figure in the matrix while the milestone
      at that same offset printed «yetarli maʼlumot yoʻq». One number, two
      modes, opposite claims, one press of the toggle apart. §8.2's invariant
      («Oddiy milestones = the matrix's own summary row at those offsets»)
      then fails as a CLAIM even where the two figures agree.

      +3 is that column in this fixture: the June cohort stops at +1, so only
      two of the three rows reach it. +1, where all three do, is the control —
      both modes speak there, so this case cannot pass by refusing everything.
    */
    const atThree = columnAverage(rows, 3, 'cumulative')
    expect(atThree.cohorts).toBe(2)
    // Not thin by headcount: the OTHER floor is the only thing that can refuse
    // this column, which is what makes it the right column to test.
    expect(atThree.base).toBeGreaterThan(30)

    const manager = render(
      <ReturnAnswer data={{ repeatCustomers: 127, totalCustomers: 320, rows }} />,
    )
    const analyst = render(<CohortHeatmap rows={rows} view="cumulative" />)

    const milestone = (offset: number) =>
      manager.container.querySelector(`[aria-label*="+${offset} oy"]`)!.textContent!
    const tile = (offset: number) =>
      within(analyst.container)
        .getByLabelText(new RegExp(`^Oʻrtacha, \\+${offset} oy:`))
        .querySelector('[data-heat]') as HTMLElement

    // Refused on both sides of the toggle.
    expect(milestone(3)).toMatch(/yetarli maʼlumot yoʻq/i)
    expect(tile(3).style.background).toBe('var(--surface-sunken)')

    // And answered on both sides of it, one column to the left.
    expect(milestone(1)).not.toMatch(/yetarli maʼlumot yoʻq/i)
    expect(tile(1).style.background).not.toBe('var(--surface-sunken)')
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
