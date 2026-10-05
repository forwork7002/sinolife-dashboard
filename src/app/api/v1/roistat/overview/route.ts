import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { roistatOverviewQuerySchema } from '@/server/http/queryParams'
import { roistatService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like «Target tahlili» and «Reklama samarasi». Meta spend
 * carries no employee, a Регистрация lead sits with its registrar, and the
 * ROP and seller cuts set every team side by side on purpose. There is no
 * honest narrowing, so a ROP is refused rather than answered with the company.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'roistat' } as const

/**
 * «Roistat» — Meta Ads spend through to Bitrix24 sales, one cut at a time.
 *
 * The Bitrix24 half is a LEAD COHORT: leads by the day they were registered,
 * and each sale on its origin lead's day (roistatRepository.ts). Meta by
 * the ad account's reporting day over the same Tashkent calendar days.
 * `dim` picks the table's cut; `parent` the campaign (under `adset`) or
 * adset (under `ad`) being drilled into. The tiles and the chart do not
 * depend on either.
 */
export const GET = getHandler(ACCESS, roistatOverviewQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await roistatService.overview(period, { dim: ctx.query.dim, parent: ctx.query.parent }, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
