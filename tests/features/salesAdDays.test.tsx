// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdSalesDaysDto } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'
import { type Viewer, ViewerProvider } from '@/lib/viewer'

/**
 * «Kunlar boʻyicha» on Savdo dinamikasi: drawn for a company-wide account
 * only (its endpoint refuses anyone else), directly above the sellers' table,
 * and still drawn when the board itself fails — it is its own request.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/analytics/sales',
  useSearchParams: () => new URLSearchParams(''),
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

// The table measures its pinned column; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

const DAYS: AdSalesDaysDto = {
  rows: [
    { date: '2026-10-04', spendUsd: 1234.5, fakt1: 4_800_000, primary: 3_200_000, base: 1_600_000 },
    { date: '2026-10-05', spendUsd: 10, fakt1: 1_000_000, primary: 1_000_000, base: 0 },
  ],
  total: { spendUsd: 1244.5, fakt1: 5_800_000, primary: 4_200_000, base: 1_600_000 },
  openDay: '2026-10-05',
}

let boardFails = false
const requested: string[] = []

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: async (path: string) => {
      requested.push(path)
      if (path === '/analytics/ad-sales-days') return { data: DAYS, meta: {} }
      if (boardFails) throw new Error('board down')
      return {
        data: {
          rows: [],
          teams: [],
          totals: { ordered: { amount: 0 }, won: { amount: 0 } },
          forecast: { elapsedPercent: 100, windowEnd: '2026-10-06T00:00:00Z', fakt1: null, fakt2: null, buckets: [] },
        },
        meta: {},
      }
    },
  }
})

const { ForecastSection } = await import('@/features/sales/ForecastSection')

function viewer(dataScope: Viewer['dataScope']): Viewer {
  return { userId: 'u', role: 'ADMIN', sections: ['sales'], dataScope, canManageUsers: false }
}

function mount(v: Viewer | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ViewerProvider value={v}>
        <ForecastSection />
      </ViewerProvider>
    </QueryClientProvider>,
  )
}

describe('«Kunlar boʻyicha»', () => {
  it('draws the five columns for a company-wide account, above the sellers', async () => {
    boardFails = false
    mount(viewer('ALL'))
    const heading = await screen.findByText('Kunlar boʻyicha · reklama va FAKT 1')
    expect(await screen.findByText('04.10.2026')).toBeTruthy()
    for (const h of ['Сана', 'Реклама жами, $', 'Жами савдо факт1', 'Первичка', 'База']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    }
    expect(screen.getByText(formatFullUzs(4_800_000))).toBeTruthy()
    expect(screen.getByText('Жами')).toBeTruthy()
    // Today is marked as still arriving.
    expect(screen.getByText(/kun hali yopilmagan/)).toBeTruthy()
    const sellers = screen.getByText('Sotuvchilar boʻyicha · hozirgi va prognoz')
    expect(heading.compareDocumentPosition(sellers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(['TEAM', 'OWN'] as const)('is not drawn, nor asked for, for a %s account', async (scope) => {
    boardFails = false
    requested.length = 0
    mount(viewer(scope))
    await screen.findByText('Sotuvchilar boʻyicha · hozirgi va prognoz')
    expect(screen.queryByText('Kunlar boʻyicha · reklama va FAKT 1')).toBeNull()
    expect(requested).not.toContain('/analytics/ad-sales-days')
  })

  it('survives a failed board', async () => {
    boardFails = true
    mount(viewer('ALL'))
    expect(await screen.findByText('04.10.2026')).toBeTruthy()
  })
})
