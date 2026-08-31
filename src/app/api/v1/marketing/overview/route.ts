import { getHandler } from '@/server/http/handler'
import { ANALYTICS_READ } from '@/server/http/permissions'
import { marketingWindowSchema } from '@/server/services/marketingService'
import { marketingService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: ANALYTICS_READ, section: 'marketing' } as const

/**
 * The marketing band: KPIs, funnel and the daily series.
 *
 * TWO THINGS THIS ROUTE DELIBERATELY DOES NOT DO.
 *
 * It does not take the dashboard-wide `preset`. Every other screen reads
 * Bitrix24, whose history runs from May 2025; this ledger covers only the days
 * the client's sheet covers (2026-07-01 onward at the time of writing). A
 * "this year" preset would silently render an empty band and look broken, so
 * the module carries its own from/to, clamped to the snapshot's own bounds by
 * the service.
 *
 * It does not honour `filial`. The branch scope narrows by the Bitrix employee
 * a deal is assigned to; these rows have no Bitrix employee — their `rop` and
 * `seller` dimensions are names typed into a spreadsheet. Filtering them by our
 * department tree would be a fabrication, so the parameter is ignored and
 * `meta.ledger` tells the client why.
 */
export const GET = getHandler(ACCESS, marketingWindowSchema, async (ctx) => {
  const data = await marketingService.overview(ctx.query, ctx.timeZone, ctx.now)
  return { data, meta: { ledger: 'ROISTAT' as const } }
})
