import { beforeEach, describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type { ConfirmationSellerRatingRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'
import { SellerBoardService, resetSellerBoardCache } from '@/server/services/sellerBoardService'

/**
 * THE MEMO IN FRONT OF THE BOARD MAY NOT SERVE ONE ACCOUNT ANOTHER'S ROWS.
 *
 * `SellerBoardService.board` holds a module-level 60-second memo so the floor,
 * which opens this screen together, pays for one build rather than one each.
 * That memo was introduced when the endpoint was company-wide by construction
 * and its own docblock said, correctly, that it had to be deleted the day the
 * route started spreading `ctx.scope`. The route did start: a ROP now reads
 * their own floor. The memo was kept and the SCOPE put in the key instead.
 *
 * Which turns a performance decision into a disclosure question, and this file
 * is the answer to it. Keyed without `restrictToEmployeeIds`, an administrator
 * and a ROP asking for the same window inside the same minute share one entry,
 * and the second one is served the first one's board — the whole company's
 * sellers on a ROP's screen, or a ROP's fifteen rows presented to an
 * administrator as the company. Neither errors. Both are a complete,
 * well-formed board carrying the wrong population, and `data.scoped` on the
 * payload would agree with whichever request happened to build it.
 *
 * The two cases below are the two halves of that: different scopes must NOT
 * share a build, and the same scope MUST — the second is not a nicety, it is
 * the entire reason the memo exists, and a key that accidentally never hits
 * would leave the timeout it was written to stop exactly where it was.
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
 * records the scope it was asked for.
 *
 * Counting the builds is the only honest assertion here. Comparing two
 * returned DTOs would pass on a broken key the moment the fixtures happened to
 * agree, and the fixtures are the one thing a future edit is most likely to
 * touch.
 */
function tracked() {
  const calls: (readonly string[] | null | undefined)[] = []
  let builds = 0
  const insights = {
    // The scope reaches the repository on the WINDOW, not in the filters:
    // `scopedPeriod(period, filters)` folds `restrictToEmployeeIds` into the
    // period before it is passed. See `sellerBoardService.sellerRows`.
    confirmationSellerRating: async (period: { restrictToEmployeeIds?: readonly string[] | null }) => {
      calls.push(period?.restrictToEmployeeIds)
      if (calls.length % CALLS_PER_BUILD === 1) builds += 1
      // Every build is distinguishable, so a shared entry is visible in the rows.
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

  return { board, calls, buildCount: () => calls.length / CALLS_PER_BUILD }
}

describe('the sellers board memo, against the scope it now carries', () => {
  it('does not serve a narrowed account the board built for a wider one', async () => {
    const { board, calls, buildCount } = tracked()

    const everybody = await board(null)
    const oneTeam = await board(['e1', 'e2'])

    // Two questions, two builds — the key told them apart.
    expect(buildCount()).toBe(2)
    expect(calls[0]).toBeNull()
    expect(calls[CALLS_PER_BUILD]).toEqual(['e1', 'e2'])
    // And the answers are the two the repository actually returned, not one twice.
    expect(everybody.rows.map((r) => r.employeeId)).toEqual(['seller-1'])
    expect(oneTeam.rows.map((r) => r.employeeId)).toEqual(['seller-2'])
  })

  it('tells two different teams apart, and does not collapse an empty scope into "everybody"', async () => {
    const { board, buildCount } = tracked()

    await board(['e1'])
    await board(['e2'])
    /*
      `[]` and `null` are DIFFERENT questions everywhere in this codebase: a
      repository tests `ids?.length`, so an empty array reads as "no filter"
      and widens to the whole company. `keyPart` keeps them apart on purpose,
      and if it ever stopped, the widening would be served from a cache under
      a narrowed account's request.
    */
    await board([])
    await board(null)

    expect(buildCount()).toBe(4)
  })

  it('builds once for the readers who are asking the same question', async () => {
    const { board, buildCount } = tracked()

    const [a, b, c] = await Promise.all([board(['e1']), board(['e1']), board(['e1'])])

    // One build for three readers — arriving together is the case the memo is for.
    expect(buildCount()).toBe(1)
    expect(a.rows[0]!.employeeId).toBe('seller-1')
    expect(b.rows[0]!.employeeId).toBe('seller-1')
    expect(c.rows[0]!.employeeId).toBe('seller-1')

    // And a reader arriving after them, inside the TTL, is served the same one.
    const later = await board(['e1'])
    expect(buildCount()).toBe(1)
    expect(later.rows[0]!.employeeId).toBe('seller-1')
  })

  it('sorts the scope, so two callers naming one team in two orders share a build', async () => {
    const { board, buildCount } = tracked()

    await board(['e2', 'e1'])
    await board(['e1', 'e2'])

    expect(buildCount()).toBe(1)
  })
})
