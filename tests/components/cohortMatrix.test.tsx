// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CohortHeatmap, type CohortMatrixRow } from '@/components/charts/Heatmap'

/**
 * The cohort matrix states the arithmetic behind every percentage it prints.
 *
 * Three of the four claims here are ones a matrix gets wrong quietly — the
 * numbers still render, they are simply a different fact from the one the
 * header promises — so nothing on screen would name the regression:
 *
 *   1. the summary row must weight by cohort size and must EXCLUDE cohorts too
 *      young to have reached the column, in the denominator as well as the
 *      numerator. Averaging the percentages lets a 50-person month outvote a
 *      200-person one; keeping the young cohort in the base divides by people
 *      who were never given the chance to come back;
 *   2. «Qaytgan» is the database's DISTINCT count, never the sum of the row's
 *      cells — a customer who returned in +1 and again in +2 is in two of them;
 *   3. a month that has not happened is not a zero.
 *
 * The fixture is built so each wrong reading produces a different, checkable
 * number, and the assertions are on the accessible names because that is where
 * the fraction is stated for a reader who cannot hover.
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
    revenue: [{ amount: 1_000_000 }, { amount: 0 }, { amount: 0 }],
  },
  {
    cohort: '2026-07-01',
    size: 50,
    returned: 5,
    retention: [100, 10, null],
    customers: [100, 5, null],
    revenue: [{ amount: 500_000 }, { amount: 90_000 }, { amount: 0 }],
  },
  {
    // 40 came back in +1 and 10 in +2, but only 45 distinct people did.
    cohort: '2026-06-01',
    size: 200,
    returned: 45,
    retention: [100, 20, 5],
    customers: [100, 40, 10],
    revenue: [{ amount: 2_000_000 }, { amount: 700_000 }, { amount: 150_000 }],
  },
]

const cell = (label: RegExp) => screen.getByLabelText(label)

describe('the cohort matrix prints the fraction under every share', () => {
  it('states each cell as «N mijozdan M tasi» beside its percentage', () => {
    render(<CohortHeatmap rows={ROWS} />)

    expect(cell(/2026-iyn kogortasi, \+1 oy/).getAttribute('aria-label')).toBe(
      '2026-iyn kogortasi, +1 oy: 20.0% — 200 mijozdan 40 tasi',
    )
  })

  it('weights the summary row by cohort size and skips cohorts that have not reached the column', () => {
    render(<CohortHeatmap rows={ROWS} />)

    // 45 of 250, not 45 of 350 (the August cohort has no +1 yet) and not the
    // 15.0% an unweighted mean of 10% and 20% would give.
    expect(cell(/Oʻrtacha, \+1 oy/).getAttribute('aria-label')).toBe(
      'Oʻrtacha, +1 oy: 18.0% — 250 mijozdan 45 tasi',
    )
    expect(cell(/Oʻrtacha, \+2 oy/).getAttribute('aria-label')).toBe(
      'Oʻrtacha, +2 oy: 5.0% — 200 mijozdan 10 tasi',
    )
  })

  it('leaves an unreached month unmeasured rather than zero', () => {
    render(<CohortHeatmap rows={ROWS} />)

    expect(screen.getAllByLabelText('hali oʻtmagan oy — oʻlchanmagan')).toHaveLength(3)
    expect(screen.queryByLabelText(/2026-avg kogortasi, \+1 oy/)).toBeNull()
  })

  it('shows the distinct returner count, not the sum of the row cells', () => {
    render(<CohortHeatmap rows={ROWS} />)

    const row = screen.getByRole('row', { name: /2026-iyn kogortasi/ })
    const returned = row.querySelectorAll('td')[1]

    // 45 distinct people, 23% of 200 — never 50, which is 40 + 10 counted twice.
    expect(returned?.textContent).toBe('45· 23%')
  })

  it('teaches the reading from the largest cohort that has lived a month', () => {
    render(<CohortHeatmap rows={ROWS} />)

    expect(
      screen.getByText(/Qanday oʻqiladi: 2026-iyn oyida 200 ta mijoz birinchi marta xarid qilgan/),
    ).toBeTruthy()
  })
})
