import { describe, expect, it } from 'vitest'

import { formatDuration } from '@/lib/format'

/**
 * A talk time is read beside other talk times, so the unit is named in the
 * figure itself — «2 daq 47 s», never «2:47», which beside a column of hours
 * reads as either.
 */
describe('formatDuration', () => {
  it('prints under a minute as seconds', () => {
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(9)).toBe('9 s')
    expect(formatDuration(59)).toBe('59 s')
  })

  it('prints minutes and seconds under an hour, dropping a zero remainder', () => {
    expect(formatDuration(60)).toBe('1 daq')
    expect(formatDuration(167)).toBe('2 daq 47 s')
    expect(formatDuration(2717)).toBe('45 daq 17 s')
  })

  it('prints hours and minutes from an hour on, without seconds', () => {
    expect(formatDuration(3600)).toBe('1 soat')
    expect(formatDuration(11_545)).toBe('3 soat 12 daq')
    expect(formatDuration(549_758)).toBe('152 soat 42 daq')
  })

  it('rounds to the nearest second rather than truncating', () => {
    // The mean arrives as talkSec / connected and is rarely whole.
    expect(formatDuration(59.6)).toBe('1 daq')
    expect(formatDuration(0.4)).toBe('0 s')
  })

  it('never prints a negative, which would mean a bug upstream', () => {
    expect(formatDuration(-5)).toBe('0 s')
  })
})
