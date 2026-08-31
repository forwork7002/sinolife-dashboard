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
  const ranks = sortedWon.map((won, index) =>
    index > 0 && sortedWon[index - 1] === won ? -1 : index + 1,
  )
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === -1) ranks[i] = ranks[i - 1]!
  }
  return ranks
}

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
