// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SideColumnDto } from '@/features/reklama/reklamaApi'
import { SideSection } from '@/features/reklama/SideSection'

/**
 * «HR · KOSMETIKA» AS ONE MORE TARGETOLOG CARD (2026-10-07).
 *
 * It was a sticky aside printing «9.12 $» beside sheets that print «$9,12».
 * The card reads like «Targetologlar · kunlik»: the sheet's dollars, «06.10»
 * dates, the period's total above the days, and a «Jami $» column.
 */

const side: SideColumnDto[] = [
  {
    key: 'hr',
    name: 'HR',
    totalUsd: 21.6,
    days: [
      { date: '2026-10-05', spendUsd: 12.48 },
      { date: '2026-10-06', spendUsd: 9.12 },
    ],
  },
  {
    key: 'kosmetika',
    name: 'Kosmetika',
    totalUsd: 5.76,
    days: [
      { date: '2026-10-05', spendUsd: 5.76 },
      { date: '2026-10-06', spendUsd: 0 },
    ],
  },
]

const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)

describe('SideSection', () => {
  it('prints the server totals first, then the days, each with its own sum', () => {
    render(<SideSection side={side} status="ready" brand="all" />)
    const table = screen.getByRole('table', { name: 'HR · Kosmetika — kunlik' })
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Sana', 'HR $', 'Kosmetika $', 'Jami $'])

    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByRole('rowheader').textContent).toBe('Jami')
    expect(cellsOf(rows[0]!)).toEqual(['$21,6', '$5,76', '$27,4'])
    expect(within(rows[1]!).getByRole('rowheader').textContent).toBe('05.10')
    expect(cellsOf(rows[1]!)).toEqual(['$12,5', '$5,76', '$18,2'])
    // A day with no Kosmetika spend is a dash, as the sheet leaves it blank.
    expect(cellsOf(rows[2]!)).toEqual(['$9,12', '—', '$9,12'])
  })

  it('says so under one brand instead of drawing empty rows', () => {
    render(<SideSection side={side} status="ready" brand="Collagen" />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Brend boʻyicha ajratilmaydi')).toBeTruthy()
  })

  it('draws an empty state for a window with no days', () => {
    render(<SideSection side={side.map((c) => ({ ...c, days: [] }))} status="ready" brand="all" />)
    expect(screen.getByText('Bu davrda maʼlumot yoʻq')).toBeTruthy()
  })
})
