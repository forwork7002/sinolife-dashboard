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
 * The reachable path is three clicks, all of them ordinary:
 *
 *   1. «Batafsil» — the concentration query runs and caches under
 *      `['concentration', apiParams]`;
 *   2. «Oddiy» — the query is disabled again, still holding that data;
 *   3. a new period — `apiParams` changes, so the key changes, so the query
 *      has no data under the new key and is `pending`. `['cohorts']` carries
 *      no period, so nothing else on the screen reacts and nothing refetches.
 *
 * At that point the DEFAULT mode of this screen sat at 60% opacity, announced
 * as busy, with no request outstanding and no way back except pressing
 * «Batafsil» again. The gate on the query could not see it: the query was
 * correctly not running, and that was the problem.
 *
 * Both halves are pinned below: the page is not dimmed when the band is not on
 * screen, AND it still dims when it is — because dropping the prop outright
 * would also pass the first case while quietly deleting the one thing `stale`
 * is for.
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

const META = {
  dataSource: 'DEMO',
  generatedAt: '2026-09-15T06:00:00.000Z',
  period: { start: '2026-09-01T00:00:00.000Z', end: '2026-09-16T00:00:00.000Z' },
}

/** Every `/api/v1` URL the page asked for, newest last. */
let requested: string[] = []

/**
 * Concentration answers held in the hand, so the dimmed moment can be READ.
 *
 * In «Batafsil» the dim is real and transient — it lasts exactly as long as
 * the request under the new key. A mock that resolves in a microtask would
 * make the second case a race against the fetch it is measuring.
 */
let holdConcentration = false
let held: (() => void)[] = []

function releaseConcentration() {
  const waiting = held
  held = []
  for (const resolve of waiting) resolve()
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    const concentration = url.includes('/insights/concentration')
    if (concentration && holdConcentration) {
      await new Promise<void>((resolve) => held.push(resolve))
    }
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
  held = []
  holdConcentration = false
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

describe('the period control on «Mijoz qaytishi»', () => {
  it('leaves «Oddiy» readable after a visit to «Batafsil» and a new window', async () => {
    /*
      THE REACHABLE PATH, three ordinary clicks, on the mode this page opens
      on. Before the gate on `stale` the page ended this test at 60% opacity
      and `aria-busy="true"`, permanently: the concentration query is disabled
      in «Oddiy», so the placeholder state its new key produced had nothing
      able to clear it.
    */
    const { container } = openPage()

    await screen.findByText(/Qancha yangi mijoz keladi\?/)
    expect(isDimmed(container)).toBe(false)

    // 1. «Batafsil» — the band fetches and caches under this period's key.
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))
    await screen.findByText(/10 ta eng yirik mijoz/)

    // 2. Back to the default reading. The query is disabled from here on.
    fireEvent.click(screen.getByRole('button', { name: 'Oddiy' }))
    await screen.findByText(/Qancha yangi mijoz keladi\?/)

    // 3. A new window. `['concentration', apiParams]` gets a key it has never
    //    fetched — and, being disabled, never will.
    const before = requested.length
    fireEvent.click(screen.getByRole('button', { name: 'Kecha' }))
    await settle()

    // Nothing is outstanding: this is the page's resting state, not a moment
    // in a transition. If a request had gone out, the dim would be honest.
    expect(requested).toHaveLength(before)
    expect(screen.getByText(/Qancha yangi mijoz keladi\?/)).toBeDefined()

    expect(isDimmed(container)).toBe(false)
    expect(isBusy(container)).toBe(false)
  })

  it('still dims «Batafsil» while the band’s new window is in flight', async () => {
    /*
      THE OTHER HALF, so the first case cannot be satisfied by deleting the
      prop. In «Batafsil» the concentration band IS the period-scoped content
      of this screen, the query is live, and `placeholderData` means the
      previous window's shares stay on screen under the new window's control.
      Dimming is exactly what `stale` is for — and it clears when the answer
      lands.
    */
    const { container } = openPage()
    await screen.findByText(/Qancha yangi mijoz keladi\?/)

    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))
    await screen.findByText(/10 ta eng yirik mijoz/)
    expect(isDimmed(container)).toBe(false)

    holdConcentration = true
    fireEvent.click(screen.getByRole('button', { name: 'Kecha' }))
    await settle()

    // The previous window's figures are still on screen, so the page says so.
    expect(isDimmed(container)).toBe(true)
    expect(isBusy(container)).toBe(true)

    releaseConcentration()
    await settle()

    expect(isDimmed(container)).toBe(false)
    expect(isBusy(container)).toBe(false)
  })
})

describe('why a disabled query can go stale at all', () => {
  it('keeps the application-wide placeholderData the cases above stand on', () => {
    /*
      THE DEFAULT THAT MAKES THIS REACHABLE, asserted so the two cases above
      cannot go quietly vacuous.

      `stale={concentration.isPlaceholderData}` was once defended as harmless
      on the grounds that no `placeholderData` was configured. It is configured
      — globally, for every query in the product, in `providers.tsx` — and
      query-core applies it on `data === undefined && status === 'pending'`
      without consulting `enabled`. Delete this default and the cases above
      would still pass while testing nothing at all.
    */
    const providers = readFileSync('src/app/providers.tsx', 'utf8')

    expect(providers).toMatch(/placeholderData:\s*<T,>\(previous: T\) => previous/)
  })
})
