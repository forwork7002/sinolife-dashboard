// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type KpiSheetDto, type KpiSheetLine, kpiSheetCsv, matchOf, scopeLines, sheetGroups } from '@/features/kpi/kpiSheetApi'
import { KpiSheetTable } from '@/features/kpi/KpiSheetTable'
import { KpiSummary } from '@/features/kpi/KpiSummary'

/** «KPI jadvali» on «KPI rejalari»: the cards as a month, Bitrix24 against MoySklad, a column per day. */

afterEach(cleanup)

const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03']
const TODAY = '2026-10-02'

const value = (
  key: string,
  side: 'bitrix' | 'moysklad' | 'diff' | 'mismatch',
  days: (number | null)[],
  over: Partial<Extract<KpiSheetLine, { kind: 'value' }>> = {},
): KpiSheetLine => ({
  kind: 'value',
  key: `${key}:${side}`,
  label: side === 'bitrix' || side === 'mismatch' ? 'Buyurtmalar · FAKT 1' : '',
  side,
  unit: 'count',
  scope: 'all',
  basis: 'FAKT1',
  opens: side === 'bitrix' || side === 'mismatch',
  total: days.reduce<number>((n, v) => n + (v ?? 0), 0),
  days,
  ...over,
})

const LINES: KpiSheetLine[] = [
  { kind: 'title', key: 'all:title', label: 'Collagen + Zextra · jami', scope: 'all' },
  value('all:orders:FAKT1', 'bitrix', [40, 38, null]),
  value('all:orders:FAKT1', 'moysklad', [40, 37, null]),
  value('all:orders:FAKT1', 'diff', [0, -1, null]),
  value('all:amount:FAKT1', 'bitrix', [1_600_000, 0, null], { label: 'Summa · FAKT 1, soʻm', unit: 'uzs' }),
  value('all:amount:FAKT1', 'moysklad', [1_600_000, 0, null], { unit: 'uzs' }),
  value('all:amount:FAKT1', 'diff', [0, 0, null], { unit: 'uzs' }),
  value('all:mismatch', 'mismatch', [0, 1, null], { key: 'all:mismatch:FAKT1', label: 'Farqli buyurtmalar · FAKT 1' }),
  { kind: 'title', key: 'Zextra:title', label: 'Zextra', scope: 'Zextra' },
  value('Zextra:orders:FAKT1', 'bitrix', [5, 4, null], { scope: 'Zextra' }),
  value('Zextra:orders:FAKT1', 'moysklad', [5, 4, null], { scope: 'Zextra' }),
  value('Zextra:orders:FAKT1', 'diff', [0, 0, null], { scope: 'Zextra' }),
]

const rows = (side: string) => screen.getAllByRole('row').filter((r) => r.getAttribute('data-side') === side)

describe('KpiSheetTable', () => {
  it('heads a column per day after «Jami» and «Moslik», the month span in the corner', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const head = screen.getAllByRole('columnheader')
    expect(head[0]!.textContent).toContain('01.10.2026 – 03.10.2026')
    expect(head[1]!.textContent).toBe('Jami')
    expect(head[2]!.textContent).toBe('Moslik')
    expect(head.find((h) => h.getAttribute('aria-current') === 'date')!.textContent).toContain('02.10')
  })

  it('draws a figure as a pair — Bitrix24 over MoySklad — with no «Farq» row of its own', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    expect(rows('bitrix')).toHaveLength(3)
    expect(rows('moysklad')).toHaveLength(3)
    expect(rows('diff')).toHaveLength(0)
    expect(rows('mismatch')).toHaveLength(1)
  })

  it('names a figure once and marks it when its two systems disagree', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const [orders, amount] = rows('bitrix')
    expect(orders!.querySelector('[title="Bu oy Bitrix24 va MoySklad farq qiladi"]')).not.toBeNull()
    expect(amount!.querySelector('[title="Bu oy Bitrix24 va MoySklad farq qiladi"]')).toBeNull()
  })

  it('writes the gap in the MoySklad cell where it happened, and in the month', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const ms = rows('moysklad')[0]!
    // The month's «Jami» and 02.10 — Bitrix24 one order ahead; 01.10 agrees and carries none.
    expect(within(ms).getAllByLabelText('farq −1')).toHaveLength(2)
    const cells = within(ms).getAllByRole('cell')
    expect(cells[1]!.textContent).toBe('40')
    expect(cells[2]!.textContent).toContain('37')
  })

  it('says how much of the month agrees: the days’ gaps over Bitrix24’s figure', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const [orders, amount] = rows('bitrix')
    // 1 off 78 orders.
    expect(within(orders!).getAllByRole('cell')[1]!.textContent).toContain('98,7%')
    expect(within(amount!).getAllByRole('cell')[1]!.textContent).toContain('100%')
  })

  it('writes figures in full with the sheet’s dots, and leaves a day not lived yet empty', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const cells = within(rows('bitrix')[1]!).getAllByRole('cell')
    expect(cells[0]!.textContent).toBe('1.600.000')
    expect(cells[2]!.textContent).toBe('1.600.000')
    expect(cells[4]!.textContent).toBe('')
  })

  it('opens a lived day’s orders under the row’s brand and FAKT figure, from either system', () => {
    const onOpen = vi.fn()
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={onOpen} />)
    const zextra = rows('moysklad')[2]!
    fireEvent.click(within(zextra).getAllByRole('cell')[2]!)
    expect(onOpen).toHaveBeenCalledWith({ day: '2026-10-02', scope: 'Zextra', basis: 'FAKT1' })
    onOpen.mockClear()
    // A day not lived yet has nothing to open.
    fireEvent.click(within(zextra).getAllByRole('cell')[3]!)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('KpiSheetTable — reading it at a glance', () => {
  it('says in each block’s heading whether everything in it agrees', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: /Collagen \+ Zextra/ }).textContent).toContain('1 farq')
    expect(screen.getByRole('button', { name: /^Zextra/ }).textContent).toContain('mos')
  })

  it('folds a block away and opens it again', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const all = screen.getByRole('button', { name: /Collagen \+ Zextra/ })
    expect(all.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(all)
    expect(all.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryAllByRole('row').some((r) => r.textContent?.includes('Summa · FAKT 1'))).toBe(false)
    // The other brand's block is untouched.
    expect(rows('bitrix')).toHaveLength(1)
    fireEvent.click(all)
    expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('Summa · FAKT 1'))).toBe(true)
  })

  it('marks the date that holds a difference', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const flagged = screen.getAllByRole('columnheader').filter((h) => h.querySelector('[aria-label="Shu kuni Bitrix24 va MoySklad farq qiladi"]'))
    expect(flagged.map((h) => h.textContent)).toEqual([expect.stringContaining('02.10')])
  })

  it('marks every day cell with its column, for the crosshair', () => {
    const { container } = render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    expect(container.querySelectorAll('thead [data-c="1"]')).toHaveLength(1)
    // Three pairs of rows and the «Farqli buyurtmalar» row.
    expect(container.querySelectorAll('tbody [data-c="1"]')).toHaveLength(7)
  })

  it('spans every row across the header', () => {
    const { container } = render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const width = (tr: HTMLTableRowElement) => Array.from(tr.cells).reduce((acc, cell) => acc + (cell.colSpan || 1), 0)
    const columns = width(container.querySelector('thead tr') as HTMLTableRowElement)
    const body = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr'))
    for (const tr of body) {
      // The MoySklad row leaves its «Moslik» cell to the Bitrix24 row above (rowSpan 2).
      expect(width(tr) + (tr.getAttribute('data-side') === 'moysklad' ? 1 : 0)).toBe(columns)
    }
  })
})

describe('KpiSummary', () => {
  it('states the brand’s headline figures with their verdict before the sheet is read', () => {
    render(<KpiSummary lines={LINES} scope="all" />)
    const orders = screen.getByRole('heading', { name: 'Buyurtmalar · FAKT 1' }).closest('article')!
    expect(orders.textContent).toContain('78')
    expect(orders.textContent).toContain('77')
    expect(within(orders).getByTitle('Bitrix24ʼda koʻp').textContent).toContain('1')
    const amount = screen.getByRole('heading', { name: 'Summa · FAKT 1' }).closest('article')!
    expect(amount.textContent).toContain('mos')
    const mismatch = screen.getByRole('heading', { name: 'Farqli buyurtmalar' }).closest('article')!
    expect(mismatch.textContent).toContain('1 ta')
  })

  it('reads only the brand on screen', () => {
    render(<KpiSummary lines={LINES} scope="Zextra" />)
    expect(screen.getByRole('heading', { name: 'Buyurtmalar · FAKT 1' }).closest('article')!.textContent).toContain('9')
  })
})

describe('sheetGroups and matchOf', () => {
  it('folds each figure’s three lines into one pair, the «Farq» total kept', () => {
    const groups = sheetGroups(LINES)
    expect(groups.map((g) => g.kind)).toEqual(['title', 'pair', 'pair', 'single', 'title', 'pair'])
    const orders = groups[1] as Extract<ReturnType<typeof sheetGroups>[number], { kind: 'pair' }>
    expect(orders.key).toBe('all:orders:FAKT1')
    expect(orders.gaps).toEqual([0, -1, null])
    expect(orders.gapTotal).toBe(-1)
    expect(orders.differs).toBe(true)
  })

  it('does not let a gap one way cancel a gap the other way', () => {
    expect(matchOf([10, 10], [-1, 1], 'count')).toBe(90)
    expect(matchOf([0, 0], [0, 0], 'count')).toBeNull()
    expect(matchOf([10, null], [0, null], 'count')).toBe(100)
  })
})

describe('kpiSheetApi', () => {
  it('cuts the sheet to one brand, and keeps it whole on «Hammasi»', () => {
    expect(scopeLines(LINES, 'all')).toBe(LINES)
    expect(scopeLines(LINES, 'Zextra').map((l) => l.key)).toEqual(['Zextra:title', 'Zextra:orders:FAKT1:bitrix', 'Zextra:orders:FAKT1:moysklad', 'Zextra:orders:FAKT1:diff'])
  })

  it('writes a CSV Excel opens into columns: a BOM, «;», plain numbers, every row named', () => {
    const data: KpiSheetDto = {
      month: '2026-10',
      days: DAYS,
      today: TODAY,
      usdPerOrder: 2,
      moysklad: { since: '2026-06-14T19:00:00.000Z', lastSuccessAt: null },
      lines: LINES,
    }
    const csv = kpiSheetCsv(data, LINES)
    const rows = csv.slice(1).split('\r\n')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(rows[0]).toBe('Koʻrsatkich;Manba;Jami;01.10.2026;02.10.2026;03.10.2026')
    expect(rows[2]).toBe('Buyurtmalar · FAKT 1;Bitrix24;78;40;38;')
    expect(rows[3]).toBe('Buyurtmalar · FAKT 1;MoySklad;77;40;37;')
    expect(rows[4]).toBe('Buyurtmalar · FAKT 1;Farq (MoySklad − Bitrix24);-1;0;-1;')
    expect(rows[5]).toBe('Summa · FAKT 1, soʻm;Bitrix24;1600000;1600000;0;')
  })
})
