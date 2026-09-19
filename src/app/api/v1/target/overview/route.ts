import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { targetOverviewQuerySchema } from '@/server/http/queryParams'
import { targetService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like «Reklama samarasi». A lead in Регистрация belongs to the
 * registrar who picked it up, not to a seller's team, and the Meta Ads half of
 * the payload has no employee on any row. There is no
 * honest narrowing, so a ROP is refused rather than answered with the company.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'target' } as const

/**
 * «Target tahlili» — the leads the ad pages brought in and what became of them.
 *
 * Dated by the deal's CREATION in Bitrix24 (`createdAtSource`): a lead on the
 * day it was registered, and a sale on the day the seller's deal was opened —
 * normally the same day or the next. `?scope=all` counts every source instead
 * of the seven target pages. The `meta` block is Meta Ads spend per targetolog
 * over the same calendar days (Tashkent), from `meta_ad_daily`.
 */
export const GET = getHandler(ACCESS, targetOverviewQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await targetService.overview(period, ctx.query.scope, ctx.query.product, ctx.timeZone)
  return { data, meta: { period: toPeriodDto(period) } }
})
