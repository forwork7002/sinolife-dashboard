import { toPeriodDto } from '@/server/domain/period/period'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { commandCentreService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * The whole home screen in one round trip.
 *
 * Ten queries across five modules, issued together — a home page that fires
 * ten requests spends its budget on handshakes, and any one of them failing
 * leaves the screen half-drawn with no way to say so.
 */
export const GET = getHandler('analytics:read:all', analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await commandCentreService.load(period, ctx.currency)
  return { data, meta: { period: toPeriodDto(period) } }
})
