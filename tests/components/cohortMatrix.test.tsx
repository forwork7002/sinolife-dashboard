// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CohortHeatmap, type CohortMatrixRow } from '@/components/charts/Heatmap'

/**
 * The cohort matrix states the arithmetic behind every percentage it prints.
 *
 * Most of the claims here are ones a matrix gets wrong quietly — the numbers
 * still render, they are simply a different fact from the one the header
 * promises — so nothing on screen would name the regression:
 *
 *   1. the summary row must weight by cohort size and must EXCLUDE cohorts too
 *      young to have reached the column, in the denominator as well as the
 *      numerator. Averaging the percentages lets a 50-person month outvote a
 *      200-person one; keeping the young cohort in the base divides by people
 *      who were never given the chance to come back;
 *   2. «Qaytgan» is the database's DISTINCT count, never the sum of the row's
 *      cells — a customer who returned in +1 and again in +2 is in two of them;
 *   3. a month that has not happened is not a zero;
 *   4. the two readings must not be confusable. The cumulative one is the
 *      default, it has no `0` column, and its last measured cell in a row is
 *      that row's «Qaytgan» share — which is the check a reader makes without
 *      leaving the table.
 *
 * The fixture is built so each wrong reading produces a different, checkable
 * number — 40 returned in +1 and 10 in +2, but only 45 distinct people — and
 * the assertions are on the accessible names because that is where the
 * fraction is stated for a reader who cannot hover.
 */

/** Newest first, as `/insights/cohorts` returns them. */
const ROWS: CohortMatrixRow[] = [
  {
    // This month: no offset has elapsed, so only column 0 is measured.
    cohort: '2026-08-01',
    size: 100,
    returned: 0,
    retention: [100, null, null],
    customers: [100, null, null],
    cumulative: [0, null, null],
    cumulativeCustomers: [0, null, null],
    revenue: [{ amount: 1_000_000 }, { amount: 0 }, { amount: 0 }],
  },
  {
    cohort: '2026-07-01',
    size: 50,
    returned: 5,
    retention: [100, 10, null],
    customers: [100, 5, null],
    cumulative: [0, 10, null],
    cumulativeCustomers: [0, 5, null],
    revenue: [{ amount: 500_000 }, { amount: 90_000 }, { amount: 0 }],
  },
  {
    /*
      40 came back in +1 and 10 in +2, but only 45 distinct people did — five
      of the ten had already been counted in +1. So the cumulative increments
      are 40 and 5, not 40 and 10, and the curve ends at 45/200 rather than at
      the 50/200 a naive sum of the monthly cells would give.
    */
    cohort: '2026-06-01',
    size: 200,
    returned: 45,
    retention: [100, 20, 5],
    customers: [100, 40, 10],
    cumulative: [0, 20, 22.5],
    cumulativeCustomers: [0, 40, 45],
    revenue: [{ amount: 2_000_000 }, { amount: 700_000 }, { amount: 150_000 }],
  },
]

const cell = (label: RegExp) => screen.getByLabelText(label)

describe('the cohort matrix, read month by month', () => {
  it('states each cell as «N mijozdan M tasi» beside its percentage', () => {
    render(<CohortHeatmap rows={ROWS} view="monthly" />)

    expect(cell(/2026-iyn kogortasi, \+1 oy/).getAttribute('aria-label')).toBe(
      '2026-iyn kogortasi, +1 oy: 20.0% — 200 mijozdan 40 tasi shu oyda qayta xarid qilgan',
    )
  })

  it('weights the summary row by cohort size and skips cohorts that have not reached the column', () => {
    render(<CohortHeatmap rows={ROWS} view="monthly" />)

    // 45 of 250, not 45 of 350 (the August cohort has no +1 yet) and not the
    // 15.0% an unweighted mean of 10% and 20% would give.
    expect(cell(/Oʻrtacha, \+1 oy/).getAttribute('aria-label')).toBe(
      'Oʻrtacha, +1 oy: 18.0% — 250 mijozdan 45 tasi shu oyda qayta xarid qilgan',
    )
    expect(cell(/Oʻrtacha, \+2 oy/).getAttribute('aria-label')).toBe(
      'Oʻrtacha, +2 oy: 5.0% — 200 mijozdan 10 tasi shu oyda qayta xarid qilgan',
    )
  })

  it('leaves an unreached month unmeasured rather than zero', () => {
    render(<CohortHeatmap rows={ROWS} view="monthly" />)

    expect(screen.getAllByLabelText('hali oʻtmagan oy — oʻlchanmagan')).toHaveLength(3)
    expect(screen.queryByLabelText(/2026-avg kogortasi, \+1 oy/)).toBeNull()
  })

  it('shows the distinct returner count, not the sum of the row cells', () => {
    render(<CohortHeatmap rows={ROWS} view="monthly" />)

    const row = screen.getByRole('row', { name: /2026-iyn kogortasi/ })
    const returned = row.querySelectorAll('td')[1]

    // 45 distinct people, 23% of 200 — never 50, which is 40 + 10 counted twice.
    expect(returned?.textContent).toBe('45· 23%')
  })
})

describe('the cohort matrix, read cumulatively', () => {
  it('is the default reading', () => {
    render(<CohortHeatmap rows={ROWS} />)

    expect(cell(/2026-iyn kogortasi, \+2 oy/).getAttribute('aria-label')).toBe(
      '2026-iyn kogortasi, +2 oy: 22.5% — 200 mijozdan 45 tasi shu oyga kelib qaytgan',
    )
  })

  it('never double-counts a customer who came back twice', () => {
    render(<CohortHeatmap rows={ROWS} />)

    /*
      THE FAILURE THIS TEST EXISTS FOR. Built by summing `customers` the +2
      cell would read 50 of 200 — 25.0% — because the five people who came back
      in both months would be counted twice. The increments come from FIRST
      returns, so the curve ends on the 45 the database counted DISTINCT.
    */
    const row = screen.getByRole('row', { name: /2026-iyn kogortasi/ })
    const returned = row.querySelectorAll('td')[1]

    expect(returned?.textContent).toBe('45· 23%')
    expect(cell(/2026-iyn kogortasi, \+2 oy/).getAttribute('aria-label')).toContain('45 tasi')
    expect(screen.queryByLabelText(/2026-iyn kogortasi, \+2 oy: 25/)).toBeNull()
  })

  it('never falls, because it is a running total', () => {
    render(<CohortHeatmap rows={ROWS} />)

    const at1 = cell(/2026-iyn kogortasi, \+1 oy/).getAttribute('aria-label')
    const at2 = cell(/2026-iyn kogortasi, \+2 oy/).getAttribute('aria-label')

    // 20.0% then 22.5%. Monthly the same two cells read 20% then 5%, which is
    // the reading this column must never be mistaken for.
    expect(at1).toContain('20.0%')
    expect(at2).toContain('22.5%')
  })

  it('drops the «0» column instead of printing a row of zeros', () => {
    render(<CohortHeatmap rows={ROWS} />)

    // Monthly, offset 0 is 100% by construction and worth printing as the
    // anchor. Cumulatively it is 0% for every cohort there has ever been.
    expect(screen.queryByLabelText(/2026-iyn kogortasi, xarid oyi/)).toBeNull()
    expect(screen.getByRole('columnheader', { name: '+1' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: '0' })).toBeNull()
  })

  it('weights the summary row the same way the monthly reading does', () => {
    render(<CohortHeatmap rows={ROWS} />)

    // +2 is reached by the June cohort alone: 45 of 200.
    expect(cell(/Oʻrtacha, \+2 oy/).getAttribute('aria-label')).toBe(
      'Oʻrtacha, +2 oy: 22.5% — 200 mijozdan 45 tasi shu oyga kelib qaytgan',
    )
  })
})
