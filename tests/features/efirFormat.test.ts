import { describe, expect, it } from 'vitest'

import { NARROW_NBSP, formatPercentUz, formatSomFull } from '@/lib/format'

/**
 * EFIR pul grammatikasi (spec §1): butun sahifada to'liq so'm, guruhlar
 * orasida U+202F, birlik yozilmaydi; foiz vergul bilan va % dan oldin U+202F.
 * Mock (`gen_efir.py`: `money()` va `pct()`) — manba.
 */
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

describe('formatPercentUz — «91,3 %»', () => {
  it('bir o‘nlik, vergul, U+202F va %', () => {
    expect(formatPercentUz(91.3)).toBe(`91,3${NARROW_NBSP}%`)
    expect(formatPercentUz(72.25)).toBe(`72,3${NARROW_NBSP}%`)
  })

  it('butun son o‘nliksiz: 100 % · 95 % · 0 %', () => {
    expect(formatPercentUz(100)).toBe(`100${NARROW_NBSP}%`)
    expect(formatPercentUz(95.0)).toBe(`95${NARROW_NBSP}%`)
    expect(formatPercentUz(0)).toBe(`0${NARROW_NBSP}%`)
  })

  it('null va cheksizlik — chiziqcha', () => {
    expect(formatPercentUz(null)).toBe('—')
    expect(formatPercentUz(Number.NaN)).toBe('—')
  })

  it('nol bo‘lmagan mayda qiymat nol deb yozilmaydi — «<0,1 %»', () => {
    expect(formatPercentUz(0.02)).toBe(`<0,1${NARROW_NBSP}%`)
  })
})
