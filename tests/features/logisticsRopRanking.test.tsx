// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

// DataTable measures its pinned columns; jsdom has no layout to observe.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

import { RopSection } from '@/features/logistics/RopSection'
import type { LogisticsRopDto } from '@/lib/api'

/**
 * «ROP lar boʻyicha» AS A RANKING — asked for on 2026-09-19: a place number
 * per team, and the order switchable between FAKT 1, FAKT 2 and Qamrov.
 */
const money = (amount: number) => ({ amount, currency: 'UZS' }) as LogisticsRopDto['ordered']

const rop = (name: string, ordered: number, won: number): LogisticsRopDto => ({
  rop: name,
  orders: ordered > 0 ? 1 : 0,
  ordered: money(ordered),
  wonOrders: won > 0 ? 1 : 0,
  won: money(won),
  coveragePercent: ordered > 0 ? (won / ordered) * 100 : null,
})

const ROPS = [
  rop('Sadriddin', 14_400_000, 1_000_000),
  rop('(ROP yoʻq)', 9_000_000, 9_000_000),
  rop('Baza', 5_000_000, 5_000_000),
  rop('Gulzora', 5_000_000, 0),
  rop('Lola', 3_000_000, 3_000_000),
  rop('Maftuna', 0, 0),
]

const cell = (index: number) =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelectorAll('td, th')[index]?.textContent ?? '')

const places = () => cell(0)
const names = () => cell(1)

describe('RopSection ranking', () => {
  it('ranks on FAKT 1 by default, ties share a place, the sentinel and zeros go unnumbered', () => {
    render(<RopSection rops={ROPS} total={null} status="ready" onRetry={() => {}} />)
    expect(names()).toEqual(['Sadriddin', 'Baza', 'Gulzora', 'Lola', 'Maftuna', '(ROP yoʻq)'])
    expect(places()).toEqual(['1', '2', '2', '4', '—', '—'])
  })

  it('re-ranks on FAKT 2 and on Qamrov', () => {
    render(<RopSection rops={ROPS} total={null} status="ready" onRetry={() => {}} />)

    fireEvent.click(within(screen.getByRole('group')).getByRole('button', { name: 'FAKT 2' }))
    expect(names().slice(0, 3)).toEqual(['Baza', 'Lola', 'Sadriddin'])
    expect(places()).toEqual(['1', '2', '3', '—', '—', '—'])

    // Baza and Lola are both at 100% — ЗАКАЗ puts Baza first, and they share 1st.
    fireEvent.click(within(screen.getByRole('group')).getByRole('button', { name: 'Qamrov' }))
    expect(names().slice(0, 3)).toEqual(['Baza', 'Lola', 'Sadriddin'])
    expect(places().slice(0, 3)).toEqual(['1', '1', '3'])

    // The header is the same switch.
    fireEvent.click(screen.getByRole('button', { name: /ЗАКАЗ · FAKT 1/ }))
    expect(names()[0]).toBe('Sadriddin')
  })
})
