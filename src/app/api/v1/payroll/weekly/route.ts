import { payrollWeekPeriod, toPeriodDto } from '@/server/domain/period/period'
import { payrollWeekQuerySchema } from '@/server/http/queryParams'
import { getHandler } from '@/server/http/handler'
import { payrollService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * «Haftalik daromad» — the weekly income, Monday to Sunday.
 *
 * The same gate as `/payroll/sellers`, for the same reason: it states
 * salaries, so only an ALL-scoped account reaches it.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'payroll' } as const

export const GET = getHandler(ACCESS, payrollWeekQuerySchema, async (ctx) => {
  const period = payrollWeekPeriod(ctx.query.week, ctx.timeZone)
  const data = await payrollService.weekly(period, ctx.currency, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
