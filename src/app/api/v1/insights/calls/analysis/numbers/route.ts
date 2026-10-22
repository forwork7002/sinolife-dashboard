import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { inboundAnalysisService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * Gated as `/insights/calls/analysis` is: its numbers, phones and contacts, as
 * `/insights/calls/inbound/callers` already hands them out.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'customers' } as const

/** «Kiruvchi tahlil»'s numbers — both groups, each with how it ended — for the list and its CSV. */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await inboundAnalysisService.numbers(period, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
