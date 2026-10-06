import { describe, expect, it } from 'vitest'

import type { RnpLine, RnpRowDto } from '@/features/rnp/rnpApi'
import { RNP_FIRST_MONTH, brandLines, dayMonth, dayMonthYear, dayTone, indexTone, rnpMonthIn, ropLines } from '@/features/rnp/rnpDerive'

/**
 * The grid's heat tint: a finished day of an additive row with a plan, read
 * against the day's share of it — and nothing else is ever tinted.
 */
const base: RnpRowDto = {
  key: 'k',
  label: 'k',
  unit: 'count',
  additive: true,
  better: 'up',
  plan: 300,
  dayPlan: 10,
  fact: null,
  forecast: null,
  index: null,
  days: [],
  sheet: null,
  tone: 'plain',
  hint: null,
  manual: null,
  planInput: null,
  reliableFrom: null,
}

describe('rnp tones', () => {
  it('grades an index by which way is good', () => {
    expect(indexTone(100, 'up')).toBe('good')
    expect(indexTone(80, 'up')).toBe('warning')
    expect(indexTone(79.9, 'up')).toBe('critical')
    expect(indexTone(100, 'down')).toBe('good')
    expect(indexTone(120, 'down')).toBe('warning')
    expect(indexTone(121, 'down')).toBe('critical')
    expect(indexTone(null, 'up')).toBe('neutral')
  })

  it('tints a finished day against the day plan', () => {
    expect(dayTone(base, 10, '2026-09-01', '2026-09-05')).toBe('good')
    expect(dayTone(base, 9, '2026-09-01', '2026-09-05')).toBe('warning')
    expect(dayTone(base, 7, '2026-09-01', '2026-09-05')).toBe('critical')
  })

  it('never tints today, a day with no figure, an unreliable day, a rate or an unplanned row', () => {
    expect(dayTone(base, 1, '2026-09-05', '2026-09-05')).toBe('neutral')
    expect(dayTone(base, null, '2026-09-01', '2026-09-05')).toBe('neutral')
    expect(dayTone({ ...base, reliableFrom: '2026-09-03' }, 1, '2026-09-01', '2026-09-05')).toBe('neutral')
    expect(dayTone({ ...base, additive: false }, 1, '2026-09-01', '2026-09-05')).toBe('neutral')
    expect(dayTone({ ...base, plan: null, dayPlan: null }, 1, '2026-09-01', '2026-09-05')).toBe('neutral')
  })

  it('writes a day as the sheet does', () => {
    expect(dayMonth('2026-09-01')).toBe('01.09')
    expect(dayMonthYear('2026-09-30')).toBe('30.09.2026')
  })
})

describe('ropLines', () => {
  const line = (key: string | null, team: string | null, row: number): RnpLine => ({
    kind: 'value', row, team, label: `r${row}`, sub: null, tone: 'plain', fact: 'plain', bold: false, key,
  })
  const lines: RnpLine[] = [
    { kind: 'title', row: 4, team: null, label: 'Маркетинг', sub: null, tone: 'section' },
    line('reg:leads', null, 47),
    line('team:Sevinch:reach', 'Sevinch', 89),
    line('team:Sevinch:fakt1', 'Sevinch', 93),
    line('team:Lola:fakt1', 'Lola', 106),
    line('lg:Sevinch:fakt1', 'Sevinch', 274),
  ]

  it('is the whole sheet for «Barchasi»', () => {
    expect(ropLines(lines, null, '')).toBe(lines)
  })

  it('gives one ROP its block and its logistics, each under a heading', () => {
    const got = ropLines(lines, 'Sevinch', 'Севинч РОП')
    expect(got.map((l) => (l.kind === 'title' ? `# ${l.label}` : `${l.row}${l.sub ? ` ${l.sub}` : ''}`))).toEqual([
      '# Севинч РОП — ROP bloki',
      '89',
      '93',
      '# Логистика — Севинч РОП',
      '274',
    ])
  })
})

describe('rnpMonthIn — a month the sheet can open on', () => {
  it('takes a whole month from the overview’s floor to the current one', () => {
    expect(RNP_FIRST_MONTH).toBe('2025-01')
    expect(rnpMonthIn('2025-01', '2026-10')).toBe('2025-01')
    expect(rnpMonthIn('2026-09', '2026-10')).toBe('2026-09')
    expect(rnpMonthIn('2026-10', '2026-10')).toBe('2026-10')
  })

  it('refuses a half-typed year, a future month, one before the floor and anything malformed', () => {
    // What a month box sends while a year is typed digit by digit: never requested.
    for (const v of ['0002-10', '0020-10', '0202-10', '2027-10', '2026-11', '2024-12', '2026-13', '2026-00', '2026-9', '2026-09-01', '', 'abc', null]) {
      expect(rnpMonthIn(v, '2026-10')).toBeNull()
    }
  })
})

describe('brandLines', () => {
  const line = (key: string | null, row: number, brand?: RnpLine['brand']): RnpLine => ({
    kind: 'value', row, team: null, label: `r${row}`, sub: null, tone: 'plain', fact: 'plain', bold: false, key,
    ...(brand ? { brand } : {}),
  })
  const lines: RnpLine[] = [
    line('sv:fakt1', 348),
    line('mk:zextra:spend', 38, 'Zextra'),
    line('mk:collagen:spend', 14, 'Collagen'),
    { kind: 'title', row: 3001, team: null, label: 'Регистрация лид → квал', sub: null, tone: 'section', brand: 'both' },
    line(null, 1001, 'Zextra'),
    line('reg:group:Asliddin:qualified', 1002, 'Zextra'),
    line('team:Asliddin:fakt1', 132, 'Zextra'),
    line('team:Sevinch:fakt1', 93, 'Collagen'),
    line('wh:orders', 265),
    line('team:Hayot:fakt1', 300, 'none'),
    line('pj:zextra:fakt1', 421, 'Zextra'),
    line('pj:zextra:fakt2', 422, 'Zextra'),
  ]

  it('keeps the whole sheet on «Hammasi»', () => {
    expect(brandLines(lines, 'all')).toBe(lines)
  })

  it('keeps one brand\'s lines, its P&L first, the shared heading over its groups', () => {
    expect(brandLines(lines, 'Zextra').map((l) => l.row)).toEqual([421, 422, 38, 3001, 1001, 1002, 132])
  })

  it('leaves out every company-wide line', () => {
    const rows = brandLines(lines, 'Collagen').map((l) => l.row)
    expect(rows).toEqual([14, 3001, 93])
  })
})

describe('brandLines — «Brendsiz»', () => {
  it('keeps only the blocks of the teams on neither list', () => {
    const line = (row: number, brand?: RnpLine['brand']): RnpLine => ({
      kind: 'value', row, team: null, label: `r${row}`, sub: null, tone: 'plain', fact: 'plain', bold: false, key: `k${row}`,
      ...(brand ? { brand } : {}),
    })
    const lines = [line(348), line(93, 'Collagen'), line(132, 'Zextra'), line(300, 'none'), line(301, 'none'), { ...line(3001), brand: 'both' as const }]
    expect(brandLines(lines, 'none').map((l) => l.row)).toEqual([300, 301])
  })
})

describe('brandLines — a brand\'s cut of a company-wide row', () => {
  it('shows the cut under its slice only, never on «Hammasi»', () => {
    const v = (key: string, extra: Partial<Extract<RnpLine, { kind: 'value' }>> = {}): RnpLine => ({
      kind: 'value', row: null, team: null, label: key, sub: null, tone: 'plain', fact: 'plain', bold: false, key, ...extra,
    })
    const lines = [v('reg:group:none:qualified'), v('reg:group:none:qualified:Collagen', { brand: 'Collagen', brandOnly: true }), v('reg:group:none:qualified:none', { brand: 'none', brandOnly: true })]
    expect(brandLines(lines, 'all').map((l) => l.kind === 'value' && l.key)).toEqual(['reg:group:none:qualified'])
    expect(brandLines(lines, 'Collagen').map((l) => l.kind === 'value' && l.key)).toEqual(['reg:group:none:qualified:Collagen'])
    expect(brandLines(lines, 'none').map((l) => l.kind === 'value' && l.key)).toEqual(['reg:group:none:qualified:none'])
  })
})
