import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { reklamaService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE. Meta rows have no employee on them at all, and a Регистрация
 * lead belongs to the registrar who picked it up rather than to a seller's
 * team, so there is no honest narrowing — a ROP is refused, as on «Target
 * tahlili», rather than answered with the company.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'marketing' } as const

/**
 * «Reklama samarasi» — the client's «DM», «Отчёт Т» and lead-quality sheets
 * over the dashboard period, one row per Tashkent day. See reklamaService.ts.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await reklamaService.overview(period, ctx.timeZone)
  return { data, meta: { period: toPeriodDto(period) } }
})
