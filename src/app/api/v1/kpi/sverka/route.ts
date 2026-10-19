import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { sverkaService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like «Sverka» whose comparison it is: MoySklad's half carries
 * no employee of ours to narrow by, so a narrowed account is refused rather
 * than answered with the company — and the card is not drawn for it.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'kpi' } as const

/**
 * «Bitrix24 ↔ MoySklad» — «Sverka»'s comparison for the window without its
 * deal and product rows: the pairs, the cash desk, each difference, the teams.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await sverkaService.summary(period)
  return { data, meta: { period: toPeriodDto(period) } }
})
