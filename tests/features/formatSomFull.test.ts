import { describe, expect, it } from 'vitest'

import { NARROW_NBSP, formatSomFull } from '@/lib/format'

/** To'liq so'm: guruhlar orasida U+202F, birlik yozilmaydi. */
describe('formatSomFull — to‘liq so‘m, U+202F guruhlar', () => {
  it('79 600 000', () => {
    expect(formatSomFull(79_600_000)).toBe(`79${NARROW_NBSP}600${NARROW_NBSP}000`)
    expect(NARROW_NBSP).toBe(' ')
  })

  it('ming va yuzlar: 1 234 · 999 · 0', () => {
    expect(formatSomFull(1_234)).toBe(`1${NARROW_NBSP}234`)
    expect(formatSomFull(999)).toBe('999')
    expect(formatSomFull(0)).toBe('0')
  })

  it('yaxlitlaydi va manfiyni saqlaydi', () => {
    expect(formatSomFull(0.01)).toBe('0')
    expect(formatSomFull(1_000_000_000.4)).toBe(`1${NARROW_NBSP}000${NARROW_NBSP}000${NARROW_NBSP}000`)
    expect(formatSomFull(-2_500)).toBe(`-2${NARROW_NBSP}500`)
  })

  it('birlik yo‘q — «so‘m» satrda uchramaydi', () => {
    expect(formatSomFull(5_100_000)).not.toMatch(/so/)
  })
})
