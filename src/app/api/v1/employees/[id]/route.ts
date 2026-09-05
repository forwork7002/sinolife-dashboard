import { canViewEmployee } from '@/server/auth/rbac'
import { requirePermission } from '@/server/auth/session'
import { getCrmProvider } from '@/server/config/providerFactory'
import {  } from '@/server/domain/money/money'
import { toDeltaDto } from '@/server/domain/analytics/metrics'
import { revenueTrend } from '@/server/domain/analytics/sales'
import { ApiError, toApiError } from '@/server/http/errors'
import { failure, serialise, success } from '@/server/http/envelope'
import { assertSection, periodFrom } from '@/server/http/handler'
import { analyticsQuerySchema, searchParamsToObject } from '@/server/http/queryParams'
import { newCorrelationId } from '@/server/logging/logger'
import { AnalyticsService } from '@/server/services/analyticsService'
import {
  analyticsService,
  dealRepository,
  referenceRepository,
  scopeService,
} from '@/server/services/container'
import { env } from '@/server/config/env'

export const dynamic = 'force-dynamic'

/**
 * Employee drill-down.
 *
 * Written out rather than using `getHandler` because authorisation here is
 * per-RESOURCE, not per-route: a salesperson may open their own page but not a
 * colleague's, and that check needs the id from the path.
 *
 * A forbidden employee returns 404, not 403. A 403 would confirm the record
 * exists, which is itself a disclosure — it tells a salesperson exactly which
 * employee ids are real.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const correlationId = newCorrelationId()
  const provider = getCrmProvider()

  const meta = {
    dataSource: provider.source,
    generatedAt: new Date().toISOString(),
    correlationId,
  }

  try {
    const principal = await requirePermission(request, 'employees:read')
    assertSection(principal, 'structure')
    const { id } = await context.params

    /*
      The scope is the third answer, and a TEAM account needs it.

      A ROP given their own floor may open the cards on it — otherwise the
      board they are allowed to read links to fifteen refusals. 404 rather than
      403 for everyone else, deliberately: a 403 confirms the id names a real
      employee, which is the enumeration oracle this route exists to avoid.
    */
    const scope = await scopeService.resolve(principal)
    if (!canViewEmployee(principal, id, scope)) {
      throw ApiError.notFound('Xodim topilmadi.')
    }

    const employee = await referenceRepository.findEmployeeById(id)
    if (!employee) throw ApiError.notFound('Xodim topilmadi.')

    const query = analyticsQuerySchema.parse(
      searchParamsToObject(new URL(request.url).searchParams),
    )
    const period = periodFrom(query, env.APP_TIMEZONE, new Date())

    const ctx = AnalyticsService.context(
      period,
      env.APP_DEFAULT_CURRENCY,
      { ...query, employeeIds: [id] },
      new Date(),
    )

    const [performance, deals] = await Promise.all([
      analyticsService.employees(ctx, [id]),
      dealRepository.findForAnalysis([ctx.period, ctx.comparison], { employeeIds: [id] }),
    ])

    const row = performance.rows[0]
    if (!row) throw ApiError.notFound('Xodim topilmadi.')

    const body = success(
      {
        employee,
        // employees() now crosses money and the revenue delta into DTO form
        // itself — converting again here would double-wrap.
        current: {
          revenue: row.current.revenue,
          pipeline: row.current.pipelineValue,
          averageDeal: row.current.averageDeal,
          dealsWon: row.current.dealsWon,
          dealsLost: row.current.dealsLost,
          dealsCreated: row.current.dealsCreated,
          dealsOpen: row.current.dealsOpen,
          conversionPercent: row.current.conversionRatePercent,
        },
        deltas: {
          revenue: row.revenueDelta,
          dealsWon: toDeltaDto(row.dealsWonDelta),
        },
        teamSharePercent: row.teamSharePercent,
        versusTeamAveragePercent: row.versusTeamAveragePercent,
        kpiAchievementPercent: row.kpiAchievementPercent,
        trend: revenueTrend(deals, ctx.period, env.APP_DEFAULT_CURRENCY).map((point) => ({
          date: point.bucketStart.toISOString(),
          revenue: Number(point.revenue.amountMinor) / 100,
          dealsWon: point.dealsWon,
          dealsCreated: point.dealsCreated,
        })),
      },
      { ...meta, ...AnalyticsService.periodMeta(ctx) },
    )

    return new Response(serialise(body), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (error) {
    const apiError = toApiError(error)
    return new Response(serialise(failure(apiError, meta)), {
      status: apiError.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
