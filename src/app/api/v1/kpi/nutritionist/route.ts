import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { sverkaService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like «Sverka» whose counts it reads: MoySklad's half carries
 * no employee of ours to narrow by, so a narrowed account is refused rather
 * than answered with the company — and the card is not drawn for it.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'kpi' } as const

/**
 * «Нутрицолог · Collagen» — the window's Collagen FAKT 1 / FAKT 2 order
 * counts in Bitrix24 and in MoySklad, each priced at the nutritionist's rate.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await sverkaService.nutritionist(period)
  return { data, meta: { period: toPeriodDto(period) } }
})
