import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { leadSourcesService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like the rest of «Lidlar». A Регистрация lead belongs to the
 * registrar who picked it up and a conversation to the bot, nobody's sales
 * team, and Meta rows carry no employee at all — so there is no honest
 * narrowing, and a ROP is refused rather than answered with the company.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/**
 * «Lid manbalari» — every Регистрация lead by source, the lead forms per
 * targetolog against Meta, and the DM pages' conversations, over the
 * dashboard period, one row per Tashkent day. See leadSourcesService.ts.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await leadSourcesService.overview(period, ctx.timeZone)
  return { data, meta: { period: toPeriodDto(period) } }
})
