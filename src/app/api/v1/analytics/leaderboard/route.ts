import { z } from 'zod'

import { LEADERBOARD_METRICS_ALL } from '@/server/domain/analytics/sellerClose'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { AnalyticsService } from '@/server/services/analyticsService'
import { analyticsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

const schema = analyticsQuerySchema.and(
  z.object({
    /**
     * One metric, never a blend. See docs/API.md.
     *
     * Two BASES live in this enum and the difference is not cosmetic:
     * `revenue`, `deals_won`, `conversion` and `kpi_achievement` rank what was
     * DELIVERED; `closed_deals` and `closed_value` rank what the SELLER CLOSED,
     * counted from the history row the seller's won stage leaves behind. Last
     * August those two sets of deals overlapped in 1 152 of 5 375. The default
     * stays `revenue` so no existing link changes meaning.
     */
    metric: z.enum(LEADERBOARD_METRICS_ALL).default('revenue'),
  }),
)

/**
 * The leaderboard is intentionally company-wide for every role, including
 * SALES — `ctx.scope` is NOT applied here. A ranking each person can only see
 * themselves in is not a ranking, and the standings are the point of the page.
 * Only aggregate per-employee figures are exposed; no individual deals.
 *
 * It is company-wide but NOT everyone: it ranks salespeople only, and the
 * `meta.leaderboardScope` block states who that leaves out. No parameter opens
 * it back up to managers — a board that can be switched back to "everyone" is a
 * board that will be read as everyone. See analyticsService.leaderboard.
 */
export const GET = getHandler('leaderboard:read', schema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(period, ctx.currency, ctx.query, ctx.now)
  const { rows, scope, sellerCloseBasis } = await analyticsService.leaderboard(
    context,
    ctx.query.metric,
  )

  // `data` stays the bare row array the overview page also reads.
  return {
    data: rows,
    meta: {
      ...AnalyticsService.periodMeta(context),
      ...AnalyticsService.leaderboardScopeMeta(scope),
      // How `closedCount` / `closedValue` on every row were arrived at, and
      // whether they were measured at all.
      ...AnalyticsService.sellerCloseBasisMeta(sellerCloseBasis),
    },
  }
})
