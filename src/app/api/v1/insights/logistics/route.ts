import { toPeriodDto } from '@/server/domain/period/period'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { ANALYTICS_READ } from '@/server/http/permissions'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/*
  WHO REACHES IT, AND HOW MUCH OF IT THEY READ.

  This asked for `analytics:read:all` until 2026-09-17, and on production a ROP
  given «Logistika natijasi» simply never saw the link: the sidebar hides a
  company-wide section from a narrowed account. The screen did not need to be
  company-wide. Its cohort is the confirmation queue's, which already narrows
  in `classified`, and the two standing statements cut on the same operator —
  so a ROP reads their own team's parcels and an ALL account the company's.

  The any-of pair says exactly that, as on the confirmation queue. The section
  gate is unchanged and still decides who sees the screen at all.
*/
const ACCESS = { permission: ANALYTICS_READ, section: 'logistics' } as const

export const GET = getHandler(ACCESS, analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await insightsService.logistics(period, ctx.currency, ctx.scope)
  return { data, meta: { period: toPeriodDto(period) } }
})
