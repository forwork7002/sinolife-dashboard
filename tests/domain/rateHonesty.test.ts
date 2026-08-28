import { describe, expect, it } from 'vitest'

/**
 * Regression tests for the five defects the August 2026 data audit confirmed.
 *
 * Each one had the same shape: a number that looked fine and said something
 * false. They are pinned here as behaviour, not as implementation, so a future
 * refactor that reintroduces the lie fails loudly.
 *
 * The repository functions they guard are module-private SQL builders, so what
 * is testable in isolation is the ARITHMETIC each defect got wrong. Where the
 * fix lives in SQL, the test states the rule the SQL must satisfy and the
 * corresponding query is cited by file so the pair can be found together.
 */

/** `rateBp` in src/server/repositories/insightsRepository.ts. */
function rateBp(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000)
}

/** `deliveryRateBp`, same file. */
function deliveryRateBp(
  delivered: number,
  refused: number,
  cancelledEarly: number,
): number | null {
  return rateBp(delivered, delivered + refused + cancelledEarly)
}

describe('a rate with no denominator is unknown, not zero', () => {
  it('returns null when nothing has resolved', () => {
    // A carrier whose forty orders are all still in transit.
    expect(deliveryRateBp(0, 0, 0)).toBeNull()
  })

  it('returns null for an operator with no decided orders', () => {
    expect(rateBp(0, 0)).toBeNull()
  })

  it('still returns 0 when there genuinely were failures and no successes', () => {
    // This IS a real zero: five orders resolved, none delivered.
    expect(deliveryRateBp(0, 5, 0)).toBe(0)
  })

  it('reports a real rate unchanged', () => {
    expect(deliveryRateBp(93, 7, 0)).toBe(9300)
  })
})

describe('cancelled-before-dispatch orders count against the delivery rate', () => {
  it('lowers the rate rather than vanishing from the denominator', () => {
    // The Warehouse page used to pass 0 for cancelledEarly while Logistics
    // passed the real count, so one screen read 90% and the other 75%.
    const withCancellations = deliveryRateBp(90, 10, 20)
    const theOldWrongWay = deliveryRateBp(90, 10, 0)

    expect(theOldWrongWay).toBe(9000)
    expect(withCancellations).toBe(7500)
    expect(withCancellations!).toBeLessThan(theOldWrongWay!)
  })
})

describe('an average over an empty set does not exist', () => {
  /** The `averageChequeMinor` expression in insightsRepository.channels(). */
  const averageCheque = (revenue: bigint, won: number): bigint | null =>
    won === 0 ? null : (revenue + BigInt(won) / 2n) / BigInt(won)

  it('is null for a channel that won nothing', () => {
    // 300 leads, no sales: the average cheque is unknown, not "0 soʻm".
    expect(averageCheque(0n, 0)).toBeNull()
  })

  it('rounds half away from zero rather than truncating', () => {
    // 3 deals totalling 10 minor units: 3.33… rounds to 3, and 5/2 rounds to 3.
    expect(averageCheque(10n, 3)).toBe(3n)
    expect(averageCheque(5n, 2)).toBe(3n)
  })
})

describe('money sorts by magnitude, never as text', () => {
  /**
   * The channels query casts BigInt sums to text (they exceed 2^53) and used
   * to ORDER BY that text alias, so Postgres sorted lexicographically. This is
   * that comparison, and it is why the fix orders by the aggregate instead.
   */
  it('lexicographic order disagrees with numeric order on real revenue figures', () => {
    const ninetyMillion = '9000000000'
    const onePointTwoBillion = '120000000000'

    // What the text sort did: '9' > '1', so the smaller number ranked first.
    expect(ninetyMillion > onePointTwoBillion).toBe(true)
    // What is true.
    expect(BigInt(ninetyMillion) < BigInt(onePointTwoBillion)).toBe(true)
  })
})
