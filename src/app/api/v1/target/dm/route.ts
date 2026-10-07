import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { targetDmQuerySchema } from '@/server/http/queryParams'
import { reklamaService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Company-wide, for the reason `/target/overview` gives. */
const ACCESS = { permission: 'analytics:read:all', section: 'target' } as const

/**
 * «Target tahlili»'s DM sheet — «Reklama samarasi»'s own DM block, read from
 * the same service, so the two screens print the same murojat, lid, kval,
 * sarf and kval narxi for the same window and product. The product switch is
 * that screen's brand switch (`reklamaOverview`'s `brand`); each product's
 * DM kval price is that screen's «Итог» under the product (`targetDm`).
 */
export const GET = getHandler(ACCESS, targetDmQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await reklamaService.targetDm(period, ctx.timeZone, ctx.query.product)
  return { data, meta: { period: toPeriodDto(period) } }
})
