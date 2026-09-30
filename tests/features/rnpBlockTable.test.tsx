// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  rows: [
    row({ key: 'a', label: 'Лидлар', plan: 300, dayPlan: 10, fact: 25, forecast: 280, index: 93.3, days: [12, 13, null] }),
    row({ key: 'b', label: 'ФАКТ 1', tone: 'total', fact: 5, days: [2, 3, null] }),
  ],
}
const DAYS = ['2026-09-01', '2026-09-02', '2026-09-03']

/** A money block with the fixture's big figures. */
const MONEY: RnpBlockDto = {
  ...BLOCK,
  id: 'co',
  title: 'Sinolife',
  rows: [
    row({
      key: 'm',
      label: 'Сумма факт1',
      unit: 'uzs',
      plan: 4_781_250_000,
      dayPlan: 159_375_000,
      fact: 3_589_815_001,
      forecast: 4_821_429_000,
      index: 100.8,
      days: [1_250_000, 159_375_000, null],
    }),
  ],
}

// jsdom has no PointerEvent; without one, clientX and pointerType never reach the handler.
class FakePointerEvent extends MouseEvent {
  pointerId: number
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'mouse'
  }
}
Object.defineProperty(window, 'PointerEvent', { configurable: true, value: FakePointerEvent })

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

  it('lays the table out over a colgroup read from the scope variables, auto so no figure is cut', () => {
    const { container } = draw()
    const table = container.querySelector('table')!
    expect(table.className).toContain('table-auto')
    expect(container.querySelector('td.text-ellipsis, th.text-ellipsis, td.overflow-hidden')).toBeNull()
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

describe('RnpBlockTable — full numbers', () => {
  it('writes every soʻm in full, in the summary and in the days', () => {
    const { container } = render(<RnpBlockTable block={MONEY} days={DAYS} today="2026-09-03" />)
    const cells = [...container.querySelectorAll('tbody td')].map((td) => td.textContent)
    expect(cells).toEqual(['4,781,250,000', '159,375,000', '3,589,815,001', '4,821,429,000', '100.8%', '1,250,000', '159,375,000', '—'])
    expect(container.textContent).not.toMatch(/mln|mlrd|ming/)
  })
})

describe('RnpBlockTable — drag to scroll', () => {
  function grid() {
    const { container } = render(<RnpBlockTable block={MONEY} days={DAYS} today="2026-09-03" />)
    const box = container.querySelector<HTMLElement>('[data-rnp-grid]')!
    // jsdom lays nothing out: give the box a scroll position that remembers what it is set to.
    let left = 200
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => void (left = v) })
    box.setPointerCapture = vi.fn()
    box.releasePointerCapture = vi.fn()
    const cell = box.querySelector('tbody td')!
    return { box, cell }
  }

  it('pans the grid sideways once the mouse has moved past the threshold', () => {
    const { box, cell } = grid()
    fireEvent.pointerDown(cell, { pointerType: 'mouse', button: 0, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(cell, { pointerType: 'mouse', clientX: 460, pointerId: 1 })
    expect(box.scrollLeft).toBe(240)
    expect(box.hasAttribute('data-panning')).toBe(true)
    expect(box.setPointerCapture).toHaveBeenCalledWith(1)
    fireEvent.pointerMove(cell, { pointerType: 'mouse', clientX: 560, pointerId: 1 })
    expect(box.scrollLeft).toBe(140)
    fireEvent.pointerUp(cell, { pointerType: 'mouse', clientX: 560, pointerId: 1 })
    expect(box.hasAttribute('data-panning')).toBe(false)
  })

  it('does nothing for a click that stays under the threshold', () => {
    const { box, cell } = grid()
    fireEvent.pointerDown(cell, { pointerType: 'mouse', button: 0, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(cell, { pointerType: 'mouse', clientX: 503, pointerId: 1 })
    fireEvent.pointerUp(cell, { pointerType: 'mouse', clientX: 503, pointerId: 1 })
    expect(box.scrollLeft).toBe(200)
    expect(box.setPointerCapture).not.toHaveBeenCalled()
  })

  it('leaves touch, the resize handles and the row labels alone', () => {
    const { box, cell } = grid()
    fireEvent.pointerDown(cell, { pointerType: 'touch', button: 0, clientX: 500, pointerId: 2 })
    fireEvent.pointerMove(cell, { pointerType: 'touch', clientX: 400, pointerId: 2 })
    expect(box.scrollLeft).toBe(200)

    const label = box.querySelector('tbody th')!
    fireEvent.pointerDown(label, { pointerType: 'mouse', button: 0, clientX: 500, pointerId: 3 })
    fireEvent.pointerMove(label, { pointerType: 'mouse', clientX: 400, pointerId: 3 })
    expect(box.scrollLeft).toBe(200)
    fireEvent.pointerUp(label, { pointerType: 'mouse', clientX: 400, pointerId: 3 })

    const handle = box.querySelector('[role="separator"]')!
    fireEvent.pointerDown(handle, { pointerType: 'mouse', button: 0, clientX: 500, pointerId: 4 })
    fireEvent.pointerMove(box, { pointerType: 'mouse', clientX: 400, pointerId: 4 })
    expect(box.scrollLeft).toBe(200)
  })
})
