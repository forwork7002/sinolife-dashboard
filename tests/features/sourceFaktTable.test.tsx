// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

// DataTable measures its pinned columns; jsdom has no layout to observe.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

import { SourceTable } from '@/features/sales/SourceFaktTable'
import type { SellerSourceRowDto } from '@/lib/api'

/**
 * «Manbalar boʻyicha» — one ranked row per source, laid out like the teams
 * table above it (asked for on 2026-09-23).
 */
afterEach(cleanup)

const money = (amount: number) =>
  ({ amountMinor: String(amount * 100), currency: 'UZS', amount }) as SellerSourceRowDto['ordered']

function row(over: Partial<SellerSourceRowDto> & Pick<SellerSourceRowDto, 'rank' | 'name'>): SellerSourceRowDto {
  return {
    sourceId: over.name,
    sellers: 2,
    cohortOrders: 5,
    orders: 4,
    ordered: money(3_200_000),
    won: money(0),
    wonOrders: 0,
    open: money(3_200_000),
    lostAfterConfirm: money(0),
    rejectedOrders: 1,
    conversionPercent: null,
    fakt1SharePercent: 35.2,
    sharePercent: null,
    forecast: { fakt1: money(7_967_532), fakt2: null },
    ...over,
  }
}

const cells = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((tr) => [...tr.querySelectorAll('td, th')].map((c) => c.textContent ?? ''))

describe('SourceTable', () => {
  it('prints one row per source, in the order it is handed, with its place first', () => {
    render(
      <SourceTable
        status="ready"
        rows={[
          row({ rank: 1, name: 'Instagram' }),
          row({ rank: 2, name: 'CRM-форма' }),
          row({ rank: 3, name: null, sourceId: null }),
        ]}
      />,
    )

    const rows = cells()
    expect(rows.map((r) => r[0])).toEqual(['1', '2', '3'])
    expect(rows.map((r) => r[1])).toEqual(['Instagram', 'CRM-форма', 'Manba koʻrsatilmagan'])
  })

  it('carries the full row — counts, both facts, the projections and the shares', () => {
    render(<SourceTable status="ready" rows={[row({ rank: 1, name: 'Instagram' })]} />)

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'Oʻrin',
      'Manba',
      'Sotuvchi',
      'Navbatga tushgan',
      'FAKT 1',
      'Tasdiqlangan',
      'FAKT 1 prognoz',
      'FAKT 2',
      'FAKT 2 prognoz',
      'Yetkazilgan',
      'Yoʻlda',
      'Rad etildi',
      'Konversiya',
      'FAKT 1 ulushi',
      'FAKT 2 ulushi',
    ])

    const [cellsOfRow] = cells()
    expect(cellsOfRow).toContain('3,200,000')
    expect(cellsOfRow).toContain('7,967,532')
    expect(cellsOfRow).toContain('5 ta')
    expect(cellsOfRow).toContain('1 ta')
  })

  it('prints an em dash, never a zero, where there is nothing to project or divide', () => {
    render(<SourceTable status="ready" rows={[row({ rank: 1, name: 'Instagram' })]} />)

    const [r] = cells()
    // FAKT 2 prognoz, Konversiya, FAKT 2 ulushi.
    expect([r![8], r![12], r![14]]).toEqual(['—', '—', '—'])
  })

  it('says so when the period has no sources at all', () => {
    render(<SourceTable status="ready" rows={[]} />)
    expect(screen.getByText('Bu davrda manba boʻyicha maʼlumot yoʻq')).toBeTruthy()
  })
})
