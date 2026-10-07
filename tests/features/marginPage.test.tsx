// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Yalpi marja»'s product table, which reads everything it filters and sorts
 * in the browser off one period-only payload.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/margin',
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

const { MarginPage } = await import('@/features/margin/MarginPage')

const money = (amount: number) => ({ amount, amountMinor: String(amount * 100), currency: 'UZS' })

function product(id: string, name: string, discount: number, overList: number) {
  return {
    productId: id,
    productName: name,
    units: 1,
    revenue: money(50_000_000),
    discount: money(discount),
    overList: money(overList),
    cost: null,
    gross: null,
    margin: null,
  }
}

/*
  B arrives first, the way the server sorts — by revenue. A gave away five
  times as much AND sold 9 mln over list on other lines: the row that a sort
  on «giveaway less markup» (1 mln against B's 2 mln) put second.
*/
const MARGIN = {
  rows: [
    product('b', 'Mahsulot B', 2_000_000, 0),
    product('a', 'Mahsulot A', 10_000_000, 9_000_000),
  ],
  revenue: money(100_000_000),
  costedRevenue: money(0),
  gross: money(0),
  discount: money(12_000_000),
  overList: money(9_000_000),
  margin: 0,
  coverage: 0,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.history.replaceState(null, '', '/margin')
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: Infinity } },
  })
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: MARGIN,
      meta: { dataSource: 'DEMO', generatedAt: '2026-10-06T06:00:00.000Z' },
    }),
  }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** One client per case, so a re-render reads the same cache rather than a fresh one. */
let client: QueryClient

function page() {
  return (
    <QueryClientProvider client={client}>
      <MarginPage />
    </QueryClientProvider>
  )
}

/** The product names in the order the table draws them. */
const productOrder = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).queryByText(/^Mahsulot /)?.textContent ?? '')
    .filter(Boolean)

describe('the search box', () => {
  /*
    IT COSTS NO REQUEST. The endpoint is period-only and the box narrows the
    table in the browser, but the search term rode `apiParams` into the key —
    so every committed term re-ran the whole-window aggregate for an identical
    payload, and the page dimmed while it did.
  */
  it('narrows the table without asking the server again', async () => {
    window.history.replaceState(null, '', '/margin?q=mahsulot')
    const view = render(page())
    await screen.findByText('Mahsulot A')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('q=')

    window.history.replaceState(null, '', '/margin?q=mahsulot+a')
    view.rerender(page())
    await screen.findByText('Mahsulotlar · 1 / 2')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(productOrder()).toEqual(['Mahsulot A'])
  })
})

describe('the «Chegirma» sort', () => {
  it('ranks on the giveaway alone, never on the giveaway less the markup', async () => {
    render(page())
    await screen.findByText('Mahsulot A')

    fireEvent.click(screen.getByRole('button', { name: 'Chegirma' }))

    /* A new column opens descending — «biggest giveaway first». */
    expect(productOrder()).toEqual(['Mahsulot A', 'Mahsulot B'])
  })
})
