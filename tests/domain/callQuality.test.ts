import { describe, expect, it } from 'vitest'

import {
  CALL_CUSTOMER_BANDS,
  CALL_DATA_FLOOR,
  CALL_DURATION_BANDS,
  callFloorApplied,
  callWindowStart,
} from '@/lib/callQuality'

/**
 * THE BANDS ARE A PARTITION, AND THE FLOOR IS A MEASURED DATE.
 *
 * `logisticsBuckets.test.ts` is the shape this follows: the business
 * definition has one home, and this file is where the definition itself is
 * checked rather than the SQL built from it. A band added with an overlapping
 * bound would produce a distribution whose shares sum past 100% — a plausible
 * table rather than an error.
 */
describe('the call duration bands', () => {
  it('covers every non-negative duration exactly once', () => {
    expect(CALL_DURATION_BANDS).toHaveLength(6)

    // Ascending, with the open-ended band last and only there.
    const bounds = CALL_DURATION_BANDS.map((band) => band.maxSec)
    expect(bounds[bounds.length - 1]).toBeNull()
    expect(bounds.slice(0, -1)).toEqual([10, 30, 60, 180, 600])

    // No duration falls through, and none matches twice. 0 is a real value —
    // 18 connected calls above the floor carry it.
    for (const seconds of [0, 9, 10, 29, 30, 59, 60, 179, 180, 599, 600, 3600]) {
      const matches = CALL_DURATION_BANDS.filter(
        (band, i) =>
          seconds >= (i === 0 ? 0 : (CALL_DURATION_BANDS[i - 1]!.maxSec ?? 0)) &&
          (band.maxSec === null || seconds < band.maxSec),
      )
      expect(matches, `${seconds}s`).toHaveLength(1)
    }
  })

  it('gives every band its own palette token, none of them the page accent', () => {
    const colours = CALL_DURATION_BANDS.map((band) => band.colour)
    expect(new Set(colours).size).toBe(colours.length)
    for (const colour of colours) expect(colour).toMatch(/^--series-\d$/)
  })
})

describe('the customer call bands', () => {
  it('is 1 / 2-3 / 4-5 / 6+, open-ended last', () => {
    expect(CALL_CUSTOMER_BANDS.map((band) => band.maxCalls)).toEqual([1, 3, 5, null])
  })
})

describe('the data floor', () => {
  /*
    2026-09-13 is where the truncated window ends — see the spec §4. Written as
    a Tashkent midnight, because that is the day boundary every other figure in
    this product uses.
  */
  it('is 2026-09-13 Tashkent midnight', () => {
    expect(CALL_DATA_FLOOR.toISOString()).toBe('2026-09-12T19:00:00.000Z')
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
