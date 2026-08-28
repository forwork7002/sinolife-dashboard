/**
 * @vitest-environment jsdom
 *
 * The two bases on the roster and on one person's page.
 *
 * The third test is the one worth keeping longest. `/employees/{id}` builds its
 * response field by field and does not yet copy `closedCount` / `closedValue`
 * out of the row it already holds, so EmployeeDetailPage falls back to
 * `/analytics/employees` narrowed to that employee. These pin both halves of
 * that shim: it fires when the fields are missing, and it does NOT fire once
 * they arrive — so the day the route is fixed, this file says the fallback is
 * dead code and can go.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

window.matchMedia = ((q: string) => ({
  matches: false, media: q, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia
global.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
} as never

const apiGet = vi.fn()

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiGet: (...args: unknown[]) => apiGet(...args) }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/employees',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/features/shared/useDashboardFilters', () => ({
  useDashboardFilters: () => ({
    filters: {
      preset: 'this_month',
      employeeIds: [], departmentIds: [], stageIds: [], productIds: [], sourceIds: [],
      page: 1, pageSize: 25, sort: 'createdAtSource', order: 'desc',
    },
    update: () => {}, setPeriod: () => {}, reset: () => {},
    apiParams: { preset: 'this_month' },
    activeCount: 0,
  }),
}))

vi.mock('@/components/layout/Shell', () => ({
  Shell: ({ children }: { children: unknown }) => <div>{children as never}</div>,
}))

import { EmployeesPage } from '@/features/employees/EmployeesPage'
import { EmployeeDetailPage } from '@/features/employees/EmployeeDetailPage'

const money = (amount: number) => ({ amountMinor: String(amount * 100), currency: 'UZS', amount })

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
    preset: 'this_month', start: '2026-07-31T19:00:00.000Z', end: '2026-08-28T19:00:00.000Z',
    timeZone: 'Asia/Tashkent', days: 28,
  },
}

const FILTERS = {
  data: { employees: [], departments: [], products: [], sources: [], stages: [], lastSyncedAt: null },
  meta: { dataSource: 'BITRIX24', generatedAt: '' },
}

function empRow(over: Record<string, unknown>) {
  return {
    employeeId: 'a', fullName: 'Aziza', position: 'Sotuvchi', departmentName: 'Sotuv (ROP)',
    isActive: true, kpiAchievementPercent: null, teamSharePercent: 10,
    versusTeamAveragePercent: 120, revenueDelta: { kind: 'no_baseline' },
    current: {
      revenue: money(217_600_000), pipelineValue: money(10_000_000), averageDeal: money(4_700_000),
      dealsWon: 46, dealsLost: 4, dealsCreated: 60, dealsOpen: 10, conversionRatePercent: 92,
    },
    closedCount: 61, closedValue: money(190_100_000),
    ...over,
  }
}

function mount(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => apiGet.mockReset())

describe('employees pages — two bases', () => {
  it('roster shows both money totals and both columns', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/meta/filters') return Promise.resolve(FILTERS)
      return Promise.resolve({
        data: {
          rows: [empRow({}), empRow({ employeeId: 'b', fullName: 'Bekzod', closedCount: 0, closedValue: money(0) })],
          sellerCloseBasis: BASIS,
        },
        meta: META,
      })
    })

    mount(<EmployeesPage />)
    await waitFor(() => expect(screen.getAllByText('Aziza').length).toBeGreaterThan(0))

    expect(screen.getAllByRole('columnheader', { name: /Yetkazilgan tushum/ }).length).toBe(1)
    expect(screen.getAllByRole('columnheader', { name: /Yopgan summa/ }).length).toBe(1)
    expect(screen.getAllByRole('columnheader', { name: /Yetkazilgan bitim/ }).length).toBe(1)
    expect(screen.getAllByRole('columnheader', { name: /Yopgan bitim/ }).length).toBe(1)

    const text = document.body.textContent ?? ''
    // Both team totals as tiles, named apart.
    expect(text).toContain('Sotuvchi yopgan summa')
    expect(text).toContain('61 ta yopilgan bitim')
    // The page header names both bases, and PageShell adds the window.
    expect(text).toContain('yetkazib berilgan tushum va sotuvchining oʻzi yopgan bitimlar')
    expect(text).toContain('28-avg 2026')
    // Explainer once.
    expect(screen.getAllByText(/bir hodisa emas/).length).toBe(1)
  })

  it('one person: the close figures reach the page even though /employees/{id} omits them', async () => {
    const calls: string[] = []
    apiGet.mockImplementation((path: string, params: Record<string, string>) => {
      calls.push(path)
      if (path === '/meta/filters') return Promise.resolve(FILTERS)
      if (path === '/analytics/employees') {
        expect(params.employeeIds).toBe('a')
        return Promise.resolve({
          data: { rows: [{ employeeId: 'a', closedCount: 61, closedValue: money(190_100_000) }], sellerCloseBasis: BASIS },
          meta: META,
        })
      }
      // The detail route as it stands today: no closedCount, no closedValue.
      return Promise.resolve({
        data: {
          employee: { id: 'a', fullName: 'Aziza', position: 'Sotuvchi', departmentName: 'Sotuv (ROP)', isActive: true },
          current: {
            revenue: money(217_600_000), pipeline: money(10_000_000), averageDeal: money(4_700_000),
            dealsWon: 46, dealsLost: 4, dealsCreated: 60, dealsOpen: 10, conversionPercent: 92,
          },
          deltas: { revenue: { kind: 'no_baseline' }, dealsWon: { kind: 'no_baseline' } },
          teamSharePercent: 10, versusTeamAveragePercent: 120, kpiAchievementPercent: null,
          trend: [],
        },
        meta: META,
      })
    })

    mount(<EmployeeDetailPage employeeId="a" />)
    await waitFor(() =>
      expect(document.body.textContent ?? '').toContain('Sotuvchi yopgan summa'),
    )
    await waitFor(() => expect(calls).toContain('/analytics/employees'))

    const text = () => document.body.textContent ?? ''
    await waitFor(() => expect(text()).toContain('61 ta yopilgan bitim'))
    // Both money figures, named apart.
    expect(text()).toContain('Yetkazilgan tushum')
    expect(text()).toContain('Sotuvchi yopgan bitimlar')
    // The caption names the resolved stage and the caveat.
    expect(text()).toContain('Sotuvchi «Сделка успешна» bosqichiga oʻtkazgan bitimlar summasi.')
    expect(text()).toContain('Summa bitimning bugungi qiymati boʻyicha olinadi.')
  })

  it('one person: no second request once the detail route sends the fields', async () => {
    const calls: string[] = []
    apiGet.mockImplementation((path: string) => {
      calls.push(path)
      if (path === '/meta/filters') return Promise.resolve(FILTERS)
      return Promise.resolve({
        data: {
          employee: { id: 'a', fullName: 'Aziza', position: null, departmentName: null, isActive: true },
          current: {
            revenue: money(217_600_000), pipeline: money(0), averageDeal: null,
            dealsWon: 46, dealsLost: 4, dealsCreated: 60, dealsOpen: 10, conversionPercent: 92,
          },
          deltas: { revenue: { kind: 'no_baseline' }, dealsWon: { kind: 'no_baseline' } },
          teamSharePercent: 10, versusTeamAveragePercent: 120, kpiAchievementPercent: null,
          trend: [],
          closedCount: 61, closedValue: money(190_100_000),
        },
        meta: { ...META, sellerCloseBasis: BASIS },
      })
    })

    mount(<EmployeeDetailPage employeeId="a" />)
    await waitFor(() => expect(document.body.textContent ?? '').toContain('61 ta yopilgan bitim'))
    expect(calls).not.toContain('/analytics/employees')
  })
})
