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
    retention: [100, null, null],
    customers: [100, null, null],
    cumulative: [0, null, null],
    cumulativeCustomers: [0, null, null],
    revenue: [{ amount: 1_000_000 }, { amount: 0 }, { amount: 0 }],
    orders: [120, null, null],
    revenueTotal: '1,000,000 soʻm',
    revenuePerCustomer: '10,000 soʻm',
    ageMonths: 0,
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
    orders: [55, 6, null],
    revenueTotal: '590,000 soʻm',
    revenuePerCustomer: '11,800 soʻm',
    ageMonths: 1,
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
    orders: [210, 45, 12],
    revenueTotal: '2,850,000 soʻm',
    revenuePerCustomer: '14,250 soʻm',
    ageMonths: 2,
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

    /*
      45 distinct people, 23% of 200 — never 50, which is 40 + 10 counted twice.

      The column PRINTS the share and carries the count in its own accessible
      label: two numbers in two formats («45· 23%») in one right-aligned cell
      was the noisiest thing in the pinned block, and the count is evidence for
      the share rather than a figure anybody scans down the column. Losing it
      from the label as well would lose the check this test exists for.
    */
    expect(returned?.textContent).toBe('23%')
    expect(returned?.getAttribute('aria-label')).toBe(
      '2026-iyn kogortasi: 200 mijozdan 45 tasi qaytgan — 23%',
    )
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

    expect(returned?.getAttribute('aria-label')).toContain('45 tasi')
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
      retention: [100, 0, 0],
      customers: [1, 0, 0],
      cumulative: [0, 0, 0],
      cumulativeCustomers: [0, 0, 0],
      revenue: [{ amount: 10_000 }, { amount: 0 }, { amount: 0 }],
    orders: [1, 0, 0],
    revenueTotal: '10,000 soʻm',
    revenuePerCustomer: '10,000 soʻm',
    ageMonths: 2,
    },
    {
      // A real cohort, but it has only lived one month.
      cohort: '2026-08-01',
      size: 400,
      returned: 40,
      retention: [100, 10, null],
      customers: [400, 40, null],
      cumulative: [0, 10, null],
      cumulativeCustomers: [0, 40, null],
      revenue: [{ amount: 4_000_000 }, { amount: 300_000 }, { amount: 0 }],
    orders: [420, 40, null],
    revenueTotal: '4,300,000 soʻm',
    revenuePerCustomer: '10,750 soʻm',
    ageMonths: 1,
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

describe('the matrix shows a window of months rather than every one it is given', () => {
  /*
    THE WIDTH WAS THE PROBLEM, not the density.

    `/insights/cohorts` is asked for eighteen months, so the grid drew up to
    nineteen columns — and because only the oldest cohort has lived that long,
    the right half of the table was hatch. A reader scrolled sideways past a
    field of «hali oʻtmagan oy» to reach columns that describe one or two
    ancient cohorts. The signal is in the first year; the rest is available on
    request and is no longer the default.
  */
  const WIDE: CohortMatrixRow[] = [
    {
      cohort: '2025-01-01',
      size: 100,
      returned: 30,
      retention: Array.from({ length: 19 }, (_, i) => (i === 0 ? 100 : 2)),
      customers: Array.from({ length: 19 }, (_, i) => (i === 0 ? 100 : 2)),
      cumulative: Array.from({ length: 19 }, (_, i) => (i === 0 ? 0 : 2 * i)),
      cumulativeCustomers: Array.from({ length: 19 }, (_, i) => (i === 0 ? 0 : 2 * i)),
      revenue: Array.from({ length: 19 }, () => ({ amount: 10_000 })),
    orders: Array.from({ length: 19 }, (_, i) => (i === 0 ? 100 : 2)),
    revenueTotal: '190,000 soʻm',
    revenuePerCustomer: '1,900 soʻm',
    ageMonths: 18,
    },
  ]

  const header = (name: string) => screen.queryByRole('columnheader', { name })

  it('draws a year of months by default and stops there', () => {
    render(<CohortHeatmap rows={WIDE} />)

    expect(header('+12')).toBeTruthy()
    expect(header('+13')).toBeNull()
    expect(header('+18')).toBeNull()
  })

  it('draws every month when asked for all of them', () => {
    render(<CohortHeatmap rows={WIDE} months={null} />)

    expect(header('+18')).toBeTruthy()
  })

  it('draws six when asked for six', () => {
    render(<CohortHeatmap rows={WIDE} months={6} />)

    expect(header('+6')).toBeTruthy()
    expect(header('+7')).toBeNull()
  })

  it('counts the window in MONTHS SINCE the first purchase, not in columns', () => {
    /*
      The cumulative reading drops the `0` column and the monthly one keeps it,
      so a window counted in columns would end on a different month in each
      reading — «12 oy» meaning +12 in one and +11 in the other. It is counted
      as an offset, so both stop on the same month and the monthly grid is one
      column wider.
    */
    const { unmount } = render(<CohortHeatmap rows={WIDE} months={12} view="monthly" />)
    expect(header('0')).toBeTruthy()
    expect(header('+12')).toBeTruthy()
    expect(header('+13')).toBeNull()
    unmount()

    render(<CohortHeatmap rows={WIDE} months={12} />)
    expect(header('0')).toBeNull()
    expect(header('+12')).toBeTruthy()
  })
})

describe('the cells print figures, and the header carries the unit', () => {
  /*
    A «%» in every cell is 250 glyphs saying what the column group already
    says once. They were set at 8.5px and 62% opacity precisely because they
    were in the way — a sign that the right place for them is not the cell.
  */
  it('prints a bare number in the cell', () => {
    render(<CohortHeatmap rows={ROWS} view="monthly" />)

    expect(cell(/2026-iyn kogortasi, \+1 oy/).textContent).toBe('20')
  })

  it('still says what the figure IS, in the label a screen reader gets', () => {
    render(<CohortHeatmap rows={ROWS} view="monthly" />)

    expect(cell(/2026-iyn kogortasi, \+1 oy/).getAttribute('aria-label')).toContain('20.0%')
  })

  it('keeps «<1» and «0» distinguishable without the sign', () => {
    render(<CohortHeatmap rows={ROWS} view="monthly" />)

    // The «0» column is 100 in every row: the anchor, off the ramp.
    expect(cell(/2026-iyn kogortasi, xarid oyi/).textContent).toBe('100')
  })
})

describe('the money columns, and the comparison they invite', () => {
  /*
    A COLUMN OF FIGURES IS AN INVITATION TO RANK THE ROWS, and ranking rows on
    money-to-date ranks them on AGE. The old cohort below has had thirteen
    months to spend and the young one has had one, so read against each other
    they say «new customers are worse» — the exact opposite of the finding this
    screen exists to show. Three defences, and each is asserted here: the
    heading says «hozirgacha», every money hover states the cohort's age, and a
    cohort under three months old prints greyed and says why.

    Three months is measured, not chosen: the median inter-purchase gap on this
    portal is 37.5 days and p75 is 73.9, so a younger cohort has largely not
    had its second chance yet. See `MONEY_YOUNG_MONTHS`.
  */
  const GROWN: CohortMatrixRow[] = [
    {
      cohort: '2025-08-01',
      size: 24,
      returned: 5,
      retention: [100, 12.5, 8.3],
      customers: [24, 3, 2],
      cumulative: [0, 12.5, 20.8],
      cumulativeCustomers: [0, 3, 5],
      revenue: [{ amount: 4_800_000 }, { amount: 900_000 }, { amount: 600_000 }],
      // Three people came back in +1 and placed FOUR orders between them:
      // the two counts are different facts and the hover must not merge them.
      orders: [24, 4, 3],
      revenueTotal: '6,300,000 soʻm',
      revenuePerCustomer: '262,500 soʻm',
      ageMonths: 13,
    },
  ]

  const INFANT: CohortMatrixRow[] = [
    {
      cohort: '2026-08-01',
      size: 3,
      returned: 0,
      retention: [100, 0, null],
      customers: [3, 0, null],
      cumulative: [0, 0, null],
      cumulativeCustomers: [0, 0, null],
      revenue: [{ amount: 600_000 }, { amount: 0 }, { amount: 0 }],
      orders: [3, 0, null],
      revenueTotal: '600,000 soʻm',
      revenuePerCustomer: '200,000 soʻm',
      ageMonths: 1,
    },
  ]

  it('prints the cohort’s whole revenue and its per-customer share', () => {
    render(<CohortHeatmap rows={GROWN} />)

    expect(cell(/kogorta tushumi/i).textContent).toBe('6,300,000 soʻm')
    expect(cell(/1 mijozga/i).textContent).toBe('262,500 soʻm')
  })

  it('heads both columns «hozirgacha», because they are money TO DATE', () => {
    render(<CohortHeatmap rows={GROWN} />)

    expect(screen.getByRole('columnheader', { name: /kogorta tushumi/i }).textContent).toContain(
      'hozirgacha',
    )
    expect(screen.getByRole('columnheader', { name: /1 mijozga/i }).textContent).toContain(
      'hozirgacha',
    )
  })

  it('greys a cohort too young to compare on money-to-date', () => {
    render(<CohortHeatmap rows={INFANT} />)

    const perCustomer = cell(/1 mijozga/i)
    expect(perCustomer.getAttribute('data-young')).toBe('true')
    expect(perCustomer.getAttribute('aria-label')).toMatch(/solishtirib boʻlmaydi/)
    // Greyed, never withheld: the figure is true, it is simply not comparable.
    expect(perCustomer.textContent).toBe('200,000 soʻm')
  })

  it('does not grey a cohort old enough to compare', () => {
    render(<CohortHeatmap rows={GROWN} />)

    const perCustomer = cell(/1 mijozga/i)
    expect(perCustomer.getAttribute('data-young')).toBe('false')
    expect(perCustomer.getAttribute('aria-label')).not.toMatch(/solishtirib boʻlmaydi/)
  })

  it('states the cohort’s age in the money hover, at every age', () => {
    render(<CohortHeatmap rows={GROWN} />)
    fireEvent.mouseEnter(cell(/1 mijozga/i))

    expect(screen.getByText('13 oy')).toBeTruthy()
    expect(screen.getByText(/13 oy davomida/)).toBeTruthy()
  })

  it('says in the young cohort’s hover why its figure cannot be ranked', () => {
    render(<CohortHeatmap rows={INFANT} />)
    fireEvent.mouseEnter(cell(/1 mijozga/i))

    expect(screen.getByText(/1 oylik — bu raqamni eski kogortalar bilan solishtirib boʻlmaydi/))
      .toBeTruthy()
  })

  it('names orders and customers as different things in the hover', () => {
    render(<CohortHeatmap rows={GROWN} />)
    fireEvent.mouseEnter(cell(/2025-avg kogortasi, \+1 oy/))

    // Three people, four orders. Printed as one number the cell would be
    // saying whichever of the two the reader assumed it meant.
    expect(screen.getByText('3 / 24 mijoz')).toBeTruthy()
    expect(screen.getByText('Buyurtmalar')).toBeTruthy()
    expect(screen.getByText('4 ta')).toBeTruthy()
  })

  it('leaves the summary row’s money blank rather than adding formatted strings', () => {
    /*
      The grid is handed money already formatted (see `toMatrixRow` in
      CohortPage), so it has no number to add — and the per-customer column
      could not be summed even if it had: a «Jami» under figures that each
      cover a different span of months is the cross-row comparison the whole
      block above defends against, printed as a fact.
    */
    render(<CohortHeatmap rows={GROWN} />)

    const summary = screen.getByRole('row', { name: /Jami · oʻrtacha/ })
    const cells = summary.querySelectorAll('td')

    // td[0] «Yangi mijoz», td[1] «Qaytgan», then the two money columns.
    expect(cells[2]?.textContent).toBe('—')
    expect(cells[3]?.textContent).toBe('—')
  })
})

describe('the pinned block is aligned by construction, not by hand', () => {
  /*
    THE FAILURE THIS PINS IS ONE PIXEL WIDE.

    The left columns are sticky, so each one's `left` has to equal the widths
    that precede it EXACTLY — a pixel of disagreement shows as a sliver of a
    scrolling cell sitting under a pinned one, which reads as a rendering
    fault. Those offsets used to be hand-written sums of three width constants
    at nine sites; they are derived from the `PINNED` list now, and this
    asserts the derivation against the widths the `<colgroup>` actually
    declares, in all three bands of the table at once.
  */
  const offsets = () => {
    const widths = Array.from(document.querySelectorAll('col'))
      .map((col) => Number.parseFloat((col as HTMLElement).style.width))
      .filter((width) => !Number.isNaN(width))

    return widths.map(
      (_, i) => `${widths.slice(0, i).reduce((sum, width) => sum + width, 0)}px`,
    )
  }

  const stickyLeftsOf = (row: Element, count: number) =>
    Array.from(row.children)
      .slice(0, count)
      .map((cell) => (cell as HTMLElement).style.left)

  it('sets every sticky left to the sum of the widths before it', () => {
    render(<CohortHeatmap rows={ROWS} />)

    const expected = offsets()
    expect(expected.length).toBeGreaterThan(3)

    const head = screen.getAllByRole('row')[0]
    const body = screen.getByRole('row', { name: /2026-iyn kogortasi/ })
    const summary = screen.getByRole('row', { name: /Jami · oʻrtacha/ })

    expect(stickyLeftsOf(head!, expected.length)).toEqual(expected)
    expect(stickyLeftsOf(body, expected.length)).toEqual(expected)
    expect(stickyLeftsOf(summary, expected.length)).toEqual(expected)
  })
})
