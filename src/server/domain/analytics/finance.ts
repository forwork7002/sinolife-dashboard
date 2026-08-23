/**
 * Financial analytics.
 *
 * Pure and framework-free, like the rest of the domain layer.
 *
 * WHAT "INVOICED" MEANS HERE
 * Only WON deals are counted as invoiced. An open deal is a hope, not a
 * receivable, and including one would inflate outstanding debt with money
 * nobody is owed yet. A lost deal is not a receivable either.
 *
 * BITRIX24_INTEGRATION_PENDING
 * Payment data currently comes from the demo provider. Whether the real
 * Bitrix24 portal exposes payments at all is an open question (docs/BITRIX24.md
 * §7), which is why the provider declares a PAYMENTS capability and the API
 * reports the whole section as unavailable rather than as zero when it is
 * absent. Zero outstanding debt and unknown outstanding debt are very
 * different claims to put in front of a finance team.
 */

import {
  CurrencyMismatchError,
  type Money,
  money,
  subtractMoney,
  sumMoney,
  zeroMoney,
} from '@/server/domain/money/money'
import { type Period, containsInstant, enumerateBuckets } from '@/server/domain/period/period'
import type { PaymentMethodValue } from '@/server/domain/types'
import { ratePercent } from './metrics'

/** A won deal and what has been collected against it. */
export interface FinanceDeal {
  readonly dealId: string
  readonly employeeId: string
  readonly amountMinor: bigint
  readonly currency: string
  /** When the deal was won — the moment it became a receivable. */
  readonly closedAt: Date
}

export interface FinancePayment {
  readonly dealId: string
  readonly amountMinor: bigint
  readonly currency: string
  readonly paidAt: Date
  readonly method: PaymentMethodValue
}

export type PaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID'

export interface DealSettlement {
  readonly dealId: string
  readonly invoiced: Money
  readonly collected: Money
  readonly outstanding: Money
  readonly status: PaymentStatus
  /** 0-100. Null when the deal is worth nothing, where a ratio is undefined. */
  readonly collectedPercent: number | null
}

export interface FinanceSummary {
  readonly invoiced: Money
  readonly collected: Money
  readonly outstanding: Money
  /** Collected as a share of invoiced. Null when nothing was invoiced. */
  readonly collectionRatePercent: number | null
  readonly paidCount: number
  readonly partialCount: number
  readonly unpaidCount: number
  /** Deals with any outstanding balance. */
  readonly debtorCount: number
}

/**
 * Settle each deal against its payments.
 *
 * Overpayment is clamped to zero outstanding rather than producing a negative
 * balance: a negative receivable is a credit note, which this model does not
 * represent, and letting it net off other deals' debt would understate the
 * total owed.
 */
export function settleDeals(
  deals: readonly FinanceDeal[],
  payments: readonly FinancePayment[],
  currency: string,
): DealSettlement[] {
  const expected = currency.toUpperCase()

  const paidByDeal = new Map<string, bigint>()
  for (const payment of payments) {
    // A payment in a different currency cannot simply be added to the balance.
    // Silently summing them would produce a total that is not money in any
    // currency — and the error would surface as an inexplicably wrong debt.
    if (payment.currency.toUpperCase() !== expected) {
      throw new CurrencyMismatchError(expected, payment.currency)
    }
    paidByDeal.set(payment.dealId, (paidByDeal.get(payment.dealId) ?? 0n) + payment.amountMinor)
  }

  return deals.map((deal) => {
    if (deal.currency.toUpperCase() !== expected) {
      throw new CurrencyMismatchError(expected, deal.currency)
    }

    const invoiced = money(deal.amountMinor, deal.currency)
    const rawCollected = paidByDeal.get(deal.dealId) ?? 0n
    const collected = money(rawCollected, deal.currency)

    const outstandingMinor = deal.amountMinor - rawCollected
    const outstanding = money(
      outstandingMinor > 0n ? outstandingMinor : 0n,
      deal.currency,
    )

    const status: PaymentStatus =
      rawCollected <= 0n ? 'UNPAID' : rawCollected >= deal.amountMinor ? 'PAID' : 'PARTIAL'

    return {
      dealId: deal.dealId,
      invoiced,
      collected,
      outstanding,
      status,
      collectedPercent: ratePercent(rawCollected, deal.amountMinor),
    }
  })
}

export function summarizeFinance(
  settlements: readonly DealSettlement[],
  currency: string,
): FinanceSummary {
  if (settlements.length === 0) {
    return {
      invoiced: zeroMoney(currency),
      collected: zeroMoney(currency),
      outstanding: zeroMoney(currency),
      // Nothing invoiced means no collection rate exists. Reporting 0% would
      // claim a failure to collect that never happened.
      collectionRatePercent: null,
      paidCount: 0,
      partialCount: 0,
      unpaidCount: 0,
      debtorCount: 0,
    }
  }

  const invoiced = sumMoney(
    settlements.map((s) => s.invoiced),
    currency,
  )
  const collected = sumMoney(
    settlements.map((s) => s.collected),
    currency,
  )

  return {
    invoiced,
    collected,
    // Summed per deal, so an overpaid deal cannot cancel another's debt.
    outstanding: sumMoney(
      settlements.map((s) => s.outstanding),
      currency,
    ),
    collectionRatePercent: ratePercent(collected.amountMinor, invoiced.amountMinor),
    paidCount: settlements.filter((s) => s.status === 'PAID').length,
    partialCount: settlements.filter((s) => s.status === 'PARTIAL').length,
    unpaidCount: settlements.filter((s) => s.status === 'UNPAID').length,
    debtorCount: settlements.filter((s) => s.outstanding.amountMinor > 0n).length,
  }
}

/** Collections received in the period, split by payment method. */
export function collectionsByMethod(
  payments: readonly FinancePayment[],
  period: Period,
  currency: string,
): { readonly method: PaymentMethodValue; readonly amount: Money; readonly count: number }[] {
  const inPeriod = payments.filter((p) => containsInstant(period, p.paidAt))
  const buckets = new Map<PaymentMethodValue, { total: bigint; count: number }>()

  for (const payment of inPeriod) {
    const entry = buckets.get(payment.method) ?? { total: 0n, count: 0 }
    entry.total += payment.amountMinor
    entry.count += 1
    buckets.set(payment.method, entry)
  }

  return [...buckets.entries()]
    .map(([method, entry]) => ({
      method,
      amount: money(entry.total, currency),
      count: entry.count,
    }))
    .sort((a, b) => (b.amount.amountMinor > a.amount.amountMinor ? 1 : -1))
}

export interface CollectionPoint {
  readonly bucketStart: Date
  readonly bucketEnd: Date
  readonly invoiced: Money
  readonly collected: Money
}

/**
 * Invoiced versus collected over time.
 *
 * Both series share one currency and one axis, so they are directly
 * comparable — the gap between the lines IS the debt accruing. Two y-scales
 * would let the gap be drawn to any width the author liked.
 */
export function collectionTrend(
  deals: readonly FinanceDeal[],
  payments: readonly FinancePayment[],
  period: Period,
  currency: string,
): CollectionPoint[] {
  return enumerateBuckets(period).map((bucket) => {
    const within = (instant: Date) =>
      instant.getTime() >= bucket.start.getTime() && instant.getTime() < bucket.end.getTime()

    return {
      bucketStart: bucket.start,
      bucketEnd: bucket.end,
      invoiced: sumMoney(
        deals.filter((d) => within(d.closedAt)).map((d) => money(d.amountMinor, d.currency)),
        currency,
      ),
      collected: sumMoney(
        payments.filter((p) => within(p.paidAt)).map((p) => money(p.amountMinor, p.currency)),
        currency,
      ),
    }
  })
}

/**
 * How overdue each unpaid balance is, bucketed the way a finance team reads it.
 *
 * Age runs from the day the deal was won, since that is when it became a
 * receivable. Deals with nothing outstanding are excluded entirely rather than
 * appearing as a zero row.
 */
export const AGEING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const
export type AgeingBucket = (typeof AGEING_BUCKETS)[number]

export function ageDebt(
  deals: readonly FinanceDeal[],
  settlements: readonly DealSettlement[],
  asOf: Date,
  currency: string,
): { readonly bucket: AgeingBucket; readonly amount: Money; readonly count: number }[] {
  const dealById = new Map(deals.map((d) => [d.dealId, d]))
  const totals = new Map<AgeingBucket, { total: bigint; count: number }>()
  for (const bucket of AGEING_BUCKETS) totals.set(bucket, { total: 0n, count: 0 })

  for (const settlement of settlements) {
    if (settlement.outstanding.amountMinor <= 0n) continue

    const deal = dealById.get(settlement.dealId)
    if (!deal) continue

    const ageDays = Math.floor(
      (asOf.getTime() - deal.closedAt.getTime()) / 86_400_000,
    )

    const bucket: AgeingBucket =
      ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+'

    const entry = totals.get(bucket)!
    entry.total += settlement.outstanding.amountMinor
    entry.count += 1
  }

  // Every bucket is returned, empty ones included: a missing 90+ row and a
  // 90+ row reading zero mean different things to whoever chases the debt.
  return AGEING_BUCKETS.map((bucket) => ({
    bucket,
    amount: money(totals.get(bucket)!.total, currency),
    count: totals.get(bucket)!.count,
  }))
}

/** Outstanding balance per employee, largest first. */
export function debtByEmployee(
  deals: readonly FinanceDeal[],
  settlements: readonly DealSettlement[],
  currency: string,
): { readonly employeeId: string; readonly outstanding: Money; readonly dealCount: number }[] {
  const dealById = new Map(deals.map((d) => [d.dealId, d]))
  const totals = new Map<string, { total: bigint; count: number }>()

  for (const settlement of settlements) {
    if (settlement.outstanding.amountMinor <= 0n) continue
    const deal = dealById.get(settlement.dealId)
    if (!deal) continue

    const entry = totals.get(deal.employeeId) ?? { total: 0n, count: 0 }
    entry.total += settlement.outstanding.amountMinor
    entry.count += 1
    totals.set(deal.employeeId, entry)
  }

  return [...totals.entries()]
    .map(([employeeId, entry]) => ({
      employeeId,
      outstanding: money(entry.total, currency),
      dealCount: entry.count,
    }))
    .sort((a, b) => (b.outstanding.amountMinor > a.outstanding.amountMinor ? 1 : -1))
}

/** Convenience for a headline card: invoiced minus collected, never negative. */
export function outstandingTotal(summary: FinanceSummary): Money {
  const diff = subtractMoney(summary.invoiced, summary.collected)
  return diff.amountMinor > 0n ? diff : zeroMoney(summary.invoiced.currency)
}
