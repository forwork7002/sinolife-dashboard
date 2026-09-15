// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
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
    /* Its own month is the one still running. */
    maxOffset: 0,
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
    maxOffset: 1,
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
    maxOffset: 2,
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

describe('the summary row refuses to colour a sample of one', () => {
  /*
    SEEN ON PRODUCTION THE DAY THIS SHIPPED. «Jami · oʻrtacha» read
    4 7 9 10 11 11 12 12 13 13 14 19 27 36 0 — climbing to 36% and then off a
    cliff. Each column averages only the cohorts old enough to have reached it,
    so the far right is one or two ancient cohorts and the last column was ONE
    cohort of ONE customer. Right arithmetic, and on the ramp it reads as a
    collapse in retention.
  */
  const THIN: CohortMatrixRow[] = [
    {
      // One customer, old enough to have reached +2, who never came back.
      cohort: '2026-06-01',
      size: 1,
      returned: 0,
      maxOffset: 2,
      retention: [100, 0, 0],
      customers: [1, 0, 0],
      cumulative: [0, 0, 0],
      cumulativeCustomers: [0, 0, 0],
      revenue: [{ amount: 10_000 }, { amount: 0 }, { amount: 0 }],
    },
    {
      // A real cohort, but it has only lived one month.
      cohort: '2026-08-01',
      size: 400,
      returned: 40,
      maxOffset: 1,
      retention: [100, 10, null],
      customers: [400, 40, null],
      cumulative: [0, 10, null],
      cumulativeCustomers: [0, 40, null],
      revenue: [{ amount: 4_000_000 }, { amount: 300_000 }, { amount: 0 }],
    },
  ]

  it('prints the figure but takes it off the ramp under thirty customers', () => {
    render(<CohortHeatmap rows={THIN} />)

    const tiles = (label: RegExp) =>
      (screen.getByLabelText(label).querySelector('[data-heat]') as HTMLElement).style.background

    // +1 stands on 401 customers and is painted; +2 stands on the one-person
    // cohort alone and is not.
    expect(tiles(/Oʻrtacha, \+1 oy/)).not.toBe('var(--surface-sunken)')
    expect(tiles(/Oʻrtacha, \+2 oy/)).toBe('var(--surface-sunken)')

    // The number itself is never withheld — it is true, it is just thin.
    expect(screen.getByLabelText(/Oʻrtacha, \+2 oy/).getAttribute('aria-label')).toContain(
      '1 mijozdan 0 tasi',
    )
  })
})

/**
 * A CELL AND ITS «QAYTGAN» COLUMN ARE THE SAME NUMBER, ROUNDED ONCE.
 *
 * The footer under the matrix promises exactly that, and on production
 * 2026-09-15 it was false in two rows out of fifteen: «118 · 3%» in the column
 * beside a cell reading 4%, and «108 · 9%» beside a cell reading 10%. Both
 * cells stand on the counts the column stands on, so the disagreement was
 * arithmetic — the share was rounded twice. `InsightsService` quantises it to
 * one decimal for the wire (118/3390 = 3.4808 → 3.5) and the cell rounded that
 * to none (3.5 → 4), while the column rounds the untouched ratio once
 * (3.4808 → 3).
 *
 * Only a value in [x.45, x.5) crosses on the way, which is why two rows broke
 * and thirteen did not — a rule that looks like a glitch. The fixtures below
 * are the two production rows, wire values included.
 */
describe('a cell and its «Qaytgan» column never disagree', () => {
  const wireRow = (
    cohort: string,
    size: number,
    returned: number,
    wireShare: number,
  ): CohortMatrixRow => ({
    cohort,
    size,
    returned,
    maxOffset: 1,
    /* `wireShare` is what the service actually sends: already one-decimal. */
    retention: [100, wireShare],
    customers: [size, returned],
    cumulative: [0, wireShare],
    cumulativeCustomers: [0, returned],
    revenue: [{ amount: 0 }, { amount: 0 }],
  })

  it('rounds 118 of 3390 to 3% in both places, not 3% and 4%', () => {
    render(<CohortHeatmap rows={[wireRow('2026-08-01', 3390, 118, 3.5)]} />)

    const row = screen.getByRole('row', { name: /2026-avg kogortasi/ })
    expect(row.querySelectorAll('td')[1]?.textContent).toBe('118· 3%')
    // The regression printed '4%' here, beside a column reading 3%.
    expect(cell(/2026-avg kogortasi, \+1 oy/).textContent).toBe('3%')
  })

  it('rounds 108 of 1138 to 9% in both places, not 9% and 10%', () => {
    render(<CohortHeatmap rows={[wireRow('2026-05-01', 1138, 108, 9.5)]} />)

    const row = screen.getByRole('row', { name: /2026-may kogortasi/ })
    expect(row.querySelectorAll('td')[1]?.textContent).toBe('108· 9%')
    // The regression printed '10%' here, beside a column reading 9%.
    expect(cell(/2026-may kogortasi, \+1 oy/).textContent).toBe('9%')
  })

  /*
    The monthly reading prints the same cell from the same two counts, so it
    carries the same promise and broke the same way.
  */
  it('holds for the monthly reading too', () => {
    render(<CohortHeatmap rows={[wireRow('2026-08-01', 3390, 118, 3.5)]} view="monthly" />)

    expect(cell(/2026-avg kogortasi, \+1 oy/).textContent).toBe('3%')
  })
})

/**
 * A MONTH THAT HAS NOT FINISHED HAS NOT ANSWERED YET.
 *
 * The hover panel picked its footer from the count alone, so on the newest
 * column — the one whose month is still running — it told the reader a
 * half-elapsed September was a finished one: «oʻlchangan nol, maʼlumot yoʻqligi
 * emas» («a measured zero, not missing data») over a month with a fortnight
 * left in it, and «ulush oʻzgarmagan» («the share did not move») over a share
 * that had every chance still to move.
 */
describe('the panel on a month that is still running', () => {
  const RUNNING: CohortMatrixRow[] = [
    {
      cohort: '2026-07-01',
      size: 200,
      returned: 0,
      /* +1 is August, and August is the month we are in. */
      maxOffset: 1,
      retention: [100, 0, null],
      customers: [200, 0, null],
      cumulative: [0, 0, null],
      cumulativeCustomers: [0, 0, null],
      revenue: [{ amount: 0 }, { amount: 0 }, { amount: 0 }],
    },
  ]

  it('says the month is not over instead of calling it a measured zero', () => {
    render(<CohortHeatmap rows={RUNNING} view="monthly" />)
    fireEvent.mouseEnter(cell(/2026-iyl kogortasi, \+1 oy/))

    expect(screen.getByText('Bu oy hali tugamagan — hisob davom etmoqda.')).toBeTruthy()
    expect(screen.queryByText(/oʻlchangan nol/)).toBeNull()
  })

  it('says the same on the cumulative reading, where it claimed the share had not moved', () => {
    render(<CohortHeatmap rows={RUNNING} />)
    fireEvent.mouseEnter(cell(/2026-iyl kogortasi, \+1 oy/))

    expect(screen.getByText('Bu oy hali tugamagan — hisob davom etmoqda.')).toBeTruthy()
    expect(screen.queryByText(/ulush oʻzgarmagan/)).toBeNull()
  })

  /* A finished month keeps the sentence it always had — the guard is on the
     horizon, not on the zero. */
  it('still calls a finished empty month a measured zero', () => {
    render(<CohortHeatmap rows={ROWS} view="monthly" />)
    fireEvent.mouseEnter(cell(/2026-iyn kogortasi, \+1 oy/))

    expect(screen.queryByText('Bu oy hali tugamagan — hisob davom etmoqda.')).toBeNull()
  })
})
