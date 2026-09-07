import { describe, expect, it } from 'vitest'

/**
 * Equal money, equal rank.
 *
 * The board sorted by won money and used the row's position as its rank, so
 * two sellers on the same amount were told one outranked the other — decided
 * by an internal id. `/analytics/leaderboard` already ranks the same floor
 * 1, 2, 2, 4, and two boards disagreeing about who is second is the kind of
 * thing a bonus argument starts over. This is that rule, isolated.
 */

/** The rule as `SellerBoardService.board` applies it, over sorted rows. */
function ranksFor(sortedWon: readonly bigint[]): number[] {
  return ranksForPairs(sortedWon.map((won) => [won, 0n] as const))
}

/**
 * The real rule: the board orders on FAKT 2 and then FAKT 1, so a rank is
 * shared only when BOTH match.
 */
function ranksForPairs(sorted: readonly (readonly [bigint, bigint])[]): number[] {
  const ranks = sorted.map(([won, ordered], index) => {
    const previous = index > 0 ? sorted[index - 1] : undefined
    return previous && previous[0] === won && previous[1] === ordered ? -1 : index + 1
  })
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === -1) ranks[i] = ranks[i - 1]!
  }
  return ranks
}

/** The sort the ranks are computed over. */
function sort(
  rows: readonly { won: bigint; ordered: bigint; id: string }[],
): { won: bigint; ordered: bigint; id: string }[] {
  return [...rows].sort(
    (a, b) =>
      (b.won > a.won ? 1 : b.won < a.won ? -1 : 0) ||
      (b.ordered > a.ordered ? 1 : b.ordered < a.ordered ? -1 : 0) ||
      a.id.localeCompare(b.id),
  )
}

describe('FAKT 2 first, FAKT 1 second', () => {
  /*
    The client's rule, stated 2026-09-04: «kimda koʻp fakt 1 va fakt 2 boʻlsa
    u yuqori oʻrinda turadi». Delivered money leads because that is what the
    floor is paid on — but delivery takes days, so for most of a working day
    every row holds zero FAKT 2. Ranking on it alone left 55 sellers and
    148 mln soʻm of confirmed work in one undifferentiated tie decided by an
    internal employee id.
  */
  it('orders a young window by FAKT 1 when nobody has delivered', () => {
    const rows = [
      { won: 0n, ordered: 10n, id: 'zz' },
      { won: 0n, ordered: 90n, id: 'aa' },
      { won: 0n, ordered: 50n, id: 'mm' },
    ]
    expect(sort(rows).map((r) => r.id)).toEqual(['aa', 'mm', 'zz'])
    expect(ranksForPairs(sort(rows).map((r) => [r.won, r.ordered] as const))).toEqual([1, 2, 3])
  })

  it('still lets delivered money outrank a bigger confirmed book', () => {
    const rows = [
      { won: 10n, ordered: 10n, id: 'a' },
      { won: 0n, ordered: 900n, id: 'b' },
    ]
    expect(sort(rows).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('shares a rank only when both figures match', () => {
    expect(
      ranksForPairs([
        [90n, 10n],
        [50n, 40n],
        [50n, 40n],
        [50n, 20n],
      ]),
    ).toEqual([1, 2, 2, 4])
  })

  it('separates rows the sort already separated', () => {
    // Level on FAKT 2, apart on FAKT 1 — printing 1, 1 over visibly different
    // rows is what sharing on FAKT 2 alone would have done.
    expect(
      ranksForPairs([
        [50n, 90n],
        [50n, 10n],
      ]),
    ).toEqual([1, 2])
  })

  it('falls back to the id only when both figures are level', () => {
    const rows = [
      { won: 5n, ordered: 5n, id: 'b' },
      { won: 5n, ordered: 5n, id: 'a' },
    ]
    expect(sort(rows).map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('competition ranking on the sellers board', () => {
  it('gives a clear order distinct ranks', () => {
    expect(ranksFor([90n, 80n, 70n])).toEqual([1, 2, 3])
  })

  it('shares a rank between ties and skips the one they used up', () => {
    expect(ranksFor([90n, 80n, 80n, 70n])).toEqual([1, 2, 2, 4])
  })

  it('holds a tie at the top', () => {
    expect(ranksFor([90n, 90n, 50n])).toEqual([1, 1, 3])
  })

  it('makes every seller first when nobody has won anything', () => {
    // The state the medals bug lived in: a whole board of zeros, where
    // position was decided entirely by the tie-break id.
    expect(ranksFor([0n, 0n, 0n, 0n])).toEqual([1, 1, 1, 1])
  })

  it('carries a tie through a run of three', () => {
    expect(ranksFor([100n, 60n, 60n, 60n, 10n])).toEqual([1, 2, 2, 2, 5])
  })
})
