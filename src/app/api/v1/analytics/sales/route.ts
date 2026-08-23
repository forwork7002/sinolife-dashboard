import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { ANALYTICS_READ } from '@/server/http/permissions'
import { AnalyticsService } from '@/server/services/analyticsService'
import { analyticsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

export const GET = getHandler(ANALYTICS_READ, analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(
    period,
    ctx.currency,
    { ...ctx.query, ...ctx.scope },
    ctx.now,
  )
  const data = await analyticsService.sales(context)
  return { data, meta: AnalyticsService.periodMeta(context) }
})