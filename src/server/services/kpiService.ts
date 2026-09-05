/**
 * KPI orchestration.
 *
 * Evaluates stored targets against live performance using the pure domain
 * functions. Attainment is judged against elapsed pace, so a monthly target
 * does not read as "behind" on the second of the month.
 */

import { toMoneyDto, money } from '@/server/domain/money/money'
import { type Period, toPeriodDto } from '@/server/domain/period/period'
import { fromBasisPoints, roundPercent } from '@/server/domain/analytics/metrics'
import {
  type KpiEvaluation,
  evaluateKpi,
  kpiWindow,
  overallAchievementPercent,
  periodElapsedFraction,
} from '@/server/domain/analytics/performance'
import { summarizeDeals } from '@/server/domain/analytics/sales'
import type { KpiMetricValue } from '@/server/domain/types'
import type { DealRepository } from '@/server/repositories/dealRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { AnalyticsContext } from './analyticsService'

/**
 * The one span that covers every plan on screen.
 *
 * Normally they all share a period and this is that period. It exists for the
 * case where they do not, so the single pace bar over the table is measured
 * against something real rather than against whichever plan happened to sort
 * first.
 */
function widestWindow(windows: readonly Period[]): Period | null {
  if (windows.length === 0) return null

  return windows.reduce((widest, candidate) => ({
    ...widest,
    start: candidate.start < widest.start ? candidate.start : widest.start,
    end: candidate.end > widest.end ? candidate.end : widest.end,
  }))
}

/** Which metrics are money, so the client formats them correctly. */
const MONEY_METRICS: ReadonlySet<KpiMetricValue> = new Set(['REVENUE', 'AVERAGE_DEAL'])

export class KpiService {
  constructor(
    private readonly deals: DealRepository,
    private readonly reference: ReferenceRepository,
  ) {}

  /**
   * The plans in view, each scored over its own period.
   *
   * THE PRESET PICKS THE PLAN; IT DOES NOT NARROW IT. `findKpisForPeriod`
   * matches on the report window's last instant, so "Bugun" on 2 September and
   * "Shu oy" both land on September's plans — and both then read those plans
   * over 1–30 September, which is the only span the targets were written for.
   *
   * This used to summarise over `ctx.period` and take the pace from it too. A
   * one-day window was scored against a whole month's target and the page
   * claimed 79% of the period had elapsed on the 2nd. `kpiWindow` in
   * domain/analytics/performance sets out both failures in full.
   *
   * The deal fetch therefore has to cover the PLAN windows, not the report
   * window, so the KPI read comes first and its windows go into the query.
   */
  async list(ctx: AnalyticsContext, restrictToEmployeeIds?: readonly string[] | null) {
    const [kpis, roster] = await Promise.all([
      this.reference.findKpisForPeriod(
        ctx.period,
        restrictToEmployeeIds?.length ? restrictToEmployeeIds : undefined,
      ),
      this.reference.findEmployees(),
    ])

    /*
      THE PAGE'S FILTERS NARROW THE PLANS TOO.

      `findForAnalysis` below is given `ctx.filters`, so picking one seller in
      the Xodim control narrows the ACTUALS. The plan rows were narrowed only
      by the caller's authorisation scope, so every other seller's target
      stayed on screen with nothing behind it — a table of people reading 0%
      and BEHIND who had simply been filtered out of the numbers.

      A department selection is resolved through the roster, which is the only
      place the tree is known here; the auth restriction is applied on top, so
      two narrowings still narrow.
    */
    const byDepartment = ctx.filters.departmentIds?.length
      ? new Set(
          roster
            .filter((e) => ctx.filters.departmentIds?.includes(e.departmentId ?? ''))
            .map((e) => e.id),
        )
      : null
    const byEmployee = ctx.filters.employeeIds?.length
      ? new Set(ctx.filters.employeeIds)
      : null

    const inScope = (employeeId: string): boolean =>
      (byEmployee === null || byEmployee.has(employeeId)) &&
      (byDepartment === null || byDepartment.has(employeeId))

    const visible = restrictToEmployeeIds?.length
      ? roster.filter((e) => restrictToEmployeeIds.includes(e.id) && inScope(e.id))
      : roster.filter((e) => inScope(e.id))

    const windows = kpis.map((kpi) => kpiWindow(kpi, ctx.period.timeZone))

    /*
      One query wide enough for every plan on screen. `findForAnalysis` spans
      from the earliest start to the latest end, so a mixed set of monthly and
      quarterly plans still costs a single read; `summarizeDeals` narrows each
      row back to its own plan below.

      With no plans at all there is nothing to score and nothing to fetch —
      which is the state the portal is in today, and the reason this screen has
      always rendered em dashes rather than confident zeros.
    */
    const all = windows.length
      ? await this.deals.findForAnalysis(windows, ctx.filters)
      : []

    const nameById = new Map(visible.map((e) => [e.id, e.fullName]))
    const evaluations: (KpiEvaluation & { fullName: string })[] = []

    kpis.forEach((kpi, index) => {
      // A KPI belonging to an employee outside the caller's scope — or outside
      // the filters the reader has set — is skipped rather than shown as a
      // target nobody is working towards.
      if (kpi.employeeId && !nameById.has(kpi.employeeId)) return
      /*
        A COMPANY-WIDE target (employeeId null) is dropped once ANY people
        filter is on. It is a target for everyone, and scoring it against one
        seller's takings would read as that seller missing the whole company's
        plan.
      */
      if (
        !kpi.employeeId &&
        (byEmployee !== null || byDepartment !== null || restrictToEmployeeIds?.length)
      )
        return

      const summary = summarizeDeals(
        kpi.employeeId ? all.filter((d) => d.employeeId === kpi.employeeId) : all,
        windows[index]!,
        ctx.currency,
      )

      evaluations.push({
        ...evaluateKpi(kpi, summary, ctx.period.timeZone, ctx.now),
        fullName: kpi.employeeId ? (nameById.get(kpi.employeeId) ?? '—') : 'Jamoa',
      })
    })

    /*
      ELAPSED IS THE PLAN'S CLOCK, NOT THE REPORT'S.

      Every plan on screen normally shares one period, so the widest window is
      that period. Where they genuinely differ — a quarterly target beside a
      monthly one — the widest is the honest single figure to put behind one
      pace bar, and the plan dates below say what it spans.
    */
    const planWindow = widestWindow(windows)
    const elapsed = planWindow ? periodElapsedFraction(planWindow, ctx.now) : 0

    return {
      /** The span every figure on this screen is measured over. */
      planPeriod: planWindow ? toPeriodDto(planWindow) : null,
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
