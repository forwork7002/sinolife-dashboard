/**
 * @vitest-environment jsdom
 *
 * SCRATCH PROBE — deleted after running. Mounts the real LeaderboardPage
 * against a stubbed apiGet to check the two bases render, switch and refuse.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

window.matchMedia = ((q: string) => ({
  matches: false, media: q, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const apiGet = vi.fn()

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiGet: (...args: unknown[]) => apiGet(...args) }
})

vi.mock('@/features/shared/useDashboardFilters', () => ({
  useDashboardFilters: () => ({
    filters: {
      preset: 'this_month',
      employeeIds: [], departmentIds: [], stageIds: [], productIds: [], sourceIds: [],
      page: 1, pageSize: 25, sort: 'createdAtSource', order: 'desc',
    },
    update: () => {},
    setPeriod: () => {},
    reset: () => {},
    apiParams: { preset: 'this_month' },
    activeCount: 0,
  }),
}))

vi.mock('@/components/layout/Shell', () => ({
  Shell: ({ children }: { children: unknown }) => <div>{children as never}</div>,
}))

import { LeaderboardPage } from '@/features/leaderboard/LeaderboardPage'

const money = (amount: number) => ({
  amountMinor: String(amount * 100),
  currency: 'UZS',
  amount,
})

function row(over: Record<string, unknown>) {
  return {
    rank: 1,
    tied: false,
    employeeId: 'e1',
    fullName: 'Aa',
    departmentName: 'Sotuv (ROP)',
    revenue: money(0),
    dealsWon: 0,
    conversionPercent: null,
    kpiAchievementPercent: null,
    closedCount: 0,
    closedValue: money(0),
    delta: { kind: 'no_baseline' },
    value: 0,
    ...over,
  }
}

const BASIS = {
  resolved: true,
  pipelineRoles: ['QUALIFICATION'],
  stages: [
    { id: 's1', name: 'Сделка успешна', externalId: 'C12:WON', pipelineName: 'Первичный отдел' },
  ],
  amountBasis: 'deal_current_amount',
}

const META = {
  dataSource: 'BITRIX24',
  generatedAt: '2026-08-28T06:00:00.000Z',
  period: {
    preset: 'this_month',
    start: '2026-07-31T19:00:00.000Z',
    end: '2026-08-28T19:00:00.000Z',
    timeZone: 'Asia/Tashkent',
    days: 28,
  },
  leaderboardScope: { scope: 'sellers', sellers: 203, excludedManagers: 17, excludedOther: 68 },
  sellerCloseBasis: BASIS,
}

const FILTERS = {
  data: {
    employees: [], departments: [], products: [], sources: [], stages: [], lastSyncedAt: null,
  },
  meta: { dataSource: 'BITRIX24', generatedAt: '' },
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LeaderboardPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  apiGet.mockReset()
})

describe('leaderboard — two bases', () => {
  it('offers six metrics, both columns, and a caption naming the resolved stage', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/meta/filters') return Promise.resolve(FILTERS)
      return Promise.resolve({
        data: [
          row({ rank: 1, employeeId: 'a', fullName: 'Aziza', revenue: money(217_600_000), dealsWon: 46, closedCount: 61, closedValue: money(190_100_000) }),
          row({ rank: 2, employeeId: 'b', fullName: 'Bekzod', revenue: money(135_300_000), dealsWon: 31, closedCount: 12, closedValue: money(41_000_000) }),
          row({ rank: 3, employeeId: 'c', fullName: 'Dilnoza', revenue: money(90_000_000), dealsWon: 20, closedCount: 25, closedValue: money(70_000_000) }),
          row({ rank: 4, employeeId: 'd', fullName: 'Eldor', revenue: money(0), dealsWon: 0, closedCount: 9, closedValue: money(30_000_000) }),
          row({ rank: 5, employeeId: 'e', fullName: 'Farrux' }),
        ],
        meta: META,
      })
    })

    mount()
    await waitFor(() => expect(screen.getAllByText('Aziza').length).toBeGreaterThan(0))

    for (const label of ['Yetkazilgan tushum', 'Yetkazilgan bitimlar', 'Yopgan bitimlar', 'Yopgan summa', 'Konversiya']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0)
    }
    expect(screen.queryByRole('button', { name: 'KPI bajarilishi' })).toBeNull()

    expect(screen.getAllByRole('columnheader', { name: 'Yetkazilgan tushum' }).length).toBe(1)
    expect(screen.getAllByRole('columnheader', { name: 'Yopgan summa' }).length).toBe(1)
    expect(screen.getAllByRole('columnheader', { name: 'Yetkazilgan bitim' }).length).toBe(1)
    expect(screen.getAllByRole('columnheader', { name: 'Yopgan bitim' }).length).toBe(1)

    const text = () => document.body.textContent ?? ''
    expect(text()).toContain('Yetkazib berilgan va tushum sifatida hisoblangan buyurtmalar puli.')
    expect(text()).toContain('28-avg 2026')

    expect(screen.getAllByText('Eldor').length).toBe(1)
    expect(screen.queryByText('Farrux')).toBeNull()
    expect(screen.getByText('Natijasiz sotuvchilar (1)')).toBeDefined()

    expect(screen.getAllByText(/bir hodisa emas/).length).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Yopgan bitimlar' }))
    await waitFor(() =>
      expect(text()).toContain('Sotuvchi «Сделка успешна» bosqichiga oʻtkazgan bitimlar soni.'),
    )
    expect(screen.getAllByRole('columnheader', { name: 'Yetkazilgan tushum' }).length).toBe(1)
    expect(screen.getAllByRole('columnheader', { name: 'Yopgan bitim' }).length).toBe(1)
  })

  it('refuses to rank an unresolved basis rather than printing id order', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/meta/filters') return Promise.resolve(FILTERS)
      return Promise.resolve({
        data: [
          row({ rank: 1, employeeId: 'a', fullName: 'Aziza', revenue: money(1_000_000), dealsWon: 2, closedCount: null, closedValue: null }),
        ],
        meta: { ...META, sellerCloseBasis: { ...BASIS, resolved: false, stages: [] } },
      })
    })

    mount()
    await waitFor(() => expect(screen.getAllByText('Aziza').length).toBeGreaterThan(0))

    expect(screen.queryByRole('button', { name: 'Yopgan bitimlar' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Yopgan summa' })).toBeNull()
    expect(screen.getAllByRole('columnheader', { name: 'Yetkazilgan tushum' }).length).toBe(1)
  })
})
