import { describe, expect, it } from 'vitest'

import { CALL_DATA_FLOOR, callFloorApplied, callWindowStart } from '@/lib/callQuality'

/**
 * THE FLOOR IS A MEASURED DATE, and every call query is clamped to it.
 */
describe('the data floor', () => {
  /*
    The truncation ends at 11:00 Tashkent on 2026-09-14, when CALLS moved to
    the half-hourly pass — see the spec §11. The floor is the next whole day,
    so no bucket on the daily chart is half truncated and reads as a dip.
  */
  it('is 2026-09-15 Tashkent midnight — the first whole day imported correctly', () => {
    expect(CALL_DATA_FLOOR.toISOString()).toBe('2026-09-14T19:00:00.000Z')
  })

  it('clamps a window that starts below it, and leaves one above it alone', () => {
    const below = new Date('2026-08-01T00:00:00.000Z')
    const above = new Date('2026-09-20T00:00:00.000Z')

    expect(callWindowStart(below)).toEqual(CALL_DATA_FLOOR)
    expect(callFloorApplied(below)).toBe(true)

    expect(callWindowStart(above)).toEqual(above)
    expect(callFloorApplied(above)).toBe(false)
  })

  it('does not report the floor as applied when the window starts exactly on it', () => {
    // A reader asking for the first honest day is not being given less than
    // they asked for, so the screen must not print the caveat.
    expect(callFloorApplied(CALL_DATA_FLOOR)).toBe(false)
    expect(callWindowStart(CALL_DATA_FLOOR)).toEqual(CALL_DATA_FLOOR)
  })
})
