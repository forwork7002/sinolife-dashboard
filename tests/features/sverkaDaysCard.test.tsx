// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SverkaDaysCard } from '@/features/kpi/SverkaDaysCard'

/** «Kunlar boʻyicha · Bitrix24 ↔ MoySklad» on «KPI rejalari»: each day, opening onto its orders and their products. */

afterEach(cleanup)

vi.mock('@/features/shared/useDashboardFilters', () => ({
  useDashboardFilters: () => ({ apiParams: { preset: 'this_month' } }),
}))

const answer = vi.hoisted(() => ({ refuse: false, calls: [] as Record<string, unknown>[] }))
const side = (orders: number, pieces: number, amount: number) => ({ orders, pieces, amount })

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: async (path: string, params: Record<string, unknown>) => {
      answer.calls.push({ path, ...params })
      if (answer.refuse) throw new actual.ApiClientError('FORBIDDEN', 'Ruxsat yoʻq', 403)
      return {
        data: {
          days: [
            { day: '2026-10-21', bitrix: side(15, 40, 12_000_000), moysklad: side(14, 38, 11_200_000), mismatched: 2 },
            { day: '2026-10-20', bitrix: side(12, 31, 9_000_000), moysklad: side(12, 31, 9_000_000), mismatched: 0 },
          ],
          total: { day: null, bitrix: side(27, 71, 21_000_000), moysklad: side(26, 69, 20_200_000), mismatched: 2 },
          orders:
            params.day === '2026-10-21'
              ? [
                  {
                    dealId: '48219',
                    brand: 'Zextra',
                    queuedAt: '2026-10-21T06:00:00.000Z',
                    inBitrix: true,
                    inMoysklad: false,
                    verdict: 'noMoysklad',
                    bitrix: { stage: 'Тасдиклаш', amount: 800_000, seller: 'Dilnoza 212', rop: 'Malika' },
                    moysklad: null,
                    items: [{ key: 'zx', name: 'Zextra sure', bitrixQuantity: 1, moyskladQuantity: 0, bitrixAmount: 800_000, moyskladAmount: 0 }],
                  },
                  {
                    dealId: '48230',
                    brand: 'Collagen',
                    queuedAt: '2026-10-21T07:00:00.000Z',
                    inBitrix: true,
                    inMoysklad: true,
                    verdict: 'products',
                    bitrix: { stage: 'CARAVAN', amount: 1_600_000, seller: 'Zarnigor 230', rop: 'Shohjaxon' },
                    moysklad: { orderName: 'bx10043', state: 'В пути', amount: 1_600_000, moment: '2026-10-21T09:00:00.000Z' },
                    items: [
                      { key: 'om', name: 'Omega Sinolife 500', bitrixQuantity: 3, moyskladQuantity: 1, bitrixAmount: 0, moyskladAmount: 0 },
                      { key: 'cm', name: 'Collagen Marine Sinolife', bitrixQuantity: 2, moyskladQuantity: 2, bitrixAmount: 1_600_000, moyskladAmount: 1_600_000 },
                    ],
                  },
                ]
              : null,
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
      <SverkaDaysCard />
    </QueryClientProvider>,
  )
}

describe('SverkaDaysCard', () => {
  it('lists each day with both systems\' orders, pieces and soʻm, and the total', async () => {
    answer.refuse = false
    mount()
    const table = await screen.findByRole('table', { name: /Kunlar boʻyicha/ })
    const rows = within(table).getAllByRole('row')
    // header, two days, total
    expect(rows).toHaveLength(4)
    expect(within(rows[1]!).getByRole('button', { expanded: false })).toBeTruthy()
    expect(within(rows[1]!).getByText('2 farq')).toBeTruthy()
    expect(within(rows[2]!).getByText('mos')).toBeTruthy()
    expect(within(rows[3]!).getByText('Jami')).toBeTruthy()
    expect(within(rows[3]!).getByText('27')).toBeTruthy()
    expect(answer.calls.at(-1)).toMatchObject({ path: '/kpi/days', preset: 'this_month', basis: 'FAKT1', brand: 'all' })
  })

  it('opens a day onto its orders, each with its products on both sides', async () => {
    answer.refuse = false
    mount()
    fireEvent.click(await screen.findByRole('button', { expanded: false, name: /21/ }))
    const list = await screen.findByRole('list', { name: /buyurtmalari/ })
    expect(answer.calls.some((c) => c.day === '2026-10-21')).toBe(true)
    const [missing, short] = within(list).getAllByRole('listitem')
    expect(within(missing!).getByText('MoySkladʼda buyurtma yoʻq')).toBeTruthy()
    expect(within(missing!).getByRole('link', { name: 'Bitim #48219' }).getAttribute('href')).toContain('/crm/deal/details/48219/')
    expect(within(missing!).getByText('Sotuvchi: Dilnoza 212')).toBeTruthy()
    expect(within(missing!).getByText('ROP: Malika')).toBeTruthy()
    expect(within(short!).getByText('Tovar farqi')).toBeTruthy()
    const omega = within(short!).getByRole('row', { name: /Omega Sinolife 500/ })
    expect(within(omega).getByLabelText('farq −2')).toBeTruthy()
  })

  it('asks again for the other FAKT figure and brand', async () => {
    answer.refuse = false
    mount()
    await screen.findByRole('table', { name: /Kunlar boʻyicha/ })
    fireEvent.click(screen.getByRole('button', { name: 'FAKT 2' }))
    fireEvent.click(screen.getByRole('button', { name: /Zextra/ }))
    await screen.findByRole('table', { name: /Kunlar boʻyicha/ })
    expect(answer.calls.some((c) => c.basis === 'FAKT2' && c.brand === 'Zextra')).toBe(true)
  })

  it('draws nothing for an account without «Sverka»', async () => {
    answer.refuse = true
    const { container } = mount()
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe('')
  })
})
