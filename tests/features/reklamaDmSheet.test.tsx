// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DmSheet } from '@/features/reklama/DmSheet'
import type { DmBlockDto, DmCellsDto } from '@/features/reklama/reklamaApi'

/**
 * THE «DM» SHEET'S DAY GRID, SIDE BY SIDE (2026-10-05).
 *
 * The client keeps «Итог» and every page next to each other, a row per day,
 * the period's total above the days. What the grid may not do: re-add the
 * days for a total (the server's totals are what the page table above prints)
 * or drop a page's day it has no row for.
 */

const cells = (o: Partial<DmCellsDto>): DmCellsDto => ({
  conversations: 0,
  leads: 0,
  qualified: 0,
  spendUsd: 0,
  costPerQualifiedUsd: null,
  qualifiedPercent: null,
  conversationToQualifiedPercent: null,
  costPerConversationUsd: null,
  ...o,
})

const dm: DmBlockDto = {
  // «Итог» prices a kval over the DM-money pages only (sinolifeuz here): 2 685 $ ÷ 649, not ÷ 753.
  total: cells({ leads: 4570, qualified: 753, qualifiedPercent: 16.5, spendUsd: 2685, costPerQualifiedUsd: 4.14 }),
  days: [
    { date: '2026-08-01', ...cells({ leads: 219, qualified: 35, qualifiedPercent: 16, spendUsd: 143, costPerQualifiedUsd: 4.61 }) },
    { date: '2026-08-02', ...cells({ leads: 224, qualified: 38 }) },
  ],
  pages: [
    {
      key: 'UC_1X1J24',
      name: 'sinolifeuz',
      product: 'Collagen',
      carriesDmSpend: true,
      total: cells({ leads: 3732, qualified: 649, spendUsd: 2685, costPerQualifiedUsd: 4.14 }),
      days: [{ date: '2026-08-01', ...cells({ leads: 171, qualified: 31 }) }],
    },
    {
      key: 'UC_0FMQ5Q',
      name: 'sinolife_otziv',
      product: 'Collagen',
      carriesDmSpend: false,
      total: cells({ leads: 409, qualified: 93 }),
      days: [],
    },
  ],
  products: [],
  unattributed: { spendUsd: 0, conversations: 0 },
}

describe('DmSheet', () => {
  it('puts «Итог» first and every page beside it, five columns each', () => {
    render(<DmSheet dm={dm} status="ready" />)
    const table = screen.getByRole('table')
    const groups = within(table).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup')
    expect(groups.map((g) => g.textContent)).toEqual(['Итог', 'sinolifeuz', 'sinolife_otziv'])
    expect(within(table).getAllByRole('columnheader', { name: 'Кол лид' })).toHaveLength(3)
    expect(within(table).getAllByRole('columnheader', { name: 'Цена за квал' })).toHaveLength(3)
  })

  it('prints the server totals above the days, never the days re-added', () => {
    render(<DmSheet dm={dm} status="ready" />)
    const totalRow = screen.getByRole('rowheader', { name: 'Jami' }).closest('tr')!
    const text = totalRow.textContent ?? ''
    expect(text).toContain('4.570')
    expect(text).toContain('3.732')
    expect(text).toContain('409')
  })

  it('draws one row per day, a page with no row that day as dashes', () => {
    render(<DmSheet dm={dm} status="ready" />)
    expect(screen.getByRole('rowheader', { name: '01.08' })).toBeTruthy()
    const day2 = screen.getByRole('rowheader', { name: '02.08' }).closest('tr')!
    // Итог has 224 leads; sinolifeuz and sinolife_otziv have no row on 02.08.
    expect(within(day2).getAllByText('—').length).toBeGreaterThanOrEqual(10)
  })

  it('says so when the window has no day', () => {
    render(<DmSheet dm={{ ...dm, days: [] }} status="ready" />)
    expect(screen.getByText('Bu davrda maʼlumot yoʻq')).toBeTruthy()
  })
})
