// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RnpBlockTable } from '@/features/rnp/RnpBlockTable'
import { ResetColumnWidths, RnpColumnScope } from '@/features/rnp/RnpColumnResizer'
import type { RnpBlockDto, RnpRowDto } from '@/features/rnp/rnpApi'
import { DEFAULT_WIDTH, STORAGE_KEY, reloadColumnWidths, resetColumnWidths, storedWidths } from '@/features/rnp/rnpColumnWidths'

/**
 * The «RNP» grid's resizable columns: a handle on every header cell, named
 * and valued for a screen reader, driven by the keyboard, and one width shared
 * by all the day columns. The figures themselves are pinned in `rnpPage.test`.
 */

function row(over: Partial<RnpRowDto> & Pick<RnpRowDto, 'key' | 'label'>): RnpRowDto {
  return {
    unit: 'count',
    additive: true,
    better: 'up',
    plan: null,
    dayPlan: null,
    fact: null,
    forecast: null,
    index: null,
    days: [null, null, null],
    planKey: null,
    sheet: null,
    share: null,
    tone: 'plain',
    hint: null,
    reliableFrom: null,
    ...over,
  }
}

const BLOCK: RnpBlockDto = {
  id: 'team:Lola',
  kind: 'team',
  title: 'Лола РОП',
  subtitle: null,
  team: 'Lola',
  sheet: null,
  rows: [
    row({ key: 'a', label: 'Лидлар', plan: 300, dayPlan: 10, fact: 25, forecast: 280, index: 93.3, days: [12, 13, null] }),
    row({ key: 'b', label: 'ФАКТ 1', tone: 'total', fact: 5, days: [2, 3, null] }),
  ],
}
const DAYS = ['2026-09-01', '2026-09-02', '2026-09-03']

function draw() {
  return render(
    <RnpColumnScope>
      <ResetColumnWidths />
      <RnpBlockTable block={BLOCK} days={DAYS} today="2026-09-03" />
    </RnpColumnScope>,
  )
}

// This jsdom has no `localStorage` (Node's own shadows it), so the page gets a Map.
const stored = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
  },
})

beforeEach(() => {
  window.localStorage.clear()
  reloadColumnWidths()
})
afterEach(() => {
  cleanup()
  resetColumnWidths()
})

describe('RnpBlockTable — resizable columns', () => {
  it('puts a labelled, valued separator on every header cell', () => {
    draw()
    const handles = screen.getAllByRole('separator')
    // Koʻrsatkich + Reja, Kunlik reja, Fakt, Prognoz, Indeks (no share column here) + three days.
    expect(handles).toHaveLength(1 + 5 + 3)
    for (const h of handles) {
      expect(h.getAttribute('aria-orientation')).toBe('vertical')
      expect(h.getAttribute('aria-label')).toMatch(/^Ustun kengligi: /)
      expect(Number(h.getAttribute('aria-valuemin'))).toBeGreaterThan(0)
      expect(Number(h.getAttribute('aria-valuemax'))).toBeGreaterThan(Number(h.getAttribute('aria-valuemin')))
    }
    const fact = screen.getByRole('separator', { name: 'Ustun kengligi: Fakt' })
    expect(fact.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH.fact))
    // Each handle sits in its own header cell.
    expect(fact.closest('th')?.textContent).toBe('Fakt')
  })

  it('lays the table out fixed over a colgroup read from the scope variables', () => {
    const { container } = draw()
    const table = container.querySelector('table')!
    expect(table.className).toContain('table-fixed')
    const cols = [...table.querySelectorAll('col')].map((c) => c.getAttribute('style'))
    expect(cols).toHaveLength(1 + 5 + 3)
    expect(cols[0]).toContain('--rnp-w-label')
    expect(cols.at(-1)).toContain('--rnp-w-day')
  })

  it('offers ONE day handle to the keyboard; all three still take a pointer', () => {
    draw()
    const days = screen.getAllByRole('separator', { name: 'Ustun kengligi: kunlar' })
    expect(days.map((h) => h.tabIndex)).toEqual([0, -1, -1])
  })

  it('moves by 8px with the arrow keys, stores it, and sets the variable on the scope', () => {
    const { container } = draw()
    const fact = screen.getByRole('separator', { name: 'Ustun kengligi: Fakt' })
    fireEvent.keyDown(fact, { key: 'ArrowRight' })
    fireEvent.keyDown(fact, { key: 'ArrowRight' })
    fireEvent.keyDown(fact, { key: 'ArrowLeft' })

    const expected = DEFAULT_WIDTH.fact + 8
    expect(storedWidths()).toEqual({ fact: expected })
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({ fact: expected })
    expect(fact.getAttribute('aria-valuenow')).toBe(String(expected))
    const scope = container.querySelector<HTMLElement>('[data-rnp-cols]')!
    expect(scope.style.getPropertyValue('--rnp-w-fact')).toBe(`${expected}px`)
  })

  it('moves every day column with any day handle', () => {
    draw()
    const [, second] = screen.getAllByRole('separator', { name: 'Ustun kengligi: kunlar' })
    fireEvent.keyDown(second!, { key: 'ArrowLeft' })
    expect(storedWidths()).toEqual({ day: DEFAULT_WIDTH.day - 8 })
    for (const h of screen.getAllByRole('separator', { name: 'Ustun kengligi: kunlar' })) {
      expect(h.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH.day - 8))
    }
  })

  it('puts a column back on double click, and every column back from the toolbar button', () => {
    const { container } = draw()
    const reset = screen.getByRole('button', { name: 'Kengliklarni tiklash' }) as HTMLButtonElement
    expect(reset.disabled).toBe(true)

    const plan = screen.getByRole('separator', { name: 'Ustun kengligi: Reja' })
    const label = screen.getByRole('separator', { name: 'Ustun kengligi: Koʻrsatkich' })
    fireEvent.keyDown(plan, { key: 'ArrowRight' })
    fireEvent.keyDown(label, { key: 'ArrowRight' })
    expect(Object.keys(storedWidths()).sort()).toEqual(['label', 'plan'])
    expect(reset.disabled).toBe(false)

    fireEvent.doubleClick(plan)
    expect(Object.keys(storedWidths())).toEqual(['label'])
    const scope = container.querySelector<HTMLElement>('[data-rnp-cols]')!
    expect(scope.style.getPropertyValue('--rnp-w-plan')).toBe('')

    act(() => fireEvent.click(reset))
    expect(storedWidths()).toEqual({})
    expect(scope.style.getPropertyValue('--rnp-w-label')).toBe('')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('still prints every figure: the index as a pill, a dash for an empty day', () => {
    const { container } = draw()
    const lids = [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].find((tr) => tr.querySelector('th')?.textContent === 'Лидлар')!
    expect([...lids.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['300', '10', '25', '280', '93.3%', '12', '13', '—'])
    expect(within(lids).getByText('93.3%').className).toContain('rounded-full')
  })
})
