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
 * Company-wide for every role, exactly like `/analytics/leaderboard` and for
 * the same reason: a ranking each person can only see themselves in is not a
 * ranking. `ctx.scope` is therefore not applied. Only aggregate per-seller
 * figures leave this endpoint; no individual deals.
 *
 * TWO CLOCKS, PICKED BY `?basis=`. The default, 'queue', dates every figure
 * by the order's own arrival in the confirmation queue (C4:NEW) — FAKT 1 is
 * Тасдиқланди, FAKT 2 is Доставланди, the floor's own vocabulary. 'intake'
 * dates by the day the order was TAKEN instead, which is how the client's
 * published dashboard originally scored the floor. `/analytics/leaderboard`
 * answers a third, related question (delivered revenue on `closedAt`) and its
 * total differs from either of these by a wide margin in a typical month, so
 * `data.basis` travels with the payload and the screen prints it.
 */
export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(period, ctx.currency, ctx.query, ctx.now)

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
