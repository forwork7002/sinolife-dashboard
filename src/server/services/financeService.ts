/**
 * Finance orchestration.
 *
 * Loads settlement data and hands it to the pure finance domain functions.
 * Contains no arithmetic of its own.
 */

import { toMoneyDto } from '@/server/domain/money/money'
import { toDeltaDto, growth, roundPercent } from '@/server/domain/analytics/metrics'
import {
  ageDebt,
  collectionTrend,
  collectionsByMethod,
  debtByEmployee,
  settleDeals,
  summarizeFinance,
} from '@/server/domain/analytics/finance'
import type { AnalyticsContext } from './analyticsService'
import type { FinanceRepository } from '@/server/repositories/financeRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'

export class FinanceService {
  constructor(
    private readonly finance: FinanceRepository,
    private readonly reference: ReferenceRepository,
  ) {}

  async overview(ctx: AnalyticsContext) {
    const [current, previous, employees] = await Promise.all([
      this.finance.findSettlementData(
        { start: ctx.period.start, end: ctx.period.end },
        ctx.filters,
      ),
      this.finance.findSettlementData(
        { start: ctx.comparison.start, end: ctx.comparison.end },
        ctx.filters,
      ),
      this.reference.findEmployees(),
    ])

    const settled = settleDeals(current.deals, current.payments, ctx.currency)
    const summary = summarizeFinance(settled, ctx.currency)

    const previousSettled = settleDeals(previous.deals, previous.payments, ctx.currency)
    const previousSummary = summarizeFinance(previousSettled, ctx.currency)

    const nameById = new Map(employees.map((e) => [e.id, e.fullName]))

    return {
      summary: {
        invoiced: toMoneyDto(summary.invoiced),
        collected: toMoneyDto(summary.collected),
        outstanding: toMoneyDto(summary.outstanding),
        collectionRatePercent:
          summary.collectionRatePercent === null
            ? null
            : roundPercent(summary.collectionRatePercent),
        paidCount: summary.paidCount,
        partialCount: summary.partialCount,
        unpaidCount: summary.unpaidCount,
        debtorCount: summary.debtorCount,
      },

      deltas: {
        invoiced: toDeltaDto(
          growth(summary.invoiced.amountMinor, previousSummary.invoiced.amountMinor),
        ),
        collected: toDeltaDto(
          growth(summary.collected.amountMinor, previousSummary.collected.amountMinor),
        ),
        outstanding: toDeltaDto(
          growth(summary.outstanding.amountMinor, previousSummary.outstanding.amountMinor),
        ),
        collectionRate: toDeltaDto(
          growth(summary.collectionRatePercent, previousSummary.collectionRatePercent),
        ),
      },

      trend: collectionTrend(current.deals, current.payments, ctx.period, ctx.currency).map(
        (point) => ({
          date: point.bucketStart.toISOString(),
          invoiced: Number(point.invoiced.amountMinor) / 100,
          collected: Number(point.collected.amountMinor) / 100,
        }),
      ),

      byMethod: collectionsByMethod(current.payments, ctx.period, ctx.currency).map((row) => ({
        method: row.method,
        amount: toMoneyDto(row.amount),
        count: row.count,
      })),

      ageing: ageDebt(current.deals, settled, ctx.now, ctx.currency).map((row) => ({
        bucket: row.bucket,
        amount: toMoneyDto(row.amount),
        count: row.count,
      })),

      byEmployee: debtByEmployee(current.deals, settled, ctx.currency)
        .slice(0, 10)
        .map((row) => ({
          employeeId: row.employeeId,
          fullName: nameById.get(row.employeeId) ?? row.employeeId,
          outstanding: toMoneyDto(row.outstanding),
          dealCount: row.dealCount,
        })),
    }
  }

  /** Deals still owing, largest first. */
  async debtors(ctx: AnalyticsContext, limit = 25) {
    const rows = await this.finance.findOutstandingDeals(
      { start: ctx.period.start, end: ctx.period.end },
      ctx.filters,
      200,
    )

    return rows
      .map((row) => {
        const paid = row.payments.reduce((sum, p) => sum + p.amountMinor, 0n)
        const outstanding = row.amountMinor - paid
        return {
          id: row.id,
          title: row.title,
          employee: row.employee,
          customer: row.customer,
          closedAt: row.closedAt?.toISOString() ?? null,
          invoicedMinor: row.amountMinor.toString(),
          paidMinor: paid.toString(),
          outstandingMinor: (outstanding > 0n ? outstanding : 0n).toString(),
          outstanding: Number(outstanding > 0n ? outstanding : 0n) / 100,
          status: paid <= 0n ? 'UNPAID' : paid >= row.amountMinor ? 'PAID' : 'PARTIAL',
        }
      })
      .filter((row) => row.status !== 'PAID')
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, limit)
  }
}
