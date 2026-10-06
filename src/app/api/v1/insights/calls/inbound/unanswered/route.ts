import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { inboundCallsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds — the same as `/insights/calls/inbound`. */
const ACCESS = { permission: 'analytics:read:all', section: 'customers' } as const

/**
 * «javobsiz qoldi» on «Kiruvchi qoʻngʻiroqlar», number by number: who rang
 * and never got through, the contact behind them, and whether anyone has rung
 * them back since (`InboundCallsService.unanswered`).
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await inboundCallsService.unanswered(period)
  return { data, meta: { period: toPeriodDto(period) } }
})
