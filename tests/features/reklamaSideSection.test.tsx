// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SideColumnDto } from '@/features/reklama/reklamaApi'
import { SideCard, hasSideSpend } from '@/features/reklama/SideSection'

/**
 * «HR · KOSMETIKA» AS THE LAST CARD OF THE TARGETOLOG STRIP (2026-10-07).
 *
 * It was a sticky aside printing «9.12 $» beside sheets that print «$9,12»,
 * then a section of its own. The card reads like «Targetologlar · kunlik»:
 * the sheet's dollars, «06.10» dates, the total above the days, «Jami $».
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

describe('SideCard', () => {
  it('prints the server totals first, then the days, each with its own sum', () => {
    render(<SideCard side={side} />)
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
})

describe('hasSideSpend — no card for a window with nothing to show', () => {
  it('is false with no answer yet, no days, or no money', () => {
    expect(hasSideSpend(undefined)).toBe(false)
    expect(hasSideSpend(side.map((c) => ({ ...c, days: [] })))).toBe(false)
    expect(hasSideSpend(side.map((c) => ({ ...c, totalUsd: 0 })))).toBe(false)
    expect(hasSideSpend(side)).toBe(true)
  })
})
