// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RoistatCountersDto, RoistatDaysDto } from '@/features/roistat/roistatApi'
import { formatFullUzs } from '@/lib/format'
import { type Viewer, ViewerProvider } from '@/lib/viewer'

/**
 * «Kunlar boʻyicha» on Savdo dinamikasi — Roistat's «Дни» table, its columns
 * and its soʻm: drawn for a company-wide account only (its endpoint refuses anyone else), directly above the sellers' table,
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

function counters(fields: Partial<RoistatCountersDto>): RoistatCountersDto {
  return {
    spendUsd: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    metaLeads: 0,
    leads: 0,
    clean: 0,
    kval: 0,
    orders: 0,
    orderedUzs: 0,
    sold: 0,
    soldUzs: 0,
    newCustomers: 0,
    dealDaysSum: 0,
    dealCount: 0,
    ...fields,
  }
}

let DAYS: RoistatDaysDto
const WITH_RATE: RoistatDaysDto = {
  dim: 'days',
  columns: { meta: false, leads: true, spend: true, sales: true },
  // Oldest first on purpose: the newest-first order is the TABLE's, not the payload's.
  rows: [
    {
      key: '2026-10-04',
      label: '2026-10-04',
      account: null,
      ...counters({ spendUsd: 700, leads: 149, clean: 148, kval: 32, orders: 3, orderedUzs: 4_800_000, sold: 2, soldUzs: 3_200_000 }),
    },
    { key: '2026-10-05', label: '2026-10-05', account: null, ...counters({ spendUsd: 10, leads: 9, clean: 9, kval: 9 }) },
  ],
  total: counters({ spendUsd: 710, leads: 158, clean: 157, kval: 41, orders: 3, orderedUzs: 4_800_000, sold: 2, soldUzs: 3_200_000 }),
  rate: { uzsPerUsd: 12_000, date: '2026-10-05' },
  freshFrom: '2026-10-05',
}
DAYS = WITH_RATE

let boardFails = false
const requested: string[] = []

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: async (path: string) => {
      requested.push(path)
      if (path === '/analytics/sales-days') return { data: DAYS, meta: {} }
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
  it('draws Roistat\'s «Дни» columns, newest day first, above the sellers', async () => {
    boardFails = false
    mount(viewer('ALL'))
    const heading = await screen.findByText('Kunlar boʻyicha · Дни')
    expect(await screen.findByText('04.10.2026')).toBeTruthy()
    for (const h of ['Дни', 'Расход, сум', 'Лиды', 'Чистые', 'Качество', 'CPL, сум', 'Квал', 'QL %', 'CPQL, сум', 'Заказы, сум', 'Продажи, сум', 'Выкуп', 'CPO, сум', 'Ср.чек, сум', 'ROAS']) {
      expect(screen.getAllByRole('columnheader').some((th) => th.textContent?.startsWith(h))).toBe(true)
    }
    // Spend in soʻm on the CBU rate: 700 $ × 12 000.
    expect(screen.getByText(formatFullUzs(8_400_000))).toBeTruthy()
    expect(screen.getAllByText(formatFullUzs(3_200_000)).length).toBeGreaterThan(0)
    expect(screen.getByText('ИТОГО')).toBeTruthy()
    // Newest first: 05.10 is above 04.10.
    const newest = screen.getByText('05.10.2026')
    expect(newest.compareDocumentPosition(screen.getByText('04.10.2026')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The reference's «Дни» has no Meta group.
    for (const h of ['Показы', 'Частота', 'Клики', 'CTR', 'Лиды Meta']) {
      expect(screen.getAllByRole('columnheader').some((th) => th.textContent?.startsWith(h))).toBe(false)
    }
    expect(screen.getByText((_, el) => el?.tagName === 'P' && (el.textContent ?? '').includes(`kurs ${formatFullUzs(12_000)} soʻm (05.10.2026)`))).toBeTruthy()
    // A settling day is marked.
    expect(screen.getByText(/hali toʻliq emas/)).toBeTruthy()
    const sellers = screen.getByText('Sotuvchilar boʻyicha · hozirgi va prognoz')
    expect(heading.compareDocumentPosition(sellers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('adds the queue cohort\'s FAKT by team after ROAS, and says which day it is dated by', async () => {
    boardFails = false
    DAYS = {
      ...WITH_RATE,
      fakt: {
        byDay: { '2026-10-04': { fakt1PrimaryUzs: 61_500_000, fakt1BaseUzs: 9_250_000, fakt2PrimaryUzs: 40_750_000 } },
        total: { fakt1PrimaryUzs: 61_500_000, fakt1BaseUzs: 9_250_000, fakt2PrimaryUzs: 40_750_000 },
      },
    }
    mount(viewer('ALL'))
    await screen.findByText('04.10.2026')
    const heads = screen.getAllByRole('columnheader').map((th) => th.textContent ?? '')
    const at = (h: string) => heads.findIndex((text) => text.startsWith(h))
    expect(at('ROAS')).toBeGreaterThan(-1)
    expect(at('FAKT 1 · Первичка, сум')).toBeGreaterThan(at('ROAS'))
    expect(at('FAKT 1 · База, сум')).toBeGreaterThan(at('FAKT 1 · Первичка, сум'))
    expect(at('FAKT 2 · Первичка, сум')).toBeGreaterThan(at('FAKT 1 · База, сум'))
    // The day's cell and the ИТОГО row.
    for (const figure of [61_500_000, 9_250_000, 40_750_000]) expect(screen.getAllByText(formatFullUzs(figure))).toHaveLength(2)
    expect(screen.getByText((_, el) => el?.tagName === 'P' && (el.textContent ?? '').includes('FAKT ustunlari — buyurtma navbatga tushgan kun boʻyicha'))).toBeTruthy()
    // «Заказы» is the two FAKT 1 columns added — the day's cell and the ИТОГО row.
    expect(screen.getAllByText(formatFullUzs(61_500_000 + 9_250_000))).toHaveLength(2)
    expect(screen.getByText((_, el) => el?.tagName === 'P' && (el.textContent ?? '').includes('Заказы = FAKT 1 Первичка + FAKT 1 База'))).toBeTruthy()
    DAYS = WITH_RATE
  })

  it('draws no FAKT column for a payload without it', async () => {
    boardFails = false
    mount(viewer('ALL'))
    await screen.findByText('04.10.2026')
    expect(screen.getAllByRole('columnheader').some((th) => th.textContent?.startsWith('FAKT'))).toBe(false)
  })

  it('says so when the CBU rate is missing, and never calls a day with spend «нет расхода»', async () => {
    boardFails = false
    DAYS = { ...WITH_RATE, rate: null }
    mount(viewer('ALL'))
    expect(await screen.findByText(/CBU kursi olinmadi/)).toBeTruthy()
    expect(screen.queryByText('нет расхода')).toBeNull()
    DAYS = WITH_RATE
  })

  it.each(['TEAM', 'OWN'] as const)('is not drawn, nor asked for, for a %s account', async (scope) => {
    boardFails = false
    requested.length = 0
    mount(viewer(scope))
    await screen.findByText('Sotuvchilar boʻyicha · hozirgi va prognoz')
    expect(screen.queryByText('Kunlar boʻyicha · Дни')).toBeNull()
    expect(requested).not.toContain('/analytics/sales-days')
  })

  it('survives a failed board', async () => {
    boardFails = true
    mount(viewer('ALL'))
    expect(await screen.findByText('04.10.2026')).toBeTruthy()
  })
})
