/**
 * Sales aggregation.
 *
 * Framework-free and pure: every function takes plain records and returns plain
 * results, so the whole engine is unit testable without a database.
 *
 * THE PERIOD SEMANTICS, STATED ONCE
 *
 * "Which deals belong to August?" has more than one defensible answer, and
 * mixing them is how a dashboard ends up internally inconsistent. This codebase
 * commits to the following, and every figure below obeys it:
 *
 *   revenue, dealsWon, dealsLost, conversion  -> by CLOSED date
 *   dealsCreated, pipeline value              -> by CREATED date
 *   openDeals                                 -> point in time, at period end
 *
 * So a deal created in July and won in August contributes to July's created
 * count and to August's revenue. That is the behaviour a sales manager expects:
 * revenue lands when the money is committed, not when the lead arrived.
 */

import {
  type Money,
  averageMoney,
  money,
  sumMoney,
} from '@/server/domain/money/money'
import { type Period, containsInstant } from '@/server/domain/period/period'
import type { DealStatusValue, StageCategoryValue } from '@/server/domain/types'
import { conversionRate } from './metrics'

/**
 * The minimal deal shape analytics needs.
 *
 * Deliberately narrower than the database row: the engine cannot depend on
 * Prisma types without dragging persistence into the domain layer.
 */
export interface AnalyticsDeal {
  readonly id: string
  readonly amountMinor: bigint
  readonly currency: string
  readonly status: DealStatusValue
  readonly stageId: string
  readonly stageCategory: StageCategoryValue
  readonly employeeId: string
  readonly customerId?: string
  readonly sourceId?: string
  readonly createdAtSource: Date
  readonly closedAt?: Date
}

// ---------------------------------------------------------------------------
// Period filters
// ---------------------------------------------------------------------------

/** Deals created within the period. */
export function createdIn(
  deals: readonly AnalyticsDeal[],
  period: Period,
): AnalyticsDeal[] {
  return deals.filter((deal) => containsInstant(period, deal.createdAtSource))
}

/** Deals that reached a final state within the period. */
export function closedIn(
  deals: readonly AnalyticsDeal[],
  period: Period,
): AnalyticsDeal[] {
  return deals.filter(
    (deal) => deal.closedAt !== undefined && containsInstant(period, deal.closedAt),
  )
}

/**
 * Deals still open as at the END of the period.
 *
 * A deal counts if it existed by then and had not closed by then — so a
 * historical period correctly reports the pipeline as it stood at the time,
 * rather than as it stands today.
 */
export function openAsOf(
  deals: readonly AnalyticsDeal[],
  period: Period,
): AnalyticsDeal[] {
  const asOf = period.end.getTime()
  return deals.filter((deal) => {
    if (deal.createdAtSource.getTime() >= asOf) return false
    return deal.closedAt === undefined || deal.closedAt.getTime() >= asOf
  })
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface SalesSummary {
  /** Value of deals WON in the period. */
  readonly revenue: Money
  /** Value of deals CREATED in the period, regardless of outcome. */
  readonly createdValue: Money
  /** Value of deals still open at period end. */
  readonly pipelineValue: Money
  readonly dealsCreated: number
  readonly dealsWon: number
  readonly dealsLost: number
  readonly dealsOpen: number
  /** Mean value of the deals won. Null when nothing was won. */
  readonly averageDeal: Money | null
  /** Won as a share of resolved. Null when nothing resolved. */
  readonly conversionRatePercent: number | null
}

export function summarizeDeals(
  deals: readonly AnalyticsDeal[],
  period: Period,
  currency: string,
): SalesSummary {
  const created = createdIn(deals, period)
  const closed = closedIn(deals, period)
  const open = openAsOf(deals, period)

  const won = closed.filter((deal) => deal.status === 'WON')
  const lost = closed.filter((deal) => deal.status === 'LOST')

  const wonAmounts = won.map((deal) => money(deal.amountMinor, deal.currency))

  return {
    revenue: sumMoney(wonAmounts, currency),
    createdValue: sumMoney(
      created.map((deal) => money(deal.amountMinor, deal.currency)),
      currency,
    ),
    pipelineValue: sumMoney(
      open.map((deal) => money(deal.amountMinor, deal.currency)),
      currency,
    ),
    dealsCreated: created.length,
    dealsWon: won.length,
    dealsLost: lost.length,
    dealsOpen: open.length,
    averageDeal: averageMoney(wonAmounts),
    conversionRatePercent: conversionRate(won.length, lost.length),
  }
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  readonly bucketStart: Date
  readonly bucketEnd: Date
  readonly revenue: Money
  readonly dealsWon: number
  readonly dealsCreated: number
}

