import { z } from 'zod'

import { LEADERBOARD_METRICS } from '@/server/domain/analytics/performance'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { AnalyticsService } from '@/server/services/analyticsService'
import { analyticsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

const schema = analyticsQuerySchema.and(
  z.object({
    // One metric, never a blend. See docs/API.md.
    metric: z.enum(LEADERBOARD_METRICS).default('revenue'),
  }),
)

/**
 * The leaderboard is intentionally company-wide for every role, including
 * SALES — `ctx.scope` is NOT applied here. A ranking each person can only see
 * themselves in is not a ranking, and the standings are the point of the page.
 * Only aggregate per-employee figures are exposed; no individual deals.
 */
export const GET = getHandler('leaderboard:read', schema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(period, ctx.currency, ctx.query, ctx.now)
  const data = await analyticsService.leaderboard(context, ctx.query.metric)
  return { data, meta: AnalyticsService.periodMeta(context) }
})
