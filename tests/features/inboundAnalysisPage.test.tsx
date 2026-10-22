// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InboundAnalysisPage, numbersCsv } from '@/features/calls/InboundAnalysisPage'

/** «Kiruvchi tahlil» under «Qoʻngʻiroqlar»: the two groups, the days, the returning callers' silence, the numbers. */

afterEach(cleanup)

/*
  jsdom has no `matchMedia`, and `AnimatedNumber` inside the count tiles asks it
  whether the reader wants motion. Answering "reduced" prints each figure once.
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

vi.mock('@/features/shared/useDashboardFilters', () => ({
  useDashboardFilters: () => ({ apiParams: { preset: 'this_month' } }),
}))
vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}))

const outcome = (numbers: number, answered: number, calledBack: number, talked: number) => ({
  numbers,
  answered,
  calledBack,
  talked,
  lost: numbers - talked,
})

const row = (key: string, group: 'fresh' | 'returning', talked: boolean, silenceDays: number | null) => ({
  key,
  phone: `+998${key}`,
  tel: `+998${key}`,
  group,
  firstCallAt: '2026-10-21T05:30:00.000Z',
  calls: 2,
  answered: talked,
  calledBack: false,
  talked,
  silenceDays,
  contact: { name: 'Dilnoza', bitrixId: '777' },
  state: 'Первичный отдел · Янги лид',
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: async (path: string) => {
      if (path === '/insights/calls/analysis/numbers') {
        return {
          data: { rows: [row('901111111', 'fresh', true, null), row('902222222', 'returning', false, 54), row('903333333', 'returning', true, 20)] },
          meta: {},
        }
      }
      return {
        data: {
          days: [
            { day: '2026-10-21', calls: 672, numbers: 538, fresh: outcome(60, 40, 5, 45), returning: outcome(70, 30, 10, 40), unfinished: false },
            { day: '2026-10-22', calls: 120, numbers: 100, fresh: outcome(10, 8, 0, 8), returning: outcome(9, 4, 1, 5), unfinished: true },
          ],
          total: { calls: 792, numbers: 610, fresh: outcome(68, 47, 5, 52), returning: outcome(76, 33, 11, 44) },
          returning: {
            buckets: { d14_30: 50, m1_3: 26, m3_6: 0, m6: 0 },
            medianDays: 24,
            longestDays: 37,
            funnels: [
              { funnel: 'Первичный отдел', numbers: 40 },
              { funnel: 'Регистрация', numbers: 36 },
            ],
          },
          analysisFrom: '2026-09-30T19:00:00.000Z',
          historyFrom: '2026-09-14T19:00:00.000Z',
          floorApplied: false,
        },
        meta: {},
      }
    },
  }
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InboundAnalysisPage />
    </QueryClientProvider>,
  )
}

describe('InboundAnalysisPage', () => {
  it('prints each group\'s outcome to the end', async () => {
    mount()
    const table = await screen.findByRole('table', { name: 'Guruhlar boʻyicha natija' })
    const returning = within(table).getByRole('row', { name: /Қайта мурожат/ })
    expect(within(returning).getByText('76')).toBeTruthy()
    expect(within(returning).getByText('44 (58%)')).toBeTruthy()
    expect(within(returning).getByText('32')).toBeTruthy()
  })

  it('marks the unfinished day and adds the period\'s total', async () => {
    mount()
    const table = await screen.findByRole('table', { name: 'Kunlik jadval' })
    expect(within(table).getByText(/\*$/)).toBeTruthy()
    expect(within(table).getByText('Davr jami')).toBeTruthy()
  })

  it('lists the lost numbers first, and every number on «Hammasi»', async () => {
    mount()
    const list = await screen.findByRole('table', { name: 'Raqamlar roʻyxati' })
    await within(list).findByText('+998902222222')
    expect(within(list).queryByText('+998901111111')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hammasi' }))
    expect(await within(list).findByText('+998901111111')).toBeTruthy()
  })

  it('writes the CLAUDE.md\'s CSV, «;»-separated, with the contact link', () => {
    const csv = numbersCsv([row('902222222', 'returning', false, 54)])
    const [head, line] = csv.replace('﻿', '').split('\r\n')
    expect(head!.split(';')).toHaveLength(13)
    expect(line).toContain(';Қайта мурожат;2;yoʻq;yoʻq;yoʻq;54;777;Dilnoza;Первичный отдел · Янги лид;')
    expect(line!.endsWith('/crm/contact/details/777/')).toBe(true)
    expect(csv.startsWith('﻿')).toBe(true)
  })
})
