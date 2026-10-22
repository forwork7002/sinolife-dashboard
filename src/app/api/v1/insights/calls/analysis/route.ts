import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { inboundAnalysisService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * «Kiruvchi tahlil» under «Qoʻngʻiroqlar», gated as `/insights/calls/inbound`
 * is: the same calls and contacts, company-wide, with no employee to narrow by.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'customers' } as const

/** «Соф янги» and «Қайта мурожат»: the days, the two groups' outcomes, the returning callers' silence and funnel. */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await inboundAnalysisService.report(period, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
