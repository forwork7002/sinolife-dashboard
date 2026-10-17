import {
  comparablePayrollPeriod,
  payrollRangePeriod,
  previousPayrollRange,
  toPeriodDto,
} from '@/server/domain/period/period'
import { payrollRangeQuerySchema } from '@/server/http/queryParams'
import { getHandler } from '@/server/http/handler'
import { payrollService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * «Sana» on Sotuvchilar oyligi — the payroll over days the reader picked
 * (2026-10-17), paid by the table of the tab lit beside the picker.
 *
 * The same gate as `/payroll/sellers`, for the same reason: it states
 * salaries, so only an ALL-scoped account reaches it.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'payroll' } as const

export const GET = getHandler(ACCESS, payrollRangeQuerySchema, async (ctx) => {
  const { from, to, scheme } = ctx.query
  const period = payrollRangePeriod(from, to, ctx.timeZone)
  // As many days just before, cut to the elapsed time while this one runs.
  const before = previousPayrollRange(from, to)
  const previous = comparablePayrollPeriod(
    period,
    payrollRangePeriod(before.from, before.to, ctx.timeZone),
    ctx.now,
  )
  const data = await payrollService.range(scheme, period, previous, ctx.currency, ctx.now)
  return {
    data,
    meta: { period: toPeriodDto(period), comparisonPeriod: toPeriodDto(previous) },
  }
})
