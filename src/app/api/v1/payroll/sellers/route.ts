import {
  comparablePayrollPeriod,
  previousEquivalent,
  toPeriodDto,
} from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { payrollQuerySchema } from '@/server/http/queryParams'
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
    THE DASHBOARD'S OWN WINDOW (2026-10-17, the client: «huddi savdo
    dinamikasidek») — the same preset / from / to Savdo dinamikasi sends,
    resolved by the same `periodFrom`, so «Shu oy» here and there is one
    window and its FAKT 2 one number.
  */
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  /*
    «KIM QANCHAGA OʻSGAN»: the dashboard's like period before, cut to the same
    elapsed time while this one runs — «Shu oy» at 11:00 on the 17th against
    1 Sep to 11:00 on 17 Sep, not against the whole of 17 Sep.
  */
  const previous = comparablePayrollPeriod(period, previousEquivalent(period), ctx.now)
  /*
    THE TOOLBAR'S «Boʻlim» AND «ROP» (2026-10-24) — a pick of teams, never a
    scope: who may read this endpoint is still `ACCESS` alone, and a pick
    only chooses which of the company's teams are summed.
  */
  const data = await payrollService.payroll(period, previous, ctx.currency, ctx.now, {
    rops: ctx.query.rops,
    blocks: ctx.query.blocks,
  })
  return {
    data,
    meta: { period: toPeriodDto(period), comparisonPeriod: toPeriodDto(previous) },
  }
})
