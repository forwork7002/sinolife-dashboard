/**
 * KPI orchestration.
 *
 * Evaluates stored targets against live performance using the pure domain
 * functions. Attainment is judged against elapsed pace, so a monthly target
 * does not read as "behind" on the second of the month.
 */

import { toMoneyDto, money } from '@/server/domain/money/money'
import { fromBasisPoints, roundPercent } from '@/server/domain/analytics/metrics'
import {
  type KpiEvaluation,
  evaluateKpi,
  overallAchievementPercent,
  periodElapsedFraction,
} from '@/server/domain/analytics/performance'
import { summarizeDeals } from '@/server/domain/analytics/sales'
import type { KpiMetricValue } from '@/server/domain/types'
import type { DealRepository } from '@/server/repositories/dealRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { AnalyticsContext } from './analyticsService'

/** Which metrics are money, so the client formats them correctly. */
const MONEY_METRICS: ReadonlySet<KpiMetricValue> = new Set(['REVENUE', 'AVERAGE_DEAL'])

export class KpiService {
  constructor(
    private readonly deals: DealRepository,
    private readonly reference: ReferenceRepository,
  ) {}

  async list(ctx: AnalyticsContext, restrictToEmployeeId?: string) {
    const [all, roster] = await Promise.all([
      this.deals.findForAnalysis([ctx.period, ctx.comparison], ctx.filters),
      this.reference.findEmployees(),
    ])

    const visible = restrictToEmployeeId
      ? roster.filter((e) => e.id === restrictToEmployeeId)
      : roster

    const kpis = await this.reference.findKpisForPeriod(
      ctx.period,
      restrictToEmployeeId ? [restrictToEmployeeId] : undefined,
    )

    const nameById = new Map(visible.map((e) => [e.id, e.fullName]))
    const evaluations: (KpiEvaluation & { fullName: string })[] = []

    for (const kpi of kpis) {
      // A KPI belonging to an employee outside the caller's scope is skipped
      // rather than shown without a name.
      if (kpi.employeeId && !nameById.has(kpi.employeeId)) continue

      const summary = summarizeDeals(
        kpi.employeeId ? all.filter((d) => d.employeeId === kpi.employeeId) : all,
        ctx.period,
        ctx.currency,
      )

      evaluations.push({
        ...evaluateKpi(kpi, summary, ctx.period, ctx.now),
        fullName: kpi.employeeId ? (nameById.get(kpi.employeeId) ?? '—') : 'Jamoa',
      })
    }

    const elapsed = periodElapsedFraction(ctx.period, ctx.now)

    return {
      elapsedPercent: roundPercent(elapsed * 100),
      overallPercent: (() => {
        const value = overallAchievementPercent(evaluations)
        return value === null ? null : roundPercent(value)
      })(),

      counts: {
        achieved: evaluations.filter((e) => e.status === 'ACHIEVED').length,
        onTrack: evaluations.filter((e) => e.status === 'ON_TRACK').length,
        atRisk: evaluations.filter((e) => e.status === 'AT_RISK').length,
        behind: evaluations.filter((e) => e.status === 'BEHIND').length,
      },

      items: evaluations
        .map((evaluation) => {
          const isMoney = MONEY_METRICS.has(evaluation.metric)
          const achievement = fromBasisPoints(evaluation.achievementBp)

          return {
            kpiId: evaluation.kpiId,
            employeeId: evaluation.employeeId,
            fullName: evaluation.fullName,
            metric: evaluation.metric,
            unit: isMoney
              ? ('money' as const)
              : evaluation.metric === 'CONVERSION_RATE'
                ? ('percent' as const)
                : ('count' as const),

            // Money targets travel as Money DTOs; counts and rates as numbers.
            target: isMoney
              ? toMoneyDto(money(evaluation.targetValue, ctx.currency))
              : null,
            actual: isMoney ? toMoneyDto(money(evaluation.actualValue, ctx.currency)) : null,
            targetValue: Number(evaluation.targetValue),
            actualValue: Number(evaluation.actualValue),

            achievementPercent: achievement === null ? null : roundPercent(achievement),
            status: evaluation.status,
          }
        })
        .sort((a, b) => (b.achievementPercent ?? -1) - (a.achievementPercent ?? -1)),
    }
  }
}
