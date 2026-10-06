// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LogisticsDto, SellerBoardDto } from '@/lib/api'

/**
 * A FAILED BACKGROUND POLL KEEPS THE PAGE IT HAS.
 *
 * TanStack Query 5 keeps the last good `data` after a failed refetch and
 * still reports `isError`. Every page read `isError` alone, so two misses in
 * a row on the 120 s poll — a deploy restart, one statement timeout — put the
 * whole of Logistika and both columns of the floor's television behind
 * «Qayta urinish» for two minutes, with every figure still in memory. The
 * rule now lives in `statusOf`; these pin it on the two screens that are
 * left open on a wall, through the real page and a real query client.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/logistics',
  useSearchParams: () => new URLSearchParams(''),
}))

// The shell's header, filters and meta line are not what is under test.
vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

/* Reduced motion: `AnimatedNumber` prints its final figure on the first frame. */
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

beforeAll(() => {
  // DataTable's pinned columns and the record wall measure with one; jsdom has none.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const { LogisticsPage } = await import('@/features/logistics/LogisticsPage')
const { SellersPage } = await import('@/features/sellers/SellersPage')

const money = (amount: number) => ({ amount, amountMinor: String(amount * 100), currency: 'UZS' })

const LOGISTICS = {
  summary: {
    cohortOrders: 50,
    orderedOrders: 42,
    ordered: money(106_432_000),
    wonOrders: 31,
    won: money(80_000_000),
    coveragePercent: 75.2,
    buckets: [],
    unbucketedOrders: 0,
    unroutedOrders: 0,
    offRevenueOrders: 0,
    revivedOrders: 0,
    revived: money(0),
    medianDays: 4,
  },
  waits: [],
  standing: { cohort: [], all: [], orders: [] },
  days: [],
  rops: [],
  ropTotal: null,
  posts: [],
  regions: [],
  reconciliation: [],
} as unknown as LogisticsDto

const seller = (fullName: string, rank: number, won: number) => ({
  employeeId: fullName,
  rank,
  fullName,
  rop: 'Gulzora',
  orders: 3,
  wonOrders: 2,
  openOrders: 0,
  ordered: money(won * 2),
  won: money(won),
  sharePercent: null,
  conversionPercent: null,
  bonus: { earned: money(0), toNext: null, toNextPercent: null, eligible: false },
})

const BOARD = {
  rows: [
    seller('154 Marjona Xayrullayeva', 1, 126_950_000),
    seller('Saparboyeva 110 Farida', 2, 108_000_000),
  ],
  teams: [],
  totals: { orders: 99, wonOrders: 73, won: money(234_950_000), teamlessSellers: 0 },
} as unknown as SellerBoardDto

/** What the server answers, flipped by each test. */
let answer: 'ok' | 'fail' = 'ok'

beforeEach(() => {
  answer = 'ok'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (answer === 'fail') {
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Server xatosi' } }),
        }
      }
      const include = new URL(url, 'http://x').searchParams.get('include')
      const data = url.includes('/insights/logistics')
        ? LOGISTICS
        : include === 'medals'
          ? { sellers: [], from: '2026-08-01' }
          : include === 'records'
            ? { months: [] }
            : BOARD
      return {
        ok: true,
        status: 200,
        json: async () => ({ data, meta: { dataSource: 'DEMO', generatedAt: '2026-10-06T06:00:00.000Z' } }),
      }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function draw(page: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  render(<QueryClientProvider client={client}>{page}</QueryClientProvider>)
  return client
}

/** Every query on the page read again, as the 120 s poll does. */
async function poll(client: QueryClient) {
  await act(async () => {
    await client.refetchQueries()
    // TanStack hands the result to React on its next tick: let it land first.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('a failed background poll', () => {
  it('leaves Logistika on screen — the hero keeps its figures and no block turns into «Olinmadi»', async () => {
    const client = draw(<LogisticsPage />)
    await waitFor(() => expect(screen.getByText('42 ta buyurtma')).toBeTruthy())

    answer = 'fail'
    await poll(client)

    // The poll really failed: what is on screen is the answer held from before.
    expect(client.getQueryCache().findAll({ queryKey: ['logistics'] })[0]?.state.status).toBe('error')
    expect(screen.getByText('42 ta buyurtma')).toBeTruthy()
    expect(screen.getByText('31 ta buyurtma')).toBeTruthy()
    expect(screen.queryByText('Olinmadi')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Qayta urinish' })).toBeNull()
  })

  it('leaves the television board on screen — both podium names stay, no error card', async () => {
    const client = draw(<SellersPage />)
    await waitFor(() => expect(screen.getAllByText('154 Marjona Xayrullayeva').length).toBeGreaterThan(0))

    answer = 'fail'
    await poll(client)

    expect(client.getQueryCache().findAll({ queryKey: ['sellers', 'board'] })[0]?.state.status).toBe('error')
    expect(screen.getAllByText('154 Marjona Xayrullayeva').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Saparboyeva 110 Farida').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Qayta urinish' })).toBeNull()
  })

  it('still shows the error card when there was never anything to keep', async () => {
    answer = 'fail'
    draw(<LogisticsPage />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Qayta urinish' }).length).toBeGreaterThan(0))
    expect(screen.queryByText('42 ta buyurtma')).toBeNull()
  })
})
