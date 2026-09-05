import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { KPI_READ } from '@/server/http/permissions'
import { AnalyticsService } from '@/server/services/analyticsService'
import { kpiService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: KPI_READ, section: 'kpi' } as const

export const GET = getHandler(ACCESS, analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(
    period,
    ctx.currency,
    { ...ctx.query, ...ctx.scope },
    ctx.now,
  )
  const data = await kpiService.list(context, ctx.scope.restrictToEmployeeIds)

  /*
    NO PERIOD META ON THIS ONE, on purpose.

    `periodMeta` carries the report window, its comparison and a
    "comparison truncated" flag — and this screen shows no comparison at all,
    so the badge PageShell renders from that flag was a warning about a
    calculation nobody was looking at. The window itself is no more use here:
    the preset picks WHICH plan is in view and then every figure is measured
    over that plan's own dates, which travel in `data.planPeriod` and are
    printed under the page title. Two date ranges on one screen, one of which
    nothing on the page is measured over, is worse than none.
  */
  return { data }
})