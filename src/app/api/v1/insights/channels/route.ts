import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

export const GET = getHandler('analytics:read:all', analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await insightsService.channels(period, ctx.currency)
  return { data }
})
