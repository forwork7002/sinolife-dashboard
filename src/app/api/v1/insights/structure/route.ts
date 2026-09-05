import { can } from '@/server/auth/rbac'
import { toPeriodDto } from '@/server/domain/period/period'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'employees:read', section: 'structure' } as const

export const GET = getHandler(ACCESS, analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)

  /*
    THE TREE IS FOR EVERYONE WITH THE SECTION; THE MONEY IS NOT.

    This is the one company-wide screen an OWN-scoped salesperson is meant to
    read — knowing who reports to whom is the whole reason it exists, and it is
    what the client asked it to be wired to the floor for. So the endpoint does
    not take the usual way out of refusing an OWN account at the gate: it serves
    the structure and withholds the figures, which the service turns into nulls
    rather than zeros. `analytics:read:all` is the same permission every other
    company-wide number on this dashboard is behind, so an account either sees
    the company's money everywhere or nowhere.
  */
  const data = await insightsService.structure(period, ctx.currency, {}, {
    viewerEmployeeId: ctx.principal.employeeId,
    withMoney: can(ctx.principal, 'analytics:read:all'),
  })

  return { data, meta: { period: toPeriodDto(period) } }
})
