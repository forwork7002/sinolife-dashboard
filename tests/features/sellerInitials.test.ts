import { describe, expect, it } from 'vitest'

import { initials } from '@/features/sellers/SellersPage'

/**
 * The floor badge is a number, and it may not become an initial.
 *
 * Every seller on this portal is badged — «Sirojov 115 Davlatbek», «118 Aziza
 * Vafoqulova» — and the badge sits wherever the spelling puts it. Taking the
 * first character of the first two whitespace tokens produced «S1» and «1A»
 * for 227 of the 289 production names, on the podium cards and on the ranked
 * rows, where the ring exists to make a person recognisable at a glance.
 */
describe('the initials on a podium card', () => {
  it('skips the badge wherever it sits', () => {
    expect(initials('Sirojov 115 Davlatbek')).toBe('SD')
    expect(initials('118 Aziza Vafoqulova')).toBe('AV')
    expect(initials('Shahtiyarovna 197 Marjona')).toBe('SM')
    expect(initials('Raxmatullayeva 253 Ruxshona Tolib qizi')).toBe('RR')
  })

  it('splits on a hyphen, because one production row is written that way', () => {
    expect(initials('130-Salomat Shoimova')).toBe('SS')
  })

  it('is unchanged for a name with no badge', () => {
    expect(initials('Abdullayeva Sevinchxon')).toBe('AS')
  })

  it('gives one letter when only one word survives', () => {
    expect(initials('292 Sotuvchi')).toBe('S')
  })

  it('falls back to a dot rather than an empty ring', () => {
    expect(initials('123 456')).toBe('•')
  })
})
