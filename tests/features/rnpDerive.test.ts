import { describe, expect, it } from 'vitest'

import type { RnpLine, RnpRowDto } from '@/features/rnp/rnpApi'
import { dayMonth, dayMonthYear, dayTone, indexTone, ropLines } from '@/features/rnp/rnpDerive'

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
  planKey: null,
  sheet: null,
  tone: 'plain',
  hint: null,
  manual: null,
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
