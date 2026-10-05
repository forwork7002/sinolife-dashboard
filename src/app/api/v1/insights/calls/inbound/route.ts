import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { inboundCallsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'customers' } as const

/**
 * «Kiruvchi qoʻngʻiroqlar» — who rang us, by number, day by day and over the
 * window, grouped by what the CRM held for them (`domain/calls/inboundCalls.ts`).
 * Company-wide like its sibling `/insights/calls`: it names no seller to
 * narrow by. Clamped to `CALL_DATA_FLOOR` and saying so (`floorApplied`).
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await inboundCallsService.report(period, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
