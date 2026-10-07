import { describe, expect, it } from 'vitest'

import { safeNext } from '@/lib/safeNext'

/**
 * `?next=` after sign-in must stay on our origin.
 *
 * Each hostile value below passed the old `^\/(?!\/)` regex or would pass a
 * naive "starts with /" check, and resolves cross-origin under the WHATWG
 * parser Next's router uses (`new URL(href, location.href)`). The last
 * assertion of each case proves that claim against the parser itself, so the
 * table cannot rot into strings that were never dangerous.
 */

const ORIGIN = 'https://dash.example.uz'

const HOSTILE = [
  '/\\evil.example', // backslash is a slash to the parser
  '/\\\\evil.example',
  '/\t/evil.example', // TAB is dropped
  '/\n/evil.example', // LF is dropped
  '/\r/evil.example', // CR is dropped
  '/\t\\evil.example',
  '//evil.example',
  '///evil.example',
  'https://evil.example',
  'http:evil.example',
  'javascript:alert(1)',
  ' //evil.example',
  '\\/evil.example',
]

describe('safeNext', () => {
  for (const value of HOSTILE) {
    it(`refuses ${JSON.stringify(value)}`, () => {
      expect(safeNext(value, ORIGIN)).toBe('/')
    })
  }

  it('the backslash/TAB payloads really are cross-origin to the parser', () => {
    for (const value of ['/\\evil.example', '/\t/evil.example', '/\n/evil.example']) {
      expect(new URL(value, ORIGIN).origin).toBe('https://evil.example')
    }
  })

  it('refuses the URL-decoded forms of encoded payloads (?next=%2F%5Cevil, %2F%09%2Fevil)', () => {
    const params = new URLSearchParams('next=%2F%5Cevil.example&tab=%2F%09%2Fevil.example')
    expect(safeNext(params.get('next'), ORIGIN)).toBe('/')
    expect(safeNext(params.get('tab'), ORIGIN)).toBe('/')
  })

  it('keeps a double-encoded value harmless: it is not a path at all', () => {
    const params = new URLSearchParams('next=%252F%255Cevil.example')
    expect(safeNext(params.get('next'), ORIGIN)).toBe('/')
  })

  it('keeps an encoded backslash inside a real path on our origin', () => {
    expect(safeNext('/%5Cevil.example', ORIGIN)).toBe('/%5Cevil.example')
  })

  it('returns a same-origin path unchanged, query and hash included', () => {
    expect(safeNext('/rnp?preset=today', ORIGIN)).toBe('/rnp?preset=today')
    expect(safeNext('/leads?tab=rop#top', ORIGIN)).toBe('/leads?tab=rop#top')
    expect(safeNext('/confirmation', ORIGIN)).toBe('/confirmation')
  })

  it('sends a missing or empty value home', () => {
    expect(safeNext(null, ORIGIN)).toBe('/')
    expect(safeNext(undefined, ORIGIN)).toBe('/')
    expect(safeNext('', ORIGIN)).toBe('/')
    expect(safeNext('rnp', ORIGIN)).toBe('/')
  })
})
