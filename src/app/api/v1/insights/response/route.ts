import { toPeriodDto } from '@/server/domain/period/period'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { responseService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

export const GET = getHandler('analytics:read:all', analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await responseService.response(period, ctx.currency)
  return { data, meta: { period: toPeriodDto(period) } }
})
