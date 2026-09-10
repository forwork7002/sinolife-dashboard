import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { ANALYTICS_READ } from '@/server/http/permissions'
import { AnalyticsService } from '@/server/services/analyticsService'
import { pulseService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: ANALYTICS_READ, section: 'sales' } as const

/**
 * The Доставка funnel's kanban columns, for Savdo dinamikasi.
 *
 * IT TAKES A PERIOD AND USES NONE OF IT — `periodFrom` runs only so
 * `periodMeta` can print the same window every other screen prints, and so a
 * reader is never shown a dateless block under a dated header with nothing
 * saying which is which. The figures themselves are a snapshot: an order that
 * arrived in June and is still in VODIY is in VODIY today. `deliveryBoard`
 * carries the whole reasoning.
 *
 * Scope is spread LAST for the usual reason, and it is honoured: a ROP reads
 * their own team's columns. This is NOT the `analytics/sellers` exemption —
 * that one is a leaderboard everybody is meant to see the same way, and this
 * is money standing in a funnel.
 */
export const GET = getHandler(ACCESS, analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(
    period,
    ctx.currency,
    { ...ctx.query, ...ctx.scope },
    ctx.now,
  )
  const data = await pulseService.deliveryBoard(context)
  return { data, meta: AnalyticsService.periodMeta(context) }
})
