// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NutritionistCard } from '@/features/kpi/NutritionistCard'

/** «Нутрицолог» on «KPI rejalari»: Collagen and Zextra, each FAKT 1 / FAKT 2 on both systems, priced. */

afterEach(cleanup)

vi.mock('@/features/shared/useDashboardFilters', () => ({
  useDashboardFilters: () => ({ apiParams: { preset: 'this_month' } }),
}))

const answer = vi.hoisted(() => ({ refuse: false }))
const count = (bitrix: number, moysklad: number) => ({ bitrix, moysklad, bitrixUsd: bitrix * 2, moyskladUsd: moysklad * 2 })

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: async () => {
      if (answer.refuse) throw new actual.ApiClientError('FORBIDDEN', 'Ruxsat yoʻq', 403)
      return {
        data: {
          usdPerOrder: 2,
          brands: [
            { brand: 'Collagen', fakt1: count(100, 98), fakt2: count(60, 60) },
            { brand: 'Zextra', fakt1: count(40, 41), fakt2: count(25, 25) },
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
      <NutritionistCard />
    </QueryClientProvider>,
  )
}

describe('NutritionistCard', () => {
  it('prints each brand under its own heading, FAKT 1 and FAKT 2 with both counts, the gap and the dollars', async () => {
    answer.refuse = false
    mount()
    // The brand heading now carries a «mos» / «N farq» chip, so the label is a prefix.
    const collagen = await screen.findByRole('rowheader', { name: /^Collagen/ })
    const zextra = screen.getByRole('rowheader', { name: /^Zextra/ })
    const collagenRows = within(collagen.closest('tbody') as HTMLElement).getAllByRole('row')
    const zextraRows = within(zextra.closest('tbody') as HTMLElement).getAllByRole('row')
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)
    expect(collagenRows).toHaveLength(3)
    // A gap prints as a magnitude beside a drawn ▲/▼ (no sign in the text); a
    // reconciled row is a muted «—».
    expect(cells(collagenRows[1])).toEqual(['100', '98', '2', '200 $', '196 $'])
    expect(cells(collagenRows[2])).toEqual(['60', '60', '—', '120 $', '120 $'])
    expect(cells(zextraRows[1])).toEqual(['40', '41', '1', '80 $', '82 $'])
    expect(cells(zextraRows[2])).toEqual(['25', '25', '—', '50 $', '50 $'])
    expect(within(zextraRows[1]).getByRole('rowheader').textContent).toBe('FAKT 1')
    // Each brand here has one FAKT off and one matching, so both read «1 farq».
    expect(collagen.textContent).toContain('1 farq')
    expect(zextra.textContent).toContain('1 farq')
    expect(screen.getByText('Нутрицолог · Collagen va Zextra')).toBeTruthy()
  })

  it('draws nothing for an account the endpoint refuses', async () => {
    answer.refuse = true
    const { container } = mount()
    // While loading the card's title is drawn; only the refusal empties it.
    expect(container.textContent).toContain('Нутрицолог')
    await vi.waitFor(() => expect(container.innerHTML).toBe(''))
  })
})
