import { beforeEach, describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type { InsightsRepository, ConfirmationSellerRatingRow } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'
import { SellerBoardService, resetSellerBoardCache } from '@/server/services/sellerBoardService'

/**
 * THE TEAMS ARE RANKED BY THE SELLERS' RULE, AND THE TELEVISION DEPENDS ON IT.
 *
 * `teamRows` used to order on FAKT 2 alone and break ties on the ROP's name.
 * In a table that printed the figures beside the rank, an alphabetical run
 * of zero-delivery teams was odd; on the floor's television, which seats the
 * first three on a podium and marks each seat «FAKT 1 · tasdiqlangan», it was
 * a false claim — «Asliddin» first on 2 mln confirmed,
 * «Gulzora» fourth on 40 mln, and every «Liderga +N» behind the leader
 * negative. And that is the state the board opens in: the window is «Bugun»
 * and delivery lags confirmation by days, so FAKT 2 is zero for everyone
 * for most of every working day.
 *
 * Driven through `board()` rather than a copy of the rule, so the sellers'
 * rows and the teams' rows are proven to come out of ONE ordering.
 */

/*
  EVERY CASE HERE BUILDS A BOARD FOR THE SAME WINDOW, so without this they
  share one memo entry and every case after the first asserts against the
  first's fixtures. See `resetSellerBoardCache`.
*/
beforeEach(resetSellerBoardCache)

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
    byOutcome: { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 0, REJECTED: 0, UNCONFIRMED_SHIPPED: 0 },
    byOutcomeMinor: {
      CONFIRM_NEW: 0n,
      NO_ANSWER: 0n,
      CONFIRMED: 0n,
      REJECTED: 0n,
      UNCONFIRMED_SHIPPED: 0n,
    },
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

/**
 * THE TEAM IS THE DEAL'S, THE ROW IS THE PERSON'S — 2026-09-26.
 *
 * The rating hands back one slice per seller AND team since the team became
 * the deal's own «Организация сотрудника» snapshot. The team table must sum
 * the slices as they are — money sold for Sevinchxon stays Sevinchxon's after
 * the seller moves — while the sellers' table must print that person once.
 * Measured on 01–25.09.2026: 22 orders, 53.9 mln FAKT 1.
 */
describe('a seller who sold for two teams in one window', () => {
  const moved = [
    rating({
      employeeId: 's',
      rop: 'Sevinchxon',
      lastQueuedAt: new Date('2026-09-10T10:00:00+05:00'),
      cohortOrders: 22,
      confirmedOrders: 22,
      confirmedMinor: mln(54),
      deliveredOrders: 16,
      deliveredMinor: mln(35),
    }),
    rating({
      employeeId: 's',
      rop: 'Sadriddin',
      lastQueuedAt: new Date('2026-09-25T10:00:00+05:00'),
      cohortOrders: 5,
      confirmedOrders: 5,
      confirmedMinor: mln(8),
    }),
    rating({ employeeId: 'd', rop: 'Sadriddin', confirmedMinor: mln(20) }),
  ]

  it('prints the seller once, with both teams’ money, under the newest team', async () => {
    const board = await boardOver(moved)
    const rows = board.rows.filter((r) => r.employeeId === 's')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.rop).toBe('Sadriddin')
    expect(rows[0]!.ordered.amount).toBe(62_000_000)
    expect(rows[0]!.won.amount).toBe(35_000_000)
    expect(rows[0]!.cohortOrders).toBe(27)
    expect(board.totals.sellers).toBe(2)
  })

  it('leaves each order with the team on its deal card', async () => {
    const board = await boardOver(moved)
    const team = (rop: string) => board.teams.find((t) => t.rop === rop)!
    expect(team('Sevinchxon').ordered.amount).toBe(54_000_000)
    expect(team('Sevinchxon').won.amount).toBe(35_000_000)
    expect(team('Sadriddin').ordered.amount).toBe(28_000_000)
    expect(team('Sadriddin').sellers).toBe(2)
    expect(board.totals.teams).toBe(2)
  })

  it('adds up: the teams sum to the same totals the sellers do', async () => {
    const board = await boardOver(moved)
    const teams = board.teams.reduce((a, t) => a + t.ordered.amount, 0)
    const sellers = board.rows.reduce((a, r) => a + r.ordered.amount, 0)
    expect(teams).toBe(sellers)
    expect(teams).toBe(board.totals.ordered.amount)
  })
})
