import { getHandler } from '@/server/http/handler'
import { marketingWindowSchema } from '@/server/services/marketingService'
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
 * The two books, side by side.
 *
 * Roistat and Bitrix24 both count orders, sales and revenue, and they disagree
 * — legitimately. Roistat attributes money to the LEAD's date and covers paid
 * traffic only; Bitrix24 counts a won deal on its close date across every
 * pipeline, with the countsAsRevenue guard removing the База duplicate. This
 * endpoint states both numbers and their difference rather than reconciling
 * them, because a reconciled figure would be a third number that neither
 * system believes.
 */
export const GET = getHandler(ACCESS, marketingWindowSchema, async (ctx) => {
  const data = await marketingService.verify(ctx.query, ctx.timeZone, ctx.now)
  return { data, meta: { ledger: 'ROISTAT' as const } }
})
