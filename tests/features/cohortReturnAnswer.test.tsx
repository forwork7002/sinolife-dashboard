// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { columnAverage } from '@/components/charts/Heatmap'
import { ReturnAnswer } from '@/features/cohort/ReturnAnswer'

/**
 * The milestones are the grid's own column averages, read through the grid's
 * own function. Anything this file asserts about the numbers is really an
 * assertion about `columnAverage`; what it asserts about ReturnAnswer is that
 * it calls it, states its width, and refuses to speak when that width is one.
 */
const row = (
  cohort: string,
  size: number,
  cumulative: (number | null)[],
  cumulativeCustomers: (number | null)[],
) => ({ cohort, size, cumulative, cumulativeCustomers, retention: cumulative, customers: cumulativeCustomers })

/** Three cohorts of very different size, so a weighted mean is distinguishable. */
const BIG = row('2025-01-01', 100, [0, 20, 30, 40], [0, 20, 30, 40])
const SMALL = row('2026-07-01', 10, [0, 50, 60, null], [0, 5, 6, null])
/*
  A third cohort, not in the brief's own draft fixture: with only BIG and
  SMALL, +1's `cohorts` is 2, which is under `MIN_COHORTS_FOR_AVERAGE` (3) —
  the very floor this task adds — so the milestone would print «yetarli
  maʼlumot yoʻq» rather than a figure and the weighted-vs-unweighted
  assertion below could never run. MEDIUM's size (50) still differs from
  both of the others, so the weighted/unweighted divergence stays visible.
*/
const MEDIUM = row('2025-06-01', 50, [0, 30, 40, 50], [0, 15, 20, 25])

describe('the return answer', () => {
  const data = {
    repeatCustomers: 159,
    totalCustomers: 203,
    rows: [
      row('2025-01-01', 24, [0, 18, 28, 37, 45, 51, 56], [0, 4, 7, 9, 11, 12, 13]),
      row('2025-02-01', 17, [0, 18, 28, 37, 45, 51, 56], [0, 3, 5, 6, 8, 9, 10]),
      row('2025-03-01', 15, [0, 18, 28, 37, 45, 51, 56], [0, 3, 4, 6, 7, 8, 8]),
    ],
  }

  it('states the answer as a sentence, on the whole-history denominator', () => {
    /*
      159 / 203 = 78.3%. It comes from the totals arm, which counts every
      cohort there has ever been — folding it from the windowed rows deletes
      the oldest loyal customers, and it did exactly that once.
    */
    render(<ReturnAnswer data={data} />)
    expect(screen.getByRole('status').textContent).toMatch(/100.*78/)
  })

  it('prints the grid’s own average, weighted by cohort size', () => {
    /*
      The single most likely regression in this task is a hand-written mean.
      Unweighted, +1 over BIG, SMALL and MEDIUM is (20 + 50 + 30) / 3 = 33.3.
      Weighted, which is what `columnAverage` does and what the grid draws, it
      is (20 + 5 + 15) / (100 + 10 + 50) = 25. If this asserts 33.3, the
      manager's view has grown a second implementation.
    */
    render(<ReturnAnswer data={{ ...data, rows: [BIG, SMALL, MEDIUM] }} />)
    const expected = columnAverage([BIG, SMALL, MEDIUM], 1, 'cumulative').percent!
    expect(expected).toBeCloseTo(25, 1)
    expect(screen.getByLabelText(/\+1 oy/i).textContent).toMatch(/25/)
  })

  it('refuses to print a milestone averaged over fewer than three cohorts', () => {
    /*
      The +12 column once had one qualifying cohort and printed its number as
      the company average. A sample of one is not an average.
    */
    const long = row(
      '2025-01-01',
      24,
      [0, 18, 28, 37, 45, 51, 56, 60, 64, 68, 72, 76, 85],
      [0, 4, 7, 9, 11, 12, 13, 14, 15, 16, 17, 18, 20],
    )
    render(<ReturnAnswer data={{ ...data, rows: [long] }} />)
    expect(screen.getByLabelText(/\+12 oy/i).textContent).toMatch(/yetarli maʼlumot yoʻq/i)
  })

  it('says how many cohorts each milestone averages', () => {
    render(<ReturnAnswer data={data} />)
    expect(screen.getByLabelText(/\+3 oy/i).getAttribute('aria-label')).toMatch(/3 ta kogorta/i)
  })
})
