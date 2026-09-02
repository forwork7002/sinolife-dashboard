import { previousEquivalent, toPeriodDto } from '@/server/domain/period/period'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { commandCentreService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'overview' } as const

/**
 * The whole home screen in one round trip.
 *
 * Ten queries across five modules, issued together — a home page that fires
 * ten requests spends its budget on handshakes, and any one of them failing
 * leaves the screen half-drawn with no way to say so.
 */
export const GET = getHandler(ACCESS, analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const comparison = previousEquivalent(period)
  const data = await commandCentreService.load(period, ctx.currency)

  /*
    The comparison window travels too.

    Every card on this screen states a change against the previous period, and
    PageShell already renders a "Taqqoslash davri qisqartirildi" badge from
    `comparisonTruncated` — it just never had one to render here, because this
    route sent the period alone. On the 31st of a month, the home screen was
    the one page comparing against a shorter February without saying so.
  */
  return {
    data,
    meta: {
      period: toPeriodDto(period),
      comparisonPeriod: toPeriodDto(comparison),
      comparisonTruncated: comparison.isTruncated,
    },
  }
})
