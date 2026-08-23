import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { KPI_READ } from '@/server/http/permissions'
import { AnalyticsService } from '@/server/services/analyticsService'
import { kpiService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

export const GET = getHandler(KPI_READ, analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(
    period,
    ctx.currency,
    { ...ctx.query, ...ctx.scope },
    ctx.now,
  )
  const data = await kpiService.list(context, ctx.scope.restrictToEmployeeId)
  return { data, meta: AnalyticsService.periodMeta(context) }
})