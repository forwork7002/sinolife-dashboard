import { describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type { InsightsRepository, ConfirmationSellerRatingRow } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'
import { SellerBoardService } from '@/server/services/sellerBoardService'

/**
 * THE TEAMS ARE RANKED BY THE SELLERS' RULE, AND THE TELEVISION DEPENDS ON IT.
 *
 * `teamRows` used to order on FAKT 2 alone and break ties on the ROP's name.
 * In a table that printed the figures beside the rank, an alphabetical run
 * of zero-delivery teams was odd; on the floor's television, which seats the
 * first three on a podium and states «oʻrinlar hozircha FAKT 1 boʻyicha»
 * underneath, it was a false claim — «Asliddin» first on 2 mln confirmed,
 * «Gulzora» fourth on 40 mln, and every «Liderga +N» behind the leader
 * negative. And that is the state the board opens in: the window is «Bugun»
 * and delivery lags confirmation by days, so FAKT 2 is zero for everyone
 * for most of every working day.
 *
 * Driven through `board()` rather than a copy of the rule, so the sellers'
 * rows and the teams' rows are proven to come out of ONE ordering.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-07T09:00:00+05:00')

function rating(
  over: Partial<ConfirmationSellerRatingRow> & Pick<ConfirmationSellerRatingRow, 'employeeId' | 'rop'>,
): ConfirmationSellerRatingRow {
  return {
    fullName: over.employeeId,
    cohortOrders: 1,
    confirmedOrders: 1,
    confirmedMinor: 0n,
    deliveredOrders: 0,
    deliveredMinor: 0n,
    inTransitOrders: 0,
    inTransitMinor: 0n,
    lostAfterConfirmOrders: 0,
    lostAfterConfirmMinor: 0n,
    rejectedOrders: 0,
    ...over,
  }
}

async function boardOver(rows: readonly ConfirmationSellerRatingRow[]) {
  const insights = {
    confirmationSellerRating: async () => [...rows],
  } as unknown as InsightsRepository
  const reference = { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository
  const service = new SellerBoardService({} as SellerBoardRepository, insights, reference)
  // Built by hand rather than through `AnalyticsService.context`, whose module
  // reads `env` at import and would make this a test of the environment.
  const period = resolvePeriod('today', { timeZone: TZ, now: NOW })
  const ctx = {
    period,
    comparison: previousEquivalent(period),
    currency: 'UZS',
    filters: {},
    now: NOW,
  } as unknown as AnalyticsContext
  return service.board(ctx, 'queue')
}

const mln = (n: number) => BigInt(n) * 1_000_000n * 100n

describe('teams on a window nobody has delivered in', () => {
  it('orders the teams by FAKT 1, not by the alphabet', async () => {
    const board = await boardOver([
      rating({ employeeId: 'a1', rop: 'Asliddin', confirmedMinor: mln(2) }),
      rating({ employeeId: 'z1', rop: 'Azizbek', confirmedMinor: mln(15) }),
      rating({ employeeId: 'g1', rop: 'Gulzora', confirmedMinor: mln(25) }),
      rating({ employeeId: 'g2', rop: 'Gulzora', confirmedMinor: mln(15) }),
    ])

    expect(board.teams.map((t) => t.rop)).toEqual(['Gulzora', 'Azizbek', 'Asliddin'])
    expect(board.teams.map((t) => t.rank)).toEqual([1, 2, 3])
    // The sum the team is ranked on is the sum the row prints.
    expect(board.teams[0]!.ordered.amount).toBe(40_000_000)
  })

  it('puts the teams in the same order their sellers come out in', async () => {
    const board = await boardOver([
      rating({ employeeId: 'b', rop: 'Beta', confirmedMinor: mln(9) }),
      rating({ employeeId: 'a', rop: 'Alfa', confirmedMinor: mln(1) }),
      rating({ employeeId: 'c', rop: 'Gamma', confirmedMinor: mln(5) }),
    ])

    const bySeller = board.rows.map((r) => r.rop)
    const byTeam = board.teams.map((t) => t.rop)
    expect(byTeam).toEqual(bySeller)
  })
})

describe('competition ranking between teams', () => {
  it('shares a rank only when both figures match, and skips the one used up', async () => {
    const board = await boardOver([
      rating({ employeeId: 'a', rop: 'Alfa', confirmedMinor: mln(10) }),
      rating({ employeeId: 'b', rop: 'Beta', confirmedMinor: mln(10) }),
      rating({ employeeId: 'c', rop: 'Gamma', confirmedMinor: mln(5) }),
    ])

    expect(board.teams.map((t) => [t.rop, t.rank])).toEqual([
      ['Alfa', 1],
      ['Beta', 1],
      ['Gamma', 3],
    ])
  })

  it('does not share a rank between teams level on FAKT 2 and apart on FAKT 1', async () => {
    const board = await boardOver([
      rating({ employeeId: 'a', rop: 'Alfa', deliveredMinor: mln(3), confirmedMinor: mln(3) }),
      rating({ employeeId: 'b', rop: 'Beta', deliveredMinor: mln(3), confirmedMinor: mln(30) }),
    ])

    expect(board.teams.map((t) => [t.rop, t.rank])).toEqual([
      ['Beta', 1],
      ['Alfa', 2],
    ])
  })

  it('still lets delivered money outrank a bigger confirmed book', async () => {
    const board = await boardOver([
      rating({ employeeId: 'a', rop: 'Alfa', confirmedMinor: mln(900) }),
      rating({ employeeId: 'b', rop: 'Beta', deliveredOrders: 1, deliveredMinor: mln(1), confirmedMinor: mln(1) }),
    ])

    expect(board.teams.map((t) => t.rop)).toEqual(['Beta', 'Alfa'])
  })
})
