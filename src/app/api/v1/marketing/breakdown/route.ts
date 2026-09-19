import { getHandler } from '@/server/http/handler'
import { marketingBreakdownSchema } from '@/server/services/marketingService'
import { marketingService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
/**
 * COMPANY-WIDE, AND NOW SAID AT THE GATE.
 *
 * This asked for `ANALYTICS_READ` — the any-of pair every active account holds
 * one half of — which was harmless while a narrowed account was refused
 * everywhere else, and stopped being harmless the moment a ROP could be given
 * a real scope: this ledger has NO employee dimension to narrow by (its `rop`
 * and `seller` columns are names typed into the client's spreadsheet, with no
 * foreign key to our roster), so a scoped caller would have been handed the
 * whole company's advertising spend under a screen that narrows everything
 * else. `analytics:read:all` is the same permission every other
 * un-narrowable screen uses to refuse; the answer for a ROP here is «no», not
 * «all of it».
 */
const ACCESS = { permission: 'analytics:read:all', section: 'marketing' } as const

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
export const GET = getHandler(ACCESS, marketingBreakdownSchema, async (ctx) => {
  const data = await marketingService.breakdown(ctx.query)
  return { data, meta: { ledger: 'ROISTAT' as const } }
})
