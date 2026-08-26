/**
 * Analytics for the superdashboard modules.
 *
 * WHY THIS IS SQL AND THE OLDER ANALYTICS IS NOT
 * `DealRepository` loads a period's deals and aggregates them in the pure
 * domain functions. That is the right trade at a few thousand rows: every rule
 * lives in one tested place. It stops being the right trade here. The portal
 * holds 415 591 deals, 317 674 contacts and over a million call records, and
 * the questions these modules ask — a cohort matrix across two years, a median
 * delivery time per region, margin over every line item — touch the whole
 * table rather than one window of it.
 *
 * So the aggregation runs in Postgres, on the indexes built for it, and this
 * file is deliberately the only place that knows the SQL.
 *
 * THREE RULES EVERY QUERY HERE FOLLOWS
 *
 * 1. `countsAsRevenue` is named explicitly in anything that touches money.
 *    The portal records the same order twice — Доставка, then База a median of
 *    ten days later with the same code and amount, 97% of the time. A revenue
 *    figure that forgets this is roughly double the truth and looks fine.
 *
 * 2. Money is summed as BIGINT and returned as text, then parsed to BigInt.
 *    Postgres widens `sum(bigint)` to `numeric`, which the driver hands back as
 *    a string; letting that become a JS number would silently lose precision
 *    above 2^53, and UZS totals pass that at ninety billion so'm.
 *
 * 3. Dates are bucketed in `Asia/Tashkent`, not UTC. Columns are naive UTC, so
 *    every truncation reads `("closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $tz)`.
 *    Without it a sale made at 2am Tashkent lands in the previous day and the
 *    daily numbers never quite match what the team saw.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import type { Period } from '@/server/domain/period/period'

/** A money column as Postgres returns it: text, to survive the driver. */
type MoneyText = string | null

function money(value: MoneyText): bigint {
  return value === null || value === undefined ? 0n : BigInt(value)
}

function int(value: unknown): number {
  return Number(value ?? 0)
}

/** Basis points, guarding the zero denominator every rate here can meet. */
function rateBp(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000)
}

/**
 * Delivery rate over RESOLVED orders, not over every order in the window.
 *
 * Half of any current month is still in transit. Dividing by the whole month
 * reported 42% for a business that actually delivers 93% of what it dispatches
 * — a number that would start a fire in the wrong department. The orders still
 * moving are reported separately as `inFlight`, where they belong.
 *
 * `cancelledEarly` counts against the rate. Bitrix24 leaves those deals with
 * an OPEN semantic because `Отказ предварительно` is not one of its terminal
 * stages, but a customer who cancelled before dispatch is not still on its way
 * anywhere, and leaving them in the denominator's numerator-free middle would
 * flatter the figure indefinitely.
 */
function deliveryRateBp(delivered: number, refused: number, cancelledEarly: number): number {
  return rateBp(delivered, delivered + refused + cancelledEarly)
}

export interface CohortCell {
  readonly monthsSince: number
  readonly customers: number
  readonly revenueMinor: bigint
}

export interface CohortRow {
  /** First day of the cohort month, in Asia/Tashkent. */
  readonly cohort: string
  readonly size: number
  readonly cells: readonly CohortCell[]
}

export interface RetentionStage {
  readonly stage: string
  readonly customers: number
}

export interface LogisticsRouteRow {
  readonly route: string
  readonly orders: number
  readonly delivered: number
  readonly refused: number
  readonly cancelledEarly: number
  readonly inFlight: number
  readonly revenueMinor: bigint
  readonly deliveryRateBp: number
  readonly medianHours: number | null
  readonly p90Hours: number | null
}

export interface ConfirmationRow {
  readonly employeeId: string
  readonly employeeName: string
  readonly orders: number
  readonly confirmed: number
  readonly unreachable: number
  readonly undecided: number
  readonly confirmRateBp: number
  readonly deliveredAfterConfirm: number
  readonly refusedAfterConfirm: number
  /** Outcome across ALL of this operator's orders, not just confirmed ones. */
  readonly delivered: number
  readonly failed: number
}

/** Window-wide order counts for the confirmation coverage denominator. */
export interface ConfirmationWindow {
  /** Every revenue order created in the window. */
  readonly orders: number
  /** Never reached the confirmation stage and is still moving. */
  readonly unconfirmedOpen: number
  /** Never reached it and is already resolved — genuinely skipped. */
  readonly unconfirmedClosed: number
}


export interface ChannelRow {
  readonly sourceId: string
  readonly sourceName: string
  readonly leads: number
  readonly deals: number
  readonly won: number
  readonly revenueMinor: bigint
  readonly spendMinor: bigint | null
  readonly conversionBp: number
  readonly averageChequeMinor: bigint
}

export interface MarginRow {
  readonly productId: string
  readonly productName: string
  readonly units: number
  readonly revenueMinor: bigint
  /** Given away — sold BELOW the catalogue price. Never negative. */
  readonly discountMinor: bigint
  /** Sold ABOVE the catalogue price. Never negative. The mirror of the above. */
  readonly overListMinor: bigint
  readonly costMinor: bigint | null
  readonly grossMinor: bigint | null
  /** Null only when no purchase price is recorded. -10000 = given away. */
  readonly marginBp: number | null
}

export interface MarginSummary {
  readonly rows: readonly MarginRow[]
  readonly revenueMinor: bigint
  readonly costedRevenueMinor: bigint
  readonly grossMinor: bigint
  /** Total given away. Positive, and never netted against markups. */
  readonly discountMinor: bigint
  /** Total sold above list. Positive. */
  readonly overListMinor: bigint
  readonly marginBp: number
  /** Share of revenue whose product has a purchase price, in basis points. */
  readonly coverageBp: number
}

/** Call totals for one direction. */
export interface CallDirectionRow {
  readonly direction: string
  readonly calls: number
  readonly connected: number
  readonly talkSeconds: number
}

export interface CallActivityRow {
  readonly employeeId: string
  readonly employeeName: string
  readonly calls: number
  readonly connected: number
  readonly talkSeconds: number
  readonly connectRateBp: number
  readonly averageTalkSeconds: number
}

export interface DispatchRow {
  readonly point: string
  readonly orders: number
  readonly delivered: number
  readonly refused: number
  readonly revenueMinor: bigint
  readonly deliveryRateBp: number
}

export interface StructureNode {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
  readonly headName: string | null
  /** Everyone on the roster, active or not. */
  readonly headcount: number
  /** Marked active in Bitrix24. */
  readonly activeHeadcount: number
  /**
   * Active AND produced something this period — a call or a won deal.
   *
   * The difference between this and `activeHeadcount` is the answer to "who is
   * here and who is not": people the roster says are working and the data says
   * are silent.
   */
  readonly workingHeadcount: number
  readonly deals: number
  readonly revenueMinor: bigint
}

export class InsightsRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  // -------------------------------------------------------------------------
  // 1 — Cohorts
  // -------------------------------------------------------------------------

  /**
   * Repeat-purchase matrix.
   *
   * A customer's cohort is the month of their FIRST revenue-bearing win, and
   * each cell counts how many of that cohort bought again N months later.
   *
   * Counting DISTINCT customers rather than deals is what makes the row a
   * retention rate: one buyer placing three orders in month 2 is one retained
   * customer, not three. Revenue is summed alongside so the same matrix answers
   * "how much is repeat business worth", which is the number that decides
   * whether the retention team is funded.
   */
  async cohorts(options: { months: number }): Promise<CohortRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { cohort: Date; size: bigint; months_since: number; customers: bigint; revenue: MoneyText }[]
    >(
      `
      WITH first_win AS (
        SELECT
          d."customerId" AS customer_id,
          date_trunc('month', min(d."closedAt") AT TIME ZONE 'UTC' AT TIME ZONE $1) AS cohort
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."status" = 'WON'
          AND d."customerId" IS NOT NULL AND d."closedAt" IS NOT NULL
        GROUP BY 1
      ),
      sized AS (
        SELECT cohort, count(*)::bigint AS size FROM first_win GROUP BY cohort
      ),
      purchases AS (
        SELECT
          f.cohort,
          d."customerId" AS customer_id,
          d."amountMinor" AS amount,
          (
            (EXTRACT(YEAR FROM date_trunc('month', d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)) -
             EXTRACT(YEAR FROM f.cohort)) * 12 +
            (EXTRACT(MONTH FROM date_trunc('month', d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)) -
             EXTRACT(MONTH FROM f.cohort))
          )::int AS months_since
        FROM "deal" d
        JOIN first_win f ON f.customer_id = d."customerId"
        WHERE d."countsAsRevenue" AND d."status" = 'WON' AND d."closedAt" IS NOT NULL
      )
      SELECT
        p.cohort,
        s.size,
        p.months_since,
        count(DISTINCT p.customer_id)::bigint AS customers,
        sum(p.amount)::text AS revenue
      FROM purchases p
      JOIN sized s ON s.cohort = p.cohort
      WHERE p.cohort >= date_trunc('month', (now() AT TIME ZONE $1)) - make_interval(months => $2::int)
        AND p.months_since >= 0
      GROUP BY p.cohort, s.size, p.months_since
      ORDER BY p.cohort DESC, p.months_since ASC
      `,
      this.tz,
      options.months,
    )

    const byCohort = new Map<string, { size: number; cells: CohortCell[] }>()

    for (const row of rows) {
      const key = row.cohort.toISOString().slice(0, 10)
      const entry = byCohort.get(key) ?? { size: int(row.size), cells: [] }
      entry.cells.push({
        monthsSince: row.months_since,
        customers: int(row.customers),
        revenueMinor: money(row.revenue),
      })
      byCohort.set(key, entry)
    }

    return [...byCohort.entries()].map(([cohort, entry]) => ({
      cohort,
      size: entry.size,
      cells: entry.cells,
    }))
  }

  /**
   * Where the customer base currently sits in the retention pipeline.
   *
   * `База` is not a sales funnel — its stages are a follow-up cadence (1 day,
   * 3 days, 7, 14, 21) ending in Активный / Неактивные / Недозвоны. Reading
   * the live headcount per stage answers "how many customers are still being
   * worked" in the team's own vocabulary, which the cohort matrix cannot.
   */
  async retentionStages(): Promise<RetentionStage[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ stage: string; customers: bigint }[]>(
      `
      SELECT s."name" AS stage, count(DISTINCT d."customerId")::bigint AS customers
      FROM "deal" d
      JOIN "deal_stage" s ON s."id" = d."stageId"
      JOIN "pipeline" p ON p."id" = d."pipelineId"
      WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
      GROUP BY s."name", s."sortOrder"
      ORDER BY s."sortOrder"
      `,
    )
    return rows.map((r) => ({ stage: r.stage, customers: int(r.customers) }))
  }

  // -------------------------------------------------------------------------
  // 2 — Logistics
  // -------------------------------------------------------------------------

  /**
   * Delivery performance per route.
   *
   * The route is the regional hub or carrier the parcel passed through, taken
   * from stage HISTORY rather than the deal's current stage — a delivered
   * order sits on `Доставлено` and has long since left `NAVOIY`, so the
   * current stage cannot tell you which hub handled it.
   *
   * Timings are the hours between entering that route stage and the deal being
   * won. Median and p90 rather than a mean: delivery times have a long tail of
   * chased orders, and an average lets three disasters hide a hundred normal
   * days.
   *
   * `refused` and `cancelledEarly` stay apart. One is a parcel that travelled
   * and came back, the other a customer who changed their mind before
   * dispatch; only the first cost anything to move.
   */
  async logisticsRoutes(period: Period): Promise<LogisticsRouteRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        route: string
        orders: bigint
        delivered: bigint
        refused: bigint
        cancelled_early: bigint
        in_flight: bigint
        revenue: MoneyText
        median_hours: number | null
        p90_hours: number | null
      }[]
    >(
      `
      WITH routed AS (
        SELECT DISTINCT ON (h."dealId")
          h."dealId"   AS deal_id,
          s."name"     AS route,
          h."enteredAt" AS entered_at
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
        WHERE s."logisticsRole" IN ('REGIONAL_HUB', 'CARRIER')
        ORDER BY h."dealId", h."enteredAt" DESC
      )
      SELECT
        r.route,
        count(*)::bigint AS orders,
        count(*) FILTER (WHERE cur."logisticsRole" = 'DELIVERED')::bigint AS delivered,
        count(*) FILTER (WHERE cur."logisticsRole" = 'REFUSED')::bigint AS refused,
        count(*) FILTER (WHERE cur."logisticsRole" = 'CANCELLED_EARLY')::bigint AS cancelled_early,
        count(*) FILTER (WHERE d."status" = 'OPEN')::bigint AS in_flight,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text AS revenue,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (d."closedAt" - r.entered_at)) / 3600
        ) FILTER (WHERE d."status" = 'WON' AND d."closedAt" > r.entered_at) AS median_hours,
        percentile_cont(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (d."closedAt" - r.entered_at)) / 3600
        ) FILTER (WHERE d."status" = 'WON' AND d."closedAt" > r.entered_at) AS p90_hours
      FROM routed r
      JOIN "deal" d ON d."id" = r.deal_id
      JOIN "deal_stage" cur ON cur."id" = d."stageId"
      WHERE d."countsAsRevenue"
        AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY r.route
      ORDER BY orders DESC
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => {
      const delivered = int(r.delivered)
      const refused = int(r.refused)
      const cancelledEarly = int(r.cancelled_early)
      return {
        route: r.route,
        orders: int(r.orders),
        delivered,
        refused,
        cancelledEarly,
        inFlight: int(r.in_flight),
        revenueMinor: money(r.revenue),
        deliveryRateBp: deliveryRateBp(delivered, refused, cancelledEarly),
        medianHours: r.median_hours === null ? null : Number(r.median_hours),
        p90Hours: r.p90_hours === null ? null : Number(r.p90_hours),
      }
    })
  }

  /** The same shape, cut by the customer's region rather than the route. */
  async logisticsRegions(period: Period): Promise<LogisticsRouteRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        route: string
        orders: bigint
        delivered: bigint
        refused: bigint
        cancelled_early: bigint
        in_flight: bigint
        revenue: MoneyText
        median_hours: number | null
        p90_hours: number | null
      }[]
    >(
      `
      SELECT
        COALESCE(d."region", 'Nomaʼlum') AS route,
        count(*)::bigint AS orders,
        count(*) FILTER (WHERE cur."logisticsRole" = 'DELIVERED')::bigint AS delivered,
        count(*) FILTER (WHERE cur."logisticsRole" = 'REFUSED')::bigint AS refused,
        count(*) FILTER (WHERE cur."logisticsRole" = 'CANCELLED_EARLY')::bigint AS cancelled_early,
        count(*) FILTER (WHERE d."status" = 'OPEN')::bigint AS in_flight,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text AS revenue,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (d."closedAt" - d."createdAtSource")) / 3600
        ) FILTER (WHERE d."status" = 'WON') AS median_hours,
        percentile_cont(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (d."closedAt" - d."createdAtSource")) / 3600
        ) FILTER (WHERE d."status" = 'WON') AS p90_hours
      FROM "deal" d
      JOIN "deal_stage" cur ON cur."id" = d."stageId"
      WHERE d."countsAsRevenue"
        AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY 1
      ORDER BY orders DESC
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => {
      const delivered = int(r.delivered)
      const refused = int(r.refused)
      const cancelledEarly = int(r.cancelled_early)
      return {
        route: r.route,
        orders: int(r.orders),
        delivered,
        refused,
        cancelledEarly,
        inFlight: int(r.in_flight),
        revenueMinor: money(r.revenue),
        deliveryRateBp: deliveryRateBp(delivered, refused, cancelledEarly),
        medianHours: r.median_hours === null ? null : Number(r.median_hours),
        p90Hours: r.p90_hours === null ? null : Number(r.p90_hours),
      }
    })
  }

  /**
   * Why orders were lost, split by WHEN they were lost.
   *
   * The two are not the same event and must not share a bar. A parcel that
   * travelled to the customer and came back cost the delivery, the handling
   * and the return leg; an order cancelled before anything shipped cost a
   * phone call. Merged under one heading called "return reasons", 81 of the 82
   * losses in a month were pre-dispatch cancellations, and 135.5 mln soʻm of
   * goods that never moved were reported as lost value.
   *
   * `stage` carries the terminal role so the caller can label each series for
   * what it is rather than guessing from the reason text.
   */
  async refusalReasons(
    period: Period,
  ): Promise<{ stage: string; reason: string; orders: number; lostMinor: bigint }[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { stage: string; reason: string; orders: bigint; lost: MoneyText }[]
    >(
      `
      SELECT
        CASE cur."logisticsRole"
          WHEN 'REFUSED' THEN 'RETURNED'
          WHEN 'CANCELLED_EARLY' THEN 'CANCELLED'
          ELSE 'OTHER'
        END AS stage,
        COALESCE(d."refusalReason", 'Sabab koʻrsatilmagan') AS reason,
        count(*)::bigint AS orders,
        sum(d."amountMinor")::text AS lost
      FROM "deal" d
      JOIN "deal_stage" cur ON cur."id" = d."stageId"
      WHERE d."countsAsRevenue" AND d."status" = 'LOST'
        AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY 1, 2
      ORDER BY orders DESC
      `,
      period.start,
      period.end,
    )
    return rows.map((r) => ({
      stage: r.stage,
      reason: r.reason,
      orders: int(r.orders),
      lostMinor: money(r.lost),
    }))
  }

  // -------------------------------------------------------------------------
  // 4 — Confirmation
  // -------------------------------------------------------------------------

  /**
   * Order confirmation, per operator.
   *
   * WHERE THIS COMES FROM
   * Not from the confirmation FIELD. The portal has a "Тастиклаш анализ"
   * enumeration and it is filled on 17 deals out of 16 618 — building a report
   * on it would produce an empty screen that looks like an outage. Nor from
   * the `Тасдиклаш` pipeline, which holds 164 deals and has never won or lost
   * one.
   *
   * The confirmation that actually happens is a STAGE: an operator moves the
   * order to `Успешно заказ` once they have reached the customer and the order
   * is agreed. 4 339 deals have passed through it. `Пропущенный` and
   * `Юрист смс` are the other side — the customer could not be reached. Both
   * are read from stage history, because a delivered order left those stages
   * long ago and its current stage cannot say it was ever there.
   *
   * The last two columns are the point of the report. A high confirmation rate
   * on orders that are refused at the door is not performance — it is an
   * operator clearing a queue. Showing the confirmation next to what happened
   * to it afterwards is what makes the number honest.
   */
  async confirmations(period: Period): Promise<ConfirmationRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        employee_id: string
        employee_name: string
        orders: bigint
        confirmed: bigint
        unreachable: bigint
        undecided: bigint
        delivered_after_confirm: bigint
        refused_after_confirm: bigint
        delivered: bigint
        failed: bigint
      }[]
    >(
      `
      WITH touched AS (
        SELECT
          h."dealId" AS deal_id,
          bool_or(s."logisticsRole" = 'CONFIRMED') AS reached_confirmed,
          bool_or(s."logisticsRole" = 'CHASING')   AS reached_chasing
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
        GROUP BY h."dealId"
      )
      SELECT
        e."id" AS employee_id,
        e."fullName" AS employee_name,
        count(*)::bigint AS orders,
        count(*) FILTER (WHERE t.reached_confirmed)::bigint AS confirmed,
        count(*) FILTER (WHERE t.reached_chasing AND NOT COALESCE(t.reached_confirmed, false))::bigint
          AS unreachable,
        count(*) FILTER (
          WHERE NOT COALESCE(t.reached_confirmed, false)
            AND NOT COALESCE(t.reached_chasing, false)
        )::bigint AS undecided,
        count(*) FILTER (WHERE t.reached_confirmed AND d."status" = 'WON')::bigint
          AS delivered_after_confirm,
        -- A pre-dispatch cancellation is a lost order even though Bitrix24
        -- leaves its semantic OPEN, so it counts against the confirmation
        -- exactly as a refusal at the door does.
        count(*) FILTER (
          WHERE t.reached_confirmed
            AND (d."status" = 'LOST' OR cur."logisticsRole" = 'CANCELLED_EARLY')
        )::bigint AS refused_after_confirm,
        -- The operator's whole book, not just the confirmed part. Without it
        -- the report says how diligently someone fills a stage and nothing
        -- about whether their orders arrive.
        count(*) FILTER (WHERE d."status" = 'WON')::bigint AS delivered,
        count(*) FILTER (WHERE d."status" = 'LOST')::bigint AS failed
      FROM "deal" d
      JOIN "employee" e ON e."id" = d."employeeId"
      JOIN "deal_stage" cur ON cur."id" = d."stageId"
      LEFT JOIN touched t ON t.deal_id = d."id"
      WHERE d."countsAsRevenue"
        AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY e."id", e."fullName"
      -- Operators who never touched the stage have nothing to report per-row.
      -- They still count in the coverage denominator — see windowOrders below,
      -- which deliberately does NOT carry this filter.
      HAVING count(*) FILTER (WHERE t.reached_confirmed OR t.reached_chasing) > 0
      ORDER BY orders DESC
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => {
      const decided = int(r.confirmed) + int(r.unreachable)
      return {
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        orders: int(r.orders),
        confirmed: int(r.confirmed),
        unreachable: int(r.unreachable),
        undecided: int(r.undecided),
        confirmRateBp: rateBp(int(r.confirmed), decided),
        deliveredAfterConfirm: int(r.delivered_after_confirm),
        refusedAfterConfirm: int(r.refused_after_confirm),
        delivered: int(r.delivered),
        failed: int(r.failed),
      }
    })
  }

  /**
   * Every revenue order created in the window, regardless of operator.
   *
   * This is the denominator coverage needs, and the reason it cannot come from
   * summing the rows above: those are filtered to operators who used the
   * confirmation stage at least once, so summing them silently excludes the
   * operators with ZERO coverage — precisely the population a coverage metric
   * exists to find. It made the Tasdiqlash page report 2,129 orders for a
   * window in which Logistika and the overview both reported 2,191, and
   * inflated coverage from 41.2% to 42.4%.
   */
  async confirmationWindowOrders(period: Period): Promise<ConfirmationWindow> {
    const rows = await this.prisma.$queryRawUnsafe<
      { orders: bigint; unconfirmed_open: bigint; unconfirmed_closed: bigint }[]
    >(
      `
      WITH reached AS (
        SELECT DISTINCT h."dealId" AS deal_id
          FROM "deal_stage_history" h
          JOIN "deal_stage" s ON s."id" = h."stageId"
         WHERE s."logisticsRole" = 'CONFIRMED'
      )
      SELECT count(*)::bigint AS orders,
             -- Why coverage is not 100%: an order still in transit has not
             -- skipped the step, it has not reached it yet. Separating the two
             -- is the difference between "operators are not confirming" and
             -- "the month is not over".
             count(*) FILTER (
               WHERE r.deal_id IS NULL AND d."status" = 'OPEN'
             )::bigint AS unconfirmed_open,
             count(*) FILTER (
               WHERE r.deal_id IS NULL AND d."status" <> 'OPEN'
             )::bigint AS unconfirmed_closed
        FROM "deal" d
        LEFT JOIN reached r ON r.deal_id = d."id"
       WHERE d."countsAsRevenue"
         AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      `,
      period.start,
      period.end,
    )

    const row = rows[0]

    return {
      orders: int(row?.orders ?? 0n),
      unconfirmedOpen: int(row?.unconfirmed_open ?? 0n),
      unconfirmedClosed: int(row?.unconfirmed_closed ?? 0n),
    }
  }

  // -------------------------------------------------------------------------
  // 9 — Channels
  // -------------------------------------------------------------------------

  /**
   * What each acquisition channel produces.
   *
   * `leads` counts every deal the channel created in ANY pipeline, including
   * the registration and qualification funnels — that is the top of the funnel
   * and the honest denominator. `deals` and `revenue` count only the pipelines
   * that can produce money, so the conversion rate reads "of everything this
   * channel brought in, how much turned into a paid order".
   *
   * Spend is joined from the manual table and left null when nobody entered it.
   * Null is not zero: a channel with no spend row has unknown ROI, and
   * reporting infinite return on zero cost would be worse than saying so.
   */
  async channels(period: Period): Promise<ChannelRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        source_id: string
        source_name: string
        leads: bigint
        deals: bigint
        won: bigint
        revenue: MoneyText
        spend: MoneyText
      }[]
    >(
      `
      SELECT
        s."id" AS source_id,
        s."name" AS source_name,
        count(d."id")::bigint AS leads,
        count(d."id") FILTER (WHERE d."countsAsRevenue")::bigint AS deals,
        count(d."id") FILTER (WHERE d."countsAsRevenue" AND d."status" = 'WON')::bigint AS won,
        sum(d."amountMinor") FILTER (WHERE d."countsAsRevenue" AND d."status" = 'WON')::text AS revenue,
        (
          SELECT sum(a."amountMinor")::text FROM "ad_spend" a
          WHERE a."sourceId" = s."id"
            AND a."periodStart" >= $1::date AND a."periodStart" < $2::date
        ) AS spend
      FROM "sales_source" s
      LEFT JOIN "deal" d
        ON d."sourceId" = s."id"
       AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY s."id", s."name"
      HAVING count(d."id") > 0
      ORDER BY revenue DESC NULLS LAST, leads DESC
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => {
      const leads = int(r.leads)
      const won = int(r.won)
      const revenue = money(r.revenue)
      return {
        sourceId: r.source_id,
        sourceName: r.source_name,
        leads,
        deals: int(r.deals),
        won,
        revenueMinor: revenue,
        spendMinor: r.spend === null ? null : money(r.spend),
        conversionBp: rateBp(won, leads),
        averageChequeMinor: won === 0 ? 0n : revenue / BigInt(won),
      }
    })
  }

  // -------------------------------------------------------------------------
  // 8 — Gross margin
  // -------------------------------------------------------------------------

  /**
   * Margin per product, and how much of the revenue it actually covers.
   *
   * Only 22 of the 160 catalogue items carry a purchase price, so a bare
   * margin percentage would describe a fraction of the business while looking
   * like all of it. `coverageBp` is returned beside it for exactly that
   * reason, and rows without a cost report null rather than a 100% margin.
   */
  async margin(period: Period): Promise<MarginSummary> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        product_id: string
        product_name: string
        units: bigint
        revenue: MoneyText
        discount: MoneyText
        over_list: MoneyText
        cost: MoneyText
        has_cost: boolean
      }[]
    >(
      `
      SELECT
        p."id" AS product_id,
        p."name" AS product_name,
        sum(i."quantity")::bigint AS units,
        sum(i."totalMinor")::text AS revenue,
        -- Split by sign rather than netted.
        --
        -- A negative discountMinor is a price ABOVE the catalogue list, not a
        -- giveaway, and netting the two under one heading called "discount
        -- given" cancels real money against real money. In one month 406 lines
        -- carried a markup and they were quietly reducing the reported
        -- giveaway. They are different facts and get different columns.
        sum(i."discountMinor") FILTER (WHERE i."discountMinor" > 0)::text AS discount,
        sum(-i."discountMinor") FILTER (WHERE i."discountMinor" < 0)::text AS over_list,
        CASE WHEN p."costMinor" IS NULL THEN NULL
             ELSE sum(i."quantity" * p."costMinor")::text END AS cost,
        (p."costMinor" IS NOT NULL) AS has_cost
      FROM "deal_item" i
      JOIN "deal" d ON d."id" = i."dealId"
      JOIN "product" p ON p."id" = i."productId"
      WHERE d."countsAsRevenue" AND d."status" = 'WON'
        AND d."closedAt" >= $1 AND d."closedAt" < $2
      GROUP BY p."id", p."name", p."costMinor"
      ORDER BY sum(i."totalMinor") DESC
      `,
      period.start,
      period.end,
    )

    const mapped: MarginRow[] = rows.map((r) => {
      const revenue = money(r.revenue)
      const cost = r.cost === null ? null : money(r.cost)
      const gross = cost === null ? null : revenue - cost
      return {
        productId: r.product_id,
        productName: r.product_name,
        units: int(r.units),
        revenueMinor: revenue,
        discountMinor: money(r.discount),
        overListMinor: money(r.over_list),
        costMinor: cost,
        grossMinor: gross,
        /**
         * Null means ONE thing: no purchase price is recorded.
         *
         * It used to mean two — that, or revenue of zero — and the page
         * rendered both as the words "tannarx yoʻq" (no cost), so a product
         * whose cost was sitting in the column beside it was labelled as
         * having none. A line given away entirely has a known cost and a
         * margin of -100%, which is a fact worth seeing, not a blank.
         */
        marginBp:
          gross === null
            ? null
            : revenue === 0n
              ? cost === 0n
                ? 0
                : -10_000
              : Number((gross * 10_000n) / revenue),
      }
    })

    const revenueMinor = mapped.reduce((sum, r) => sum + r.revenueMinor, 0n)
    const costed = mapped.filter((r) => r.costMinor !== null)
    const costedRevenue = costed.reduce((sum, r) => sum + r.revenueMinor, 0n)
    const gross = costed.reduce((sum, r) => sum + (r.grossMinor ?? 0n), 0n)

    return {
      rows: mapped,
      revenueMinor,
      costedRevenueMinor: costedRevenue,
      grossMinor: gross,
      discountMinor: mapped.reduce((sum, r) => sum + r.discountMinor, 0n),
      overListMinor: mapped.reduce((sum, r) => sum + r.overListMinor, 0n),
      marginBp: costedRevenue === 0n ? 0 : Number((gross * 10_000n) / costedRevenue),
      coverageBp: revenueMinor === 0n ? 0 : Number((costedRevenue * 10_000n) / revenueMinor),
    }
  }

  // -------------------------------------------------------------------------
  // 6 — Call activity
  // -------------------------------------------------------------------------

  /**
   * How much each person actually spoke to customers.
   *
   * Talk time counts connected calls only. Including the failed legs would
   * reward dialling over conversation, which is the opposite of what the
   * number is for.
   */
  /**
   * The same call log, split by who dialled.
   *
   * The two directions are different questions wearing the same word. Outbound
   * asks how often a dial reaches someone — a third to two thirds is ordinary
   * and nobody has set a target. Inbound asks how many CUSTOMERS calling this
   * company got an answer, and that has an obvious direction: every miss is a
   * person who wanted to buy and did not get through.
   *
   * Blended, they had been reported as one 31.5% "dial success" rate on a log
   * that is 92% inbound, which hid 159,722 unanswered customer calls behind a
   * number labelled as something else entirely.
   */
  async callDirections(period: Period): Promise<CallDirectionRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { direction: string; calls: bigint; connected: bigint; talk_seconds: bigint }[]
    >(
      `
      SELECT
        c."direction"::text AS direction,
        count(*)::bigint AS calls,
        count(*) FILTER (WHERE c."connected")::bigint AS connected,
        COALESCE(sum(c."durationSec") FILTER (WHERE c."connected"), 0)::bigint AS talk_seconds
      FROM "call_record" c
      WHERE c."startedAt" >= $1 AND c."startedAt" < $2
      GROUP BY c."direction"
      ORDER BY calls DESC
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => ({
      direction: r.direction,
      calls: int(r.calls),
      connected: int(r.connected),
      talkSeconds: int(r.talk_seconds),
    }))
  }

  async callActivity(period: Period): Promise<CallActivityRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        employee_id: string
        employee_name: string
        calls: bigint
        connected: bigint
        talk_seconds: bigint
      }[]
    >(
      `
      SELECT
        e."id" AS employee_id,
        e."fullName" AS employee_name,
        count(*)::bigint AS calls,
        count(*) FILTER (WHERE c."connected")::bigint AS connected,
        COALESCE(sum(c."durationSec") FILTER (WHERE c."connected"), 0)::bigint AS talk_seconds
      FROM "call_record" c
      JOIN "employee" e ON e."id" = c."employeeId"
      WHERE c."startedAt" >= $1 AND c."startedAt" < $2
      GROUP BY e."id", e."fullName"
      ORDER BY talk_seconds DESC
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => {
      const calls = int(r.calls)
      const connected = int(r.connected)
      const talk = int(r.talk_seconds)
      return {
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        calls,
        connected,
        talkSeconds: talk,
        connectRateBp: rateBp(connected, calls),
        averageTalkSeconds: connected === 0 ? 0 : Math.round(talk / connected),
      }
    })
  }

  // -------------------------------------------------------------------------
  // 5 — Dispatch by fulfilment point
  // -------------------------------------------------------------------------

  /**
   * What each warehouse, courier and marketplace actually shipped.
   *
   * This is NOT a stock report. The portal defines four stores and keeps no
   * balances in any of them — `catalog.storeproduct.list` returns nothing and
   * there are no inventory documents — so on-hand quantity genuinely does not
   * exist to be shown. What the portal does record, on every order, is which
   * point fulfils it, and that answers the question the stock page was wanted
   * for: where volume goes and where it fails.
   */
  async dispatchPoints(period: Period): Promise<DispatchRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        point: string
        orders: bigint
        delivered: bigint
        refused: bigint
        revenue: MoneyText
      }[]
    >(
      `
      SELECT
        COALESCE(d."fulfilmentPoint", 'Belgilanmagan') AS point,
        count(*)::bigint AS orders,
        count(*) FILTER (WHERE d."status" = 'WON')::bigint AS delivered,
        count(*) FILTER (WHERE d."status" = 'LOST')::bigint AS refused,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text AS revenue
      FROM "deal" d
      WHERE d."countsAsRevenue"
        AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY 1
      ORDER BY orders DESC
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => {
      const delivered = int(r.delivered)
      const refused = int(r.refused)
      return {
        point: r.point,
        orders: int(r.orders),
        delivered,
        refused,
        revenueMinor: money(r.revenue),
        deliveryRateBp: deliveryRateBp(delivered, refused, 0),
      }
    })
  }

  // -------------------------------------------------------------------------
  // 7 — Structure
  // -------------------------------------------------------------------------

  /**
   * The company tree with each unit's own numbers.
   *
   * Figures are the unit's OWN people, not a rollup — the caller assembles the
   * tree and rolls up, because a department's total depends on whether you
   * count sub-departments, and that is a display decision rather than a
   * database one.
   */
  async structure(period: Period): Promise<StructureNode[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: string
        name: string
        parent_id: string | null
        head_name: string | null
        headcount: bigint
        active_headcount: bigint
        working_headcount: bigint
        deals: bigint
        revenue: MoneyText
      }[]
    >(
      `
      SELECT
        dep."id",
        dep."name",
        dep."parentId" AS parent_id,
        head."fullName" AS head_name,
        count(DISTINCT e."id")::bigint AS headcount,
        count(DISTINCT e."id") FILTER (WHERE e."isActive")::bigint AS active_headcount,
        /*
          Who was actually working.
          
          "Kim bor, kim yoʻq" cannot be answered by the Bitrix isActive flag
          alone: every deactivated person is also silent, so the flag finds
          nobody the roster does not already show. The question people are
          asking is who is on the roster, marked active, and produced NOTHING
          this period — 58 of 206 active staff, invisible until now.
        */
        count(DISTINCT e."id") FILTER (
          WHERE e."isActive" AND (act.calls > 0 OR act.wins > 0)
        )::bigint AS working_headcount,
        count(d."id") FILTER (WHERE d."countsAsRevenue" AND d."status" = 'WON')::bigint AS deals,
        sum(d."amountMinor") FILTER (WHERE d."countsAsRevenue" AND d."status" = 'WON')::text AS revenue
      FROM "department" dep
      LEFT JOIN "employee" head ON head."id" = dep."headId"
      LEFT JOIN "employee" e ON e."departmentId" = dep."id"
      LEFT JOIN LATERAL (
        SELECT
          (SELECT count(*) FROM "call_record" c
            WHERE c."employeeId" = e."id"
              AND c."startedAt" >= $1 AND c."startedAt" < $2) AS calls,
          (SELECT count(*) FROM "deal" w
            WHERE w."employeeId" = e."id" AND w."countsAsRevenue" AND w."status" = 'WON'
              AND w."closedAt" >= $1 AND w."closedAt" < $2) AS wins
      ) act ON TRUE
      LEFT JOIN "deal" d
        ON d."employeeId" = e."id"
       AND d."closedAt" >= $1 AND d."closedAt" < $2
      GROUP BY dep."id", dep."name", dep."parentId", head."fullName", dep."sortOrder"
      ORDER BY dep."sortOrder", dep."name"
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      headName: r.head_name,
      headcount: int(r.headcount),
      activeHeadcount: int(r.active_headcount),
      workingHeadcount: int(r.working_headcount),
      deals: int(r.deals),
      revenueMinor: money(r.revenue),
    }))
  }
}
