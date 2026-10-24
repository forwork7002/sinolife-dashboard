// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PayrollFilters } from '@/features/payroll/payrollFilters'
import type { PayrollChoicesDto } from '@/lib/api'

/**
 * «Sotuvchilar oyligi»'s top panel (2026-10-24): «Boʻlim» · «ROP» · «Bosqich»
 * · «Oʻsish», written to the address. The «ROP» list follows the picked block
 * and keeps a stale link's team; «Oʻsish» needs a comparison window.
 */

const nav = vi.hoisted(() => ({ search: '' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/payroll',
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const CHOICES: PayrollChoicesDto = {
  blocks: [
    { branch: 'toshkent', label: 'Toshkent', sellers: 2 },
    { branch: 'navoiy', label: 'Navoiy', sellers: 2 },
    { branch: 'other', label: 'Boshqa', sellers: 1 },
  ],
  teams: [
    { rop: 'Sevinch', branch: 'toshkent', head: null, sellers: 1 },
    { rop: 'Marjona', branch: 'toshkent', head: null, sellers: 1 },
    { rop: 'Lola', branch: 'navoiy', head: 'Lola Head', sellers: 2 },
    { rop: null, branch: 'other', head: null, sellers: 1 },
  ],
}

function at(search: string) {
  nav.search = search
  window.history.replaceState(null, '', `/payroll?${search}`)
}

beforeEach(() => at('preset=this_month'))
afterEach(cleanup)

const options = () => screen.getAllByRole('option').map((option) => option.textContent)

describe('the payroll toolbar', () => {
  it('offers every block and team of the window, «ROP yoʻq» included', () => {
    render(<PayrollFilters choices={CHOICES} compared />)
    fireEvent.click(screen.getByRole('button', { name: /^ROP/ }))
    expect(options()).toEqual(['Sevinch · Toshkent · 1', 'Marjona · Toshkent · 1', 'Lola · Navoiy · 2', 'ROP yoʻq · Boshqa · 1'])
  })

  it('lists only the picked block’s teams, and still a team a link picked outside it', () => {
    at('preset=this_month&blocks=navoiy&rops=Sevinch')
    render(<PayrollFilters choices={CHOICES} compared />)
    fireEvent.click(screen.getByRole('button', { name: /^ROP/ }))
    expect(options()).toEqual(['Lola · Navoiy · 2', 'Sevinch'])
  })

  it('writes a pick to the address, the window kept', () => {
    render(<PayrollFilters choices={CHOICES} compared />)
    fireEvent.click(screen.getByRole('button', { name: /^Bosqich/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fiksasiz' }))
    const params = new URLSearchParams(window.location.search)
    expect(params.get('tiers')).toBe('nofixed')
    expect(params.get('preset')).toBe('this_month')
  })

  it('draws «Oʻsish» only with a comparison window', () => {
    render(<PayrollFilters choices={CHOICES} compared={false} />)
    expect(screen.queryByRole('button', { name: /^Oʻsish/ })).toBeNull()
    cleanup()
    render(<PayrollFilters choices={CHOICES} compared />)
    expect(screen.getByRole('button', { name: /^Oʻsish/ })).toBeTruthy()
  })

  it('counts what it will clear and clears the four, never the window', () => {
    at('preset=this_month&blocks=navoiy&rops=Lola&tiers=fixed&trend=up')
    render(<PayrollFilters choices={CHOICES} compared />)
    fireEvent.click(screen.getByRole('button', { name: 'Filtrlarni tozalash (4)' }))
    const params = new URLSearchParams(window.location.search)
    expect([...params.keys()]).toEqual(['preset'])
  })
})
