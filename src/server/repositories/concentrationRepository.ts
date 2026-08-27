/**
 * Aggregation for the concentration endpoint: who the revenue depends on.
 *
 * SQL for the same reason `InsightsRepository` is SQL: these questions touch
 * whole tables — a customer's FIRST purchase can only be found by looking at
 * every win they ever had — and the composite index
 * `[countsAsRevenue, status, closedAt]` was built to answer the period cuts
 * in the database.
 *
 * The three rules from `insightsRepository.ts` apply verbatim:
 *   1. `countsAsRevenue` named explicitly wherever money is touched — every
 *      query here touches money, so every query here names it;
 *   2. BigInt money crosses the driver as text;
 *   3. period boundaries arrive already resolved in Asia/Tashkent and are
 *      compared as instants; purchase intervals are INTERVALS, which no
 *      timezone can shift. Nothing here truncates to a calendar date.
 *
 * ONE RULE OF ITS OWN: `customerId IS NULL` is never silently dropped. A
 * concentration figure computed only over deals that HAVE a customer looks
 * precise while ignoring an unknown slice of the money, so every method
 * returns the null-customer revenue alongside for the UI to disclose.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { REPURCHASE_HORIZON_DAYS } from '@/server/domain/analytics/concentration'
import type { Period } from '@/server/domain/period/period'

/** A money column as Postgres returns it: text, to survive the driver. */
type MoneyText = string | null

function money(value: MoneyText): bigint {
  return value === null || value === undefined ? 0n : BigInt(value)
}

function int(value: unknown): number {
  return Number(value ?? 0)
}

function floatOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

export interface CustomerRevenueBreakdown {
  /** Won revenue per identified customer, sorted descending. */
  readonly revenuesMinor: readonly bigint[]
  /** Won revenue booked with NO customer attached — the disclosed blind spot. */
  readonly nullCustomerMinor: bigint
  /** Everything, identified or not. The denominator the shares are read against. */
  readonly totalMinor: bigint
}

/** One group of a revenue cut. `label: null` = the field was left empty. */
export interface GroupRevenueRow {
  readonly label: string | null
  readonly revenueMinor: bigint
}

export interface RepeatStats {
  /** First-to-second-purchase interval percentiles, over pairs completed in the period. */
  readonly medianDays: number | null
  readonly p90Days: number | null
  /** How many second purchases the percentiles were computed from. */
  readonly pairsMeasured: number
  /** First-time buyers of the SHIFTED window — see the cohort note on `repeatStats`. */
  readonly cohortSize: number
  /** Of those, how many bought again within the horizon. */
  readonly repurchasedWithin: number
  /** Period revenue on deals that are NOT the customer's first win. */
  readonly repeatRevenueMinor: bigint
  /** All won revenue of the period, null-customer deals included. */
  readonly totalRevenueMinor: bigint
  /** Period revenue on deals Bitrix24 itself flags `isReturnCustomer`. */
  readonly flaggedRevenueMinor: bigint
}

export class ConcentrationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Won revenue per customer, largest first.
   *
   * The rows come back as one number column: the Pareto arithmetic (top-N
   * share, customers-for-80%) is pure math in
   * `domain/analytics/concentration.ts`, where it is unit tested, and the
   * repository's only job is to hand it an exact distribution. A busy month
   * is a few thousand customers — small next to the cohort matrix this
   * pattern is borrowed from.
   */
  async customerRevenue(period: Period): Promise<CustomerRevenueBreakdown> {
    const rows = await this.prisma.$queryRawUnsafe<
      { customer_id: string | null; revenue: MoneyText }[]
    >(
      `
      SELECT d."customerId" AS customer_id, sum(d."amountMinor")::text AS revenue
      FROM "deal" d
      WHERE d."countsAsRevenue" AND d."status" = 'WON'
        AND d."closedAt" >= $1 AND d."closedAt" < $2
      GROUP BY 1
      ORDER BY sum(d."amountMinor") DESC
      `,
      period.start,
      period.end,
    )

    const revenuesMinor: bigint[] = []
    let nullCustomerMinor = 0n
    let totalMinor = 0n

    for (const row of rows) {
      const amount = money(row.revenue)
      totalMinor += amount
      if (row.customer_id === null) {
        nullCustomerMinor += amount
      } else {
        revenuesMinor.push(amount)
      }
    }

    return { revenuesMinor, nullCustomerMinor, totalMinor }
  }

  /** Won revenue per acquisition source. One HHI cut. */
  async revenueBySource(period: Period): Promise<GroupRevenueRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { label: string | null; revenue: MoneyText }[]
    >(
      `
      SELECT d."sourceId" AS label, sum(d."amountMinor")::text AS revenue
      FROM "deal" d
      WHERE d."countsAsRevenue" AND d."status" = 'WON'
        AND d."closedAt" >= $1 AND d."closedAt" < $2
      GROUP BY 1
      `,
      period.start,
      period.end,
    )
    return rows.map((r) => ({ label: r.label, revenueMinor: money(r.revenue) }))
  }

  /** The same cut by the deal's region field. */
  async revenueByRegion(period: Period): Promise<GroupRevenueRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { label: string | null; revenue: MoneyText }[]
    >(
      `
      SELECT d."region" AS label, sum(d."amountMinor")::text AS revenue
      FROM "deal" d
      WHERE d."countsAsRevenue" AND d."status" = 'WON'
        AND d."closedAt" >= $1 AND d."closedAt" < $2
      GROUP BY 1
      `,
      period.start,
      period.end,
    )
    return rows.map((r) => ({ label: r.label, revenueMinor: money(r.revenue) }))
  }

  /**
   * Everything the repeat-purchase card needs, in one scan of the wins.
   *
   * The `wins` CTE ranks every customer's revenue wins ALL TIME — like the
   * cohort matrix, "first purchase" only means something against the whole
   * history, so the period filters are applied to the derived facts, never to
   * the ranking itself.
   *
   * TWO COHORTS, DELIBERATELY DIFFERENT
   *
   * The interval percentiles (p50/p90 days between first and second purchase)
   * are computed over customers whose SECOND purchase landed in the period.
   * Conditioning on the second keeps the measurement uncensored: a customer
   * whose first purchase was in the period but who has not returned YET has
   * an interval nobody knows, and averaging only the quick returners would
   * bias the figure short.
   *
   * The repurchase RATE cannot use that trick — a rate needs a denominator of
   * chances, not of successes. Its cohort is first-time buyers of the period
   * SHIFTED BACK by the horizon: first purchases in
   * [start - 90d, end - 90d), so by the period's end every member has had the
   * full 90 days to come back. An unshifted cohort would count this week's
   * first-buyers as "not repurchased" when their window has barely opened,
   * and the rate would sag every month by construction.
   *
   * The horizon is `REPURCHASE_HORIZON_DAYS` from the domain module, passed
   * in as a parameter so the shift and the window can never drift apart.
   *
   * REPEAT REVENUE VS THE BITRIX FLAG. `repeat_revenue` derives repeatness
   * from the ranking (`rn > 1`); `flagged_revenue` trusts the portal's own
   * `isReturnCustomer`. They should agree and do not always — the divergence
   * is a data-quality signal the service exposes rather than reconciles.
   * Null-customer deals sit in `total_revenue` but can never be repeat: with
   * no identity there is no purchase history, and the honest place for that
   * money is the denominator plus the disclosed null share, not either
   * numerator.
   */
  async repeatStats(period: Period): Promise<RepeatStats> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        p50_days: number | null
        p90_days: number | null
        pairs_measured: bigint
        cohort_size: bigint
        repurchased: bigint
        repeat_revenue: MoneyText
        total_revenue: MoneyText
        flagged_revenue: MoneyText
      }[]
    >(
      `
      WITH wins AS (
        -- Ties on closedAt broken by id so re-synced same-instant duplicates
        -- rank deterministically instead of by physical row order.
        SELECT
          d."customerId" AS customer_id,
          d."closedAt" AS closed_at,
          d."amountMinor" AS amount,
          row_number() OVER (
            PARTITION BY d."customerId" ORDER BY d."closedAt", d."id"
          ) AS rn
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."status" = 'WON'
          AND d."customerId" IS NOT NULL AND d."closedAt" IS NOT NULL
      ),
      pairs AS (
        SELECT
          customer_id,
          min(closed_at) FILTER (WHERE rn = 1) AS first_at,
          min(closed_at) FILTER (WHERE rn = 2) AS second_at
        FROM wins
        WHERE rn <= 2
        GROUP BY customer_id
      ),
      intervals AS (
        SELECT
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (second_at - first_at)) / 86400
          ) AS p50_days,
          percentile_cont(0.9) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (second_at - first_at)) / 86400
          ) AS p90_days,
          count(*)::bigint AS pairs_measured
        FROM pairs
        WHERE second_at >= $1 AND second_at < $2
      ),
      horizon AS (
        SELECT
          count(*)::bigint AS cohort_size,
          count(*) FILTER (
            WHERE second_at IS NOT NULL
              AND second_at <= first_at + make_interval(days => $3::int)
          )::bigint AS repurchased
        FROM pairs
        WHERE first_at >= $1::timestamp - make_interval(days => $3::int)
          AND first_at <  $2::timestamp - make_interval(days => $3::int)
      ),
      repeat_rev AS (
        SELECT COALESCE(sum(amount) FILTER (WHERE rn > 1), 0)::text AS repeat_revenue
        FROM wins
        WHERE closed_at >= $1 AND closed_at < $2
      ),
      totals AS (
        SELECT
          COALESCE(sum(d."amountMinor"), 0)::text AS total_revenue,
          COALESCE(sum(d."amountMinor") FILTER (WHERE d."isReturnCustomer"), 0)::text
            AS flagged_revenue
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."status" = 'WON'
          AND d."closedAt" >= $1 AND d."closedAt" < $2
      )
      SELECT *
      FROM intervals
      CROSS JOIN horizon
      CROSS JOIN repeat_rev
      CROSS JOIN totals
      `,
      period.start,
      period.end,
      REPURCHASE_HORIZON_DAYS,
    )

    const row = rows[0]

    return {
      medianDays: floatOrNull(row?.p50_days ?? null),
      p90Days: floatOrNull(row?.p90_days ?? null),
      pairsMeasured: int(row?.pairs_measured ?? 0n),
      cohortSize: int(row?.cohort_size ?? 0n),
      repurchasedWithin: int(row?.repurchased ?? 0n),
      repeatRevenueMinor: money(row?.repeat_revenue ?? null),
      totalRevenueMinor: money(row?.total_revenue ?? null),
      flaggedRevenueMinor: money(row?.flagged_revenue ?? null),
    }
  }
}
