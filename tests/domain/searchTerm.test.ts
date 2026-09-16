import { describe, expect, it } from 'vitest'

import { classifySearchTerm, MIN_DIGITS, MIN_TEXT } from '@/lib/searchTerm'

/**
 * WHAT A TYPED TERM IS, decided once for both ends of the wire.
 *
 * The palette and the repository both need to know whether a term is worth
 * a round trip, and they used to disagree: the palette fired from three
 * characters of anything, and «998» — the first three digits of every phone
 * number in the country — reached Postgres as a substring match over all
 * 326 859 customers, once per keystroke, until the number was long enough to
 * mean something. The classifier below is the single answer both sides read.
 */
describe('a number is a number even when it is typed like one', () => {
  it('reads a bare phone number as digits', () => {
    expect(classifySearchTerm('998901234567')).toEqual({
      kind: 'number',
      needle: '998901234567',
      status: 'ok',
    })
  })

  it('strips the punctuation people put in a phone number', () => {
    expect(classifySearchTerm('+998 (90) 123-45-67').needle).toBe('998901234567')
    expect(classifySearchTerm('+998 (90) 123-45-67').kind).toBe('number')
  })

  it('reads a deal id as a number', () => {
    expect(classifySearchTerm('925842')).toMatchObject({ kind: 'number', status: 'ok' })
  })

  it(`calls fewer than ${MIN_DIGITS} digits too short — they identify nobody`, () => {
    expect(classifySearchTerm('998').status).toBe('short')
    expect(classifySearchTerm('9989').status).toBe('short')
    expect(classifySearchTerm('+998 9').status).toBe('short')
    expect(classifySearchTerm('99890').status).toBe('ok')
  })
})

describe('everything else is text', () => {
  it('keeps a name as typed, trimmed', () => {
    expect(classifySearchTerm('  Dilnoza ')).toEqual({ kind: 'text', needle: 'Dilnoza', status: 'ok' })
  })

  it('treats an order code as text, digits and all', () => {
    expect(classifySearchTerm('bx00790')).toMatchObject({ kind: 'text', needle: 'bx00790' })
    expect(classifySearchTerm('bx-1')).toMatchObject({ kind: 'text' })
  })

  it(`calls fewer than ${MIN_TEXT} characters too short`, () => {
    expect(classifySearchTerm('di').status).toBe('short')
    expect(classifySearchTerm('Dil').status).toBe('ok')
  })

  it('calls an empty box empty, not short', () => {
    expect(classifySearchTerm('').status).toBe('empty')
    expect(classifySearchTerm('   ').status).toBe('empty')
  })
})
