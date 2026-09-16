// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE PAGE MAY NOT BE LEFT DIMMED BY A BAND IT IS NOT DRAWING.
 *
 * `PageShell`'s `stale` holds the WHOLE page at `opacity: 0.6` with
 * `aria-busy`, and it says one thing: the figures on screen still belong to
 * the previous window and better ones are on their way. It is therefore only
 * ever true of a query that is LIVE — something has to be able to resolve it.
 *
 * `/insights/concentration` is not live in both modes. It is `enabled: mode
 * === 'detail'`, and «Oddiy» is the default. What makes that dangerous is a
 * setting two files away: `src/app/providers.tsx` gives EVERY query in the
 * application `placeholderData: (previous) => previous`, and query-core applies
 * placeholder data whenever `data === undefined && status === 'pending'` —
 * with no `enabled` check at all (`queryObserver.js`). So a key change on a
 * DISABLED query sets `isPlaceholderData` and nothing can ever clear it.
 *
 * On 2026-09-15 that was reachable in three ordinary clicks — «Batafsil»,
 * «Oddiy», then a new period — and the DEFAULT mode of this screen sat at 60%
 * opacity, announced as busy, with no request outstanding.
 *
 * THE SCREEN HAS NO PERIOD CONTROL ANY MORE (`period={false}`, since the same
 * day: nothing on it reads a window, and the concentration band resolves its
 * own ninety days on the server), so the third click no longer exists and
 * the concentration key is a constant. That closes the path — as long as
 * nobody re-points `stale` at a query that is disabled in the default mode,
 * and nobody gives the band a key that can change under a disabled query.
 * Both are pinned below, one in the DOM and one in the source.
 */

/*
  The address bar IS `window.location`, as it is on a shallow route.

  `/analytics/cohort` is in `SHALLOW_ROUTES`, so `useDashboardFilters` writes
  the window with `history.replaceState` and reads it straight back — and in
  the browser that re-renders because Next patches `replaceState` to publish
  its router state. `next/navigation` is stubbed here, so the patch is put back
  by hand in `beforeEach`: without it the period control would write an address
  no component ever hears about, which is not the browser this page runs in.
*/
const address = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let version = 0
  return {
    subscribe(onChange: () => void) {
      listeners.add(onChange)
      return () => void listeners.delete(onChange)
    },
    snapshot: () => version,
    publish() {
      version += 1
      for (const listener of [...listeners]) listener()
    },
  }
})

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useRouter: () => ({ replace: () => {}, push: () => {} }),
    usePathname: () => '/analytics/cohort',
    useSearchParams: () => {
      useSyncExternalStore(address.subscribe, address.snapshot, address.snapshot)
      return new URLSearchParams(window.location.search)
    },
  }
})

/*
  jsdom has no `matchMedia`, and `AnimatedNumber` in the concentration tiles
  asks it whether the reader wants motion. «Reduced» renders the final figure
  on the first frame, which is what a test can read.
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

const { CohortPage } = await import('@/features/cohort/CohortPage')
/*
  THE REAL `Providers`, not a QueryClient assembled here.

  The defect lives in a DEFAULT — the application-wide `placeholderData` — so a
  client configured by this file would be the test asserting against its own
  fixture. This renders the page under exactly the client every screen runs
  under.
*/
const { Providers } = await import('@/app/providers')

/** A cohort row, with only the fields `toMatrixRow` and the two views read. */
function cohortRow(cohort: string, size: number, cumulative: (number | null)[]) {
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
    revenueTotal: { amount: 12_000_000, amountMinor: '1200000000', currency: 'UZS' },
    revenuePerCustomer: { amount: 500_000, amountMinor: '50000000', currency: 'UZS' },
    ageMonths: cumulative.length - 1,
  }
}

const COHORTS = {
  rows: [
    cohortRow('2025-08-01', 24, [0, 21, 29, 38, 54, 63, 67]),
    cohortRow('2025-09-01', 17, [0, 18, 35, 35, 41, 41, 53]),
    cohortRow('2025-10-01', 15, [0, 13, 27, 33, 47, 47, 60]),
  ],
  groups: [],
  baseCustomers: 120,
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

const META = {
  dataSource: 'DEMO',
  generatedAt: '2026-09-15T06:00:00.000Z',
  period: { start: '2026-09-01T00:00:00.000Z', end: '2026-09-16T00:00:00.000Z' },
}

/** Every `/api/v1` URL the page asked for, newest last. */
let requested: string[] = []

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    const concentration = url.includes('/insights/concentration')
    const data = url.includes('/insights/cohorts')
      ? COHORTS
      : concentration
        ? CONCENTRATION
        : {}
    return {
      ok: true,
      status: 200,
      json: async () => ({ data, meta: META }),
    } as unknown as Response
  })
}

/** The real `replaceState`, restored after each case. */
const nativeReplaceState = window.history.replaceState.bind(window.history)

beforeEach(() => {
  requested = []
  /*
    No remembered window: `useRestoreRememberedPeriod` would otherwise write
    one over the bare address this page opens on, and `rememberPeriod` writes
    one on every preset clicked below. This jsdom has no `localStorage` at all
    — `periodMemory` catches that and reads «never chosen» — so the clear is
    guarded rather than assumed.
  */
  window.localStorage?.clear()
  nativeReplaceState(null, '', '/analytics/cohort')
  address.publish()
  window.history.replaceState = ((...args: Parameters<typeof nativeReplaceState>) => {
    nativeReplaceState(...args)
    address.publish()
  }) as typeof window.history.replaceState
  vi.stubGlobal('fetch', mockFetch())
})

afterEach(() => {
  window.history.replaceState = nativeReplaceState
  vi.unstubAllGlobals()
})

/**
 * Let everything in flight land — generously.
 *
 * Several macrotasks rather than a microtask or two, because the negative
 * assertions below («the page is NOT dimmed») have to give the page every
 * chance to put itself right before they are read. A dim that is still there
 * after this is a dim with nothing left to clear it.
 */
async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function openPage() {
  return render(
    <Providers>
      <CohortPage />
    </Providers>,
  )
}

/** The block `stale` dims: `PageShell`'s own page container. */
function pageBody(container: HTMLElement) {
  const body = container.querySelector<HTMLElement>('.page-container')
  if (!body) throw new Error('PageShell drew no page container')
  return body
}

const isDimmed = (container: HTMLElement) => pageBody(container).style.opacity === '0.6'
const isBusy = (container: HTMLElement) =>
  pageBody(container).getAttribute('aria-busy') === 'true'

describe('«Oddiy» after a visit to «Batafsil»', () => {
  it('is readable — not dimmed and not busy — with nothing outstanding', async () => {
    /*
      The two clicks that are still possible. Before the page went dateless
      the third one dimmed «Oddiy» permanently; with a constant concentration
      key there is nothing left that could, and this is what says so.
    */
    const { container } = openPage()

    await screen.findByText(/Qancha yangi mijoz keladi\?/)
    expect(isDimmed(container)).toBe(false)

    // 1. «Batafsil» — the band fetches and caches under its constant key.
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))
    await screen.findByText(/10 ta eng yirik mijoz/)
    expect(isDimmed(container)).toBe(false)

    // 2. Back to the default reading. The query is disabled from here on.
    fireEvent.click(screen.getByRole('button', { name: 'Oddiy' }))
    await screen.findByText(/Qancha yangi mijoz keladi\?/)
    await settle()

    expect(isDimmed(container)).toBe(false)
    expect(isBusy(container)).toBe(false)
  })

  it('offers no period control to change the band’s window under a disabled query', async () => {
    openPage()
    await screen.findByText(/Qancha yangi mijoz keladi\?/)

    expect(screen.queryByRole('button', { name: 'Kecha' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bugun' })).toBeNull()
  })
})

describe('what keeps the path closed', () => {
  it('passes no `stale` to PageShell and keys the band on a constant', () => {
    /*
      STRUCTURAL, by reading the source: a `stale` prop pointed at a query
      that is disabled in the default mode is exactly the claim this file
      exists to keep off the page, and a key carrying `apiParams` is the one
      thing that could change under it.
    */
    const page = readFileSync('src/features/cohort/CohortPage.tsx', 'utf8')

    expect(page).not.toMatch(/\bstale=/)
    expect(page).toMatch(/period=\{false\}/)
    expect(page).toMatch(/queryKey: \['concentration', 'trailing-90'\]/)
    expect(page).not.toMatch(/\['concentration', apiParams\]/)
  })

  it('keeps the application-wide placeholderData the cases above stand on', () => {
    /*
      THE DEFAULT THAT MADE THIS REACHABLE, asserted so the cases above cannot
      go quietly vacuous: query-core applies it on `data === undefined &&
      status === 'pending'` without consulting `enabled`.
    */
    const providers = readFileSync('src/app/providers.tsx', 'utf8')

    expect(providers).toMatch(/placeholderData:\s*<T,>\(previous: T\) => previous/)
  })
})
