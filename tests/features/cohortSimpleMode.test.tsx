// @vitest-environment jsdom
import { readFileSync } from 'node:fs'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE MANAGER'S READING, AND THE ONE PROPERTY THAT MAKES IT TRUSTWORTHY.
 *
 * «Oddiy» answers three questions in sentences; «Batafsil» is the matrix. The
 * whole value of putting both on one screen is that they cannot disagree, and
 * that rests on one mechanical fact: they are two renderings of ONE
 * `useQuery(['cohorts'])` answer, off ONE mapped array of rows. A second
 * request — even the same request under a second key — reintroduces a moment
 * when the two halves of this screen were built from different reads of a
 * database the sync worker rewrites every minute.
 *
 * So this file holds three things:
 *   1. `SimpleView` says what it is supposed to say, in order, and names its
 *      clock on the screen rather than in a tooltip;
 *   2. switching modes issues NO request, shows NO skeleton and creates NO
 *      second query key;
 *   3. «Filtrlarni tozalash» does not delete `?mode=` — the one edit that
 *      would leave the screen and the address bar disagreeing about which
 *      reading is on, silently, because the route is shallow.
 */

/*
  The address bar IS `window.location` here, both ways. `/analytics/cohort` is
  in `SHALLOW_ROUTES`, so `useDashboardFilters` writes with `replaceState` and
  reads `window.location` back; `useCohortMode` does the same. A harness that
  froze `useSearchParams` at a value the location no longer had would be
  describing a browser that does not exist.
*/
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/analytics/cohort',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

/*
  PageShell is the nav, the period control, the freshness chip and the ⌘K
  search — none of which this file is about. Stubbed to the two slots
  `CohortPage` actually uses, so what is measured below is the page's own
  fetching and not the shell's.
*/
vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ actions, children }: { actions?: unknown; children?: unknown }) => (
    <div>
      <div data-testid="page-actions">{actions as React.ReactNode}</div>
      <div>{children as React.ReactNode}</div>
    </div>
  ),
}))

/*
  jsdom has no `matchMedia`, and `AnimatedNumber` — inside the concentration
  band's tiles — asks it whether the reader wants motion. Answering «reduced»
  makes the figures render at their final value on the first frame, which is
  what a test wants to read.
*/
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const { SimpleView } = await import('@/features/cohort/SimpleView')
const { CohortPage } = await import('@/features/cohort/CohortPage')
const { useDashboardFilters } = await import('@/features/shared/useDashboardFilters')

/** A cohort row, with only the fields `toMatrixRow` and the two views read. */
function cohortRow(
  cohort: string,
  size: number,
  cumulative: (number | null)[],
  revenueTotal: number,
) {
  const cumulativeCustomers = cumulative.map((v) =>
    v === null ? null : Math.round((v / 100) * size),
  )
  return {
    cohort,
    size,
    returned: cumulativeCustomers.at(-1) ?? 0,
    retention: cumulative,
    customers: cumulativeCustomers,
    cumulative,
    cumulativeCustomers,
    revenue: cumulative.map(() => ({ amount: 1_000_000, amountMinor: '100000000', currency: 'UZS' })),
    orders: cumulative.map(() => 1),
    revenueTotal: {
      amount: revenueTotal,
      amountMinor: String(revenueTotal * 100),
      currency: 'UZS',
    },
    revenuePerCustomer: { amount: 500_000, amountMinor: '50000000', currency: 'UZS' },
    ageMonths: cumulative.length - 1,
  }
}

const COHORTS = {
  /*
    THREE DIFFERENT REVENUES, adding to 23 750 000 — deliberately nowhere near
    `revenueTotalAll` below. The footer cell has to be the sum of THESE, and a
    fixture where the two figures happened to be close could not tell the
    difference.
  */
  rows: [
    cohortRow('2025-08-01', 24, [0, 21, 29, 38, 54, 63, 67], 12_000_000),
    cohortRow('2025-09-01', 17, [0, 18, 35, 35, 41, 41, 53], 7_500_000),
    cohortRow('2025-10-01', 15, [0, 13, 27, 33, 47, 47, 60], 4_250_000),
  ],
  stages: [{ stage: '1 kun', customers: 40 }],
  workedCustomers: 90,
  repeatRevenueShare: 65.2,
  repeatCustomers: 159,
  totalCustomers: 203,
  currentMonth: '2026-09-01',
  revenueTotalAll: { amount: 253_750_000, amountMinor: '25375000000', currency: 'UZS' },
  revenuePerCustomerAll: { amount: 1_250_000, amountMinor: '125000000', currency: 'UZS' },
}

const CONCENTRATION = {
  pareto: {
    top10SharePercent: 22.4,
    top5SharePercent: 14.1,
    nullCustomerSharePercent: 3.2,
    customersFor80Percent: 42,
    totalCustomers: 203,
  },
  repeat: {
    medianDaysBetweenFirstAndSecond: 31.5,
    p90Days: 92.1,
    pairsMeasured: 410,
    repurchaseWithin90Percent: 38.4,
    cohortSize: 180,
    repeatRevenueSharePercent: 61.0,
    bitrixFlagSharePercent: 54.3,
  },
}

const META = { dataSource: 'DEMO', generatedAt: '2026-09-15T06:00:00.000Z' }

/** Every `/api/v1` URL the page asked for, newest last. */
let requested: string[] = []

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    const data = url.includes('/insights/cohorts')
      ? COHORTS
      : url.includes('/insights/concentration')
        ? CONCENTRATION
        : {}
    return {
      ok: true,
      status: 200,
      json: async () => ({ data, meta: META }),
    } as unknown as Response
  })
}

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: Infinity } },
  })
}

beforeEach(() => {
  requested = []
  window.history.replaceState(null, '', '/analytics/cohort')
  vi.stubGlobal('fetch', mockFetch())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The rows `SimpleView` reads, in the shape the page's own mapping produces. */
const SIMPLE_DATA = {
  rows: COHORTS.rows,
  repeatCustomers: 159,
  totalCustomers: 203,
  repeatRevenueShare: 65.2,
  currentMonth: '2026-09-01',
  revenuePerCustomerAll: { amount: 1_250_000 },
  /* The page passes `COHORT_HISTORY_MONTHS`; the view states it rather than
     typing a number of its own. 18 is what the page asks for today. */
  historyMonths: 18,
}

describe('the manager’s view', () => {
  it('answers the three questions, in the order they are asked', () => {
    render(<SimpleView data={SIMPLE_DATA} />)

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '')
    expect(headings).toHaveLength(3)
    expect(headings[0]).toMatch(/yangi mijoz/i)
    expect(headings[1]).toMatch(/qayt/i)
    expect(headings[2]).toMatch(/pul/i)
  })

  it('states the repeat revenue share as a sentence, not as a gauge', () => {
    /*
      The figure used to be one ring among four tiles, where it was a magnitude
      with no subject. The subject is the finding: this much of the company's
      money is made after the customer was already won.
    */
    render(<SimpleView data={SIMPLE_DATA} />)

    expect(screen.getByText(/65[.,]2/)).toBeDefined()
    expect(screen.getByText(/keyingi xaridlar/i)).toBeDefined()
  })

  it('labels the per-customer figure as money SO FAR', () => {
    /*
      Whole-history revenue per customer is honest as ONE number, and
      «hozirgacha» is what stops it being read as a settled lifetime value for
      a business that is still running — which is how it turns into «so we may
      spend up to this much to win one».
    */
    render(<SimpleView data={SIMPLE_DATA} />)

    // The whole sentence, not just the word: `getByText` returns the
    // innermost match, and «hozirgacha» is its own <strong>.
    const sentence = screen.getByText(/olib kelgan/i)
    expect(sentence.textContent).toMatch(/hozirgacha/i)
    expect(sentence.textContent).toMatch(/1\D?250\D?000/)
  })

  it('names its clock AND its window ON THE SCREEN, so two honest totals do not look like a bug', () => {
    /*
      «Har 100 ta yangi mijozdan…» stands on every cohort there has ever been;
      the bars above it are the months the page asked for. Both are right and
      they are not the same population. The sentence that settles it has to be
      VISIBLE — a tooltip is read by whoever already suspects there is
      something to read, and this is read by everybody.

      TWO HALVES, AND THIS BLOCK USED TO PRINT ONE. The clock («delivered, not
      ordered») was on screen; the WINDOW — the half that actually makes the
      two totals different numbers — was only in a comment claiming it was on
      screen. It costs nothing today, with 16 months of history under an
      18-month bound, and starts lying the month the history passes it.
    */
    const { container } = render(<SimpleView data={SIMPLE_DATA} />)

    expect(screen.getByText(/yetkazilgan sana boʻyicha/i)).toBeDefined()
    expect(container.textContent).toMatch(/soʻnggi 18 oy/)
    expect(container.textContent).toMatch(/butun tarix/i)
  })

  it('reads the window off the page’s own bound rather than typing it', () => {
    /*
      `COHORT_HISTORY_MONTHS` lives in `CohortPage` and the query asks for it;
      a second copy in this sentence is the hand-mirrored literal that
      constant's own comment was written about — two places in this product
      said «eighteen» on a live screen for a day after the portal changed.
      Rendered at a different bound, the sentence has to follow.
    */
    const { container } = render(<SimpleView data={{ ...SIMPLE_DATA, historyMonths: 24 }} />)

    expect(container.textContent).toMatch(/soʻnggi 24 oy/)
    expect(container.textContent).not.toMatch(/soʻnggi 18 oy/)
  })

  it('says nothing about a share that was never measured, rather than 0%', () => {
    /*
      `repeatRevenueShare` is null when no revenue-bearing win is linked to a
      customer at all. A «0%» sentence there claims nobody in the company's
      history has ever bought twice.
    */
    render(<SimpleView data={{ ...SIMPLE_DATA, repeatRevenueShare: null }} />)

    expect(screen.queryByText(/keyingi xaridlar/i)).toBeNull()
    expect(screen.getByText(/oʻlchanmadi/i)).toBeDefined()
    // The money sentence is a separate measurement and still stands.
    expect(screen.getByText(/hozirgacha/i)).toBeDefined()
  })
})

describe('switching between «Oddiy» and «Batafsil»', () => {
  async function openPage() {
    const queryClient = client()
    const view = render(
      <QueryClientProvider client={queryClient}>
        <CohortPage />
      </QueryClientProvider>,
    )
    /* The cohorts read resolved and «Oddiy» drew itself from it. The
       concentration query has not run at all yet — it is gated on «Batafsil»
       — which is the subject of its own case below. */
    await screen.findByText(/Qancha yangi mijoz keladi\?/)
    return { ...view, queryClient }
  }

  /** What the page asked each endpoint for, so far. */
  const cohortReads = () => requested.filter((u) => u.includes('/insights/cohorts'))
  const concentrationReads = () =>
    requested.filter((u) => u.includes('/insights/concentration'))

  it('reads /insights/cohorts ONCE and redraws the other mode from it', async () => {
    /*
      THE PROPERTY, NOT A CONVENIENCE, AND IT IS ABOUT ONE ENDPOINT.
      `/insights/cohorts` is two of the most expensive scans in the product; a
      second read for the manager's view would have doubled it to print
      numbers already in the first response, and — worse — the two views would
      then have been built from two reads of a table the sync worker rewrites
      every minute, free to disagree about the same customers.

      Written over the COHORTS requests rather than over every request the page
      makes. It used to assert that the full URL list did not change at all,
      which quietly made it a test of two different things: the shared-payload
      property above, and «no other query may ever be mode-dependent» — a rule
      nobody stated and the concentration read now deliberately breaks (see
      the case below, and that query's comment in `CohortPage`). Narrowed, it
      fails for the reason it is named after and for no other.
    */
    const { container, queryClient } = await openPage()

    expect(cohortReads()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    // The matrix is on screen, so the switch really happened…
    expect(screen.getByText('Kogorta matritsasi')).toBeDefined()
    expect(screen.queryByText(/Qancha yangi mijoz keladi\?/)).toBeNull()
    // …and it arrived without re-reading the cohorts, or reloading at all.
    expect(cohortReads()).toHaveLength(1)
    // Scoped to the matrix's own card (`card-hero`): the concentration band
    // below it IS loading at this instant, honestly, and that is the trade
    // the gating case documents — but the matrix may never skeleton, because
    // its payload has been in hand since the first render.
    expect(container.querySelector('.card-hero')!.querySelectorAll('.skeleton')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Oddiy' }))
    expect(screen.getByText(/Qancha yangi mijoz keladi\?/)).toBeDefined()
    expect(cohortReads()).toHaveLength(1)
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0)

    /*
      ONE KEY, not two that happen to be fetched once each. A second key is how
      a refetch on one half of the screen leaves the other half on the older
      answer.
    */
    const cohortQueries = queryClient
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[0] === 'cohorts')
    expect(cohortQueries).toHaveLength(1)
  })

  it('does not fetch the concentration band a manager never opens', async () => {
    /*
      THE OTHER HALF OF THE SAME ARITHMETIC. Every consumer of
      `/insights/concentration` lives in «Batafsil», and «Oddiy» is the
      default: fetching it unconditionally spent a real query on the slowest
      screen in the product, on every first load, and threw the answer away
      for the majority of visits that never press the toggle.

      The trade, asserted rather than only described: the FIRST press pays for
      it, and no press after that does — the result is cached under
      `['concentration', apiParams]`, so toggling back and forth costs one
      fetch in total.
    */
    await openPage()

    expect(concentrationReads()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))
    expect(concentrationReads()).toHaveLength(1)

    // Back to «Oddiy» and forward again: still one, from cache.
    fireEvent.click(screen.getByRole('button', { name: 'Oddiy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))
    expect(concentrationReads()).toHaveLength(1)
  })

  it('carries the reading in the address, so a link opens on what was sent', async () => {
    await openPage()

    // The default is stripped rather than written — a default in a shared link
    // is noise.
    expect(window.location.search).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))
    expect(new URLSearchParams(window.location.search).get('mode')).toBe('detail')

    fireEvent.click(screen.getByRole('button', { name: 'Oddiy' }))
    expect(new URLSearchParams(window.location.search).get('mode')).toBeNull()
  })

  it('draws both readings from the SAME mapped rows', async () => {
    /*
      `columnAverage` draws the matrix's summary row AND «Ular qaytadimi?»'s
      milestones, reading `size` and `cumulativeCustomers` off these rows. The
      +1 column is the check: (21%·24 + 18%·17 + 13%·15) / 56 rounds to the
      same figure in both places only because it is the same array.
    */
    await openPage()

    const milestone = screen.getByLabelText(/^\+1 oy —/)
    // The milestone also prints the width of its own evidence, and three
    // cohorts is what the fixture has — so both readings are averaging over
    // the same population, not merely arriving at similar numbers.
    expect(milestone.textContent).toMatch(/3 ta kogorta/)
    const simple = Number(/(\d+[.,]?\d*)\s*%/.exec(milestone.textContent ?? '')?.[1])
    expect(Number.isFinite(simple)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    /*
      The grid rounds to whole percent in a 44px column and the milestone
      prints one decimal in a sentence; both come out of `columnAverage`, so
      the one must round to the other. If the rows were constructed twice the
      weighting would differ and this gap would not close.
    */
    const grid = Number(
      /(\d+)/.exec(screen.getByLabelText(/Oʻrtacha.*\+1/).textContent ?? '')?.[1],
    )
    expect(grid).toBe(Math.round(simple))
  })

  it('maps the rows ONCE, above the mode switch', () => {
    /*
      The assertion the numbers above cannot make on their own: two views that
      agree today can be mapped twice and drift tomorrow. `toMatrixRow` is
      called in exactly one place, and the grid is handed the result by name.
    */
    const page = readFileSync('src/features/cohort/CohortPage.tsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

    expect(page.match(/\.map\(toMatrixRow\)/g)).toHaveLength(1)
    expect(page).toContain('rows={matrixRows}')
    expect(page).toContain('rows: matrixRows')
  })

  it('sums the VISIBLE column where the summary row printed «—»', async () => {
    /*
      THE FOOTER IS THE COLUMN, ADDED UP — 12 000 000 + 7 500 000 + 4 250 000.

      A footer cell's grammar already promises that, and this one has no
      visible marker to say otherwise: its span lives in a `title` and an
      `aria-label`, so a sighted reader scanning the column sees one number
      under a column of numbers and reads it as their total. The DTO's
      whole-history `revenueTotalAll` (253 750 000) would have been a different
      fact wearing that shape, and this screen prints no revenue tile anywhere
      else that could have corrected them.
    */
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    const cell = screen.getByLabelText(/Kogorta tushumi jami/)
    expect(cell.getAttribute('aria-label')).toMatch(/23\D?750\D?000/)
    // Compact in the column, exact in the label — the columns' own treatment.
    expect(cell.textContent).toMatch(/23[.,]8 mln/)

    /*
      AND EXPLICITLY NOT THE WHOLE-HISTORY FIGURE. Without this the test would
      pass on the windowed number and say nothing about the one it replaced —
      the regression worth catching is the cell quietly going back.
    */
    expect(cell.getAttribute('aria-label')).not.toMatch(/253\D?750\D?000/)
    expect(cell.textContent).not.toMatch(/254 mln/)
  })

  it('does not move the footer when the reader changes the month window', () => {
    /*
      `months` bounds the grid's COLUMNS, not its rows, which is what makes
      summing rows well-defined here. If that ever changes, the footer starts
      disagreeing with a column the reader just narrowed — so the sum is taken
      from `matrixRows`, which the window control does not touch.
    */
    const page = readFileSync('src/features/cohort/CohortPage.tsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

    expect(page).toMatch(/matrixRows\.reduce\(\(sum, row\) => sum \+ row\.revenueTotalAmount, 0\)/)
    expect(page).not.toContain('revenueTotalAll')
  })

  it('still refuses to fold the per-customer column, in the singular', () => {
    /*
      «Pul ustunlari … jamlanmaydi» — money columnS — was true while both were
      blank and is false now that the cell beside it visibly sums. The sentence
      a reader actually sees has to be about the one column it still describes.
    */
    const heatmap = readFileSync('src/components/charts/Heatmap.tsx', 'utf8')
    const sentence = /const MONEY_NOT_SUMMED =\s*'([^']*)'/.exec(heatmap)?.[1]

    expect(sentence).toBeDefined()
    expect(sentence).toMatch(/^Bu ustun/)
    expect(sentence).not.toMatch(/Pul ustunlari/)
  })
})

describe('«Filtrlarni tozalash» on a screen whose reading lives in the URL', () => {
  /*
    `reset()` REBUILDS the query string from an allowlist, so anything missing
    from that list is DELETED. `mode` was missing.

    It would have been deleted through `replaceState` — `/analytics/cohort` is
    a shallow route — which fires no `popstate` and never reaches
    `useCohortMode`'s own `publish()`. The screen would have gone on drawing
    «Batafsil» while the address said «Oddiy»: no error, nothing on screen
    saying so, and the next reload or shared link flipping the view with
    nobody having touched it. That is precisely the divergence a URL-backed
    toggle exists to prevent.

    Latent today only because `CohortPage` passes no filter props, so the
    button does not render there — an accident of one page's props, not a
    property of the hook.
  */
  function filtersAt(search: string) {
    window.history.replaceState(null, '', `/analytics/cohort?${search}`)
    return renderHook(() => useDashboardFilters())
  }

  it('keeps the reading, and still clears the filters beside it', () => {
    const { result } = filtersAt('mode=detail&employeeIds=e1,e2&preset=this_month&page=3')

    act(() => result.current.reset())

    const kept = new URLSearchParams(window.location.search)
    expect(kept.get('mode')).toBe('detail')
    // The window is not a filter either, and never has been in that count.
    expect(kept.get('preset')).toBe('this_month')
    // These are.
    expect(kept.get('employeeIds')).toBeNull()
    expect(kept.get('page')).toBeNull()
  })

  it('does not invent a reading where the address had none', () => {
    const { result } = filtersAt('employeeIds=e1')

    act(() => result.current.reset())

    expect(new URLSearchParams(window.location.search).get('mode')).toBeNull()
  })
})
