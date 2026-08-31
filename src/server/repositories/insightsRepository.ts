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
import {
  CONFIRMATION_OUTCOMES,
  type ConfirmationOrderSortValue,
  type ConfirmationOutcomeValue,
} from '@/server/domain/types'

/** A money column as Postgres returns it: text, to survive the driver. */
type MoneyText = string | null

function money(value: MoneyText): bigint {
  return value === null || value === undefined ? 0n : BigInt(value)
}

function int(value: unknown): number {
  return Number(value ?? 0)
}

/**
 * Basis points, or NULL when there is nothing to divide by.
 *
 * Null, not zero. A carrier whose every order is still in transit has no
 * delivery rate yet; returning 0 states that it delivers nothing, which is a
 * confident claim about something nobody knows. The same applies to an
 * operator with no decided orders and a channel with no leads. The DTO layer
 * carries the null through and the Meter renders an em dash, which is the
 * whole point of having three renderings for loading, failure and a genuine
 * absence — a zero manufactured this deep made the third one unreachable.
 */
function rateBp(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000)
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
function deliveryRateBp(
  delivered: number,
  refused: number,
  cancelledEarly: number,
): number | null {
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
  readonly deliveryRateBp: number | null
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
  readonly confirmRateBp: number | null
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

/** One order in the Тасдиклаш queue, in the column order the floor reads. */
export interface ConfirmationOrderRow {
  readonly dealId: string
  /** РОП — the sales group, as the team names it: "Sevinch", "Lola", "Baza". */
  readonly rop: string | null
  /** № — the order's place in ITS ROP's day. Restarts at 1 each morning. */
  readonly dailyNo: number
  /** Id сделки — the Bitrix24 deal id, the key both systems look an order up by. */
  readonly bitrixId: string | null
  /** `bx…` code parsed from the title, where the title carries one. */
  readonly orderCode: string | null
  readonly title: string
  readonly customerName: string | null
  /** Every number on the contact, in the portal's order. May be empty. */
  readonly customerPhones: readonly string[]
  readonly employeeName: string
  /** Продукт — one entry per line item, "name - N ta". */
  readonly products: readonly string[]
  readonly region: string | null
  readonly deliveryAddress: string | null
  /** Источник — the acquisition channel the order came in through. */
  readonly sourceName: string | null
  readonly amountMinor: bigint
  readonly currency: string
  /** The stage the deal sits in NOW, which is what the outcome was read from. */
  readonly stageName: string
  readonly outcome: ConfirmationOutcomeValue
  /** The stage move this row is dated by — the client's `MOVED_TIME`. */
  readonly movedAt: Date
  /**
   * When the order entered the queue this state belongs to.
   *
   * Null for an order refused without ever being queued, which the client's
   * bot counts and so does this.
   */
  readonly queuedAt: Date | null
  /** When it left the queue. Null while it is still in one. */
  readonly decidedAt: Date | null
  /** Queue time in hours, one decimal. Null while it is still waiting. */
  readonly hoursToDecide: number | null
}

/** How many orders ended in each of the five states. */
export type ConfirmationOutcomeTotals = Readonly<Record<ConfirmationOutcomeValue, number>>

/** One ROP group's slice of the queue — the Статистика panel's row. */
export interface ConfirmationRopRow {
  readonly rop: string
  readonly orders: number
  readonly confirmed: number
  readonly noAnswer: number
  readonly rejected: number
  readonly pending: number
  readonly unconfirmedShipped: number
}

export interface ConfirmationOrderQuery {
  /** Any subset of the five states. Undefined or empty means all of them. */
  readonly outcomes?: readonly ConfirmationOutcomeValue[]
  /** A single ROP group ("Sevinch"), or undefined for all of them. */
  readonly rop?: string
  /** Free text over name, phone, product, Bitrix id, order code and title. */
  readonly q?: string
  readonly page: number
  readonly pageSize: number
  readonly sort: ConfirmationOrderSortValue
  readonly order: 'asc' | 'desc'
}


export interface ChannelRow {
  readonly sourceId: string
  readonly sourceName: string
  readonly leads: number
  readonly deals: number
  readonly won: number
  readonly revenueMinor: bigint
  readonly spendMinor: bigint | null
  readonly conversionBp: number | null
  readonly funnelRateBp: number | null
  readonly averageChequeMinor: bigint | null
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
  readonly connectRateBp: number | null
  readonly averageTalkSeconds: number
}

export interface DispatchRow {
  readonly point: string
  readonly orders: number
  readonly delivered: number
  readonly refused: number
  readonly cancelledEarly: number
  readonly revenueMinor: bigint
  readonly deliveryRateBp: number | null
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
   * THREE STAGES, AND THEY ARE NOT COMPARABLE
   *   RETURNED  — the parcel travelled and came back. Cost the delivery, the
   *               handling and the return leg.
   *   CANCELLED — killed in the delivery pipeline before anything shipped.
   *               Cost a phone call.
   *   PRE_SALE  — never became an order at all. Lost in the qualification
   *               funnel.
   *
   * WHERE THE REASONS ACTUALLY ARE
   * This is the part that made the old card useless. It filtered on
   * `countsAsRevenue`, and on this portal EVERY loss carrying a real reason
   * sits in a pipeline that flag excludes — 442 "олиш нияти ёк", 208 "5
   * уринишда богланиб болмади", 142 "пулидан муамоси бор". The rows that
   * survived the filter were 82 deals whose reason is null. So a card titled
   * "why orders come back" could only ever render one full-width bar reading
   * "reason not given", and 883 recorded reasons were invisible.
   *
   * MONEY IS NULL FOR PRE_SALE, deliberately. `countsAsRevenue` exists because
   * the same order appears in several pipelines; summing amounts across the
   * excluded ones would double-count. A count of reasons has no such problem —
   * which is exactly why the filter belongs on the money and not on the rows.
   */
  async refusalReasons(
    period: Period,
  ): Promise<{ stage: string; reason: string; orders: number; lostMinor: bigint | null }[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { stage: string; reason: string | null; orders: bigint; lost: MoneyText }[]
    >(
      `
      SELECT
        CASE
          WHEN NOT d."countsAsRevenue" THEN 'PRE_SALE'
          WHEN cur."logisticsRole" = 'REFUSED' THEN 'RETURNED'
          WHEN cur."logisticsRole" = 'CANCELLED_EARLY' THEN 'CANCELLED'
          ELSE 'OTHER'
        END AS stage,
        d."refusalReason" AS reason,
        count(*)::bigint AS orders,
        sum(d."amountMinor") FILTER (WHERE d."countsAsRevenue")::text AS lost
      FROM "deal" d
      JOIN "deal_stage" cur ON cur."id" = d."stageId"
      WHERE d."status" = 'LOST'
        AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY 1, 2
      ORDER BY orders DESC
      `,
      period.start,
      period.end,
    )
    return rows.map((r) => ({
      stage: r.stage,
      reason: r.reason ?? 'Sabab koʻrsatilmagan',
      orders: int(r.orders),
      // Null, not zero: "no money was lost" and "we do not count money here"
      // are different claims.
      lostMinor: r.lost === null ? null : money(r.lost),
    }))
  }

  // -------------------------------------------------------------------------
  // 4 — Confirmation
  // -------------------------------------------------------------------------

  /**
   * Order confirmation, per operator.
   *
   * WHERE THIS COMES FROM — AND WHERE IT USED TO COME FROM
   * Not from the confirmation FIELD: the portal's "Тастиклаш анализ"
   * enumeration is filled on 17 deals out of 16 618, and a report on it would
   * be an empty screen that looks like an outage.
   *
   * It used to come from `Доставка · Успешно заказ`, on the reading that an
   * operator moves an order there once they have reached the customer. That
   * reading was wrong, and it made this entire module a second copy of the
   * delivery rate. The stage is stamped within FIVE SECONDS of `Доставлено` in
   * 2 869 of the 4 335 deals reaching both, a median of 244 hours after the
   * order is created — automation, after the parcel has already arrived.
   * Per-operator "confirmed" equalled "delivered" in 85 of 92 rows, and the
   * confirmation rate was 100% in every month the database holds.
   *
   * The real ladder is the `Тасдиклаш` pipeline, whose stages carried no
   * logistics role at all — which is why the module reached elsewhere for one.
   * Median `Заказ тасдиклаш` → `Сделка успешна` is 85 minutes: the shape of
   * someone picking up a phone.
   *
   *   PENDING_CONFIRM  Заказ тасдиклаш          the queue, and the cohort
   *   CONFIRMED        Сделка успешна           reached and agreed
   *   CHASING          Недозвон смс, Пропущенный, the SMS stages
   *   CANCELLED_EARLY  Ошибка первичный отдел, UTECHKA
   *
   * THE COHORT IS ENTRY INTO THE QUEUE, not "orders created in the window".
   * Anything that reached Доставка got there through `Сделка успешна`, so a
   * delivery-based denominator makes confirmed ≡ entered and the rate 100%
   * again in new clothes. Counting from the queue is what lets it fall.
   *
   * Everything is read from stage HISTORY: a delivered order left these stages
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
      WITH queued AS (
        -- The cohort: orders that ENTERED the confirmation queue in the window.
        -- Not "orders created in the window" — see the note above this method.
        SELECT h."dealId" AS deal_id, min(h."enteredAt") AS queued_at
          FROM "deal_stage_history" h
          JOIN "deal_stage" s ON s."id" = h."stageId"
         WHERE s."logisticsRole" = 'PENDING_CONFIRM'
         GROUP BY h."dealId"
        HAVING min(h."enteredAt") >= $1 AND min(h."enteredAt") < $2
      ),
      touched AS (
        SELECT
          h."dealId" AS deal_id,
          bool_or(s."logisticsRole" = 'CONFIRMED') AS reached_confirmed,
          bool_or(s."logisticsRole" = 'CHASING')   AS reached_chasing
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
        JOIN queued q ON q.deal_id = h."dealId"
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
      JOIN queued q ON q.deal_id = d."id"
      LEFT JOIN touched t ON t.deal_id = d."id"
      -- No countsAsRevenue here: the confirmation queue is a pipeline of its
      -- own, and the guard exists to stop the same order being counted twice
      -- for MONEY. Applying it to a stage cohort would drop the whole cohort.
      GROUP BY e."id", e."fullName"
      -- No HAVING. Every row here is an operator with orders IN the queue, so
      -- one who confirmed none of them is the most interesting row on the page
      -- rather than one to hide.
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
      WITH queued AS (
        SELECT h."dealId" AS deal_id, min(h."enteredAt") AS queued_at
          FROM "deal_stage_history" h
          JOIN "deal_stage" s ON s."id" = h."stageId"
         WHERE s."logisticsRole" = 'PENDING_CONFIRM'
         GROUP BY h."dealId"
        HAVING min(h."enteredAt") >= $1 AND min(h."enteredAt") < $2
      ),
      reached AS (
        SELECT DISTINCT h."dealId" AS deal_id
          FROM "deal_stage_history" h
          JOIN "deal_stage" s ON s."id" = h."stageId"
         WHERE s."logisticsRole" = 'CONFIRMED'
      )
      SELECT count(*)::bigint AS orders,
             -- Why coverage is not 100%: an order still sitting in the queue
             -- has not been skipped, it has not been WORKED yet. Separating
             -- the two is the difference between "operators are not
             -- confirming" and "the month is not over".
             count(*) FILTER (
               WHERE r.deal_id IS NULL AND d."status" = 'OPEN'
             )::bigint AS unconfirmed_open,
             count(*) FILTER (
               WHERE r.deal_id IS NULL AND d."status" <> 'OPEN'
             )::bigint AS unconfirmed_closed
        FROM queued q
        JOIN "deal" d ON d."id" = q.deal_id
        LEFT JOIN reached r ON r.deal_id = d."id"
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

  /**
   * The Тасдиклаш board, one row per order.
   *
   * BUILT TO THE CLIENT'S OWN SPECIFICATION, not to ours. They run a Telegram
   * bot that watches Bitrix and a published dashboard built from its output;
   * the floor reads those numbers every day. Two documents of theirs define
   * the rules exactly — which stages mean what, and which are ignored — so a
   * second, reasonable-looking definition here would not be a variant, it
   * would be a contradiction of the figures the company already works to.
   *
   * THE WINDOW SELECTS ON THE LAST SIGNIFICANT MOVE. An order belongs to the
   * period in which its confirmation last changed. Their bot keys on
   * `MOVED_TIME` and deliberately not on `DATE_MODIFY`, which any edit bumps —
   * «шунинг учун ойлар олдин рад этилган сделкалар "янги воқеа" деб хабар
   * қилинарди».
   *
   * FIVE STAGES SPEAK; THE REST ARE SILENT:
   *
   *   🕔 CONFIRM_NEW          `C4:NEW` — in the queue, nobody has worked it.
   *   🟡 NO_ANSWER            `C4:UC_JQR9F1` — reached for, no answer.
   *   ❌ REJECTED             `C4:LOSE`, and `C12:UC_1OM8B2` where Bitrix
   *                           actually files the refusal.
   *   ✅ CONFIRMED            `C6:NEW` — moved to Доставка, which is the move
   *                           an operator makes once the customer says yes.
   *   🟣 UNCONFIRMED_SHIPPED  the same move, but the deal's «Тастиклаш анализ»
   *                           says the customer was never reached.
   *
   * «Пропущенный», the two SMS stages, `C4:WON` and UTECHKA say nothing: an
   * order parked in one of them has neither been reached nor refused, and is
   * still whatever it was. See CONFIRMATION_SIGNAL_STAGES for why each.
   *
   * № AND РОП COME FROM HERE, because they are properties of the board rather
   * than of the deal. The floor numbers orders per ROP per day — Sevinch's
   * 21st of the 26th — which is why the window function partitions by both, in
   * Tashkent time and not UTC.
   */
  private static readonly QUEUE_SQL = `
    /*
      Every stage move that says something about a confirmation.

      Five stages carry a signal and the rest carry none — see
      ConfirmationSignal in the schema. Reading the column rather than a list
      of Bitrix ids keeps this query free of portal vocabulary and lets the
      index do the narrowing: about 95 000 signal moves out of 216 000 rows.

      Bounded by $2 so the window can be read as of its end rather than as of
      now — a report on last week must show what last week looked like, not
      what has happened to those orders since.
    */
    WITH moves AS (
      SELECT h."dealId" AS deal_id,
             h."enteredAt" AS moved_at,
             s."confirmationSignal" AS signal
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
       WHERE s."confirmationSignal" IS NOT NULL
         AND h."enteredAt" < $2
    ),
    /*
      One row per order, at its latest signal.

      THE ORDER IS THE UNIT, not the visit. An order that was queued, refused,
      re-queued and confirmed is one line showing where it stands — which is
      how the floor reads it, and how the client's own board is built. Counting
      each visit separately would have the same order appear three times in a
      month and make «тасдиқланиш %» exceed the number of orders.
    */
    latest AS (
      SELECT DISTINCT ON (deal_id) deal_id, moved_at, signal
        FROM moves
       ORDER BY deal_id, moved_at DESC, signal
    ),
    dated AS (
      SELECT * FROM latest WHERE moved_at >= $1
    ),
    /*
      The queue arrival the current state belongs to.

      Not the first arrival ever: an order that came back into the queue is
      being worked from the moment it came back, so a waiting time measured
      from a visit that ended weeks ago describes nothing that happened.
    */
    arrival AS (
      SELECT w.deal_id, max(m.moved_at) AS queued_at
        FROM dated w
        JOIN moves m
          ON m.deal_id = w.deal_id
         AND m.signal = 'CONFIRM_NEW'
         AND m.moved_at <= w.moved_at
       GROUP BY w.deal_id
    ),
    classified AS (
      SELECT
        d."id" AS deal_id,
        w.moved_at,
        /*
          Null when the order never passed through the queue at all.

          It happens: a refusal recorded straight in Первичный отдел ·
          Тасдикланмаган has no arrival behind it. The client's bot counts it
          all the same — a filter requiring the refusal to arrive FROM the
          queue was tried on their side and removed, because Bitrix's
          automation does not route it consistently.
        */
        a.queued_at,
        CASE WHEN w.signal = 'CONFIRM_NEW' THEN NULL ELSE w.moved_at END AS decided_at,
        /*
          РОП is the department's OWN name with the marker stripped, not its
          head's full name. The client's dashboards print "Sevinch", and the
          head of Sevinch(ROP) is "Usmonova 199 Sevinch" — a different string,
          and the one nobody on the floor uses.

          A department is only a ROP if it says so. Stripping '(ROP)'
          unconditionally printed the raw name of any other department into a
          column headed РОП — Регистрация and Операцион, the two back-office
          units, leaked onto 25 orders and into the ROP filter list.
        */
        CASE
          WHEN dep."name" ILIKE '%(ROP)%'
            THEN NULLIF(btrim(replace(dep."name", '(ROP)', '')), '')
          ELSE NULL
        END AS rop,
        /*
          Shipped without anyone reaching the customer.

          Arriving in Доставка is a confirmation unless the deal's «Тастиклаш
          анализ» field says «Недозвон булиб чикарилган», which is a fact about
          the deal rather than about the stage — so it refines the signal here
          instead of being a sixth signal nothing could ever set.
        */
        CASE
          WHEN w.signal = 'CONFIRMED' AND d."confirmStatus" = 'UNREACHABLE'
            THEN 'UNCONFIRMED_SHIPPED'
          ELSE w.signal::text
        END AS outcome
      FROM dated w
      JOIN "deal" d ON d."id" = w.deal_id
      JOIN "employee" e ON e."id" = d."employeeId"
      LEFT JOIN "department" dep ON dep."id" = e."departmentId"
      LEFT JOIN arrival a ON a.deal_id = w.deal_id
    ),
    numbered AS (
      SELECT
        c.*,
        -- Tashkent, not UTC: the working day is the thing being counted, and
        -- five hours of it would otherwise be numbered into yesterday.
        row_number() OVER (
          PARTITION BY c.rop, (c.moved_at AT TIME ZONE 'UTC' AT TIME ZONE '${env.APP_TIMEZONE}')::date
          ORDER BY c.moved_at ASC, c.deal_id ASC
        )::int AS daily_no
      FROM classified c
    )
  `

  /** How the window's queue split across the five states. */
  async confirmationOutcomes(
    period: Period,
    filter: { rop?: string; q?: string } = {},
  ): Promise<ConfirmationOutcomeTotals> {
    const rows = await this.prisma.$queryRawUnsafe<
      { outcome: ConfirmationOutcomeValue; orders: bigint }[]
    >(
      `${InsightsRepository.QUEUE_SQL}
       SELECT c.outcome, count(*)::bigint AS orders
         FROM numbered c
         JOIN "deal" d ON d."id" = c.deal_id
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
        WHERE ($3::text IS NULL OR c.rop = $3)
          ${InsightsRepository.SEARCH_SQL('$4')}
        GROUP BY c.outcome`,
      period.start,
      period.end,
      filter.rop ?? null,
      filter.q ?? null,
    )

    // Every state is present with a zero rather than absent. A state missing
    // from the payload would render as an em dash — "not measured" — when the
    // truth is "measured, and none".
    const totals = Object.fromEntries(
      CONFIRMATION_OUTCOMES.map((outcome) => [outcome, 0]),
    ) as Record<ConfirmationOutcomeValue, number>

    for (const row of rows) totals[row.outcome] = int(row.orders)

    return totals
  }

  /**
   * The search box, as one predicate.
   *
   * Shared verbatim between the list and its tiles so a search can never
   * narrow the rows and leave the counts above them describing a wider set.
   * The product term needs its own EXISTS: a deal carries up to four line
   * items and joining them in would multiply the row.
   */
  private static SEARCH_SQL(param: string): string {
    /*
      Every column the table shows, searchable from the one box.

      WHAT IT HAS TO WORK OVER. The three queries that use this predicate join
      different things — the tiles and the ROP panel join only `deal` and
      `customer`, the list also joins employee, stage and source. So the
      predicate may only depend on what ALL THREE have: the `numbered` CTE
      aliased `c`, `d` and `cust`. Everything else is reached by a correlated
      EXISTS rather than an outer join, which keeps one definition of "search"
      instead of three that can drift apart.

      TWO KINDS OF MATCH. Text columns match on a plain substring. Phone and
      amount cannot: the phone is displayed masked and formatted (+99894***0037)
      while the column holds +998944340037, and the amount is displayed
      "1 600 000" while the column holds minor units. Both are compared on
      DIGITS ONLY, so what a person reads on screen and types back finds the
      row. The digits branch is guarded — a query with no digits in it would
      otherwise reduce to '%%' and match every row in the table.
    */
    const digits = `regexp_replace(${param}, '[^0-9]', '', 'g')`
    // The digits before the first '*' and after the last one.
    const head = `regexp_replace(split_part(${param}, '*', 1), '[^0-9]', '', 'g')`
    const tail = `regexp_replace(reverse(split_part(reverse(${param}), '*', 1)), '[^0-9]', '', 'g')`

    return `
          AND (
            ${param}::text IS NULL
            OR d."title" ILIKE '%' || ${param} || '%'
            OR d."orderCode" ILIKE '%' || ${param} || '%'
            OR d."externalId" ILIKE '%' || ${param} || '%'
            OR d."region" ILIKE '%' || ${param} || '%'
            OR d."deliveryAddress" ILIKE '%' || ${param} || '%'
            OR c.rop ILIKE '%' || ${param} || '%'
            OR cust."name" ILIKE '%' || ${param} || '%'
            OR EXISTS (
              SELECT 1 FROM "employee" emp
               WHERE emp."id" = d."employeeId" AND emp."fullName" ILIKE '%' || ${param} || '%'
            )
            OR EXISTS (
              SELECT 1 FROM "sales_source" ss
               WHERE ss."id" = d."sourceId" AND ss."name" ILIKE '%' || ${param} || '%'
            )
            OR EXISTS (
              SELECT 1 FROM "deal_item" di
                JOIN "product" pr ON pr."id" = di."productId"
               WHERE di."dealId" = d."id" AND pr."name" ILIKE '%' || ${param} || '%'
            )
            OR (
              ${digits} <> ''
              AND (
                regexp_replace(
                  COALESCE(array_to_string(cust."phones", ' '), '') || ' ' || COALESCE(cust."phone", ''),
                  '[^0-9]', '', 'g'
                ) LIKE '%' || ${digits} || '%'
                OR (d."amountMinor" / 100)::text LIKE '%' || ${digits} || '%'
              )
            )
            /*
              The MASKED phone, as it appears on screen.

              The column shows +99894***0037 and people search by copying what
              they can see. Digits-only turns that into 998940037, a sequence
              that exists in no phone number, so the obvious search silently
              found nothing. Matched as head AND tail instead — both required
              and both non-empty, or a lone '*' would match every row.
            */
            OR (
              ${param} LIKE '%*%'
              AND ${head} <> ''
              AND ${tail} <> ''
              AND EXISTS (
                SELECT 1
                  FROM unnest(
                    CASE
                      WHEN cust."phones" IS NOT NULL AND array_length(cust."phones", 1) > 0
                        THEN cust."phones"
                      ELSE ARRAY[COALESCE(cust."phone", '')]
                    END
                  ) AS one(num)
                 WHERE regexp_replace(one.num, '[^0-9]', '', 'g') LIKE ${head} || '%'
                   AND regexp_replace(one.num, '[^0-9]', '', 'g') LIKE '%' || ${tail}
              )
            )
          )`
  }

  /**
   * The queue broken down by ROP group.
   *
   * The one cut this page cannot make from the row list: a ROP's rate is a
   * statement about their whole day, and the table in front of the reader is
   * twenty-five rows of it. Follows the search box; the state filter is
   * deliberately NOT applied — the panel exists to compare states across
   * groups, which a state filter would collapse.
   */
  async confirmationByRop(
    period: Period,
    filter: { q?: string } = {},
  ): Promise<ConfirmationRopRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        rop: string | null
        orders: bigint
        confirmed: bigint
        no_answer: bigint
        rejected: bigint
        pending: bigint
        unconfirmed_shipped: bigint
      }[]
    >(
      `${InsightsRepository.QUEUE_SQL}
       SELECT
         c.rop AS rop,
         count(*)::bigint AS orders,
         count(*) FILTER (WHERE c.outcome = 'CONFIRMED')::bigint AS confirmed,
         count(*) FILTER (WHERE c.outcome = 'NO_ANSWER')::bigint AS no_answer,
         count(*) FILTER (WHERE c.outcome = 'REJECTED')::bigint AS rejected,
         count(*) FILTER (WHERE c.outcome = 'CONFIRM_NEW')::bigint AS pending,
         count(*) FILTER (WHERE c.outcome = 'UNCONFIRMED_SHIPPED')::bigint AS unconfirmed_shipped
       FROM numbered c
       JOIN "deal" d ON d."id" = c.deal_id
       LEFT JOIN "customer" cust ON cust."id" = d."customerId"
      /*
        NULL rops are KEPT, and dropped by the caller instead.

        The tiles are this breakdown summed down its columns, so a row excluded
        here is an order missing from the headline total — and the one
        population most likely to have no ROP is exactly the one worth
        noticing. The filter list drops them; the arithmetic does not.
      */
      WHERE TRUE
        ${InsightsRepository.SEARCH_SQL('$3')}
      GROUP BY c.rop
      ORDER BY orders DESC`,
      period.start,
      period.end,
      filter.q ?? null,
    )

    return rows.map((r) => ({
        // A group with no ROP is labelled rather than hidden: it still has to
        // be countable, and "(ROP yoʻq)" is a finding, not a gap.
        rop: r.rop ?? '(ROP yoʻq)',
        orders: int(r.orders),
        confirmed: int(r.confirmed),
        noAnswer: int(r.no_answer),
        rejected: int(r.rejected),
        pending: int(r.pending),
        unconfirmedShipped: int(r.unconfirmed_shipped),
    }))
  }

  /** Every ROP group that has orders in the window, for the filter. */
  async confirmationRops(period: Period): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ rop: string | null }[]>(
      `${InsightsRepository.QUEUE_SQL}
       SELECT DISTINCT c.rop FROM numbered c WHERE c.rop IS NOT NULL ORDER BY c.rop`,
      period.start,
      period.end,
    )

    return rows.map((r) => r.rop).filter((r): r is string => r !== null)
  }

  /** One page of the queue, newest first by default. */
  async confirmationOrders(
    period: Period,
    query: ConfirmationOrderQuery,
  ): Promise<{ totalItems: number; rows: ConfirmationOrderRow[] }> {
    // Allowlisted, never interpolated from the request: this reaches SQL.
    const sortColumn: Record<ConfirmationOrderSortValue, string> = {
      movedAt: 'c.moved_at',
      queuedAt: 'c.queued_at',
      decidedAt: 'c.decided_at',
      amountMinor: 'd."amountMinor"',
      title: 'd."title"',
    }
    const direction = query.order === 'asc' ? 'ASC' : 'DESC'
    const offset = (query.page - 1) * query.pageSize

    const rows = await this.prisma.$queryRawUnsafe<
      {
        deal_id: string
        rop: string | null
        daily_no: number
        bitrix_id: string | null
        order_code: string | null
        title: string
        customer_name: string | null
        customer_phones: string | null
        employee_name: string
        products: string | null
        region: string | null
        delivery_address: string | null
        source_name: string | null
        amount_minor: MoneyText
        currency: string
        stage_name: string
        outcome: ConfirmationOutcomeValue
        moved_at: Date
        queued_at: Date | null
        decided_at: Date | null
        total_items: bigint
      }[]
    >(
      `${InsightsRepository.QUEUE_SQL}
       SELECT
         d."id" AS deal_id,
         c.rop AS rop,
         c.daily_no AS daily_no,
         d."externalId" AS bitrix_id,
         d."orderCode" AS order_code,
         d."title" AS title,
         cust."name" AS customer_name,
         -- Joined to text and split in TS: a text[] round-trips differently
         -- depending on the driver, a delimiter does not.
         array_to_string(
           CASE
             WHEN cust."phones" IS NOT NULL AND array_length(cust."phones", 1) > 0
               THEN cust."phones"
             WHEN cust."phone" IS NOT NULL THEN ARRAY[cust."phone"]
             ELSE ARRAY[]::text[]
           END, E'\n') AS customer_phones,
         e."fullName" AS employee_name,
         items.products AS products,
         d."region" AS region,
         d."deliveryAddress" AS delivery_address,
         src."name" AS source_name,
         d."amountMinor"::text AS amount_minor,
         d."currency" AS currency,
         st."name" AS stage_name,
         c.outcome AS outcome,
         c.moved_at AS moved_at,
         c.queued_at AS queued_at,
         c.decided_at AS decided_at,
         -- The unpaged count, carried on the rows themselves. A second
         -- COUNT query would run this whole CTE twice.
         (count(*) OVER ())::bigint AS total_items
       FROM numbered c
       JOIN "deal" d ON d."id" = c.deal_id
       JOIN "employee" e ON e."id" = d."employeeId"
       JOIN "deal_stage" st ON st."id" = d."stageId"
       LEFT JOIN "customer" cust ON cust."id" = d."customerId"
       -- LATERAL, not a join: four line items would otherwise become four rows
       -- and the pager would count the same order four times.
       LEFT JOIN "sales_source" src ON src."id" = d."sourceId"
       LEFT JOIN LATERAL (
         SELECT string_agg(pr."name" || ' - ' || di."quantity"::text || ' ta', E'\\n' ORDER BY pr."name") AS products
           FROM "deal_item" di
           JOIN "product" pr ON pr."id" = di."productId"
          WHERE di."dealId" = d."id"
       ) items ON true
      -- NULL, not an empty array: ANY over an empty array is false for every
      -- row, so an empty selection would render an empty table rather than
      -- the whole queue.
      WHERE ($3::text[] IS NULL OR c.outcome = ANY($3::text[]))
        AND ($5::text IS NULL OR c.rop = $5)
        ${InsightsRepository.SEARCH_SQL('$4')}
      -- The deal id breaks ties, so paging cannot show one order twice and
      -- skip another when a thousand rows share a sort value.
      ORDER BY ${sortColumn[query.sort]} ${direction} NULLS LAST, d."id" ASC
      LIMIT $6 OFFSET $7`,
      period.start,
      period.end,
      query.outcomes && query.outcomes.length > 0 ? [...query.outcomes] : null,
      query.q ?? null,
      query.rop ?? null,
      query.pageSize,
      offset,
    )

    return {
      totalItems: rows.length === 0 ? 0 : int(rows[0]!.total_items),
      rows: rows.map((r) => {
        const queuedAt = r.queued_at === null ? null : new Date(r.queued_at)
        const decidedAt = r.decided_at === null ? null : new Date(r.decided_at)

        return {
          dealId: r.deal_id,
          rop: r.rop,
          dailyNo: int(r.daily_no),
          bitrixId: r.bitrix_id,
          orderCode: r.order_code,
          title: r.title,
          customerName: r.customer_name,
          customerPhones:
            r.customer_phones === null || r.customer_phones === ''
              ? []
              : r.customer_phones.split('\n'),
          employeeName: r.employee_name,
          // string_agg rather than array_agg: a text array's shape depends on
          // the driver, a delimiter does not.
          products: r.products === null ? [] : r.products.split('\n'),
          region: r.region,
          deliveryAddress: r.delivery_address,
          sourceName: r.source_name,
          amountMinor: money(r.amount_minor),
          currency: r.currency,
          stageName: r.stage_name,
          outcome: r.outcome,
          movedAt: new Date(r.moved_at),
          queuedAt,
          decidedAt,
          // Both ends or nothing: an order refused without ever being queued
          // has no waiting time, and zero would read as "decided instantly".
          hoursToDecide:
            decidedAt === null || queuedAt === null
              ? null
              : Math.round(((decidedAt.getTime() - queuedAt.getTime()) / 3_600_000) * 10) / 10,
        }
      }),
    }
  }

  // -------------------------------------------------------------------------
  // 5 — The command centre
  // -------------------------------------------------------------------------

  /**
   * What the company took in, on the clock that is not distorted by delivery.
   *
   * THE TRAP THIS EXISTS TO AVOID. Revenue is bucketed by `closedAt`, and the
   * median order takes 20.5 days to close (p90 61.5). So a month-over-month
   * revenue comparison reads August's closed deals against July's — most of
   * July's are still open. Measured on this portal, that produced a headline
   * of +478% "growth" in a month whose order intake actually FELL 8.5%.
   *
   * Intake is counted on `createdAtSource`, so both months are complete on the
   * same basis and the comparison means what it says. `countsAsRevenue` is
   * named explicitly: База duplicates Доставка's orders a median of ten days
   * later, and without the guard this figure is roughly double.
   */
  async commandIntake(period: Period): Promise<{
    orders: number
    bookedMinor: bigint
    won: number
    lost: number
    open: number
  }> {
    const rows = await this.prisma.$queryRawUnsafe<
      { orders: bigint; booked: MoneyText; won: bigint; lost: bigint; open: bigint }[]
    >(
      `
      SELECT count(*)::bigint AS orders,
             sum(d."amountMinor")::text AS booked,
             count(*) FILTER (WHERE d."status" = 'WON')::bigint  AS won,
             count(*) FILTER (WHERE d."status" = 'LOST')::bigint AS lost,
             count(*) FILTER (WHERE d."status" = 'OPEN')::bigint AS open
        FROM "deal" d
       WHERE d."countsAsRevenue"
         AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      `,
      period.start,
      period.end,
    )

    const r = rows[0]
    return {
      orders: int(r?.orders ?? 0n),
      bookedMinor: money(r?.booked ?? null),
      won: int(r?.won ?? 0n),
      lost: int(r?.lost ?? 0n),
      open: int(r?.open ?? 0n),
    }
  }

  /**
   * The intake, day by day — the shape behind the headline number.
   *
   * Same clock and same filter as `commandIntake`, so the area under this
   * series IS the tile beside it; a chart that filtered differently from its
   * own headline would disagree with it by Friday. Days with no orders come
   * back as zeros rather than being absent: on a time axis a missing day
   * reads as "not measured", and a working day that took nothing in is a
   * measurement. The series is capped at TODAY in Tashkent — a period that
   * runs to the end of the month must not draw a zero tail through days that
   * have not happened yet.
   */
  async commandIntakeDaily(
    period: Period,
  ): Promise<{ day: string; orders: number; bookedMinor: bigint }[]> {
    const tz = env.APP_TIMEZONE
    const rows = await this.prisma.$queryRawUnsafe<
      { day: string; orders: bigint; booked: MoneyText }[]
    >(
      `
      WITH days AS (
        SELECT generate_series(
                 ($1::timestamp AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date,
                 LEAST(
                   (($2::timestamp - interval '1 millisecond') AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date,
                   (now() AT TIME ZONE '${tz}')::date
                 ),
                 interval '1 day'
               )::date AS day
      ),
      taken AS (
        SELECT (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date AS day,
               count(*)::bigint AS orders,
               sum(d."amountMinor")::text AS booked
          FROM "deal" d
         WHERE d."countsAsRevenue"
           AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
         GROUP BY 1
      )
      SELECT days.day::text AS day,
             COALESCE(taken.orders, 0)::bigint AS orders,
             taken.booked AS booked
        FROM days
        LEFT JOIN taken ON taken.day = days.day
       ORDER BY days.day
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => ({
      day: r.day,
      orders: int(r.orders),
      bookedMinor: money(r.booked ?? null),
    }))
  }

  /**
   * Money that actually closed, money still open, and the lag between them.
   *
   * `closeLagDays` is the point of this method. It is the median days from
   * order created to closed, and it is what licenses the screen to show
   * delivered revenue WITHOUT a growth arrow: at a 20-day median, this month's
   * closed column is mostly last month's orders, so comparing it to last
   * month's compares two overlapping sets and calls the overlap growth.
   *
   * Open pipeline is the honest counterweight, and it is scoped to orders
   * CREATED in the window rather than to every open deal in the company. A
   * company-wide snapshot is the same number in every window, so it cannot be
   * compared to anything; scoped this way it answers "of what we took in, how
   * much is still in flight" — which is complete on the creation clock and so
   * is comparable month to month. A falling pipeline against rising closures
   * is exactly the picture a 20-day lag produces on the way down.
   */
  async commandRevenue(period: Period): Promise<{
    deliveredMinor: bigint
    openMinor: bigint
    closeLagDays: number | null
  }> {
    const rows = await this.prisma.$queryRawUnsafe<
      { delivered: MoneyText; open_now: MoneyText; lag: number | null }[]
    >(
      `
      SELECT
        (SELECT sum(d."amountMinor")::text
           FROM "deal" d
          WHERE d."countsAsRevenue" AND d."status" = 'WON'
            AND d."closedAt" >= $1 AND d."closedAt" < $2)                  AS delivered,
        (SELECT sum(d."amountMinor")::text
           FROM "deal" d
          WHERE d."countsAsRevenue" AND d."status" = 'OPEN'
            AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2)    AS open_now,
        (SELECT percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM (d."closedAt" - d."createdAtSource")) / 86400.0)
           FROM "deal" d
          WHERE d."countsAsRevenue" AND d."status" = 'WON'
            AND d."closedAt" >= $1 AND d."closedAt" < $2
            AND d."closedAt" > d."createdAtSource")::float                 AS lag
      `,
      period.start,
      period.end,
    )

    const r = rows[0]
    return {
      deliveredMinor: money(r?.delivered ?? null),
      openMinor: money(r?.open_now ?? null),
      closeLagDays: r?.lag == null ? null : Math.round(r.lag * 10) / 10,
    }
  }

  /**
   * Customers whose FIRST order was created in the window, and who came back.
   *
   * On the creation clock for the same reason intake is: a first purchase
   * bucketed by `closedAt` lands in whichever month the parcel happened to
   * arrive, which is not when the customer was won.
   */
  async commandCustomers(period: Period): Promise<{ ordering: number; fresh: number }> {
    const rows = await this.prisma.$queryRawUnsafe<{ ordering: bigint; fresh: bigint }[]>(
      `
      WITH first_order AS (
        SELECT d."customerId" AS customer_id, min(d."createdAtSource") AS first_at
          FROM "deal" d
         WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
         GROUP BY d."customerId"
      ),
      ordered AS (
        SELECT DISTINCT d."customerId" AS customer_id
          FROM "deal" d
         WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
           AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      )
      SELECT count(*)::bigint AS ordering,
             count(*) FILTER (WHERE f.first_at >= $1 AND f.first_at < $2)::bigint AS fresh
        FROM ordered o JOIN first_order f ON f.customer_id = o.customer_id
      `,
      period.start,
      period.end,
    )

    const r = rows[0]
    return { ordering: int(r?.ordering ?? 0n), fresh: int(r?.fresh ?? 0n) }
  }

  /**
   * How much of the month's revenue rests on how few products.
   *
   * The largest single business risk visible in this database, and the one cut
   * the concentration module does not make — it indexes by source and by
   * region, not by product. Measured here: the top product is 68.5% of the
   * month's revenue and the top two are 95.8%. A director who does not know
   * that cannot weigh a supply interruption.
   *
   * Line items rather than deal totals, because a deal can carry several
   * products and splitting its amount across them is the only way the shares
   * add to the whole.
   */
  async commandProducts(period: Period, limit = 4): Promise<{
    rows: { label: string; revenueMinor: bigint; sharePercent: number }[]
    topSharePercent: number | null
    coveragePercent: number | null
  }> {
    const rows = await this.prisma.$queryRawUnsafe<
      { label: string; revenue: MoneyText; total: MoneyText; booked: MoneyText }[]
    >(
      `
      WITH won AS (
        SELECT d."id", d."amountMinor"
          FROM "deal" d
         WHERE d."countsAsRevenue" AND d."status" = 'WON'
           AND d."closedAt" >= $1 AND d."closedAt" < $2
      ),
      lines AS (
        SELECT COALESCE(p."name", 'Nomsiz') AS label,
               li."totalMinor" AS amount
          FROM "deal_item" li
          JOIN won ON won."id" = li."dealId"
          LEFT JOIN "product" p ON p."id" = li."productId"
      )
      SELECT label,
             sum(amount)::text AS revenue,
             (SELECT sum(amount) FROM lines)::text          AS total,
             (SELECT sum("amountMinor") FROM won)::text     AS booked
        FROM lines
       GROUP BY label
       ORDER BY sum(amount) DESC
      `,
      period.start,
      period.end,
    )

    const total = money(rows[0]?.total ?? null)
    if (total === 0n) return { rows: [], topSharePercent: null, coveragePercent: null }

    const share = (minor: bigint): number =>
      Math.round((Number(minor) / Number(total)) * 1000) / 10

    const top = rows.slice(0, limit).map((r) => {
      const revenueMinor = money(r.revenue)
      return { label: r.label, revenueMinor, sharePercent: share(revenueMinor) }
    })

    // Everything past the cut, as one honest remainder rather than a dropped
    // tail — the shares have to add to 100 or the reader cannot trust them.
    const rest = rows.slice(limit).reduce((a, r) => a + money(r.revenue), 0n)
    if (rest > 0n) {
      top.push({ label: 'Boshqalar', revenueMinor: rest, sharePercent: share(rest) })
    }

    // What share of the period's WON revenue carries line items at all. The
    // shares above are of THAT, not of total revenue, and saying so is the
    // difference between a fact and a guess — a product that is 68% of the
    // itemised half is not 68% of the business unless the halves match.
    const booked = money(rows[0]?.booked ?? null)

    return {
      rows: top,
      topSharePercent: top[0]?.sharePercent ?? null,
      coveragePercent:
        booked === 0n ? null : Math.round((Number(total) / Number(booked)) * 1000) / 10,
    }
  }

  /**
   * The confirmation queue's daily rejection share, and its own control band.
   *
   * The one operational number that is daily, complete the same day, and
   * attached to money. Measured over 51 working days on this portal it runs a
   * mean of 10.98% with sd 4.56, and mean+2sd was breached on 2 of them — a
   * 3.9% alarm rate, which is what a usable control limit looks like rather
   * than one that cries every afternoon.
   *
   * SUNDAYS ARE EXCLUDED FROM THE BASELINE, not from the reading. Sunday takes
   * 31 orders against a weekday 110 and its share swings twice as widely (sd
   * 8.12 vs 4.56); blended into one baseline, every Sunday trips the alarm.
   */
  async commandRejectionBand(
    period: Period,
  ): Promise<{
    today: number | null
    mean: number
    sd: number
    limit: number
    days: number
    /** Every day of the window up to today — the control chart's raw series. */
    series: { day: string; share: number | null; orders: number; rejected: number; dow: number }[]
  }> {
    const tz = env.APP_TIMEZONE
    /*
      Gap-filled the same way the intake series is: a day with no queue
      traffic comes back with share NULL rather than being absent, so the
      chart can draw an honest gap ("not measured") instead of silently
      splicing Thursday onto Saturday. The series is capped at today for the
      same reason the intake series is.
    */
    const rows = await this.prisma.$queryRawUnsafe<
      { day: string; share: number | null; orders: number; rejected: number; dow: number }[]
    >(
      `${InsightsRepository.QUEUE_SQL},
       perday AS (
         SELECT (c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date AS day,
                (count(*) FILTER (WHERE c.outcome = 'REJECTED')::float
                   / NULLIF(count(*), 0)::float * 100)::float AS share,
                count(*)::int AS orders,
                count(*) FILTER (WHERE c.outcome = 'REJECTED')::int AS rejected
           FROM numbered c
          GROUP BY 1
       ),
       days AS (
         SELECT generate_series(
                  ($1::timestamp AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date,
                  LEAST(
                    (($2::timestamp - interval '1 millisecond') AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date,
                    (now() AT TIME ZONE '${tz}')::date
                  ),
                  interval '1 day'
                )::date AS day
       )
       SELECT days.day::text AS day,
              perday.share AS share,
              COALESCE(perday.orders, 0)::int AS orders,
              COALESCE(perday.rejected, 0)::int AS rejected,
              EXTRACT(DOW FROM days.day)::int AS dow
         FROM days
         LEFT JOIN perday ON perday.day = days.day
        ORDER BY days.day`,
      period.start,
      period.end,
    )

    // Sunday is its own regime; it informs nobody about a Tuesday. Empty
    // days carry no reading at all, so they cannot inform the baseline either.
    const working = rows
      .filter((r) => r.dow !== 0 && r.share !== null)
      .map((r) => r.share as number)
    const days = working.length

    if (days < 5) {
      return { today: rows.at(-1)?.share ?? null, mean: 0, sd: 0, limit: 0, days, series: rows }
    }

    const mean = working.reduce((a, b) => a + b, 0) / days
    const variance = working.reduce((a, b) => a + (b - mean) ** 2, 0) / days
    const sd = Math.sqrt(variance)

    return {
      today: rows.at(-1)?.share ?? null,
      mean: Math.round(mean * 10) / 10,
      sd: Math.round(sd * 10) / 10,
      limit: Math.round((mean + 2 * sd) * 10) / 10,
      days,
      series: rows,
    }
  }

  /**
   * One cohort of orders, followed through the company.
   *
   * Every step shares a denominator — the orders CREATED in the window — so
   * the percentages compose. That is the difference between this and the
   * stage-conversion figure the flow service returns, which divides adjacent
   * rows in sort order and is arithmetic rather than a funnel: a deal can skip
   * a stage, and stages that never see each other still appear to convert.
   *
   * Marketing is deliberately absent from the top. Roistat is a separate
   * ledger with its own definition of an order and a 42-day history; splicing
   * it on would produce a funnel whose first step cannot be reconciled with
   * its second.
   */
  async commandFunnel(period: Period): Promise<
    { key: string; orders: number }[]
  > {
    const rows = await this.prisma.$queryRawUnsafe<
      { created: bigint; queued: bigint; confirmed: bigint; shipped: bigint; delivered: bigint }[]
    >(
      `
      WITH cohort AS (
        SELECT d."id"
          FROM "deal" d
         WHERE d."countsAsRevenue"
           AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      ),
      trail AS (
        SELECT h."dealId" AS deal_id,
               bool_or(s."logisticsRole" = 'PENDING_CONFIRM') AS queued,
               bool_or(s."logisticsRole" = 'CONFIRMED')       AS confirmed,
               bool_or(s."logisticsRole" IN ('IN_TRANSIT', 'REGIONAL_HUB', 'CARRIER')) AS shipped,
               bool_or(s."logisticsRole" = 'DELIVERED')       AS delivered
          FROM "deal_stage_history" h
          JOIN "deal_stage" s ON s."id" = h."stageId"
          JOIN cohort c ON c."id" = h."dealId"
         GROUP BY h."dealId"
      )
      SELECT count(*)::bigint AS created,
             count(*) FILTER (WHERE t.queued)::bigint    AS queued,
             count(*) FILTER (WHERE t.confirmed)::bigint AS confirmed,
             count(*) FILTER (WHERE t.shipped)::bigint   AS shipped,
             count(*) FILTER (WHERE t.delivered)::bigint AS delivered
        FROM cohort c LEFT JOIN trail t ON t.deal_id = c."id"
      `,
      period.start,
      period.end,
    )

    const r = rows[0]
    return [
      { key: 'created', orders: int(r?.created ?? 0n) },
      { key: 'queued', orders: int(r?.queued ?? 0n) },
      { key: 'confirmed', orders: int(r?.confirmed ?? 0n) },
      { key: 'shipped', orders: int(r?.shipped ?? 0n) },
      { key: 'delivered', orders: int(r?.delivered ?? 0n) },
    ]
  }

  // -------------------------------------------------------------------------
  // 9 — Channels
  // -------------------------------------------------------------------------

  /**
   * What each acquisition channel produces.
   *
   * TWO CONVERSION RATES, because one number cannot answer both questions and
   * pretending otherwise is how this method used to lie.
   *
   * `leads` counts the deals a channel created in pipelines that represent a
   * human enquiry — registration, qualification, confirmation, and the money
   * pipelines themselves. It deliberately EXCLUDES the AI-triage bucket and the
   * ignored pipelines (HR candidates, complaints). Measured on the portal in
   * August 2026, one source produced 22,864 rows of which 17,728 — 78% — were
   * AI-triage records; dividing wins by that total printed a 0.6% conversion
   * for a channel that closes 44.7% of the orders it actually gets. A
   * denominator three quarters full of machine bookkeeping is not the top of a
   * funnel, and HR applicants are not leads at all.
   *
   * `deals` counts only what can produce money. So:
   *   conversionBp    = won / leads  — "of enquiries, how many paid"
   *   funnelRateBp    = won / deals  — "of real orders, how many closed"
   * Both ship, both are labelled with their own fraction on screen, and neither
   * is presented as "the" conversion.
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
        count(d."id") FILTER (WHERE p."role" NOT IN ('AI_TRIAGE', 'IGNORED'))::bigint AS leads,
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
      LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
      GROUP BY s."id", s."name"
      -- Keep a source that produced only AI-triage rows out of the table
      -- entirely rather than listing it with a zero it never earned.
      HAVING count(d."id") FILTER (WHERE p."role" NOT IN ('AI_TRIAGE', 'IGNORED')) > 0
      -- Order by the AGGREGATE, never by the output alias.
      --
      -- The revenue column is sum(...)::text, because BigInt totals exceed
      -- 2^53 and have to cross the driver as text. Postgres lets ORDER BY name
      -- an output column, and that column is TEXT -- so ordering by the alias
      -- sorted lexicographically: "9000000000" (9 mln) ranked above
      -- "120000000000" (1.2 bln), because the digit 9 sorts after 1. The table
      -- was mis-ranked, and the share list's top-12 cut then dropped whichever
      -- large channel happened to begin with a low digit. Naming the
      -- expression sorts the numeric value the text was made from.
      ORDER BY sum(d."amountMinor") FILTER (WHERE d."countsAsRevenue" AND d."status" = 'WON')
                 DESC NULLS LAST,
               leads DESC
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
        // Of the orders that reached a money pipeline, how many closed. The
        // number a channel manager can actually act on; the one above answers
        // the different question of how much of the traffic was worth having.
        funnelRateBp: rateBp(won, int(r.deals)),
        /*
          Null, not zero, when nothing was won.
    
          An average over an empty set does not exist. Zero states that this
          channel's orders are worth nothing, which is a claim about orders it
          never had — the same mistake the roas field below already refuses to
          make. Division rounds half away from zero rather than truncating, to
          agree with divideMoney everywhere else.
        */
        averageChequeMinor:
          won === 0 ? null : (revenue + BigInt(won) / 2n) / BigInt(won),
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
        cancelled_early: bigint
        revenue: MoneyText
      }[]
    >(
      `
      SELECT
        COALESCE(d."fulfilmentPoint", 'Belgilanmagan') AS point,
        count(*)::bigint AS orders,
        count(*) FILTER (WHERE cur."logisticsRole" = 'DELIVERED')::bigint AS delivered,
        count(*) FILTER (WHERE cur."logisticsRole" = 'REFUSED')::bigint AS refused,
        count(*) FILTER (WHERE cur."logisticsRole" = 'CANCELLED_EARLY')::bigint AS cancelled_early,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text AS revenue
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
      /*
        Classified exactly as logisticsRoutes and logisticsRegions classify.
    
        This used to read status WON / LOST and pass 0 for cancelledEarly, so
        the same orders produced a HIGHER delivery rate here than on the
        Logistics page — the gap being precisely the cancelled-before-dispatch
        share, which vanished from the denominator. Two screens, one column
        heading, two quantities. One definition, in one helper, is the fix.
      */
      const cancelledEarly = int(r.cancelled_early)
      return {
        point: r.point,
        orders: int(r.orders),
        delivered,
        refused,
        cancelledEarly,
        revenueMinor: money(r.revenue),
        deliveryRateBp: deliveryRateBp(delivered, refused, cancelledEarly),
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
      /*
        Two independent aggregates joined on the department, NOT one query with
        both a per-employee LATERAL and a deal join.
        
        That earlier shape took 52 seconds and was cancelled by the statement
        timeout — the page simply never loaded. The reason is a fan-out: the
        deal join multiplies each employee row by their deal count, and the
        correlated subqueries then ran once per multiplied row, 24,367 index
        searches deep. Aggregating each side to one row per department first
        means every table is touched exactly once.
      */
      WITH active AS (
        SELECT DISTINCT "employeeId" AS id
          FROM "call_record"
         WHERE "startedAt" >= $1 AND "startedAt" < $2
         UNION
        SELECT DISTINCT "employeeId" AS id
          FROM "deal"
         WHERE "countsAsRevenue" AND "status" = 'WON'
           AND "closedAt" >= $1 AND "closedAt" < $2
      ),
      people AS (
        SELECT
          e."departmentId" AS dep_id,
          count(*)::bigint AS headcount,
          count(*) FILTER (WHERE e."isActive")::bigint AS active_headcount,
          -- On the roster, marked active, and produced something. The gap
          -- between this and active_headcount is "who is here and who is not".
          count(*) FILTER (WHERE e."isActive" AND a.id IS NOT NULL)::bigint AS working_headcount
        FROM "employee" e
        LEFT JOIN active a ON a.id = e."id"
        WHERE e."departmentId" IS NOT NULL
        GROUP BY e."departmentId"
      ),
      sales AS (
        SELECT
          e."departmentId" AS dep_id,
          count(d."id") FILTER (WHERE d."countsAsRevenue" AND d."status" = 'WON')::bigint AS deals,
          sum(d."amountMinor") FILTER (WHERE d."countsAsRevenue" AND d."status" = 'WON')::text AS revenue
        FROM "deal" d
        JOIN "employee" e ON e."id" = d."employeeId"
        WHERE d."closedAt" >= $1 AND d."closedAt" < $2
          AND e."departmentId" IS NOT NULL
        GROUP BY e."departmentId"
      )
      SELECT
        dep."id",
        dep."name",
        dep."parentId" AS parent_id,
        head."fullName" AS head_name,
        COALESCE(p.headcount, 0)::bigint AS headcount,
        COALESCE(p.active_headcount, 0)::bigint AS active_headcount,
        COALESCE(p.working_headcount, 0)::bigint AS working_headcount,
        COALESCE(s.deals, 0)::bigint AS deals,
        s.revenue AS revenue
      FROM "department" dep
      LEFT JOIN "employee" head ON head."id" = dep."headId"
      LEFT JOIN people p ON p.dep_id = dep."id"
      LEFT JOIN sales s ON s.dep_id = dep."id"
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
