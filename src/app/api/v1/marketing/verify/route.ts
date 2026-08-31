import { getHandler } from '@/server/http/handler'
import { ANALYTICS_READ } from '@/server/http/permissions'
import { marketingWindowSchema } from '@/server/services/marketingService'
import { marketingService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: ANALYTICS_READ, section: 'marketing' } as const

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
