// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type KpiSheetDto, type KpiSheetLine, groupDiffers, kpiSheetCsv, scopeLines } from '@/features/kpi/kpiSheetApi'
import { KpiSheetTable } from '@/features/kpi/KpiSheetTable'

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
  { kind: 'title', key: 'all:title', label: 'Asosiy koʻrsatkichlar · Collagen + Zextra', scope: 'all' },
  value('all:orders', 'bitrix', [40, 38, null]),
  value('all:orders', 'moysklad', [40, 37, null]),
  value('all:orders', 'diff', [0, -1, null]),
  value('all:amount', 'bitrix', [1_600_000, 0, null], { label: 'Summa · FAKT 1, soʻm', unit: 'uzs' }),
  value('all:amount', 'moysklad', [1_600_000, 0, null], { unit: 'uzs' }),
  value('all:amount', 'diff', [0, 0, null], { unit: 'uzs' }),
  { kind: 'title', key: 'Zextra:title', label: 'Zextra · asosiy koʻrsatkichlar', scope: 'Zextra' },
  value('Zextra:orders', 'bitrix', [5, 4, null], { scope: 'Zextra' }),
]

describe('KpiSheetTable', () => {
  it('heads a column per day, the month span in the corner', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const head = screen.getAllByRole('columnheader')
    expect(head[0]!.textContent).toContain('01.10.2026 – 03.10.2026')
    expect(head[1]!.textContent).toBe('Jami')
    expect(head.map((h) => h.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('02.10')]))
    expect(head.find((h) => h.getAttribute('aria-current') === 'date')!.textContent).toContain('02.10')
  })

  it('names a figure once and marks it when its two systems disagree', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const orders = screen.getAllByRole('rowheader').find((h) => h.textContent?.includes('Buyurtmalar · FAKT 1'))!
    expect(orders.querySelector('[title="Bu oy Bitrix24 va MoySklad farq qiladi"]')).not.toBeNull()
    const amount = screen.getAllByRole('rowheader').find((h) => h.textContent?.includes('Summa · FAKT 1'))!
    expect(amount.querySelector('[title="Bu oy Bitrix24 va MoySklad farq qiladi"]')).toBeNull()
  })

  it('draws a difference as a mark: a quiet dash for nought, a pill with its direction for a gap', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const diff = screen.getAllByRole('row').find((r) => r.getAttribute('data-side') === 'diff')!
    expect(within(diff).getAllByLabelText('farq yoʻq').length).toBeGreaterThan(0)
    // The month's «Jami» and 02.10 — Bitrix24 one order ahead.
    expect(within(diff).getAllByLabelText('farq −1')).toHaveLength(2)
  })

  it('writes figures in full with the sheet\'s dots, and leaves a day not lived yet empty', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const amount = screen.getAllByRole('row').find((r) => r.textContent?.includes('Summa · FAKT 1'))!
    const cells = within(amount).getAllByRole('cell')
    expect(cells[0]!.textContent).toBe('1.600.000')
    expect(cells[1]!.textContent).toBe('1.600.000')
    expect(cells[3]!.textContent).toBe('')
  })

  it('opens a lived day\'s orders under the row\'s brand and FAKT figure', () => {
    const onOpen = vi.fn()
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={onOpen} />)
    const zextra = screen.getAllByRole('row').find((r) => r.getAttribute('data-side') === 'bitrix' && r.textContent?.includes('5'))!
    fireEvent.click(within(zextra).getAllByRole('cell')[2]!)
    expect(onOpen).toHaveBeenCalledWith({ day: '2026-10-02', scope: 'Zextra', basis: 'FAKT1' })
    // A day not lived yet has nothing to open.
    onOpen.mockClear()
    fireEvent.click(within(zextra).getAllByRole('cell')[3]!)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('KpiSheetTable — reading it at a glance', () => {
  it('says in each block’s heading whether everything in it agrees', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const all = screen.getByRole('button', { name: /Asosiy koʻrsatkichlar/ })
    // «Buyurtmalar» differs on 02.10; «Summa» agrees.
    expect(all.textContent).toContain('1 farq')
    expect(screen.getByRole('button', { name: /^Zextra · asosiy/ }).textContent).toContain('mos')
  })

  it('folds a block away and opens it again', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const all = screen.getByRole('button', { name: /Asosiy koʻrsatkichlar/ })
    expect(all.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(all)
    expect(all.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryAllByRole('row').some((r) => r.textContent?.includes('Summa · FAKT 1'))).toBe(false)
    // The other brand's block is untouched.
    expect(screen.getAllByRole('row').some((r) => r.getAttribute('data-side') === 'bitrix' && r.textContent?.includes('5'))).toBe(true)
    fireEvent.click(all)
    expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('Summa · FAKT 1'))).toBe(true)
  })

  it('marks the date that holds a difference', () => {
    render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    const heads = screen.getAllByRole('columnheader')
    const flagged = heads.filter((h) => h.querySelector('[aria-label="Shu kuni Bitrix24 va MoySklad farq qiladi"]'))
    expect(flagged.map((h) => h.textContent)).toEqual([expect.stringContaining('02.10')])
  })

  it('marks every day cell with its column, for the crosshair', () => {
    const { container } = render(<KpiSheetTable lines={LINES} days={DAYS} today={TODAY} onOpen={() => {}} />)
    expect(container.querySelectorAll('thead [data-c="1"]')).toHaveLength(1)
    expect(container.querySelectorAll('tbody [data-c="1"]').length).toBe(LINES.filter((l) => l.kind === 'value').length)
  })
})

describe('kpiSheetApi', () => {
  it('cuts the sheet to one brand, and keeps it whole on «Hammasi»', () => {
    expect(scopeLines(LINES, 'all')).toBe(LINES)
    expect(scopeLines(LINES, 'Zextra').map((l) => l.key)).toEqual(['Zextra:title', 'Zextra:orders:bitrix'])
  })

  it('reads a group\'s difference off its «Farq» row', () => {
    expect(groupDiffers(LINES, 1)).toBe(true)
    expect(groupDiffers(LINES, 4)).toBe(false)
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
