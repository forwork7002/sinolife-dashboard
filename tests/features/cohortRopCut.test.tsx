// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * CUTTING THE MATRIX BY THE TEAM THAT BROUGHT THE CUSTOMER IN.
 *
 * `/insights/cohorts` is the slowest statement in the product, and the team
 * cut is safe only because of two promises that nothing on screen would show
 * if they broke:
 *
 *   1. a page that did not ask for the cut never asks for any part of it. The
 *      team LIST costs a grouping and two joins, so it is fetched on the first
 *      reach for the picker and not before — `cohortsSql.test.ts` pins the
 *      other half of this, that the default STATEMENT carries none of it;
 *   2. the cut is a different ANSWER, so it is a different cache entry and a
 *      different URL. Sharing a key with the company view would show one
 *      team's cells under the company's denominator for as long as it took the
 *      refetch to land, and sharing no URL would make the screen unshareable.
 *
 * And one thing a reader can be actively misled by: the banner that names the
 * cut must name the team whose ROWS are drawn, which for one render after
 * every change is not the team the control holds.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/analytics/cohort',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ actions, children }: { actions?: unknown; children?: unknown }) => (
    <div>
      <div data-testid="page-actions">{actions as React.ReactNode}</div>
      <div>{children as React.ReactNode}</div>
    </div>
  ),
}))

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

const { CohortPage } = await import('@/features/cohort/CohortPage')

function cohortRow(cohort: string, size: number) {
  const cumulative = [0, 20, 30]
  const cumulativeCustomers = cumulative.map((v) => Math.round((v / 100) * size))
  return {
    cohort,
    size,
    returned: cumulativeCustomers.at(-1) ?? 0,
    retention: cumulative,
    customers: cumulativeCustomers,
    cumulative,
    cumulativeCustomers,
    revenue: cumulative.map(() => ({
      amount: 1_000_000,
      amountMinor: '100000000',
      currency: 'UZS',
    })),
    orders: cumulative.map(() => 1),
    revenueTotal: { amount: 3_000_000, amountMinor: '300000000', currency: 'UZS' },
    revenuePerCustomer: { amount: 500_000, amountMinor: '50000000', currency: 'UZS' },
    ageMonths: 2,
  }
}

/*
  The concentration band is not cut by team and is not what this file is
  about — but «Batafsil» renders it, so it has to answer with its own shape.
  Its presence here is itself the claim that the cut does NOT reach it: the
  page asks for it once, on the mode, and never again when a team is picked.
*/
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

let requested: string[] = []

/** Every `/insights/cohorts` call that asked for a matrix, not for the list. */
const matrixReads = () =>
  requested.filter((url) => url.includes('/insights/cohorts') && !url.includes('include=rops'))

/** …and the calls that asked only for the picker's options. */
const listReads = () => requested.filter((url) => url.includes('include=rops'))

/*
  «Mijozlar oqimi», the band at the top of «Batafsil».

  A STUB THAT ANSWERED `{}` WOULD NOT BE A LIGHTER FIXTURE, IT WOULD BE A LIE
  ABOUT THE CONTRACT: `apiGet<CustomerFlowDto>` promises these fields and the
  page reads them the way every other block on it reads its own payload —
  unguarded past the response itself. An empty object is truthy, so the band
  rendered and threw on `states.rows`, taking the whole page with it.
*/
const FLOW = {
  summary: {
    newCustomers: 180,
    returningCustomers: 64,
    activeCustomers: 244,
    newCustomersWon: 138,
    firstRevenue: { amount: 42_000_000, amountMinor: '4200000000', currency: 'UZS' },
    repeatRevenue: { amount: 18_000_000, amountMinor: '1800000000', currency: 'UZS' },
    repeatRevenueSharePercent: 30.0,
  },
  series: [
    { bucket: '2026-08-01', newCustomers: 90, returningCustomers: 30 },
    { bucket: '2026-08-02', newCustomers: 90, returningCustomers: 34 },
  ],
  sources: [
    {
      key: 'instagram',
      label: 'Instagram',
      newCustomers: 120,
      sharePercent: 66.7,
      repeatPercent: 21.4,
      maturedCustomers: 900,
    },
    {
      key: 'telefon',
      label: 'Telefon',
      newCustomers: 60,
      sharePercent: 33.3,
      repeatPercent: 12.1,
      maturedCustomers: 410,
    },
  ],
  states: {
    customers: 500,
    rows: [
      { key: 'ACTIVE', label: 'Faol', colour: '--series-3', customers: 300 },
      { key: 'AT_RISK', label: 'Xavf ostida', colour: '--series-5', customers: 120 },
      { key: 'LOST', label: 'Yoʻqotilgan', colour: '--series-8', customers: 80 },
    ],
  },
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)

    /*
      THE SERVER ECHOES THE CUT BACK, which is the fact the banner is built
      from. A stub that always answered `rop: null` would let the page pass
      this file while printing nothing over a cut matrix in production.
    */
    const rop = new URL(url, 'http://x').searchParams.get('rop')
    const data = url.includes('/insights/cohorts')
      ? {
          rows: [cohortRow('2026-06-01', 40), cohortRow('2026-07-01', 30)],
          groups: [],
          baseCustomers: 120,
          workedCustomers: 90,
          repeatRevenueShare: 65.2,
          repeatCustomers: 40,
          totalCustomers: 70,
          rop,
          rops: url.includes('include=rops')
            ? [
                { rop: 'Sevinch', customers: 412 },
                { rop: 'Charos', customers: 188 },
              ]
            : [],
        }
      : url.includes('/insights/concentration')
        ? CONCENTRATION
        : url.includes('/insights/customers')
          ? FLOW
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

async function draw() {
  const view = render(
    <QueryClientProvider client={client()}>
      <CohortPage />
    </QueryClientProvider>,
  )
  await act(async () => {})
  return view
}

const picker = () => screen.getByLabelText('Kogortani jamoa boʻyicha kesish') as HTMLSelectElement

/**
 * Choose a team, the way a browser does — INSIDE one `act`.
 *
 * `fireEvent.change(el, { target: { value } })` does not work on this control
 * and the reason is worth writing down: `fireEvent` flushes React's pending
 * work before it dispatches, the select is CONTROLLED, and that flush
 * re-renders it back to the value the props still hold. The handler then fires
 * with an empty string — silently, so the test reads as «the cut did not
 * happen» when what actually happened is that the harness undid the choice.
 *
 * Assigning and dispatching inside a single `act` leaves no flush in between,
 * which is what a real change event has.
 */
/**
 * Reach for the picker, and wait for the options to actually be there.
 *
 * A COUNTED NUMBER OF FLUSHES DOES NOT WORK HERE, and the failure it gives is
 * the quiet kind. The focus enables the options query; the response then has
 * to cross `fetch`, `res.json()` and TanStack's own scheduling before the
 * `<option>`s exist, which is more microtask turns than any fixed number of
 * `act` calls is honestly asserting. Short, the control still holds
 * «yuklanmoqda…», `pick` selects nothing, and the test reads as «the cut did
 * not happen».
 */
async function openPicker(): Promise<void> {
  fireEvent.focus(picker())
  await waitFor(() =>
    expect([...picker().options].some((option) => option.value === 'Sevinch')).toBe(true),
  )
}

async function pick(value: string): Promise<void> {
  await act(async () => {
    const el = picker()
    /*
      A SELECT CANNOT TAKE A VALUE IT HAS NO OPTION FOR, and jsdom does not
      complain — it leaves the value at ''. The handler then fires with the
      empty string, the page reads it as «Butun kompaniya», and every
      assertion afterwards fails as «the cut did not happen». It cost an hour
      once; it says so now.
    */
    expect([...el.options].map((option) => option.value)).toContain(value)
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  requested = []
  /* A bare address. This used to carry `?mode=detail`, because the matrix and
     its controls only existed under «Batafsil»; that reading is the only one
     left and the parameter no longer means anything. Reset anyway — every
     case here reads `?rop=` out of this same URL, and a test that inherits
     the previous one's query string passes for the wrong reason. */
  window.history.replaceState(null, '', '/analytics/cohort')
  vi.stubGlobal('fetch', mockFetch())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the cohort matrix, cut by acquiring team', () => {
  it('asks for nothing about teams until somebody reaches for the picker', async () => {
    await draw()

    expect(matrixReads()).toHaveLength(1)
    expect(matrixReads()[0]).not.toContain('rop=')
    expect(listReads()).toHaveLength(0)

    /* The control is on screen the whole time — a reader arriving on a shared
       link needs the way back to the company view before any list loads. */
    expect(picker()).toBeDefined()
    expect(picker().value).toBe('')
  })

  it('fetches the team list on the first reach, and only once', async () => {
    await draw()

    await openPicker()

    expect(listReads()).toHaveLength(1)
    /* Listing the teams must not re-read the matrix: it asks for the smallest
       window the route accepts precisely because its own matrix is discarded. */
    expect(matrixReads()).toHaveLength(1)
    expect(listReads()[0]).toContain('months=3')

    fireEvent.focus(picker())
    await act(async () => {})
    expect(listReads()).toHaveLength(1)
  })

  it('re-reads the matrix under its own key and writes the team into the URL', async () => {
    await draw()
    await openPicker()
    await pick('Sevinch')

    expect(matrixReads()).toHaveLength(2)
    expect(matrixReads()[1]).toContain('rop=Sevinch')
    expect(new URL(window.location.href).searchParams.get('rop')).toBe('Sevinch')
  })

  /*
    THE BANNER IS BUILT FROM THE RESPONSE, NOT FROM THE CONTROL.

    Both say «Sevinch» once the read lands, so a test that only looked at the
    end state would pass either way. What separates them is that the banner is
    ABSENT on the company view — where the control also holds nothing — and
    present with the team's name the moment rows carrying it arrive.
  */
  it('names the cut only while cut rows are on screen', async () => {
    await draw()
    expect(screen.queryByText(/birinchi marta sotgan mijozlar/)).toBeNull()

    await openPicker()
    await pick('Sevinch')

    /* WAITED FOR, and the wait is the claim. The banner appears when the CUT
       ROWS do, not when the control changes — so there is a render in between
       where the control says «Sevinch» and the banner is still absent. A test
       that read it synchronously would be asserting the opposite property. */
    const banner = await waitFor(() => screen.getByText(/birinchi marta sotgan mijozlar/))
    expect(banner.textContent).toContain('Sevinch')
    /* The sentence a reader would otherwise get backwards: a return is NOT
       re-attributed to whoever sold it. */
    expect(banner.textContent).toContain('kim mijoz olib keladi')
  })

  it('returns to the company view from cache, without a third read', async () => {
    await draw()
    await openPicker()
    await pick('Sevinch')
    expect(matrixReads()).toHaveLength(2)

    await pick('')

    /* The company answer is still in its own entry, so this costs nothing —
       which is the point of keying on the team rather than refetching one key. */
    expect(matrixReads()).toHaveLength(2)
    expect(new URL(window.location.href).searchParams.get('rop')).toBeNull()
    expect(screen.queryByText(/birinchi marta sotgan mijozlar/)).toBeNull()
  })
})
