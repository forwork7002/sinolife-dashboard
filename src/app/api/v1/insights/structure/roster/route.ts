import { can } from '@/server/auth/rbac'
import { toPeriodDto } from '@/server/domain/period/period'
import { departmentRosterQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * One department's people, for the panel the org chart opens beside a card.
 *
 * Same gate as the chart itself: an account holding the section may see who
 * works where, and only an account that may see the company's money sees the
 * money. There is deliberately no per-department authorisation and no 404 for
 * a unit outside some scope — the tree this reads from is already served whole
 * to the same caller, so hiding one unit's roster would withhold nothing the
 * chart beside it does not already show.
 */
const ACCESS = { permission: 'employees:read', section: 'structure' } as const

export const GET = getHandler(ACCESS, departmentRosterQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)

  const data = await insightsService.departmentRoster(
    ctx.query.departmentId,
    period,
    ctx.currency,
    { withMoney: can(ctx.principal, 'analytics:read:all') },
  )

  return { data, meta: { period: toPeriodDto(period) } }
})
