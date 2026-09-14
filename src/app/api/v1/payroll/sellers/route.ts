import { payrollPeriod, toPeriodDto } from '@/server/domain/period/period'
import { payrollQuerySchema } from '@/server/http/queryParams'
import { getHandler } from '@/server/http/handler'
import { payrollService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * `analytics:read:all` is the strictest thing this codebase has, and salaries
 * are the strictest thing it now answers. Only an ALL-scoped account holds it,
 * so a ROP or a salesperson is REFUSED rather than served their own row — a
 * payroll narrowed to one team is still everyone-in-that-team's pay, which is
 * not a decision to make by leaving a permission loose. `payroll` is in
 * COMPANY_WIDE in `src/lib/sections.ts` so the admin screen says so before an
 * account is saved, and the service's memo carries no scope for the same
 * reason.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'payroll' } as const

export const GET = getHandler(ACCESS, payrollQuerySchema, async (ctx) => {
  /*
    THE WINDOW IS BUILT FROM THE TWO WORDS THE CLIENT USES — a month and which
    half of it — in Asia/Tashkent, not from a from/to pair the browser worked
    out. `payrollPeriod` carries the reason at length.
  */
  const period = payrollPeriod(ctx.query.month, ctx.query.half, ctx.timeZone)
  const data = await payrollService.sellers(
    period,
    ctx.query.month,
    ctx.query.half,
    ctx.currency,
    ctx.now,
  )
  return { data, meta: { period: toPeriodDto(period) } }
})
