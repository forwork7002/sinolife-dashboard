// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProductCompareCard } from '@/features/kpi/ProductCompareCard'

/** «Tovarlar · Bitrix24 ↔ MoySklad» on «KPI rejalari»: each brand's pieces per product, FAKT 1 or FAKT 2, with totals. */

afterEach(cleanup)

vi.mock('@/features/shared/useDashboardFilters', () => ({
  useDashboardFilters: () => ({ apiParams: { preset: 'this_month' } }),
}))

const answer = vi.hoisted(() => ({ refuse: false, calls: [] as unknown[][] }))
const product = (name: string, bitrixQuantity: number, moyskladQuantity: number, price = 800_000) => ({
  key: `name:${name}`,
  code: null,
  name,
  bitrixQuantity,
  bitrixAmount: bitrixQuantity * price,
  moyskladQuantity,
  moyskladAmount: moyskladQuantity * price,
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: async (...args: unknown[]) => {
      answer.calls.push(args.slice(0, 2))
      if (answer.refuse) throw new actual.ApiClientError('FORBIDDEN', 'Ruxsat yoʻq', 403)
      return {
        data: {
          brands: [
            {
              brand: 'Collagen',
              fakt1: [product('Collagen Marine Sinolife', 120, 118), product('Collagen Tabletka Sinolife', 30, 30)],
              fakt2: [product('Collagen Marine Sinolife', 70, 71)],
            },
            {
              brand: 'Zextra',
              // A kopeck apart: MoySklad's lines carry tiyin. No gap in whole soʻm.
              fakt1: [{ ...product('Zextra sure', 40, 40), moyskladAmount: 32_000_000.4 }],
              fakt2: [],
            },
          ],
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
      <ProductCompareCard />
    </QueryClientProvider>,
  )
}

const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)
const rowsOf = (brand: string) =>
  within(screen.getByRole('rowheader', { name: `${brand} buyurtmalari · jami` }).closest('tbody') as HTMLElement).getAllByRole('row')

describe('ProductCompareCard', () => {
  it('prints each brand\'s total on its heading row, then every product with both counts, the gap and the soʻm', async () => {
    answer.refuse = false
    answer.calls = []
    mount()
    await screen.findByRole('rowheader', { name: 'Collagen buyurtmalari · jami' })
    // The dashboard window only: the employee / department filters do not narrow it.
    expect(answer.calls[0]).toEqual(['/kpi/products', { preset: 'this_month' }])
    const collagen = rowsOf('Collagen')
    expect(collagen).toHaveLength(3)
    expect(cells(collagen[0])).toEqual(['150', '148', '-2', '120,000,000', '118,400,000', '-1,600,000'])
    expect(within(collagen[1]).getByRole('rowheader').textContent).toBe('Collagen Marine Sinolife')
    expect(cells(collagen[1])).toEqual(['120', '118', '-2', '96,000,000', '94,400,000', '-1,600,000'])
    expect(cells(collagen[2])).toEqual(['30', '30', '0', '24,000,000', '24,000,000', '0'])
    expect(cells(rowsOf('Zextra')[0])).toEqual(['40', '40', '0', '32,000,000', '32,000,000', '0'])
  })

  it('switches every brand to FAKT 2, and says so where a brand has none', async () => {
    answer.refuse = false
    mount()
    await screen.findByRole('rowheader', { name: 'Collagen buyurtmalari · jami' })
    fireEvent.click(screen.getByRole('button', { name: 'FAKT 2' }))
    expect(screen.getByRole('button', { name: 'FAKT 2' }).getAttribute('aria-pressed')).toBe('true')
    const collagen = rowsOf('Collagen')
    expect(collagen).toHaveLength(2)
    expect(cells(collagen[0]).slice(0, 3)).toEqual(['70', '71', '+1'])
    const zextra = rowsOf('Zextra')
    expect(cells(zextra[0]).slice(0, 3)).toEqual(['0', '0', '0'])
    expect(zextra[1].textContent).toBe('Bu davrda tovar yoʻq')
  })

  it('draws nothing for an account the endpoint refuses', async () => {
    answer.refuse = true
    const { container } = mount()
    expect(container.textContent).toContain('Tovarlar')
    await vi.waitFor(() => expect(container.innerHTML).toBe(''))
  })
})
