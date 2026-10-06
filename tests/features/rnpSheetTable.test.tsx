// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RnpColumnScope } from '@/features/rnp/RnpColumnResizer'
import { RnpSheetTable, scrollToToday } from '@/features/rnp/RnpSheetTable'
import { RNP_ADDED_TEAM_NOTE, type RnpBlockDto, type RnpLine, type RnpRowDto } from '@/features/rnp/rnpApi'
import { brandLines, ropLines } from '@/features/rnp/rnpDerive'
import { DEFAULT_WIDTH, STORAGE_KEY, reloadColumnWidths, storedWidths } from '@/features/rnp/rnpColumnWidths'

/**
 * «RNP jadvali» as the client's sheet: `lines` drawn in order with the
 * sheet's labels, heading bands, a row Bitrix24 cannot supply kept empty and
 * marked, an added team said so — and the grid's resizable columns, full
 * numbers and drag-to-scroll.
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
    sheet: null,
    tone: 'plain',
    hint: null,
    manual: null,
    planInput: null,
    reliableFrom: null,
    ...over,
  }
}

const BLOCKS: RnpBlockDto[] = [
  {
    id: 'team:Lola',
    kind: 'team',
    title: 'Лола РОП',
    subtitle: null,
    team: 'Lola',
    sheet: null,
    rows: [
      row({ key: 'lids', label: 'Лидлар (dashboard)', plan: 300, dayPlan: 10, fact: 25, forecast: 280, index: 93.3, days: [12, 13, null] }),
      row({
        key: 'sum',
        label: 'Сумма ФАКТ 1',
        unit: 'uzs',
        plan: 4_781_250_000,
        dayPlan: 159_375_000,
        fact: 3_589_815_001,
        forecast: 4_821_429_000,
        index: 100.8,
        days: [1_250_000, 159_375_000, null],
      }),
      row({ key: 'kompaniya', label: 'Буюртма сони', fact: 7, days: [3, 4, null] }),
    ],
  },
]

const LINES: RnpLine[] = [
  { kind: 'title', row: 4, team: null, label: 'Маркетинг COLLAGEN', sub: 'Хаёт', tone: 'section' },
  { kind: 'value', row: 9, team: null, label: 'Кол подпис tg', sub: null, tone: 'plain', fact: 'plain', bold: false, key: null },
  { kind: 'value', row: 102, team: null, label: 'Продажа (первичка) факт1', sub: 'Лола РОП', tone: 'team', fact: 'plain', bold: true, key: 'lids' },
  { kind: 'value', row: 106, team: null, label: 'Сумма факт 1 сум', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: 'sum' },
  { kind: 'title', row: null, team: null, label: 'Kompaniya РОП', sub: 'sheetda bloki yoʻq', tone: 'team' },
  { kind: 'value', row: null, team: null, label: 'Буюртма сони', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'kompaniya' },
]

const DAYS = ['2026-09-01', '2026-09-02', '2026-09-03']

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

function draw(lines: RnpLine[] = LINES) {
  return render(
    <RnpColumnScope>
      <RnpSheetTable lines={lines} blocks={BLOCKS} days={DAYS} today="2026-09-03" />
    </RnpColumnScope>,
  )
}

/** Every body row but the blank spacers between blocks. */
function bodyRows(container: HTMLElement): HTMLTableRowElement[] {
  return [...container.querySelectorAll<HTMLTableRowElement>('tbody tr:not([data-gap])')]
}

function rowNamed(container: HTMLElement, text: string): HTMLTableRowElement {
  const found = bodyRows(container).find((tr) => tr.querySelector('th')?.textContent?.includes(text))
  if (!found) throw new Error(`no row «${text}»`)
  return found
}

beforeEach(() => {
  window.localStorage.clear()
  reloadColumnWidths()
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  reloadColumnWidths()
})

describe('RnpSheetTable — the sheet, row by row', () => {
  it('draws every line in order under the sheet’s own labels, not the dashboard’s', () => {
    const { container } = draw()
    const labels = bodyRows(container).map((tr) => tr.querySelector('th')!.textContent)
    expect(labels).toEqual([
      'Маркетинг COLLAGENХаёт',
      'Кол подпис tg',
      'Лола РОППродажа (первичка) факт1',
      'Сумма факт 1 сум',
      'Kompaniya РОПsheetda bloki yoʻq',
      'Буюртма сони',
    ])
    expect(container.textContent).not.toContain('Лидлар (dashboard)')
    // Every label is a row header.
    for (const tr of bodyRows(container)) expect(tr.querySelector('th')!.getAttribute('scope')).toBe('row')
  })

  it('heads the columns in the sheet’s order, a real header row', () => {
    draw()
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual([
      'Koʻrsatkich, 01.09.2026 – 03.09.2026',
      'План обший',
      'Факт',
      'Прогноз',
      'Индекс, %',
      // After «Индекс» since the client reshaped the sheet (2026-09-30), beside the days.
      'Кунлик план',
      '01.09Se',
      '02.09Ch',
      '03.09Pa',
    ])
    expect(screen.getAllByRole('columnheader').every((th) => th.getAttribute('scope') === 'col')).toBe(true)
    // Today's column is announced as the current date.
    expect(screen.getAllByRole('columnheader').at(-1)!.getAttribute('aria-current')).toBe('date')
  })

  it('draws a heading as a band across the month, with its owner, and opens a gap after figures', () => {
    const { container } = draw()
    const title = rowNamed(container, 'Маркетинг COLLAGEN')
    expect(title.dataset.line).toBe('title')
    expect(title.dataset.tone).toBe('section')
    // Two pieces: the one under the pinned План/Факт/Прогноз, and the rest of the month.
    const band = [...title.querySelectorAll('td')]
    expect(band.map((td) => td.colSpan)).toEqual([3, 2 + DAYS.length])
    expect(band[0]!.classList.contains('rnp-pin')).toBe(true)
    expect(band.every((td) => td.textContent === '')).toBe(true)
    // The added team's heading follows a line of figures: a blank spacer row sits before it.
    const added = rowNamed(container, 'Kompaniya РОП')
    expect(added.previousElementSibling?.hasAttribute('data-gap')).toBe(true)
    expect(added.previousElementSibling?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps a row Bitrix24 cannot supply in place, empty, with a named marker', () => {
    const { container } = draw()
    const missing = rowNamed(container, 'Кол подпис tg')
    expect(missing.dataset.line).toBe('missing')
    const cells = [...missing.querySelectorAll('td')]
    // No figure — only the mark, in the empty span so the row stays one line.
    expect(cells.map((td) => td.textContent)).toEqual(['Bitrix24ʼda yoʻq', ''])
    // The mark sits under the pinned summary, so it stays in sight across the month.
    expect(cells.map((td) => td.colSpan)).toEqual([3, 2 + DAYS.length])
    expect(cells[0]!.classList.contains('rnp-pin')).toBe(true)
    const marker = within(missing).getByRole('note', { name: /^Bitrix24ʼda yoʻq/ })
    expect(marker.getAttribute('aria-label')).toContain('Bu qator Bitrix24 da yoʻq — qoʻlda kiritilmaydi')
    // Exactly one row is missing here.
    expect(screen.getAllByRole('note')).toHaveLength(1)
  })

  it('names a team the sheet lacks with its chip', () => {
    const { container } = draw()
    const added = rowNamed(container, 'Kompaniya РОП')
    expect(within(added).getByText('sheetda bloki yoʻq')).toBeTruthy()
    // Its figures still print: nothing a team sold is dropped.
    const orders = rowNamed(container, 'Буюртма сони')
    expect([...orders.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['—', '7', '—', '—', '—', '3', '4', '—'])
  })

  it('puts the ROP first on a team’s row, and fills the columns in the sheet’s order', () => {
    const { container } = draw()
    const team = rowNamed(container, 'Лола РОП')
    expect(team.dataset.tone).toBe('team')
    expect(team.querySelector('th')!.textContent!.indexOf('Лола РОП')).toBe(0)
    // План, Факт, Прогноз, Индекс, Кунлик план, then the days; a dash, never a zero.
    expect([...team.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['300', '25', '280', '93,3%', '10', '12', '13', '—'])
    expect(within(team).getByText('93,3%').className).toContain('rounded-full')
  })

  it('colours only «План бажарилиши», «Сумма факт 1» and «Конверсия» rows (the client, 2026-10-01)', () => {
    const plainLine: RnpLine = { kind: 'value', row: 108, team: null, label: 'Ходим сони', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: 'lids' }
    const convLine: RnpLine = { kind: 'value', row: 103, team: null, label: 'Конверция % от квал лид 📌', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'lids' }
    const { container } = draw([...LINES, plainLine, convLine])
    expect(rowNamed(container, 'Лола РОП').dataset.accent).toBe('plan')
    expect(rowNamed(container, 'Сумма факт 1 сум').dataset.accent).toBe('fakt1')
    expect(rowNamed(container, 'Конверция % от квал лид').dataset.accent).toBe('conversion')
    const plainRow = rowNamed(container, 'Ходим сони')
    expect(plainRow.dataset.accent).toBeUndefined()
    // Its index is plain text, not a coloured pill.
    expect(within(plainRow).getByText('93,3%').className).not.toContain('rounded-full')
    expect(within(rowNamed(container, 'Конверция % от квал лид')).getByText('93,3%').className).toContain('rounded-full')
  })

  it('sets each ROP apart with a ruled gap, also where the sheet runs one ROP into the next', () => {
    const lg = (team: string, row: number): RnpLine => ({ kind: 'value', row, team, label: 'Логистика  Сумма факт1', sub: `${team} РОП`, tone: 'section', fact: 'fakt', bold: true, key: 'sum' })
    const { container } = draw([
      { kind: 'value', row: 94, team: 'Sevinch', label: 'План бажарилиши', sub: 'Севинч РОП', tone: 'team', fact: 'plan', bold: true, key: 'lids' },
      { kind: 'value', row: 96, team: 'Sevinch', label: 'Сумма факт 2 сум', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: 'kompaniya' },
      { kind: 'value', row: 107, team: 'Lola', label: 'План бажарилиши', sub: 'Лола РОП', tone: 'team', fact: 'plan', bold: true, key: 'lids' },
      { kind: 'value', row: 109, team: 'Lola', label: 'Сумма факт 2 сум', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: 'kompaniya' },
      lg('Sevinch', 274),
      { kind: 'value', row: 275, team: 'Sevinch', label: 'Успешка сумма факт 2', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'kompaniya' },
      lg('Lola', 279),
    ])
    const order = [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].map((tr) => tr.dataset.gap ?? tr.querySelector('th')!.textContent)
    expect(order.filter((x) => x === 'rop')).toHaveLength(3)
    expect(order.indexOf('rop', 2)).toBe(order.findIndex((x) => x?.startsWith('Лола РОП')) - 1)
    // The rows inside one ROP are not split.
    expect(order.at(-1)).toContain('Логистика')
    expect(order.at(-2)).toBe('rop')
  })

  it('sets «Коллаген проект» and «Зехтра проект» apart like the ROPs, not their rows', () => {
    const v = (row: number, label: string, tone: RnpLine['tone'] = 'plain'): RnpLine => ({ kind: 'value', row, team: null, label, sub: null, tone, fact: 'plain', bold: false, key: 'kompaniya' })
    const { container } = draw([
      { kind: 'value', row: 334, team: 'Lola', label: 'Отказ %', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'kompaniya' },
      v(394, 'Коллаген проект', 'section'),
      v(418, '%'),
      v(421, 'Зехтра проект', 'section'),
      v(422, 'Сумма факт2 (успешка)'),
      v(443, 'Маркетолог фот = 1%'),
    ])
    const order = [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].map((tr) => tr.dataset.gap ?? tr.querySelector('th')!.textContent)
    for (const opener of ['Коллаген проект', 'Зехтра проект']) {
      expect(order[order.findIndex((x) => x?.startsWith(opener)) - 1]).toBe('rop')
    }
    expect(order.filter((x) => x === 'rop')).toHaveLength(2)
    expect(order.filter((x) => x === '')).toHaveLength(0)
  })

  it('writes every soʻm in full, in the summary and in the days', () => {
    const { container } = draw()
    const sum = rowNamed(container, 'Сумма факт 1 сум')
    expect([...sum.querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      '4.781.250.000',
      '3.589.815.001',
      '4.821.429.000',
      '100,8%',
      '159.375.000',
      '1.250.000',
      '159.375.000',
      '—',
    ])
    expect(container.textContent).not.toMatch(/mln|mlrd|ming/)
    // A FAKT row's fact cell is bold.
    expect(sum.querySelectorAll('td')[1]!.className).toContain('font-semibold')
  })

  it('opens «Коллаген проект» with a gap after an added team’s logistics, which has no sheet row (2026-10-02)', () => {
    const { container } = draw([
      { kind: 'value', row: null, team: 'Kompaniya', label: 'Логистика  Сумма факт1', sub: 'Kompaniya РОП', tone: 'section', fact: 'plain', bold: true, key: 'sum', added: true },
      { kind: 'value', row: null, team: 'Kompaniya', label: 'Отказ сумма', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'kompaniya' },
      { kind: 'value', row: 394, team: null, label: 'Коллаген проект', sub: 'Сумма факт1', tone: 'section', fact: 'plain', bold: true, key: 'lids' },
    ])
    const project = rowNamed(container, 'Коллаген проект')
    // A project opens its own table with the wide gap (0a32b03); any other section after a row-less line gets the block gap.
    expect(project.previousElementSibling?.getAttribute('data-gap')).toBe('rop')
    const other = draw([
      { kind: 'value', row: null, team: 'Kompaniya', label: 'Отказ сумма', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'kompaniya' },
      { kind: 'value', row: 350, team: null, label: 'Квал лид сони', sub: null, tone: 'section', fact: 'plain', bold: true, key: 'lids' },
    ]).container
    expect(rowNamed(other, 'Квал лид сони').previousElementSibling?.getAttribute('data-gap')).toBe('')
  })

  it('marks an added team on its block’s first line, and still on an older payload’s heading', () => {
    const { container } = draw([
      { kind: 'value', row: null, team: 'Kompaniya', label: 'План бажарилиши', sub: 'Kompaniya РОП', tone: 'team', fact: 'plan', bold: true, key: 'lids', added: true },
      { kind: 'value', row: null, team: 'Kompaniya', label: 'Квал лид сони', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'kompaniya' },
      ...LINES.slice(4, 5),
    ])
    const marked = bodyRows(container).filter((tr) => tr.textContent?.includes(RNP_ADDED_TEAM_NOTE))
    expect(marked.map((tr) => tr.dataset.line)).toEqual(['value', 'title'])
    // The ROP's name first, the chip beside it, the sheet's label under it — like a sheet block.
    expect(marked[0]!.querySelector('th')!.textContent).toBe(`Kompaniya РОП${RNP_ADDED_TEAM_NOTE}План бажарилиши`)
    // Only the first line: the rest of the block reads like the sheet's.
    expect(within(rowNamed(container, 'Квал лид сони')).queryByText(RNP_ADDED_TEAM_NOTE)).toBeNull()
    // The old form: the note as a heading's sub, drawn as the chip and not as an owner pill.
    expect(marked[1]!.querySelector('th')!.textContent).toBe(`Kompaniya РОП${RNP_ADDED_TEAM_NOTE}`)
    expect(within(marked[1]!).getByText(RNP_ADDED_TEAM_NOTE).className).toContain('normal-case')
  })

  it('says what a typed row’s chip means: a day’s soʻm on a cost line, the head count on «Ходим сони»', () => {
    const typed: RnpBlockDto = {
      ...BLOCKS[0]!,
      rows: [
        row({ key: 'heads', label: 'Ходим сони', additive: false, manual: { kind: 'headcount', rop: 'Lola' } }),
        row({ key: 'bloggers', label: 'Блогерлар', unit: 'uzs', manual: { kind: 'cost', project: 'Collagen', line: 'bloggers' } }),
      ],
    }
    const { container } = render(
      <RnpSheetTable
        lines={[
          { kind: 'value', row: 108, team: 'Lola', label: 'Ходим сони', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: 'heads' },
          { kind: 'value', row: 411, team: null, label: 'Блогерлар', sub: null, tone: 'brand', fact: 'plain', bold: false, key: 'bloggers' },
        ]}
        blocks={[typed]}
        days={DAYS}
        today="2026-09-03"
      />,
    )
    expect(within(rowNamed(container, 'Ходим сони')).getByText('qoʻlda').getAttribute('title')).toBe('Bitrix24 dan emas — har kuni xodimlar soni qoʻlda kiritiladi')
    expect(within(rowNamed(container, 'Блогерлар')).getByText('qoʻlda').getAttribute('title')).toBe('Bitrix24 dan emas — kunlik summa qoʻlda kiritiladi')
  })

  it('grades an index pill on the figure it prints, in its tone’s ink, on the column’s edge', () => {
    const graded: RnpBlockDto = {
      ...BLOCKS[0]!,
      rows: [
        row({ key: 'f1', label: 'Сумма ФАКТ 1', unit: 'uzs', index: 99.96 }),
        row({ key: 'cv', label: 'Конверсия', unit: 'percent', additive: false, index: 79.96 }),
      ],
    }
    const { container } = render(
      <RnpSheetTable
        lines={[
          { kind: 'value', row: 80, team: null, label: 'Сумма факт 1 сум', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: 'f1' },
          { kind: 'value', row: 77, team: null, label: 'Конверция % от квал лид 📌', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'cv' },
        ]}
        blocks={[graded]}
        days={DAYS}
        today="2026-09-03"
      />,
    )
    // «100,0%» on track, never amber; «80,0%» a look, never red.
    const full = within(rowNamed(container, 'Сумма факт 1 сум')).getByText('100,0%')
    expect(full.style.color).toContain('var(--status-good)')
    expect(full.style.color).toContain('var(--ink-primary)')
    expect(full.className).toContain('-mr-2')
    expect(within(rowNamed(container, 'Конверция')).getByText('80,0%').style.color).toContain('var(--status-warning)')
  })

  it('paints a tinted row’s band as an image, so the row’s hover still reaches its days', () => {
    const { container } = draw()
    const sum = rowNamed(container, 'Сумма факт 1 сум')
    expect(sum.style.backgroundImage).toContain('linear-gradient')
    expect(sum.style.backgroundColor).toBe('')
    expect(sum.className).toContain('hover:bg-[var(--surface-sunken)]')
    expect(rowNamed(container, 'Буюртма сони').getAttribute('style')).toBeNull()
  })

  it('says each summary column’s formula on its header', () => {
    draw()
    expect(screen.getAllByRole('columnheader').slice(1, 6).map((th) => th.title)).toEqual([
      'Oy rejasi (jadvalning C ustuni)',
      'Oy boshidan bugungacha, bugun ham hisobda',
      'Fakt ÷ oʻtgan kunlar × oydagi kunlar',
      'Prognoz ÷ reja; foizli qatorda — fakt ÷ reja',
      'Reja ÷ 27; foizli qatorda — oy rejasining oʻzi',
    ])
  })

  it('says a muted early day is left out of the month’s fact and forecast', () => {
    const early: RnpBlockDto = { ...BLOCKS[0]!, rows: [row({ key: 'calls', label: 'Дозвон', fact: 2, days: [5, 2, null], reliableFrom: '2026-09-02' })] }
    const { container } = render(
      <RnpSheetTable
        lines={[{ kind: 'value', row: 157, team: 'Charos', label: 'Дозвон сони', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'calls' }]}
        blocks={[early]}
        days={DAYS}
        today="2026-09-03"
      />,
    )
    const [, , , , , first] = [...rowNamed(container, 'Дозвон сони').querySelectorAll('td')]
    expect(first!.title).toBe('Bitrix24 da bu maydon 02.09 dan toʻliq — bu kun oy fakti va prognoziga kirmaydi')
  })

  it('writes «План бажарилиши» under a ROP’s name at full strength, and every sheet heading in capitals', () => {
    const { container } = draw([
      ...LINES,
      { kind: 'title', row: 37, team: null, label: 'Таргет Zextra', sub: null, tone: 'team' },
      { kind: 'title', row: null, team: 'Lola', label: 'Лола РОП — ROP bloki', sub: null, tone: 'team' },
    ])
    expect(rowNamed(container, 'Лола РОППродажа').querySelector('th span.uppercase')!.className).not.toContain('opacity')
    // «Таргет Zextra» is the sheet's blue (team) heading, and upper case like «ТАРГЕТ COLLAGEN».
    expect(within(rowNamed(container, 'Таргет Zextra')).getByText('Таргет Zextra').className).toContain('uppercase')
    expect(within(rowNamed(container, 'Маркетинг COLLAGEN')).getByText('Маркетинг COLLAGEN').className).toContain('uppercase')
    // A ROP's own heading, which the sheet does not have, keeps its case.
    expect(within(rowNamed(container, 'ROP bloki')).getByText('Лола РОП — ROP bloki').className).not.toContain('uppercase')
  })

  it('prints a plan in its own unit — the brand P&L’s success share over a soʻm row (`planUnit`)', () => {
    const brand: RnpBlockDto = {
      ...BLOCKS[0]!,
      rows: [row({ key: 'pj:collagen:fakt2', label: 'Сумма ФАКТ 2', unit: 'uzs', plan: 80.61, planUnit: 'percent', fact: 1_000_000 })],
    }
    const { container } = render(
      <RnpSheetTable
        lines={[{ kind: 'value', row: 395, team: null, label: 'Сумма факт2 (успешка)', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: 'pj:collagen:fakt2' }]}
        blocks={[brand]}
        days={DAYS}
        today="2026-09-03"
      />,
    )
    const cells = [...rowNamed(container, 'Сумма факт2').querySelectorAll('td')].map((td) => td.textContent)
    expect(cells.slice(0, 2)).toEqual(['80,6%', '1.000.000'])
  })
})

describe('RnpSheetTable — the typed P&L cost lines', () => {
  const COST_BLOCKS: RnpBlockDto[] = [
    ...BLOCKS,
    {
      id: 'project:collagen',
      kind: 'project',
      title: 'Коллаген проект',
      subtitle: null,
      team: null,
      sheet: null,
      rows: [
        row({
          key: 'pc:cost_bloggers',
          label: 'Блогерлар',
          unit: 'uzs',
          better: 'down',
          fact: 1_500_000,
          days: [1_500_000, null, null],
          hint: 'Qoʻlda kiritiladi — katakni bosing.',
          manual: { kind: 'cost', project: 'Collagen', line: 'bloggers' },
        }),
      ],
    },
  ]
  const COST_LINES: RnpLine[] = [
    ...LINES,
    { kind: 'value', row: 411, team: null, label: 'Блогерлар', sub: null, tone: 'brand', fact: 'plain', bold: false, key: 'pc:cost_bloggers' },
  ]

  function drawCosts(editCostsFor: string | null) {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <RnpSheetTable lines={COST_LINES} blocks={COST_BLOCKS} days={DAYS} today="2026-09-02" editCostsFor={editCostsFor} />
      </QueryClientProvider>,
    )
  }

  it('marks the typed row «qoʻlda», never «Bitrix24ʼda yoʻq»', () => {
    const { container } = drawCosts(null)
    const bloggers = rowNamed(container, 'Блогерлар')
    expect(bloggers.dataset.line).toBe('value')
    expect(within(bloggers).getByText('qoʻlda')).toBeTruthy()
    expect(bloggers.textContent).not.toContain('Bitrix24ʼda yoʻq')
    // The only «Bitrix24ʼda yoʻq» left is the row that really has no source.
    expect(screen.getAllByRole('note')).toHaveLength(1)
    expect(within(rowNamed(container, 'Кол подпис tg')).getByRole('note')).toBeTruthy()
    // No other row wears the chip.
    expect(screen.getAllByText('qoʻlda')).toHaveLength(1)
    // Its figures print in the sheet's order, summary computed.
    expect([...bloggers.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['—', '1.500.000', '—', '—', '—', '1.500.000', '—', '—'])
  })

  it('offers nothing to type to an account that cannot edit plans', () => {
    drawCosts(null)
    expect(screen.queryAllByRole('button', { name: /tahrirlash$/ })).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('keeps the typed row’s days up to today open as fields, each named for its row and day', () => {
    const { container } = drawCosts('2026-09')
    const fields = screen.getAllByRole('textbox', { name: /soʻm$/ }) as HTMLInputElement[]
    // Open at once — no button to press first (the client: «ochiq tursin»).
    expect(fields.map((f) => f.getAttribute('aria-label'))).toEqual(['Collagen · Блогерлар, 01.09 — soʻm', 'Collagen · Блогерлар, 02.09 — soʻm'])
    expect(fields[0]!.value).toBe('1.500.000')
    expect(fields[1]!.value).toBe('')
    expect(fields[0]!.inputMode).toBe('numeric')
    // Every other row stays plain cells.
    for (const tr of bodyRows(container)) {
      if (tr.querySelector('th')!.textContent!.includes('Блогерлар')) continue
      expect(tr.querySelectorAll('td input')).toHaveLength(0)
    }
    // The summary cells of the typed row stay read-only.
    const cells = [...rowNamed(container, 'Блогерлар').querySelectorAll('td')]
    expect(cells.slice(0, 5).every((td) => td.querySelector('input') === null)).toBe(true)
  })

  it('keys a typed field by what it saves: a refused text survives neither a month switch nor a reorder (2026-10-02)', () => {
    const plans: RnpBlockDto[] = [
      {
        ...BLOCKS[0]!,
        rows: [
          row({ key: 'meta:collagen:budget', label: 'Бюджет', unit: 'usd', planInput: { team: '', metric: 'budget_collagen' } }),
          row({ key: 'meta:collagen:leads', label: 'Лид', planInput: { team: '', metric: 'meta_leads_collagen' } }),
        ],
      },
    ]
    const budgetLine: RnpLine = { kind: 'value', row: 14, team: null, label: 'Бюджет Collagen', sub: null, tone: 'plain', fact: 'money', bold: false, key: 'meta:collagen:budget' }
    const leadsLine: RnpLine = { kind: 'value', row: 15, team: null, label: 'Колич Collagen лид', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'meta:collagen:leads' }
    const client = new QueryClient()
    const view = (month: string, lines: RnpLine[]) => (
      <QueryClientProvider client={client}>
        <RnpSheetTable lines={lines} blocks={plans} days={DAYS} today="2026-09-02" editCostsFor={month} />
      </QueryClientProvider>
    )
    const budget = () => screen.getByRole('textbox', { name: 'Kompaniya · Бюджет Collagen — reja, $' }) as HTMLInputElement
    const leads = () => screen.getByRole('textbox', { name: 'Kompaniya · Колич Collagen лид — reja' }) as HTMLInputElement
    const refuse = (field: HTMLInputElement) => {
      fireEvent.focus(field)
      fireEvent.change(field, { target: { value: 'abc' } })
      fireEvent.keyDown(field, { key: 'Enter' })
      expect(field.getAttribute('aria-invalid')).toBe('true')
    }

    const { rerender } = render(view('2026-09', [budgetLine, leadsLine]))
    refuse(budget())
    // Another month, the same row: a fresh field, not September's red «abc».
    rerender(view('2026-10', [budgetLine, leadsLine]))
    expect(budget().value).toBe('')
    expect(budget().getAttribute('aria-invalid')).toBeNull()
    // The lines reordered under the same positions (as a ROP cut does): nothing moves into the other plan.
    refuse(budget())
    rerender(view('2026-10', [leadsLine, budgetLine]))
    expect(leads().value).toBe('')
    expect(leads().getAttribute('aria-invalid')).toBeNull()
  })

  it('keys a typed day by its row and day: two teams’ «Ходим сони» trading places keep their own text', () => {
    const heads: RnpBlockDto[] = [
      {
        ...BLOCKS[0]!,
        rows: ['Lola', 'Aziz'].map((rop) => row({ key: `team:${rop}:headcount`, label: 'Ходим сони', additive: false, manual: { kind: 'headcount', rop } })),
      },
    ]
    const line = (rop: string): RnpLine => ({ kind: 'value', row: null, team: rop, label: 'Ходим сони', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: `team:${rop}:headcount` })
    const client = new QueryClient()
    const view = (lines: RnpLine[]) => (
      <QueryClientProvider client={client}>
        <RnpSheetTable lines={lines} blocks={heads} days={DAYS} today="2026-09-02" editCostsFor="2026-09" />
      </QueryClientProvider>
    )
    const field = (rop: string) => screen.getByRole('textbox', { name: `${rop} · Ходим сони, 02.09 — kishi` }) as HTMLInputElement
    const { rerender } = render(view([line('Lola'), line('Aziz')]))
    fireEvent.focus(field('Lola'))
    fireEvent.change(field('Lola'), { target: { value: '7.5' } })
    fireEvent.keyDown(field('Lola'), { key: 'Enter' })
    expect(field('Lola').getAttribute('aria-invalid')).toBe('true')
    rerender(view([line('Aziz'), line('Lola')]))
    // Aziz now stands where Lola's refused «7.5» was typed: his field is his own.
    expect(field('Aziz').value).toBe('')
    expect(field('Aziz').getAttribute('aria-invalid')).toBeNull()
  })
})

describe('RnpSheetTable — resizable columns', () => {
  it('puts a labelled, valued separator on every header cell', () => {
    draw()
    const handles = screen.getAllByRole('separator')
    // Koʻrsatkich + five summary columns + three days.
    expect(handles).toHaveLength(1 + 5 + 3)
    for (const h of handles) {
      expect(h.getAttribute('aria-orientation')).toBe('vertical')
      expect(h.getAttribute('aria-label')).toMatch(/^Ustun kengligi: /)
      expect(Number(h.getAttribute('aria-valuemin'))).toBeGreaterThan(0)
      expect(Number(h.getAttribute('aria-valuemax'))).toBeGreaterThan(Number(h.getAttribute('aria-valuemin')))
    }
    const fact = screen.getByRole('separator', { name: 'Ustun kengligi: Факт' })
    expect(fact.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH.fact))
    expect(fact.closest('th')?.textContent).toBe('Факт')
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

  it('drags on the <col> elements and the table width, then commits the variable on release', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    const { container } = draw()
    const fact = screen.getByRole('separator', { name: 'Ustun kengligi: Факт' })
    const col = container.querySelector<HTMLTableColElement>('col[data-col-kind="fact"]')!
    const table = container.querySelector('table')!
    const tableStyle = table.style.width
    const colStyle = col.style.width

    fireEvent.pointerDown(fact, { button: 0, clientX: 100, pointerId: 7 })
    fireEvent.pointerMove(fact, { clientX: 160, pointerId: 7 })
    const live = DEFAULT_WIDTH.fact + 60
    expect(col.style.width).toBe(`${live}px`) // the cells' styles are not touched mid-drag
    expect(table.style.width).toMatch(/px$/)
    expect(fact.getAttribute('aria-valuenow')).toBe(String(live))

    fireEvent.pointerUp(fact, { clientX: 160, pointerId: 7 })
    expect(col.style.width).toBe(colStyle) // back to reading the variable
    expect(table.style.width).toBe(tableStyle)
    expect(storedWidths()).toEqual({ fact: live })
    raf.mockRestore()
  })

  it('offers ONE day handle to the keyboard; all three still take a pointer', () => {
    draw()
    const days = screen.getAllByRole('separator', { name: 'Ustun kengligi: kunlar' })
    expect(days.map((h) => h.tabIndex)).toEqual([0, -1, -1])
  })

  it('moves by 8px with the arrow keys, stores it, and sets the variable on the scope', () => {
    const { container } = draw()
    const fact = screen.getByRole('separator', { name: 'Ustun kengligi: Факт' })
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

  it('puts a column back on double click', () => {
    const { container } = draw()
    const plan = screen.getByRole('separator', { name: 'Ustun kengligi: План обший' })
    const label = screen.getByRole('separator', { name: 'Ustun kengligi: Koʻrsatkich' })
    fireEvent.keyDown(plan, { key: 'ArrowRight' })
    fireEvent.keyDown(label, { key: 'ArrowRight' })
    expect(Object.keys(storedWidths()).sort()).toEqual(['label', 'plan'])

    fireEvent.doubleClick(plan)
    expect(Object.keys(storedWidths())).toEqual(['label'])
    const scope = container.querySelector<HTMLElement>('[data-rnp-cols]')!
    expect(scope.style.getPropertyValue('--rnp-w-plan')).toBe('')
    // «Kengliklarni tiklash» was removed at the client's word; nothing offers it.
    expect(screen.queryByRole('button', { name: 'Kengliklarni tiklash' })).toBeNull()
  })

})

describe('RnpSheetTable — План обший, Факт and Прогноз pinned beside the label', () => {
  const observers: { cb: () => void }[] = []

  beforeEach(() => {
    observers.length = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        cb: () => void
        constructor(cb: () => void) {
          this.cb = cb
          observers.push(this)
        }
        observe() {}
        disconnect() {}
      },
    )
    // jsdom lays nothing out: every header cell is 100px wide.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100 } as DOMRect)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function grid(boxWidth: number) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(boxWidth)
    const { container } = render(<RnpSheetTable lines={LINES} blocks={BLOCKS} days={DAYS} today="2026-09-03" />)
    return container.querySelector<HTMLElement>('[data-rnp-grid]')!
  }

  it('pins exactly those three columns, the last carrying the divider', () => {
    grid(1200)
    const heads = screen.getAllByRole('columnheader')
    expect(heads.slice(1, 6).map((th) => th.classList.contains('rnp-pin'))).toEqual([true, true, true, false, false])
    expect(heads.slice(1, 6).map((th) => th.classList.contains('rnp-edge'))).toEqual([false, false, true, false, false])
    const orders = rowNamed(document.body, 'Буюртма сони')
    expect([...orders.querySelectorAll('td')].slice(0, 5).map((td) => td.classList.contains('rnp-pin'))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
  })

  it('offsets each one by the measured widths before it, while the box has room for days', () => {
    const box = grid(1200)
    expect(box.style.getPropertyValue('--rnp-left-plan')).toBe('100px')
    expect(box.style.getPropertyValue('--rnp-left-fact')).toBe('200px')
    expect(box.style.getPropertyValue('--rnp-left-forecast')).toBe('300px')
    expect(box.hasAttribute('data-pin-wide')).toBe(true)
  })

  it('pins only the label on a box too narrow to leave days beside them, and re-measures on resize', () => {
    const box = grid(375)
    expect(box.hasAttribute('data-pin-wide')).toBe(false)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    for (const o of observers) o.cb()
    expect(box.hasAttribute('data-pin-wide')).toBe(true)
  })

  it('keeps the frozen parts as the box’s scroll padding, so Tab never lands a field under them (2026-10-02)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 48 } as DOMRect)
    const box = grid(1200)
    // The label and the three pinned columns, and the header row.
    expect(box.style.scrollPaddingLeft).toBe('400px')
    expect(box.style.scrollPaddingTop).toBe('48px')
    // Narrow, only the label is frozen.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(375)
    for (const o of observers) o.cb()
    expect(box.style.scrollPaddingLeft).toBe('100px')
  })

  it('brings today’s column just right of the frozen block — the toolbar’s «Bugun»', () => {
    const box = grid(1200)
    let left = 100
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => void (left = v) })
    const today = screen.getAllByRole('columnheader').find((th) => th.getAttribute('aria-current') === 'date')!
    // One spy for every element (vitest hands back the prototype's): the box at 20px, today's header at 1 520px.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: 100, left: this === box ? 20 : this === today ? 1520 : 0 } as DOMRect
    })
    scrollToToday(box)
    // 1 500px into the box, less the 400px frozen: today sits at the frozen block's edge.
    expect(box.scrollLeft).toBe(100 + 1500 - 400)
  })

  it('leaves a month without today where it is', () => {
    const { container } = render(<RnpSheetTable lines={LINES} blocks={BLOCKS} days={DAYS} today="2026-10-02" />)
    const box = container.querySelector<HTMLElement>('[data-rnp-grid]')!
    let left = 100
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => void (left = v) })
    scrollToToday(box)
    expect(box.scrollLeft).toBe(100)
  })
})

describe('RnpSheetTable — drag to scroll', () => {
  function grid() {
    const { container } = render(<RnpSheetTable lines={LINES} blocks={BLOCKS} days={DAYS} today="2026-09-03" />)
    const box = container.querySelector<HTMLElement>('[data-rnp-grid]')!
    // jsdom lays nothing out: give the box a scroll position that remembers what it is set to.
    let left = 200
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => void (left = v) })
    box.setPointerCapture = vi.fn()
    box.releasePointerCapture = vi.fn()
    const cell = box.querySelector('tr[data-line="value"] td')!
    return { box, cell }
  }

  it('is one keyboard-reachable scroll region', () => {
    const { box } = grid()
    expect(box.getAttribute('role')).toBe('region')
    expect(box.getAttribute('aria-label')).toBe('RNP jadvali')
    expect(box.tabIndex).toBe(0)
  })

  it('pans the grid sideways once the mouse has moved past the threshold', () => {
    const { box, cell } = grid()
    fireEvent.pointerDown(cell, { pointerType: 'mouse', button: 0, buttons: 1, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(cell, { pointerType: 'mouse', buttons: 1, clientX: 460, pointerId: 1 })
    expect(box.scrollLeft).toBe(240)
    expect(box.hasAttribute('data-panning')).toBe(true)
    expect(box.setPointerCapture).toHaveBeenCalledWith(1)
    fireEvent.pointerMove(cell, { pointerType: 'mouse', buttons: 1, clientX: 560, pointerId: 1 })
    expect(box.scrollLeft).toBe(140)
    fireEvent.pointerUp(cell, { pointerType: 'mouse', clientX: 560, pointerId: 1 })
    expect(box.hasAttribute('data-panning')).toBe(false)
  })

  it('does nothing for a click that stays under the threshold', () => {
    const { box, cell } = grid()
    fireEvent.pointerDown(cell, { pointerType: 'mouse', button: 0, buttons: 1, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(cell, { pointerType: 'mouse', buttons: 1, clientX: 503, pointerId: 1 })
    fireEvent.pointerUp(cell, { pointerType: 'mouse', clientX: 503, pointerId: 1 })
    expect(box.scrollLeft).toBe(200)
    expect(box.setPointerCapture).not.toHaveBeenCalled()
  })

  it('forgets a press released outside the box: a hover with no button held never pans (2026-10-02)', () => {
    const { box, cell } = grid()
    // Pressed, moved straight up out of the grid and released over the page — the box never heard the release.
    fireEvent.pointerDown(cell, { pointerType: 'mouse', button: 0, buttons: 1, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(cell, { pointerType: 'mouse', buttons: 0, clientX: 400, pointerId: 1 })
    expect(box.scrollLeft).toBe(200)
    expect(box.hasAttribute('data-panning')).toBe(false)
    expect(box.setPointerCapture).not.toHaveBeenCalled()
    // And the press is gone, not waiting for the button to come back.
    fireEvent.pointerMove(cell, { pointerType: 'mouse', buttons: 1, clientX: 300, pointerId: 1 })
    expect(box.scrollLeft).toBe(200)
  })

  it('leaves touch, the resize handles and the row labels alone', () => {
    const { box, cell } = grid()
    fireEvent.pointerDown(cell, { pointerType: 'touch', button: 0, buttons: 1, clientX: 500, pointerId: 2 })
    fireEvent.pointerMove(cell, { pointerType: 'touch', buttons: 1, clientX: 400, pointerId: 2 })
    expect(box.scrollLeft).toBe(200)

    const label = box.querySelector('tbody th')!
    fireEvent.pointerDown(label, { pointerType: 'mouse', button: 0, buttons: 1, clientX: 500, pointerId: 3 })
    fireEvent.pointerMove(label, { pointerType: 'mouse', buttons: 1, clientX: 400, pointerId: 3 })
    expect(box.scrollLeft).toBe(200)
    fireEvent.pointerUp(label, { pointerType: 'mouse', clientX: 400, pointerId: 3 })

    const handle = box.querySelector('[role="separator"]')!
    fireEvent.pointerDown(handle, { pointerType: 'mouse', button: 0, buttons: 1, clientX: 500, pointerId: 4 })
    fireEvent.pointerMove(box, { pointerType: 'mouse', buttons: 1, clientX: 400, pointerId: 4 })
    expect(box.scrollLeft).toBe(200)
  })

  it('marks the box once the days have moved, without redrawing a line', () => {
    const { box } = grid()
    fireEvent.scroll(box)
    expect(box.hasAttribute('data-scrolled-x')).toBe(true)
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => 0 })
    fireEvent.scroll(box)
    expect(box.hasAttribute('data-scrolled-x')).toBe(false)
  })
})

/*
  The brand switch filters the sheet and lifts the brand's P&L to the top;
  «ROP» keeps one team under headings of its own (2026-10-06). A line is
  keyed by its place in the payload, so a cut hands every kept line its own
  row back — its memo holds — and never another line's.
*/
describe('RnpSheetTable — a line keeps its key through the brand and ROP cuts', () => {
  const CUT: RnpLine[] = [
    { kind: 'title', row: 4, team: null, label: 'Маркетинг COLLAGEN', sub: 'Хаёт', tone: 'section', brand: 'Collagen' },
    { kind: 'value', row: 102, team: 'Lola', label: 'Продажа (первичка) факт1', sub: 'Лола РОП', tone: 'team', fact: 'plain', bold: true, key: 'lids', brand: 'Collagen' },
    { kind: 'value', row: 106, team: 'Lola', label: 'Сумма факт 1 сум', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: 'sum', brand: 'Collagen' },
    { kind: 'value', row: 140, team: 'Asliddin', label: 'Буюртма сони', sub: 'Аслиддин РОП', tone: 'team', fact: 'plain', bold: false, key: 'kompaniya', brand: 'Zextra' },
    { kind: 'value', row: 250, team: 'Lola', label: 'Логистика  Сумма факт1', sub: 'Лола РОП', tone: 'section', fact: 'fakt', bold: false, key: 'lg:Lola:fakt1', brand: 'Collagen' },
    // The team's part again after its logistics: «ROP» opens a second heading of the same name.
    { kind: 'value', row: 108, team: 'Lola', label: 'Ходим сони', sub: null, tone: 'plain', fact: 'plain', bold: false, key: null, brand: 'Collagen' },
    { kind: 'value', row: 394, team: null, label: 'Коллаген проект', sub: null, tone: 'section', fact: 'fakt', bold: true, key: 'pj:collagen:fakt1', brand: 'Collagen' },
  ]
  const view = (lines: readonly RnpLine[]) => (
    <RnpColumnScope>
      <RnpSheetTable lines={lines} allLines={CUT} blocks={BLOCKS} days={DAYS} today="2026-09-03" />
    </RnpColumnScope>
  )
  const labels = (container: HTMLElement) => bodyRows(container).map((tr) => tr.querySelector('th')!.textContent)

  it('hands a line the brand cut keeps its own row, not the one that stood at its index', () => {
    const { container, rerender } = render(view(brandLines(CUT, 'all')))
    const lids = rowNamed(container, 'Продажа (первичка) факт1')
    const sum = rowNamed(container, 'Сумма факт 1 сум')
    rerender(view(brandLines(CUT, 'Collagen')))
    expect(labels(container)[0]).toBe('Коллаген проект') // the P&L lifted to the top, Zextra's team gone
    expect(rowNamed(container, 'Продажа (первичка) факт1')).toBe(lids)
    expect(rowNamed(container, 'Сумма факт 1 сум')).toBe(sum)
  })

  it('keys every line of a brand and ROP cut apart — two headings of one team included', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { container } = render(view(ropLines(brandLines(CUT, 'Collagen'), 'Lola', 'Лола РОП')))
    expect(labels(container).filter((label) => label === 'Лола РОП — ROP bloki')).toHaveLength(2)
    expect(labels(container)).toHaveLength(7)
    expect(error.mock.calls.filter(([message]) => String(message).includes('same key'))).toEqual([])
    error.mockRestore()
  })
})
