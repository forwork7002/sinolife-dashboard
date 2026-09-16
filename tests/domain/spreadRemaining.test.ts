import { describe, expect, it } from 'vitest'

import { spreadRemainingMinor } from '@/server/domain/analytics/pulse'

/**
 * THE DASHED LINE MUST ADD UP TO THE FIGURE IT IS DRAWING TOWARDS.
 *
 * Savdo dinamikasi prints a projected FAKT 1 / FAKT 2 in a tile and draws the
 * same projection across the period's remaining buckets. Those are one claim
 * rendered twice, and the only way they stay one claim is if the buckets sum
 * to exactly the money the tile names — which a plain BigInt division does
 * not do, because it truncates once per bucket.
 */
describe('splitting the remainder of a run-rate across the buckets that are left', () => {
  it('sums to exactly what it was given, remainder and all', () => {
    // 100 over 7 is 14 remainder 2 — the case a truncating split loses.
    const parts = spreadRemainingMinor(100n, 7)

    expect(parts).toHaveLength(7)
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n)
  })

  it('never loses a minor unit, over any split a month can ask for', () => {
    /*
      A real month asks this between one and thirty-one times, of an amount in
      the billions of minor units. Truncation there is invisible per bucket and
      persistent in the total — the symptom is a chart that stops short of its
      own headline by an amount nobody can explain.
    */
    for (let buckets = 1; buckets <= 31; buckets++) {
      const remaining = 1_234_567_891n
      const parts = spreadRemainingMinor(remaining, buckets)

      expect(parts).toHaveLength(buckets)
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(remaining)
    }
  })

  it('puts the remainder at the FRONT, and never spreads it wider than one unit', () => {
    const parts = spreadRemainingMinor(10n, 4)

    // 2 2 3 3 would also sum correctly and would make the last days of the
    // month look busier than the first for no reason at all.
    expect(parts).toEqual([3n, 3n, 2n, 2n])
    expect(Number(parts[0]! - parts[parts.length - 1]!)).toBeLessThanOrEqual(1)
  })

  it('draws nothing for a period with no buckets left', () => {
    // A finished period, and the last day of a month, both land here: there is
    // no bucket after the report window, so there is no continuation to draw.
    expect(spreadRemainingMinor(500n, 0)).toEqual([])
    expect(spreadRemainingMinor(500n, -3)).toEqual([])
    expect(spreadRemainingMinor(500n, 2.5)).toEqual([])
  })

  it('draws nothing when the projection is not ahead of what already landed', () => {
    /*
      A downward dashed line reads as money coming back. It cannot arise from
      the run-rate itself — dividing by a fraction below 1 only ever grows the
      figure — but it can arise from a caller that hands this the wrong pair,
      and refusing is how that stays a blank chart rather than a fiction.
    */
    expect(spreadRemainingMinor(0n, 10)).toEqual([])
    expect(spreadRemainingMinor(-1n, 10)).toEqual([])
  })
})
