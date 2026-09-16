import { describe, expect, it } from 'vitest'

import { formatDuration } from '@/lib/format'

/**
 * A call length is read beside other call lengths, so the format has to sort by
 * eye. Minutes and seconds, zero-padded, with the unit named once — not «167»
 * under a header saying "seconds", which is what a raw count gives and which
 * nobody converts in their head while comparing two rows.
 */
describe('formatDuration', () => {
  it('prints under a minute as seconds', () => {
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(9)).toBe('9 s')
    expect(formatDuration(59)).toBe('59 s')
  })

  it('prints a minute and over as m:ss', () => {
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(167)).toBe('2:47')
    expect(formatDuration(514)).toBe('8:34')
    expect(formatDuration(2717)).toBe('45:17')
  })

  it('rounds to the nearest second rather than truncating', () => {
    // The mean arrives as talkSec / connected and is rarely whole.
    expect(formatDuration(59.6)).toBe('1:00')
    expect(formatDuration(0.4)).toBe('0 s')
  })

  it('never prints a negative, which would mean a bug upstream', () => {
    expect(formatDuration(-5)).toBe('0 s')
  })
})
