import { beforeEach, describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type { ConfirmationSellerRatingRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'
import { SellerBoardService, resetSellerBoardCache } from '@/server/services/sellerBoardService'

/**
 * THE SELLERS BOARD IS COMPANY-WIDE, AND ITS MEMO MAY ONLY BE SHARED BECAUSE
 * OF THAT. This file pins the two halves of one bargain.
 *
 * The board is the floor's television and the client asked for it to be the
 * same for everyone — «sotuvchilar reytingi bo'limi hammaga bir xil ko'rinishi
 * kerak… hamma bir-birini natijasini ko'ra olishi uchun», 2026-09-08 — so it
 * is the single endpoint in this API that admits a narrowed caller and answers
 * with the whole company. Every other screen still narrows, and
 * `routeAccess.test.ts` records this one by name so the absence of `ctx.scope`
 * reads as a decision rather than an oversight.
 *
 * That decision is also what licenses the 60-second memo in front of `board()`
 * to be keyed WITHOUT a scope: two accounts asking for the same window are
 * asking the identical question, so they must share the entry.
 *
 * THE TWO ARE ONE THING, WHICH IS WHY THEY ARE PINNED TOGETHER. The day the
 * board is narrowed again, this memo becomes a disclosure — an administrator
 * and a ROP asking for the same window inside the same minute would share an
 * entry, and the second would be served the first's board: the whole company's
 * sellers on a ROP's screen, or a ROP's fifteen rows presented to an
 * administrator as the floor. Neither errors. Both are a complete,
 * well-formed board carrying the wrong population.
 *
 * So the first case below fails the moment the service starts reading a scope
 * it is not keying on. It is not testing that scoping is wrong; it is testing
 * that the service and its cache still agree about which of the two worlds
 * they are in.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-07T09:00:00+05:00')

beforeEach(resetSellerBoardCache)

function rating(employeeId: string, rop: string, minor: bigint): ConfirmationSellerRatingRow {
  return {
    employeeId,
    rop,
    fullName: employeeId,
    cohortOrders: 1,
    confirmedOrders: 1,
    confirmedMinor: minor,
    deliveredOrders: 0,
    deliveredMinor: 0n,
    inTransitOrders: 0,
    inTransitMinor: 0n,
    lostAfterConfirmOrders: 0,
    lostAfterConfirmMinor: 0n,
    rejectedOrders: 0,
  }
}

/**
 * ONE BOARD IS TWO COHORT CONSTRUCTIONS — the window and the comparison it is
 * measured against — so a build shows up here as two calls, not one. The
 * constant is named rather than folded into each expectation: if the service
 * ever stops fetching the comparison, these counts must fail loudly instead of
 * quietly meaning half of what they say.
 */
const CALLS_PER_BUILD = 2

/**
 * A service whose repository answers a DIFFERENT board on every build, and
 * records the scope it was actually asked for.
 *
 * Recording the scope is the point. Comparing two returned DTOs would pass on
 * a broken key the moment two fixtures happened to agree, and the fixtures are
 * the thing a future edit is most likely to touch.
 */
function tracked() {
  const scopes: (readonly string[] | null | undefined)[] = []
  let builds = 0
  const insights = {
    // The scope would reach the repository on the WINDOW, not in the filters:
    // `scopedPeriod(period, filters)` folds `restrictToEmployeeIds` into the
    // period before it is passed. See `sellerBoardService.sellerRows`.
    confirmationSellerRating: async (period: { restrictToEmployeeIds?: readonly string[] | null }) => {
      scopes.push(period?.restrictToEmployeeIds)
      if (scopes.length % CALLS_PER_BUILD === 1) builds += 1
      return [rating(`seller-${builds}`, `rop-${builds}`, BigInt(builds) * 100n)]
    },
  } as unknown as InsightsRepository
  const reference = { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository
  const service = new SellerBoardService({} as SellerBoardRepository, insights, reference)

  // Built by hand rather than through `AnalyticsService.context`, whose module
  // reads `env` at import and would make this a test of the environment.
  const board = (restrictToEmployeeIds: readonly string[] | null) => {
    const period = resolvePeriod('today', { timeZone: TZ, now: NOW })
    const ctx = {
      period,
      comparison: previousEquivalent(period),
      currency: 'UZS',
      filters: { restrictToEmployeeIds },
      now: NOW,
    } as unknown as AnalyticsContext
    return service.board(ctx, 'queue')
  }

  return { board, scopes, buildCount: () => scopes.length / CALLS_PER_BUILD }
}

describe('the sellers board, company-wide by decision', () => {
  it('never carries a caller’s scope into the query', () => {
    /*
      THE ONE THAT MUST NOT DRIFT. A context arriving with a resolved scope —
      which is what `ctx.scope` would produce if the route ever spread it again
      — must still reach the repository with nothing set, because
      `boardFilters` drops it. If this fails, the service is reading a scope
      while its memo is keyed without one, and the next case is a disclosure
      rather than an optimisation.
    */
    const { board, scopes } = tracked()

    return board(['e1', 'e2']).then(() => {
      expect(scopes).toHaveLength(CALLS_PER_BUILD)
      for (const s of scopes) expect(s ?? null).toBeNull()
    })
  })

  it('answers a narrowed account exactly what it answers an administrator', async () => {
    const { board, buildCount } = tracked()

    const everybody = await board(null)
    const oneTeam = await board(['e1', 'e2'])

    // ONE build, because it is one question. Two accounts, one answer.
    expect(buildCount()).toBe(1)
    expect(oneTeam.rows).toEqual(everybody.rows)
    expect(oneTeam.totals).toEqual(everybody.totals)
  })

  it('builds once for the readers who arrive together', async () => {
    const { board, buildCount } = tracked()

    const [a, b, c] = await Promise.all([board(null), board(null), board(null)])

    // The case the memo exists for: the floor opens this screen together, and
    // each build is two full cohort constructions on a one-vCPU database.
    expect(buildCount()).toBe(1)
    expect(a.rows[0]!.employeeId).toBe('seller-1')
    expect(b.rows[0]!.employeeId).toBe('seller-1')
    expect(c.rows[0]!.employeeId).toBe('seller-1')

    // And a reader arriving after them, inside the TTL, is served the same one.
    const later = await board(null)
    expect(buildCount()).toBe(1)
    expect(later.rows[0]!.employeeId).toBe('seller-1')
  })

  it('still tells the reader’s OWN filters apart', async () => {
    /*
      `employeeIds` is the caller's own pick rather than the server's grant, so
      it stays in the key — it narrows an answer that is already public, and a
      board filtered to one team must not be served to somebody who asked for
      all of them.
    */
    const reference = { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository
    let calls = 0
    const counting = {
      confirmationSellerRating: async () => {
        calls += 1
        return [rating(`s${calls}`, 'Alfa', BigInt(calls) * 100n)]
      },
    } as unknown as InsightsRepository
    const counted = new SellerBoardService({} as SellerBoardRepository, counting, reference)

    const ctxWith = (employeeIds?: readonly string[]) => {
      const period = resolvePeriod('today', { timeZone: TZ, now: NOW })
      return {
        period,
        comparison: previousEquivalent(period),
        currency: 'UZS',
        filters: { employeeIds },
        now: NOW,
      } as unknown as AnalyticsContext
    }

    await counted.board(ctxWith(undefined), 'queue')
    await counted.board(ctxWith(['e1']), 'queue')

    expect(calls / CALLS_PER_BUILD).toBe(2)
  })
})
