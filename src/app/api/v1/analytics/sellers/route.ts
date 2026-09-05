import { z } from 'zod'

import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { AnalyticsService } from '@/server/services/analyticsService'
import { SELLER_BOARD_BASES } from '@/server/services/sellerBoardService'
import { sellerBoardService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'leaderboard:read', section: 'sellers' } as const

const schema = analyticsQuerySchema.and(
  z.object({
    /**
     * One seller's daily rows instead of the whole board.
     *
     * A separate parameter rather than a separate route because the two reads
     * share every filter and the same period resolution; splitting them would
     * duplicate that surface for one extra query.
     */
    employeeId: z.string().min(1).optional(),
    /**
     * Which clock the board reads — see `SellerBoardDto.basis`.
     *
     * Defaults to 'queue', the floor's own FAKT 1 / FAKT 2 definitions. The
     * original 'intake' reading stays reachable rather than deleted: it is
     * the one figure measured against the client's own published dashboard
     * (see `sellerBoardRepository`), so it is the oracle a 'queue' regression
     * gets checked against, not a screen anyone is meant to keep reading.
     */
    basis: z.enum(SELLER_BOARD_BASES).default('queue'),
  }),
)

/**
 * The sellers' board — who brought in what during the period.
 *
 * NARROWED BY THE CALLER'S SCOPE, and it was the one screen that most needed
 * to be. `leaderboard:read` is a permission every active account holds, so
 * this endpoint answered an OWN-scoped salesperson with the whole company's
 * board — 289 people's confirmed and delivered money — while every other
 * company-wide screen refused them at the gate. The docblock here used to
 * argue that a ranking each person can only see themselves in is not a
 * ranking, which is true of a NAME FILTER and was never a reason to hand the
 * firm's numbers to an account scoped away from them.
 *
 * What a narrowed caller gets is their own board: their team's rows, ranked
 * among themselves, with share and totals over the same rows. That is a real
 * ranking — the one a ROP is paid to read — and `data.scope` on the payload
 * says so, so «1-oʻrin» on a team board cannot be misread as first in the
 * company.
 *
 * TWO CLOCKS, PICKED BY `?basis=`. The default, 'queue', dates every figure
 * by the order's own arrival in the confirmation queue (C4:NEW) — FAKT 1 is
 * Тасдиқланди plus Тасдиқланмай чиқди (everything that left the queue as an
 * order), FAKT 2 is Доставланди, the floor's own vocabulary. 'intake'
 * dates by the day the order was TAKEN instead, which is how the client's
 * published dashboard originally scored the floor. `/analytics/leaderboard`
 * answers a third, related question (delivered revenue on `closedAt`) and its
 * total differs from either of these by a wide margin in a typical month, so
 * `data.basis` travels with the payload and the screen prints it.
 */
export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  /*
    SCOPE LAST, the same ordering every narrowed route in this API uses: a
    caller who hand-writes `?employeeIds=` into the address bar narrows their
    own view and cannot widen it, because the restriction is spread on top of
    whatever they asked for and then ANDed in SQL.
  */
  const context = AnalyticsService.context(
    period,
    ctx.currency,
    { ...ctx.query, ...ctx.scope },
    ctx.now,
  )

  if (ctx.query.employeeId) {
    return {
      data: await sellerBoardService.sellerDays(context, ctx.query.employeeId, ctx.query.basis),
      meta: AnalyticsService.periodMeta(context),
    }
  }

  return {
    data: await sellerBoardService.board(context, ctx.query.basis),
    meta: AnalyticsService.periodMeta(context),
  }
})
