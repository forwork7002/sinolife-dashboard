import { describe, expect, it } from 'vitest'

import { parseSellerName } from '@/features/sellers/sellerName'

/**
 * `parseSellerName` — the six portal name shapes (EFIR Premium delta 10b).
 * The code is the first 2–4 digit token, taken only when a non-digit token
 * remains; everything else stays in the name, in order.
 */
describe('parseSellerName', () => {
  it('a leading code, with the same number again later: the first is the code, the later one stays', () => {
    expect(parseSellerName('131 sotuvchi 131')).toEqual({ name: 'sotuvchi 131', code: '131' })
  })

  it('a leading code before first and last name', () => {
    expect(parseSellerName('268 Ozoda Yuldosheva')).toEqual({ name: 'Ozoda Yuldosheva', code: '268' })
  })

  it('a code between surname and name', () => {
    expect(parseSellerName('Shahtiyarovna 197 Marjona')).toEqual({ name: 'Shahtiyarovna Marjona', code: '197' })
  })

  it('a Cyrillic name with no code passes through unchanged', () => {
    expect(parseSellerName('Содиков Мурод')).toEqual({ name: 'Содиков Мурод', code: null })
  })

  it('a four-word name with the code inside keeps every other word in order', () => {
    expect(parseSellerName('Raxmatullayeva 253 Ruxshona Tolib qizi')).toEqual({
      name: 'Raxmatullayeva Ruxshona Tolib qizi',
      code: '253',
    })
  })

  it('a one-token name has no code — and a bare number stays the name', () => {
    expect(parseSellerName('Dilnoza')).toEqual({ name: 'Dilnoza', code: null })
    expect(parseSellerName('197')).toEqual({ name: '197', code: null })
  })

  it('«(stajor)» stays in the name; one-digit and five-digit numbers are not codes', () => {
    expect(parseSellerName('Karimova 204 Nilufar (stajor)')).toEqual({ name: 'Karimova Nilufar (stajor)', code: '204' })
    expect(parseSellerName('7 Aziz Rahimov')).toEqual({ name: '7 Aziz Rahimov', code: null })
    expect(parseSellerName('  Aziz   12345  ')).toEqual({ name: 'Aziz 12345', code: null })
  })
})
