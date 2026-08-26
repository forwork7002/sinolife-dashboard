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
  zeroMoney,
} from '@/server/domain/money/money'
import { type Period, containsInstant, enumerateBuckets } from '@/server/domain/period/period'
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

export interface AnalyticsDealItem {
  readonly dealId: string
  readonly productId: string
  readonly quantity: number
  readonly totalMinor: bigint
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

/**
 * Bucketed trend across the period.
 *
 * Buckets with no activity are RETAINED with zero values. Dropping them would
 * make a chart's x-axis skip quiet weeks and misrepresent the shape of the
 * business — a flat line and a missing line mean different things.
 */
export function revenueTrend(
  deals: readonly AnalyticsDeal[],
  period: Period,
  currency: string,
  granularity?: Parameters<typeof enumerateBuckets>[1],
): TrendPoint[] {
  const buckets = enumerateBuckets(period, granularity)

  return buckets.map((bucket) => {
    const inBucket = (instant: Date | undefined): boolean =>
      instant !== undefined &&
      instant.getTime() >= bucket.start.getTime() &&
      instant.getTime() < bucket.end.getTime()

    const won = deals.filter((deal) => deal.status === 'WON' && inBucket(deal.closedAt))
    const created = deals.filter((deal) => inBucket(deal.createdAtSource))

    return {
      bucketStart: bucket.start,
      bucketEnd: bucket.end,
      revenue: sumMoney(
        won.map((deal) => money(deal.amountMinor, deal.currency)),
        currency,
      ),
      dealsWon: won.length,
      dealsCreated: created.length,
    }
  })
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface GroupTotal {
  readonly key: string
  readonly revenue: Money
  readonly dealsWon: number
  readonly dealsTotal: number
  /** Share of total revenue, 0-100. Null when total revenue is zero. */
  readonly sharePercent: number | null
}

/**
 * Group won-deal revenue by an arbitrary key.
 *
 * Deals whose key is undefined are collected under `unknownKey` rather than
 * dropped: silently discarding them would make the group totals fail to add up
 * to the headline revenue figure, which is worse than an explicit "unknown".
 */
export function groupRevenue(
  deals: readonly AnalyticsDeal[],
  period: Period,
  currency: string,
  keyOf: (deal: AnalyticsDeal) => string | undefined,
  unknownKey = 'unknown',
): GroupTotal[] {
  const closed = closedIn(deals, period)
  const buckets = new Map<string, { won: Money[]; wonCount: number; total: number }>()

  for (const deal of closed) {
    const key = keyOf(deal) ?? unknownKey
    const entry = buckets.get(key) ?? { won: [], wonCount: 0, total: 0 }
    entry.total += 1
    if (deal.status === 'WON') {
      entry.won.push(money(deal.amountMinor, deal.currency))
      entry.wonCount += 1
    }
    buckets.set(key, entry)
  }

  const totals = [...buckets.entries()].map(([key, entry]) => ({
    key,
    revenue: sumMoney(entry.won, currency),
    dealsWon: entry.wonCount,
    dealsTotal: entry.total,
  }))

  const grandTotal = totals.reduce((sum, item) => sum + item.revenue.amountMinor, 0n)

  return totals
    .map((item) => ({
      ...item,
      sharePercent:
        grandTotal === 0n
          ? null
          : (Number(item.revenue.amountMinor) / Number(grandTotal)) * 100,
    }))
    .sort((a, b) =>
      b.revenue.amountMinor > a.revenue.amountMinor
        ? 1
        : b.revenue.amountMinor < a.revenue.amountMinor
          ? -1
          : a.key.localeCompare(b.key),
    )
}

/**
 * Product revenue, from line items rather than deal totals.
 *
 * Only items belonging to deals WON in the period count — but this is a
 * LINE-ITEM basis and the headline is a deal-amount one, and the portal's two
 * records do not always agree. Over a month they differ by 5.5 mln soʻm across
 * 143 of 3,574 deals. See the note on AnalyticsService.products.
 */
export function productRevenue(
  deals: readonly AnalyticsDeal[],
  items: readonly AnalyticsDealItem[],
  period: Period,
  currency: string,
): GroupTotal[] {
  const wonDealIds = new Set(
    closedIn(deals, period)
      .filter((deal) => deal.status === 'WON')
      .map((deal) => deal.id),
  )

  const buckets = new Map<string, { total: bigint; units: number; deals: Set<string> }>()

  for (const item of items) {
    if (!wonDealIds.has(item.dealId)) continue
    const entry = buckets.get(item.productId) ?? { total: 0n, units: 0, deals: new Set() }
    entry.total += item.totalMinor
    entry.units += item.quantity
    entry.deals.add(item.dealId)
    buckets.set(item.productId, entry)
  }

  const grandTotal = [...buckets.values()].reduce((sum, entry) => sum + entry.total, 0n)

  return [...buckets.entries()]
    .map(([key, entry]) => ({
      key,
      revenue: money(entry.total, currency),
      dealsWon: entry.deals.size,
      dealsTotal: entry.deals.size,
      sharePercent:
        grandTotal === 0n ? null : (Number(entry.total) / Number(grandTotal)) * 100,
    }))
    .sort((a, b) =>
      b.revenue.amountMinor > a.revenue.amountMinor
        ? 1
        : b.revenue.amountMinor < a.revenue.amountMinor
          ? -1
          : a.key.localeCompare(b.key),
    )
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export interface FunnelStep {
  readonly stageId: string
  readonly stageName: string
  readonly sortOrder: number
  readonly category: StageCategoryValue
  readonly dealCount: number
  readonly value: Money
  /** Share of the funnel's entry count, 0-100. Null when nothing entered. */
  readonly reachedPercent: number | null
}

export interface FunnelStageDefinition {
  readonly id: string
  readonly name: string
  readonly sortOrder: number
  readonly category: StageCategoryValue
}

/**
 * Where the deals created in this period currently stand.
 *
 * A snapshot of current position, not a cumulative "ever reached" measure:
 * without stage-transition history we cannot know a deal passed through a
 * stage it has already left. Calling this a conversion funnel would overstate
 * what the data supports, so `reachedPercent` is expressed against the number
 * of deals in the cohort and nothing more.
 */
export function stageFunnel(
  deals: readonly AnalyticsDeal[],
  stages: readonly FunnelStageDefinition[],
  period: Period,
  currency: string,
): FunnelStep[] {
  const cohort = createdIn(deals, period)
  const cohortSize = cohort.length

  const byStage = new Map<string, AnalyticsDeal[]>()
  for (const deal of cohort) {
    const list = byStage.get(deal.stageId) ?? []
    list.push(deal)
    byStage.set(deal.stageId, list)
  }

  return [...stages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((stage) => {
      const stageDeals = byStage.get(stage.id) ?? []
      return {
        stageId: stage.id,
        stageName: stage.name,
        sortOrder: stage.sortOrder,
        category: stage.category,
        dealCount: stageDeals.length,
        value: stageDeals.length
          ? sumMoney(
              stageDeals.map((deal) => money(deal.amountMinor, deal.currency)),
              currency,
            )
          : zeroMoney(currency),
        reachedPercent: cohortSize === 0 ? null : (stageDeals.length / cohortSize) * 100,
      }
    })
}
