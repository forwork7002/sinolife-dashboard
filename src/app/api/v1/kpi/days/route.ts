import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { kpiDaysQuerySchema } from '@/server/http/queryParams'
import { sverkaService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like «Sverka» whose deals these are: MoySklad's half carries
 * no employee of ours to narrow by, so a narrowed account is refused rather
 * than answered with the company — and the card is not drawn for it.
 *
 * Gated on «Sverka»'s section, as `/kpi/products` is and for its reason: the
 * days are `/kpi/products` and `/kpi/nutritionist` cut by day, and a day's
 * orders are `/sverka/overview`'s deal rows — sums, products, seller and team
 * — so they reach exactly the accounts that endpoint already answers.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'sverka' } as const

/**
 * «Kunlar boʻyicha · Bitrix24 ↔ MoySklad» — each day's orders, pieces and soʻm
 * on both systems; with `day`, that day's orders and every product of each.
 */
export const GET = getHandler(ACCESS, kpiDaysQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await sverkaService.days(period, ctx.timeZone, ctx.query.basis, ctx.query.brand, ctx.query.day ?? null)
  return { data, meta: { period: toPeriodDto(period) } }
})
