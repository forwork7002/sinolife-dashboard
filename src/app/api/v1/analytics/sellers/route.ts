import { z } from 'zod'

import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { AnalyticsService } from '@/server/services/analyticsService'
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
 * THE CLOCK IS ORDER INTAKE, not delivery — every figure is bucketed by the
 * day the order was taken, which is the basis the client's own sellers
 * dashboard scores by. `/analytics/leaderboard` answers the other question
 * (delivered revenue) and the two totals differ by a factor of four in a
 * typical month, so `data.basis` travels with the payload and the screen
 * prints it.
 */
export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(period, ctx.currency, ctx.query, ctx.now)

  if (ctx.query.employeeId) {
    return {
      data: await sellerBoardService.sellerDays(context, ctx.query.employeeId),
      meta: AnalyticsService.periodMeta(context),
    }
  }

  return {
    data: await sellerBoardService.board(context),
    meta: AnalyticsService.periodMeta(context),
  }
})
