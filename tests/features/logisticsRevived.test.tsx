// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «REFUSED, THEN DELIVERED ANYWAY» IS NOT A PART OF «Отказ».
 *
 * The six columns are each order's CURRENT stage. `revived` is a delivery
 * that came after the order's LAST refusal, so the order cannot be standing
 * in a refusal stage — it was never one of the Отказ orders. The line used to
 * read «Отказ koʻrsatgan yoʻqotishdan N tasi … yetkazilgan», and a manager
 * who took N off Отказ understated the loss by exactly N. This pins the
 * sentence the other way round — and pins that it names no column it cannot
 * vouch for: the count is every such FAKT 1 order, and one moved on after its
 * delivery is not in Успешно.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/logistics',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ children }: { children?: unknown }) => <div>{children as React.ReactNode}</div>,
}))

// DataTable measures its pinned columns; jsdom has no layout to observe.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

// jsdom has no `matchMedia`; «reduced» prints every animated figure at once.
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

const { LogisticsPage } = await import('@/features/logistics/LogisticsPage')

const money = (amount: number) => ({ amount, amountMinor: String(amount * 100), currency: 'UZS' })

/** An otherwise quiet window: 12 orders refused and then delivered anyway. */
const LOGISTICS = {
  summary: {
    cohortOrders: 100,
    orderedOrders: 90,
    ordered: money(90_000_000),
    wonOrders: 60,
    won: money(60_000_000),
    coveragePercent: 66.7,
    buckets: [],
    unbucketedOrders: 0,
    unroutedOrders: 0,
    offRevenueOrders: 0,
    revivedOrders: 12,
    revived: money(4_800_000),
    medianDays: 3.5,
  },
  waits: [],
  standing: { cohort: [], all: [], orders: [] },
  days: [],
  rops: [],
  ropTotal: null,
  posts: [],
  regions: [],
  reconciliation: [],
}

beforeEach(() => {
  window.history.replaceState(null, '', '/logistics')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: LOGISTICS,
        meta: { dataSource: 'DEMO', generatedAt: '2026-10-06T06:00:00.000Z' },
      }),
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the revived-orders line on Logistika', () => {
  it('says the orders sit outside «Отказ», never that they are part of its loss', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: Infinity } },
          })
        }
      >
        <LogisticsPage />
      </QueryClientProvider>,
    )

    const line = (await screen.findByText(/avval rad etilgan/)).closest('p')
    expect(line).not.toBeNull()
    const text = line?.textContent ?? ''

    expect(text).toContain('12 ta buyurtma')
    expect(text).toMatch(/Отказ ustunida emas/)
    expect(text).toMatch(/hozirgi bosqichi boʻyicha sanalgan/)
    /* Not «Успешно ichida»: an order delivered after its refusal and then
       moved to «База», or back to another Доставка stage, is in that column
       and still in this count, so the claim would be false for it. */
    expect(text).not.toMatch(/Успешно/)
    /* The old claim — that N of Отказ's loss was delivered — is the reading
       that led a reader to subtract N from a column it was never in. */
    expect(text).not.toMatch(/yoʻqotishdan/)
  })
})
