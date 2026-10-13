import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { targetOverviewQuerySchema } from '@/server/http/queryParams'
import { logger } from '@/server/logging/logger'
import { leadSourcesService, targetService } from '@/server/services/container'
import { withTargetologLeads } from '@/server/services/targetService'

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
 * of the target pages. The `meta` block is Meta Ads spend per targetolog
 * over the same calendar days (Tashkent), from `meta_ad_daily`.
 */
export const GET = getHandler(ACCESS, targetOverviewQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  /*
    The targetolog cards' kval, kval % and «Факт1 мижоз» are «Lidlar»'s `forms`
    block over the same window (`withTargetologLeads`) — read under «Hammasi»
    and cut to the product by the form's owner, as the cards' money is cut by
    the account's. An addition to the cards, never their price: a failed scan
    is logged and the cards draw without those lines. No `leads` gate as on
    «Reklama samarasi»: this screen already lists every targetolog's leads,
    orders and money, phones included, so counts per person add nothing.
  */
  const formsScan = leadSourcesService.targetologForms(period, ctx.timeZone, 'all', { fakt1: true }).then(
    (answer) => answer.forms,
    (error: unknown) => {
      logger.warn({ err: error }, 'Target tahlili kval scan failed; the targetolog cards draw without it')
      return null
    },
  )
  const [overview, forms] = await Promise.all([
    targetService.overview(period, ctx.query.scope, ctx.query.product, ctx.timeZone),
    formsScan,
  ])
  return { data: withTargetologLeads(overview, forms, ctx.query.product), meta: { period: toPeriodDto(period) } }
})
