import { describe, expect, it } from 'vitest'

import type { RnpRowDto } from '@/features/rnp/rnpApi'
import { dayTone, indexTone } from '@/features/rnp/rnpDerive'

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
  share: null,
  tone: 'plain',
  hint: null,
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
})
