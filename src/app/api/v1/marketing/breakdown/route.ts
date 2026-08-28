import { getHandler } from '@/server/http/handler'
import { ANALYTICS_READ } from '@/server/http/permissions'
import { marketingBreakdownSchema } from '@/server/services/marketingService'
import { marketingService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * One dimension's rows, plus the JAMI totals.
 *
 * `dimension` selects the tab (camp, adset, creative, targetolog, form, source,
 * product, region, rop, seller, registrator, days) and `parent` carries the
 * drill-down: adsets of one campaign, creatives of one adset. The totals row
 * is summed from the RAW fields and only then derived — averaging a column of
 * percentages would report a CPL nobody paid and a ROAS nobody earned.
 *
 * Ledger and period semantics are the module's own; see the overview route.
 */
export const GET = getHandler(ANALYTICS_READ, marketingBreakdownSchema, async (ctx) => {
  const data = await marketingService.breakdown(ctx.query)
  return { data, meta: { ledger: 'ROISTAT' as const } }
})
