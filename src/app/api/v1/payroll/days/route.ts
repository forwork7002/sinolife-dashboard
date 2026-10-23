import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { payrollQuerySchema } from '@/server/http/queryParams'
import { payrollService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * The same as `/payroll/sellers`, whose FAKT 2 these are cut by day: salaries
 * are the strictest thing this codebase answers, so only an ALL-scoped account
 * holding «Sotuvchilar oyligi» is served, and a narrowed one is refused.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'payroll' } as const

/** «Maosh jadvali»'s day columns — FAKT 2 per day of the window, per seller and per team label. */
export const GET = getHandler(ACCESS, payrollQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await payrollService.days(period, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
