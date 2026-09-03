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
  type ConfirmationQueueMode,
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
  // Deliberately NOT rounded to whole basis points. `pct` rounds it again for
  // display, and rounding twice moved Namangan's 86/101 from 85.1% to 85.2% —
  // small, except the tone thresholds sit at 85 and 60.
  return denominator === 0 ? null : (numerator / denominator) * 10_000
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

/**
 * Peel the `GROUPING SETS` grand total off the bottom of a delivery cut.
 *
 * Both cuts of the logistics table are grouped over `((route), ())`, so the
 * one row where `GROUPING(route)` is 1 is the whole window aggregated by the
 * database — including a median taken over every deal at once, which is the
 * only way to get a real one. An empty window still yields that row, so the
 * total is never undefined.
 */
function splitTotals(
  rows: readonly {
    route: string | null
    is_total: number
    orders: bigint
    delivered: bigint
    refused: bigint
    cancelled_early: bigint
    in_flight: bigint
    revenue: MoneyText
    median_days: number | null
    p90_days: number | null
  }[],
): LogisticsBreakdown {
  const toRow = (r: (typeof rows)[number]): LogisticsRouteRow => {
    const delivered = int(r.delivered)
    const refused = int(r.refused)
    const cancelledEarly = int(r.cancelled_early)
    return {
      route: r.route ?? 'Jami',
      orders: int(r.orders),
      delivered,
      refused,
      cancelledEarly,
      inFlight: int(r.in_flight),
      revenueMinor: money(r.revenue),
      deliveryRateBp: deliveryRateBp(delivered, refused, cancelledEarly),
      medianDays: r.median_days === null ? null : Number(r.median_days),
      p90Days: r.p90_days === null ? null : Number(r.p90_days),
    }
  }

  const totalRow = rows.find((r) => r.is_total === 1)

  return {
    rows: rows.filter((r) => r.is_total === 0).map(toRow),
    total: totalRow
      ? toRow(totalRow)
      : {
          route: 'Jami',
          orders: 0,
          delivered: 0,
          refused: 0,
          cancelledEarly: 0,
          inFlight: 0,
          revenueMinor: 0n,
          deliveryRateBp: null,
          medianDays: null,
          p90Days: null,
        },
  }
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
  /**
   * How many of this cohort ever came back, counted once each.
   *
   * Not derivable from `cells`: a customer who returned twice is in two of
   * them, and the first cell alone is only the ones who came back the very
   * next month.
   */
  readonly returned: number
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
  /**
   * Days from the order being created to the `Доставлено` stamp.
   *
   * NOT from the hub, and not to `closedAt`. Both of those were tried and both
   * lie on this portal:
   *
   *   `closedAt` is a DATE — every closed deal lands on UTC midnight, all
   *   105,693 of them — so an hour figure taken against it reports the time of
   *   day the OTHER end happened and calls it precision. Worse, a parcel
   *   delivered the same afternoon it reached the hub had `closedAt` BEFORE
   *   the hub stamp, and the guard that dropped those threw away 52% of every
   *   month's deliveries without saying so.
   *
   *   The hub stamp is not a checkpoint. Measured against the delivered
   *   stamp its median is 0.0 hours: the route is written down when the
   *   parcel is closed out, not when it is picked up.
   *
   * The `Доставлено` stage entry, on the other hand, is a real timestamp on
   * every one of the delivered orders. Measured from creation it covers all of
   * them with nothing dropped — and on this portal the robot moves a confirmed
   * order to `В пути` within minutes, so creation and dispatch are six hours
   * apart in the median. There is no honest in-network clock to prefer.
   */
  readonly medianDays: number | null
  readonly p90Days: number | null
}

/** A cut of the delivery table plus the true totals row beneath it. */
export interface LogisticsBreakdown {
  readonly rows: readonly LogisticsRouteRow[]
  /**
   * The whole window in one row, aggregated by the DATABASE.
   *
   * Not summable in the service: a median of medians is not a median, and
   * weighting per-route medians by order count made it worse still — the
   * weight counted every order while the median covered only the delivered
   * ones. `GROUPING SETS` costs one extra pass over rows already in memory
   * and returns the real thing.
   */
  readonly total: LogisticsRouteRow
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
  /**
   * Reached NO decision — neither confirmed nor chased — and is still moving.
   *
   * "Chased" counts as reached. Looking only for CONFIRMED put the 174 orders
   * an operator rang and could not reach into this bucket as well as into
   * `unreachable`, so the screen's three states summed to 174 more than the
   * orders they were dividing.
   */
  readonly unconfirmedOpen: number
  /** Reached no decision and is already resolved — genuinely skipped. */
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
  /** Дата создания — when the order was placed. What the window selects on. */
  readonly createdAt: Date
  /** The order's last confirmation move, which is where its status comes from. */
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
  /**
   * How many times this order has reached Тасдиклаш — over its WHOLE life,
   * not over the reporting window.
   *
   * «🔁 ҚАЙТА ТУШДИ» on the board. The client's bot marks this by remembering
   * each deal's previous stage in `deal_state.json` and noticing the move back
   * into `C4:NEW`; that memory is the bot's, and a dashboard that reads the
   * portal once has no "what it was before". The same fact IS in Bitrix
   * though, as a row per entry in the stage history: an order that entered
   * `C4:NEW` more than once came back. This counts those entries.
   *
   * NOT WHAT DRAWS THE MARK — `queueReturns` is. An order can enter twice in
   * fifteen minutes because one person confirmed it, spotted a mistake and
   * pulled it back; that is two entries and no return.
   *
   * ALL TIME, DELIBERATELY. The cohort's own scan is bounded by the window —
   * it has to be, or the queue query is a sequential pass over the history
   * table — so a return that happened this morning to an order first queued
   * last month would look like a first arrival. The count is taken separately,
   * for the page's rows only, where the (dealId, enteredAt) index makes it one
   * scan per row rather than a second pass over the cohort.
   */
  readonly queueEntries: number
  /**
   * How many of those entries were real RETURNS — the mark's own count.
   *
   * A return is an arrival at least `REPEAT_GAP_HOURS` after the previous one,
   * which is the bot's own rule and therefore the one the floor already reads
   * in Telegram. Zero means no mark, however many times the order bounced
   * through the stage in a single afternoon.
   */
  readonly queueReturns: number
  /**
   * The arrival before the last RETURN — when the order was last in the queue
   * before it came back. Null when it has never come back.
   *
   * What turns the mark into something actionable: an order that came back
   * three minutes after it was confirmed is somebody correcting a misclick,
   * and one that came back four days later is a customer who was reached
   * again. The badge cannot tell them apart; the date beside it can.
   */
  readonly previousQueuedAt: Date | null
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

/** The same shape `SellerBoardFilters` carries, kept local so the two repositories stay independent. */
export interface ConfirmationSellerRatingFilters {
  readonly employeeIds?: readonly string[]
  readonly departmentIds?: readonly string[]
  readonly sourceIds?: readonly string[]
  readonly restrictToEmployeeId?: string
}

/**
 * One operator's standing on the confirmation-queue cohort.
 *
 * THE TWO FACTS ARE THE CLIENT'S OWN, NAMED «FAKT 1» AND «FAKT 2» ON THE
 * FLOOR. FAKT 1 is Тасдиқланди — the order reached the customer and moved
 * into Доставка (`outcome = 'CONFIRMED'`). FAKT 2 is Доставланди — of those,
 * the ones the carrier actually delivered (`deal.status = 'WON'` on a
 * Доставка-pipeline deal, i.e. C6:WON).
 *
 * «Успешно заказ» (C6:UC_YUKVF1) was considered and rejected for FAKT 1: see
 * `DELIVERY_STAGE_ROLES['C6:UC_YUKVF1']` in `mapping.ts` — it is a settlement
 * stamp automation writes within five seconds of Доставлено in most cases,
 * not an operator's own act, and using it collapsed FAKT 1 into FAKT 2.
 *
 * FAKT 2 IS NOT A SUBSET OF FAKT 1, and the client's definition is why:
 * "har bir buyurtma" — EVERY cohort order that reached delivery counts,
 * including one shipped as Тасдиқланмай чиқди (outcome UNCONFIRMED_SHIPPED,
 * so outside FAKT 1) that the carrier then delivered. For the ordinary order
 * the two do nest — `moves` never records a C6:WON visit (WON is not in
 * `CONFIRMATION_SIGNAL_STAGES`), so a confirmed order's `outcome` stays
 * 'CONFIRMED' through delivery — which is what makes inTransit ("confirmed,
 * still on the way") a meaningful remainder.
 */
export interface ConfirmationSellerRatingRow {
  readonly employeeId: string
  readonly fullName: string
  /** The ROP's own name — see `queueSql`'s `classified.rop`. Null off a team. */
  readonly rop: string | null
  /** FAKT 1: Тасдиқланди — confirmed orders, this operator's book. */
  readonly confirmedOrders: number
  readonly confirmedMinor: bigint
  /** FAKT 2: Доставланди — of those, delivered (C6:WON). */
  readonly deliveredOrders: number
  readonly deliveredMinor: bigint
  /** Confirmed but not yet delivered — still inside FAKT 1, shown apart. */
  readonly inTransitOrders: number
  readonly inTransitMinor: bigint
  /** Тасдиқланмади — refused in the queue. Outside FAKT 1, shown so the exclusion is visible. */
  readonly rejectedOrders: number
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
      {
        cohort: Date
        size: bigint
        months_since: number
        customers: bigint
        revenue: MoneyText
        returned: bigint
      }[]
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
      ),
      /*
        Everyone who ever came back, once each.

        It cannot be derived from the matrix beside it: a customer who
        returned in month +1 AND month +3 appears in two cells, so summing
        double-counts them, and taking only the first cell counts only the
        ones who came back immediately. Measured on this database: 320 by
        that reading against 751 who actually returned.

        A separate aggregate rather than a window function, because a window
        function may not take DISTINCT.
      */
      returners AS (
        SELECT cohort, count(DISTINCT customer_id) AS returned
          FROM purchases
         WHERE months_since > 0
         GROUP BY cohort
      )
      SELECT
        p.cohort,
        s.size,
        p.months_since,
        count(DISTINCT p.customer_id)::bigint AS customers,
        sum(p.amount)::text AS revenue,
        -- How many of this cohort ever came back, counted once each; see the
        -- returners CTE. Repeated on every row of the cohort, which is what
        -- lets one query carry both the matrix and the headline.
        r.returned::bigint AS returned
      FROM purchases p
      JOIN sized s ON s.cohort = p.cohort
      LEFT JOIN returners r ON r.cohort = p.cohort
      WHERE p.cohort >= date_trunc('month', (now() AT TIME ZONE $1)) - make_interval(months => $2::int)
        AND p.months_since >= 0
      GROUP BY p.cohort, s.size, p.months_since, r.returned
      ORDER BY p.cohort DESC, p.months_since ASC
      `,
      this.tz,
      options.months,
    )

    const byCohort = new Map<string, { size: number; returned: number; cells: CohortCell[] }>()

    for (const row of rows) {
      const key = row.cohort.toISOString().slice(0, 10)
      const entry =
        byCohort.get(key) ?? { size: int(row.size), returned: int(row.returned), cells: [] }
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
      returned: entry.returned,
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
  async retentionStages(): Promise<{
    readonly stages: RetentionStage[]
    /**
     * Distinct customers on an OPEN retention deal — the ones actually being
     * worked, counted once each.
     *
     * NOT the sum of the rows. A customer with deals on two stages is in two
     * of them, so adding the column up counted 1,660 people twice and
     * produced a "base" larger than the whole customer list. It also swept in
     * Активный, Неактивные and Недозвоны, which are where the cadence ENDS.
     */
    readonly workedCustomers: number
  }> {
    const rows = await this.prisma.$queryRawUnsafe<
      { stage: string | null; is_total: number; customers: bigint; open_customers: bigint }[]
    >(
      `
      SELECT
        s."name" AS stage,
        GROUPING(s."name")::int AS is_total,
        count(DISTINCT d."customerId")::bigint AS customers,
        count(DISTINCT d."customerId") FILTER (WHERE d."status" = 'OPEN')::bigint
          AS open_customers
      FROM "deal" d
      JOIN "deal_stage" s ON s."id" = d."stageId"
      JOIN "pipeline" p ON p."id" = d."pipelineId"
      WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
      GROUP BY GROUPING SETS ((s."name", s."sortOrder"), ())
      ORDER BY is_total, min(s."sortOrder")
      `,
    )

    return {
      stages: rows
        .filter((r) => r.is_total === 0)
        .map((r) => ({ stage: r.stage ?? '', customers: int(r.customers) })),
      workedCustomers: int(rows.find((r) => r.is_total === 1)?.open_customers ?? 0n),
    }
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
   * Timings are the CALENDAR DAYS between entering that route stage and the
   * deal being closed — see `LogisticsRouteRow.medianDays` for why days and
   * not hours. Median and p90 rather than a mean: delivery times have a long
   * tail of chased orders, and an average lets three disasters hide a hundred
   * normal days.
   *
   * `refused` and `cancelledEarly` stay apart. One is a parcel that travelled
   * and came back, the other a customer who changed their mind before
   * dispatch; only the first cost anything to move.
   */
  /**
   * BOTH LOGISTICS CUTS FROM ONE PASS — by route and by customer region.
   *
   * They were two methods issuing two statements that differed by ONE LINE:
   * `COALESCE(r.route, …)` against `COALESCE(d."region", …)`. Everything above
   * that — the three unbounded CTEs over the whole stage history, the DISTINCT
   * ON sorts, the join back to every revenue deal in the window — was computed
   * twice to answer one card. Measured on production: 2 212 ms and 1 361 ms,
   * side by side in a Promise.all, for a single request. And the command centre
   * pays it too, because its logistics module fans out to the same pair.
   *
   * `scoped` is MATERIALIZED and read twice, so the expensive half runs once
   * and only the grouping is repeated. Postgres would materialise a CTE with
   * two references anyway; saying so keeps it true if a later edit leaves one.
   *
   * MEASURES THE DELIVERY LEG, both ways. It used to measure `closedAt -
   * createdAtSource` — the order's whole life, qualification and confirmation
   * included — while the route table beside it measured the delivery leg, both
   * under one column header. That is how the page's headline came to say
   * delivery took 197 hours when the delivery leg's own median was 87.
   *
   * The joins stay LEFT, so a region or a route whose orders never reached a
   * hub keeps its counts and reports a null pace rather than vanishing.
   */
  async logisticsCuts(
    period: Period,
  ): Promise<{ routes: LogisticsBreakdown; regions: LogisticsBreakdown }> {
    /*
      One list, read by both cuts. Written twice, the two halves of this card
      could drift into counting different things under the same column names —
      which is the fault the module header records, arriving by another door.
    */
    const AGGREGATES = `
        count(*)::bigint AS orders,
        count(*) FILTER (WHERE stage_role = 'DELIVERED')::bigint AS delivered,
        count(*) FILTER (WHERE stage_role IN ('REFUSED', 'CANCELLED_EARLY') AND dispatched)::bigint AS refused,
        count(*) FILTER (WHERE stage_role IN ('REFUSED', 'CANCELLED_EARLY') AND NOT dispatched)::bigint AS cancelled_early,
        count(*) FILTER (WHERE status = 'OPEN')::bigint AS in_flight,
        sum(amount_minor) FILTER (WHERE status = 'WON')::text AS revenue,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY pace_days) AS median_days,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY pace_days) AS p90_days`

    const rows = await this.prisma.$queryRawUnsafe<
      {
        cut: 'route' | 'region'
        route: string | null
        is_total: number
        orders: bigint
        delivered: bigint
        refused: bigint
        cancelled_early: bigint
        in_flight: bigint
        revenue: MoneyText
        median_days: number | null
        p90_days: number | null
      }[]
    >(
      `
      WITH routed AS (
        SELECT DISTINCT ON (h."dealId")
          h."dealId"    AS deal_id,
          s."name"      AS route,
          h."enteredAt" AS entered_at
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
        WHERE s."logisticsRole" IN ('REGIONAL_HUB', 'CARRIER')
        ORDER BY h."dealId", h."enteredAt" DESC
      ),
      dispatched AS (
        SELECT DISTINCT h."dealId" AS deal_id
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
        WHERE s."logisticsRole" IN ('REGIONAL_HUB', 'CARRIER', 'IN_TRANSIT')
      ),
      delivered AS (
        SELECT DISTINCT ON (h."dealId")
          h."dealId"    AS deal_id,
          h."enteredAt" AS delivered_at
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
        WHERE s."logisticsRole" = 'DELIVERED'
        ORDER BY h."dealId", h."enteredAt" ASC
      ),
      scoped AS MATERIALIZED (
        SELECT
          COALESCE(r.route, 'Hub belgilanmagan') AS route,
          COALESCE(d."region", 'Nomaʼlum')       AS region,
          d."status"   AS status,
          d."amountMinor" AS amount_minor,
          cur."logisticsRole" AS stage_role,
          (dp.deal_id IS NOT NULL) AS dispatched,
          CASE
            WHEN cur."logisticsRole" = 'DELIVERED' AND dv.delivered_at >= d."createdAtSource"
            THEN EXTRACT(EPOCH FROM (dv.delivered_at - d."createdAtSource")) / 86400
          END AS pace_days
        FROM "deal" d
        JOIN "deal_stage" cur ON cur."id" = d."stageId"
        LEFT JOIN delivered dv ON dv.deal_id = d."id"
        LEFT JOIN dispatched dp ON dp.deal_id = d."id"
        LEFT JOIN routed r ON r.deal_id = d."id"
        WHERE d."countsAsRevenue"
          AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      ),
      by_route AS (
        SELECT 'route'::text AS cut, route AS bucket, GROUPING(route)::int AS is_total,${AGGREGATES}
        FROM scoped
        GROUP BY GROUPING SETS ((route), ())
      ),
      by_region AS (
        SELECT 'region'::text AS cut, region AS bucket, GROUPING(region)::int AS is_total,${AGGREGATES}
        FROM scoped
        GROUP BY GROUPING SETS ((region), ())
      )
      SELECT cut, bucket AS route, is_total, orders, delivered, refused, cancelled_early,
             in_flight, revenue, median_days, p90_days
        FROM (SELECT * FROM by_route UNION ALL SELECT * FROM by_region) cuts
       ORDER BY cut, is_total, orders DESC
      `,
      period.start,
      period.end,
    )

    const cut = (name: 'route' | 'region') => splitTotals(rows.filter((r) => r.cut === name))

    return { routes: cut('route'), regions: cut('region') }
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
          -- Split on whether the parcel actually travelled, not on which of
          -- the two refusal stages the portal happens to park it in. Since
          -- June this portal writes every refusal to
          -- "Отказ предварительно" — all 150 of August's, every one of which
          -- had reached a hub, a carrier or "В пути" first. Read from the
          -- stage alone the screen said nothing came back and 150 orders
          -- never left the warehouse; both were the opposite of the truth.
          WHEN cur."logisticsRole" IN ('REFUSED', 'CANCELLED_EARLY')
            AND EXISTS (
              SELECT 1 FROM "deal_stage_history" hh
              JOIN "deal_stage" ss ON ss."id" = hh."stageId"
              WHERE hh."dealId" = d."id"
                AND ss."logisticsRole" IN ('REGIONAL_HUB', 'CARRIER', 'IN_TRANSIT')
            ) THEN 'RETURNED'
          WHEN cur."logisticsRole" IN ('REFUSED', 'CANCELLED_EARLY') THEN 'CANCELLED'
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
         WHERE s."logisticsRole" IN ('CONFIRMED', 'CHASING')
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
   * THE WINDOW SELECTS ON THE ARRIVAL IN `C4:NEW`. An order belongs to the day
   * it entered the confirmation queue — «БОШЛАНИШ НУҚТАСИ» in their own words —
   * because that is the day their bot announced it and the day it has carried
   * on their board ever since. The bot keys on the stage move (`MOVED_TIME`)
   * and deliberately not on `DATE_MODIFY`, which any edit bumps: «шунинг учун
   * ойлар олдин рад этилган сделкалар "янги воқеа" деб хабар қилинарди».
   *
   * NOT Дата создания, which is what this used to select on and what made the
   * board disagree with the floor. Registration («Регистрация», pipeline 0)
   * holds a deal for as long as it takes to reach the customer, and only the
   * move to «Сделка успешна» hands it to Тасдиклаш as `C4:NEW`. Measured
   * against the portal on 2026-09-03: one order had arrived, their bot showed
   * one, and this board showed four — three of them created that morning but
   * still sitting in Регистрация, unannounced and unworkable.
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
  /**
   * The label for orders whose department is not a ROP group.
   *
   * IT IS A REAL FILTER VALUE, not a display string. The breakdown keeps NULL
   * rops so the tiles can total every order, and it labels them with this — so
   * the label has to be something the WHERE clause understands too. It did
   * not: the page compared `c.rop = $5`, which is NULL for exactly these rows
   * and therefore matches none of them, while the tiles were filtered in
   * TypeScript by string equality and matched all of them. Selecting the group
   * showed 40 in the band and an empty table under it.
   *
   * Every predicate on the ROP now compares `coalesce(c.rop, SENTINEL)`, and
   * the group is offered in the dropdown like any other — the 83 orders on
   * this portal whose seller sits outside a ROP department were otherwise
   * countable but unreachable.
   */
  static readonly NO_ROP = '(ROP yoʻq)'

  /** The ROP predicate, written once so the three readings cannot drift. */
  private static ropMatch(param: string): string {
    return `(${param}::text IS NULL OR coalesce(c.rop, '${InsightsRepository.NO_ROP}') = ${param})`
  }

  /**
   * The board answers two questions, and they are not the same question.
   *
   *   'window'  — WHAT CAME IN, AND WHERE DOES IT STAND. Orders that ARRIVED
   *               in `C4:NEW` during the reporting window, at whatever state
   *               they have reached by now. This is the client's own
   *               specification, the day their bot announced the order, and
   *               the day their board still carries it.
   *
   *   'backlog' — WHAT IS WAITING, RIGHT NOW. Every still-open order whose
   *               latest confirmation signal is CONFIRM_NEW, whenever it
   *               arrived. The window is opened to all time, and must be: a
   *               queue that only listed today's arrivals reported nothing to
   *               do on a morning with 265 orders unworked, because the oldest of
   *               them came in a year ago and no preset shorter than «Shu
   *               yil» could reach it. The bell counts this, so the number in
   *               the header and the rows behind it are the same set.
   *
   * ONE DEFINITION, TWO COHORTS. Everything below the cohort — the latest
   * signal, the UNCONFIRMED_SHIPPED refinement, the ROP name, the Tashkent
   * daily number — is shared, so the two readings can never drift apart in
   * how they classify an order. Only which orders enter differs.
   */
  private static queueSql(mode: ConfirmationQueueMode = 'window'): string {
    /*
      Backlog mode narrows the history scan to LIVE orders before aggregating.

      Without a window there is no cheap bound on `moves`, and the signal
      history is six figures of rows. Open deals are a small fraction of the
      table and `deal(status, closedAt)` leads on the column, so this is what
      keeps the bell affordable enough to poll from every screen.
    */
    const liveOnly =
      mode === 'backlog' ? `JOIN "deal" d0 ON d0."id" = h."dealId" AND d0."status" = 'OPEN'` : ''

    /*
      The cohort predicate. Both forms still read $1 and $2 — the caller binds
      an all-time span for the backlog — so the parameter positions every
      reading below depends on stay identical in either mode.
    */
    const cohort =
      mode === 'backlog'
        ? `WHERE a.signal = 'CONFIRM_NEW'
         AND a.queued_at >= $1 AND a.queued_at < $2`
        : `WHERE a.queued_at >= $1
         AND a.queued_at <  $2`

    return `
    /*
      The five stages that speak, resolved once.

      MATERIALIZED is load-bearing, not decoration. Inlined, the planner
      estimates the join badly and picks a parallel sequential scan over all
      216 000 history rows; pinned, it drives five index range scans on
      (stageId, enteredAt). Measured on production: 1 881 ms against 206 ms
      for the same rows.
    */
    WITH signal_stage AS MATERIALIZED (
      SELECT "id", "confirmationSignal" AS signal
        FROM "deal_stage"
       WHERE "confirmationSignal" IS NOT NULL
    ),
    /*
      Every confirmation move from the window's start onwards.

      OPEN ON THE RIGHT, and that is what lets the board show a status rather
      than a snapshot. An order that arrived at 23:50 is worked the next
      morning, and one that arrived on the 31st is decided in the new month;
      closing this at $2 would freeze both as «kutilmoqda». Measured when it
      was closed: «Kecha» showed 96 orders against a true 101, «Oʻtgan oy»
      2 970 against 3 103, and «Shu oy» hid the fault entirely because its end
      is tomorrow and nothing can fall past it.

      The consequence is deliberate: an order's status is its status NOW, not
      the one it happened to hold at midnight on the window's last day. A board
      that answers "what came in last month, and where does each stand" has to
      say where they stand — freezing an order as «kutilmoqda» because that is
      what it was six weeks ago describes nothing anybody can act on.

      LEFT BOUND ONLY, AND IT IS WHAT MAKES queued_at HONEST. The cohort
      below keeps orders whose arrival falls inside the window, so the arrival
      itself is at or after $1 and no scan earlier than $1 can change which
      order enters. Nor can it change the state: every move before $1 is older
      than that arrival, so none of them can win max(moved_at). What the
      bound buys is the whole reason this query is affordable — (stageId,
      enteredAt) range scans instead of a sequential pass over the history.
    */
    moves AS (
      SELECT h."dealId" AS deal_id, h."enteredAt" AS moved_at, ss.signal
        FROM signal_stage ss
        JOIN "deal_stage_history" h
          ON h."stageId" = ss."id"
         AND h."enteredAt" >= $1
        ${liveOnly}
    ),
    /*
      One row per order, at its latest signal.

      THE ORDER IS THE UNIT, not the visit. An order that was queued, refused,
      re-queued and confirmed is one line showing where it stands. Counting
      each visit separately would put the same order in a month three times
      and let «тасдиқланиш %» exceed the number of orders.

      The queue arrival is the LAST one, not the first: an order that came
      back into the queue is being worked from the moment it came back, and a
      waiting time measured from a visit that ended weeks ago describes
      nothing that happened. Null when it was refused without ever being
      queued — which happens, and which the client's bot counts too.
    */
    agg AS (
      SELECT deal_id,
             max(moved_at) AS moved_at,
             max(moved_at) FILTER (WHERE signal = 'CONFIRM_NEW') AS queued_at,
             (array_agg(signal ORDER BY moved_at DESC, signal))[1] AS signal
        FROM moves
       GROUP BY deal_id
    ),
    /*
      THE WINDOW IS THE ARRIVAL IN THE QUEUE — a.queued_at.

      Picking "today" means the orders that reached Тасдиклаш today, which is
      the same set their bot posted to the ROP channels today and the same set
      their own board still shows under today. Verified against the portal
      over three weeks, Tashkent days, distinct deals:

                  Дата создания   last move   arrival    portal (C4:NEW)
        08-31            99          157        125           135 visits
        09-01             1            1          1             1 visit
        09-02            80           93         93            96 visits
        09-03             4            6          1             1 visit

      Only the arrival column tracks the portal. Дата создания undercounts
      because a deal can sit in Регистрация for days before anyone can work
      it; the last move overcounts because it drags every order that merely
      CHANGED today onto today — six deals reached Доставка on 09-03, all of
      them yesterday's orders.

      NOT NULL BY CONSTRUCTION, and that is a second fix riding along. An
      order that never touched C4:NEW has no arrival, so the predicate drops
      it — the ~52 deals that appear straight in C6:NEW, which the bot never
      announced and which their board has never listed. They used to be
      counted here purely because they had a creation date.

      THE LAST ARRIVAL, not the first: an order that comes back into the queue
      is being worked from the day it came back, and their bot agrees — it
      keeps one entry per deal and re-posts under 🔁 ҚАЙТА ТУШДИ. Their board
      carries 2 211 rows for 2 211 distinct deals, never a deal twice.

      created_at stays selected. It is still Дата создания, still shown on
      the row, and still sortable — it just no longer decides who is on the
      board.
    */
    dated AS (
      SELECT a.deal_id, d."createdAtSource" AS created_at, a.moved_at, a.queued_at, a.signal
        FROM agg a
        JOIN "deal" d ON d."id" = a.deal_id
       ${cohort}
    ),
    classified AS (
      SELECT
        d."id" AS deal_id,
        w.created_at,
        w.moved_at,
        w.queued_at,
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
    ),
    numbered AS (
      /*
        READ BY TWO CALLERS, NOT SIX. The number is only ever shown on the
        board's own rows, so confirmationOrders and confirmationBoard take
        their rows from here and everything else reads classified above —
        a window function nobody selects is still sorted and computed.
      */
      SELECT
        c.*,
        -- Numbered on the SAME clock the cohort is chosen by. Partitioning
        -- this by the creation day while the board is dated by the arrival
        -- would put two «001»s under one ROP on one screen, because a single
        -- queue day holds arrivals created across several days.
        --
        -- Tashkent, not UTC: the working day is the thing being counted, and
        -- five hours of it would otherwise be numbered into yesterday.
        row_number() OVER (
          PARTITION BY c.rop, (c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${env.APP_TIMEZONE}')::date
          ORDER BY c.queued_at ASC, c.deal_id ASC
        )::int AS daily_no
      FROM classified c
    )
  `
  }

  /**
   * What the header's bell counts: still waiting, and waiting too long.
   *
   * Built on the SAME cohort the board is, so the bell and the screen it
   * links to can never disagree — a header that says three and a page that
   * shows two is worse than no header. That is not a hypothetical: the bell
   * was left counting `mode: 'backlog'` over an all-time span while its link
   * opened the board on its own window, and the header read 7 over a page
   * that read 2 for a fortnight.
   *
   * NOT TODAY'S WINDOW. `alertsService` passes an all-time span in backlog
   * mode, and what keeps that affordable to fetch from every page every
   * minute is the join to open deals inside `queueSql` — not a narrow date
   * bound, which backlog mode by definition does not have.
   *
   * `overdue` is measured from the order's own arrival in the queue, not from
   * the start of the day: an order that arrived ten minutes ago has not been
   * waiting since midnight.
   *
   * The `queued_at IS NOT NULL` guard below is now implied by the cohort — an
   * order with no arrival is not on the board at all — and it is kept because
   * the comparison beneath it is what the count means, and a reader should
   * not have to prove the null case away before trusting the number.
   */
  async queuePressure(
    period: Period,
    overdueAfterMinutes = 120,
    mode: ConfirmationQueueMode = 'window',
  ): Promise<{ pending: number; overdue: number }> {
    const rows = await this.prisma.$queryRawUnsafe<{ pending: bigint; overdue: bigint }[]>(
      `${InsightsRepository.queueSql(mode)}
       SELECT
         count(*) FILTER (WHERE c.outcome = 'CONFIRM_NEW')::bigint AS pending,
         count(*) FILTER (
           WHERE c.outcome = 'CONFIRM_NEW'
             AND c.queued_at IS NOT NULL
             AND c.queued_at < $3
         )::bigint AS overdue
       /*
         classified, NOT numbered — this reading never shows the day's number.

         numbered adds a row_number() partitioned by ROP and Tashkent day,
         which is a Sort plus a WindowAgg over the whole cohort. Postgres does
         not prune a window function nobody selected, so every reader that took
         its rows from numbered paid for the ordering whether or not it showed
         it. Only the board's own row list and the one-statement board need the
         number; the tiles, the ROP panel, the ROP options, the header bell and
         the rejection chart do not.
       */
       FROM classified c`,
      period.start,
      period.end,
      new Date(Date.now() - overdueAfterMinutes * 60_000),
    )

    return { pending: int(rows[0]?.pending), overdue: int(rows[0]?.overdue) }
  }

  /** How the window's queue split across the five states. */
  async confirmationOutcomes(
    period: Period,
    filter: { rop?: string; q?: string } = {},
    mode: ConfirmationQueueMode = 'window',
  ): Promise<ConfirmationOutcomeTotals> {
    const rows = await this.prisma.$queryRawUnsafe<
      { outcome: ConfirmationOutcomeValue; orders: bigint }[]
    >(
      `${InsightsRepository.queueSql(mode)}
       SELECT c.outcome, count(*)::bigint AS orders
         FROM classified c
         JOIN "deal" d ON d."id" = c.deal_id
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
        WHERE ${InsightsRepository.ropMatch('$3')}
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
   * How long an order must have been OUT of the queue for its return to count.
   *
   * SIX HOURS, BECAUSE THAT IS WHAT THE FLOOR READS. The bot marks a return
   * only when its last message about the deal is at least this old, and the
   * mark on this board has to mean what the mark in Telegram means or the two
   * contradict each other in front of the same operator.
   *
   * It is also the right rule on its own terms. Deal 319494 on 2026-09-03
   * entered the queue at 14:40, was confirmed at 14:49, came back at 14:55 and
   * was confirmed again at 14:56 — one person correcting themselves inside a
   * quarter of an hour, which is not a customer who had to be reached twice.
   * Without the threshold this board marked it 🔁 and the bot did not, and the
   * board was the one that was wrong. Thirty days of production hold 220
   * re-entries: 11 inside five minutes, 143 inside six hours, and 66 beyond it.
   */
  private static readonly REPEAT_GAP_HOURS = 6

  /**
   * «🔁 ҚАЙТА ТУШДИ» — has this order been in the queue before?
   *
   * ONE SCAN PER ROW, ON THE PAGE ONLY. It runs in the decorating join, after
   * the LIMIT, so it costs twenty-five index lookups on (dealId, enteredAt)
   * rather than a second pass over a cohort that can be eighteen thousand
   * orders. Putting it in `queueSql` would also make the tiles and the header
   * bell pay for a fact only the table shows.
   *
   * UNBOUNDED BY THE WINDOW, unlike everything else on the board. `moves` is
   * cut at the window's start because the history table is six figures of
   * rows; here the deal is already known, so the whole of its own history is
   * one index range. It has to be: an order first queued in July and returned
   * this morning is a return, and a window that starts today cannot see that.
   *
   * IT COUNTS GAPS, NOT VISITS. `entries` is every arrival and is what the
   * tooltip reports; `returns` is how many of the gaps between consecutive
   * arrivals are long enough to be a real return, and that is what draws the
   * mark. `previous_at` is the arrival before the LAST qualifying return —
   * the moment the order was last in the queue before it came back — so the
   * tooltip names the visit the mark is actually about rather than whatever
   * happened most recently.
   */
  private static readonly REPEAT_SQL = `
       LEFT JOIN LATERAL (
         SELECT
           count(*)::int AS entries,
           count(*) FILTER (
             WHERE gap >= interval '${InsightsRepository.REPEAT_GAP_HOURS} hours'
           )::int AS returns,
           max(prev) FILTER (
             WHERE gap >= interval '${InsightsRepository.REPEAT_GAP_HOURS} hours'
           ) AS previous_at
         FROM (
           SELECT
             lag(h."enteredAt") OVER (ORDER BY h."enteredAt") AS prev,
             h."enteredAt" - lag(h."enteredAt") OVER (ORDER BY h."enteredAt") AS gap
             FROM "deal_stage_history" h
             JOIN signal_stage ss ON ss."id" = h."stageId"
            WHERE h."dealId" = d."id" AND ss.signal = 'CONFIRM_NEW'
         ) visits
       ) rep ON true`

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
    mode: ConfirmationQueueMode = 'window',
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
      `${InsightsRepository.queueSql(mode)}
       SELECT
         c.rop AS rop,
         count(*)::bigint AS orders,
         count(*) FILTER (WHERE c.outcome = 'CONFIRMED')::bigint AS confirmed,
         count(*) FILTER (WHERE c.outcome = 'NO_ANSWER')::bigint AS no_answer,
         count(*) FILTER (WHERE c.outcome = 'REJECTED')::bigint AS rejected,
         count(*) FILTER (WHERE c.outcome = 'CONFIRM_NEW')::bigint AS pending,
         count(*) FILTER (WHERE c.outcome = 'UNCONFIRMED_SHIPPED')::bigint AS unconfirmed_shipped
       FROM classified c
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
        rop: r.rop ?? InsightsRepository.NO_ROP,
        orders: int(r.orders),
        confirmed: int(r.confirmed),
        noAnswer: int(r.no_answer),
        rejected: int(r.rejected),
        pending: int(r.pending),
        unconfirmedShipped: int(r.unconfirmed_shipped),
    }))
  }

  /**
   * The SELECT this rating runs over `classified`, isolated so its predicates
   * can be pinned by a SQL-shape test without a database — see `queueSql`.
   */
  private static ratingSql(filterClause: string): string {
    return `
       SELECT
         e."id" AS employee_id,
         e."fullName" AS full_name,
         c.rop AS rop,
         count(*) FILTER (WHERE c.outcome = 'CONFIRMED')::bigint AS confirmed_orders,
         sum(d."amountMinor") FILTER (WHERE c.outcome = 'CONFIRMED')::text AS confirmed,
         count(*) FILTER (WHERE d."status" = 'WON')::bigint AS delivered_orders,
         sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text AS delivered,
         count(*) FILTER (WHERE c.outcome = 'CONFIRMED' AND d."status" <> 'WON')::bigint AS in_transit_orders,
         sum(d."amountMinor") FILTER (WHERE c.outcome = 'CONFIRMED' AND d."status" <> 'WON')::text AS in_transit,
         count(*) FILTER (WHERE c.outcome = 'REJECTED')::bigint AS rejected_orders
       FROM classified c
       JOIN "deal" d ON d."id" = c.deal_id
       JOIN "employee" e ON e."id" = d."employeeId"
       WHERE TRUE
         ${filterClause}
       GROUP BY e."id", e."fullName", c.rop
       -- Confirmed OR delivered, not confirmed alone. FAKT 2 spans the whole
       -- cohort ("har bir buyurtma"), so an operator whose only deliveries
       -- rode out as Тасдиқланмай чиқди still holds real FAKT 2 money — a
       -- confirmed-only gate silently erased it from the board. Books that
       -- are all pending or all refused stay off: the board ranks work done.
       HAVING count(*) FILTER (WHERE c.outcome = 'CONFIRMED') > 0
           OR count(*) FILTER (WHERE d."status" = 'WON') > 0
       ORDER BY sum(d."amountMinor") FILTER (WHERE d."status" = 'WON') DESC NULLS LAST`
  }

  /**
   * The same filter grammar `SellerBoardRepository` speaks, reimplemented
   * rather than imported: the two repositories stay independent, and this is
   * four conditions, not a framework.
   */
  private static ratingFilterSql(filters: ConfirmationSellerRatingFilters, params: unknown[]): string {
    const conditions: string[] = []

    if (filters.restrictToEmployeeId) {
      params.push(filters.restrictToEmployeeId)
      conditions.push(`e."id" = $${params.length}`)
    }
    if (filters.employeeIds?.length) {
      params.push(filters.employeeIds.join(','))
      conditions.push(`e."id" = ANY(string_to_array($${params.length}, ','))`)
    }
    if (filters.departmentIds?.length) {
      params.push(filters.departmentIds.join(','))
      conditions.push(`e."departmentId" = ANY(string_to_array($${params.length}, ','))`)
    }
    if (filters.sourceIds?.length) {
      params.push(filters.sourceIds.join(','))
      conditions.push(`d."sourceId" = ANY(string_to_array($${params.length}, ','))`)
    }

    return conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`
  }

  /**
   * Sotuvchilar reytingi, rebuilt on the confirmation queue instead of order
   * intake — one row per operator, FAKT 1 and FAKT 2 as the floor names them.
   *
   * SAME COHORT AS THE QUEUE, on purpose: `SellerBoardService` calls this and
   * `confirmationOrders`/`confirmationBoard` for the SAME period and they must
   * count the same orders, or the rating and the board it is drawn from would
   * disagree about who is even in it.
   *
   * `countsAsRevenue` is DELIBERATELY NOT NAMED HERE, unlike every other money
   * query in this file. It would not change the total: every deal that reaches
   * this cohort arrived via a confirmation-signal stage in pipeline 4, 6 or
   * 12, none of which is «#10 База» — the duplicate the flag exists to
   * exclude is a separate deal row Bitrix creates later and that row never
   * touches a signal stage, so it can never enter `classified`. What the flag
   * WOULD do here is wrong: pipelines 4 and 12 are not revenue pipelines, so
   * filtering on it would silently drop every still-queued and every refused
   * order — the two states «barcha buyurtmalar» exists to show.
   */
  async confirmationSellerRating(
    period: Period,
    filters: ConfirmationSellerRatingFilters = {},
  ): Promise<ConfirmationSellerRatingRow[]> {
    const params: unknown[] = [period.start, period.end]
    const filterClause = InsightsRepository.ratingFilterSql(filters, params)

    const rows = await this.prisma.$queryRawUnsafe<
      {
        employee_id: string
        full_name: string
        rop: string | null
        confirmed_orders: bigint
        confirmed: MoneyText
        delivered_orders: bigint
        delivered: MoneyText
        in_transit_orders: bigint
        in_transit: MoneyText
        rejected_orders: bigint
      }[]
    >(
      `${InsightsRepository.queueSql('window')}${InsightsRepository.ratingSql(filterClause)}`,
      ...params,
    )

    return rows.map((r) => ({
      employeeId: r.employee_id,
      fullName: r.full_name,
      rop: r.rop,
      confirmedOrders: int(r.confirmed_orders),
      confirmedMinor: money(r.confirmed),
      deliveredOrders: int(r.delivered_orders),
      deliveredMinor: money(r.delivered),
      inTransitOrders: int(r.in_transit_orders),
      inTransitMinor: money(r.in_transit),
      rejectedOrders: int(r.rejected_orders),
    }))
  }

  /**
   * One operator's daily arrivals into the confirmation queue — the queue
   * basis's counterpart to `SellerBoardRepository.sellerDays`.
   *
   * Dated by `queued_at`, not `createdAtSource`: see `queueSql` for why the
   * arrival in C4:NEW is the only date that tracks the client's own board.
   */
  async confirmationSellerRatingDays(
    period: Period,
    employeeId: string,
  ): Promise<{ date: string; confirmedMinor: bigint; deliveredMinor: bigint; orders: number }[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { date: string; confirmed: MoneyText; delivered: MoneyText; orders: bigint }[]
    >(
      `${InsightsRepository.queueSql('window')}
       SELECT
         (c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${env.APP_TIMEZONE}')::date::text AS date,
         count(*) FILTER (WHERE c.outcome = 'CONFIRMED')::bigint AS orders,
         sum(d."amountMinor") FILTER (WHERE c.outcome = 'CONFIRMED')::text AS confirmed,
         sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text AS delivered
       FROM classified c
       JOIN "deal" d ON d."id" = c.deal_id
       WHERE d."employeeId" = $3
       GROUP BY 1
       -- The same gate as the board: a day whose only money was delivered
       -- without a confirmation still belongs to FAKT 2's series.
       HAVING count(*) FILTER (WHERE c.outcome = 'CONFIRMED') > 0
           OR count(*) FILTER (WHERE d."status" = 'WON') > 0
       ORDER BY 1`,
      period.start,
      period.end,
      employeeId,
    )

    return rows.map((r) => ({
      date: r.date,
      orders: int(r.orders),
      confirmedMinor: money(r.confirmed),
      deliveredMinor: money(r.delivered),
    }))
  }

  /** Every ROP group that has orders in the window, for the filter. */
  async confirmationRops(
    period: Period,
    mode: ConfirmationQueueMode = 'window',
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ rop: string | null }[]>(
      `${InsightsRepository.queueSql(mode)}
       SELECT DISTINCT c.rop FROM classified c WHERE c.rop IS NOT NULL ORDER BY c.rop`,
      period.start,
      period.end,
    )

    return rows.map((r) => r.rop).filter((r): r is string => r !== null)
  }

  /** One page of the queue, newest first by default. */
  /**
   * The whole board in one statement: the page, its total, and the ROP panel.
   *
   * WHY ONE STATEMENT. The page and the panel used to be two queries fired
   * together, and each rebuilt the cohort — every order in the window, its
   * latest signal, its number in the day — from scratch. For a month that was
   * two seconds of duplicated work; for a year, where the cohort is eighteen
   * thousand orders, the two ran the single core against each other and the
   * request died on the twenty-second statement timeout. «Shu yil» was a 500.
   *
   * Here `numbered` is referenced twice inside one statement, which Postgres
   * materialises exactly once, and both readings are taken from it. Measured
   * on production against the two-query shape: [see commit].
   *
   * THE TWO READINGS DIFFER ON PURPOSE. The page obeys every filter — state,
   * ROP, search. The panel obeys the search and nothing else: it is what the
   * five tiles above the table are summed from, and a band whose numbers
   * changed to match its own selection could not be used to compare one
   * state against another, which is the only reason to put five of them side
   * by side.
   *
   * The page is cut BEFORE it is dressed: filter, sort and LIMIT run over the
   * bare cohort, and only the fifty survivors are joined to their customer,
   * operator, stage, source and line items. Both readings come back as JSON
   * so a single row can carry two differently-shaped lists; timestamps arrive
   * as ISO text without a zone and are read back as the UTC they are.
   */
  async confirmationBoard(
    period: Period,
    query: ConfirmationOrderQuery,
    mode: ConfirmationQueueMode = 'window',
  ): Promise<{ totalItems: number; rows: ConfirmationOrderRow[]; byRop: ConfirmationRopRow[] }> {
    // Allowlisted, never interpolated from the request: this reaches SQL.
    // Columns of `filtered`, which carries the two deal fields a sort may need.
    const sortColumn: Record<ConfirmationOrderSortValue, string> = {
      createdAt: 'created_at',
      movedAt: 'moved_at',
      queuedAt: 'queued_at',
      decidedAt: 'decided_at',
      amountMinor: 'amount_minor_sort',
      title: 'title_sort',
    }
    const direction = query.order === 'asc' ? 'ASC' : 'DESC'
    const offset = (query.page - 1) * query.pageSize
    // The deal id breaks ties, so paging cannot show one order twice and skip
    // another when a thousand rows share a sort value.
    const order = `${sortColumn[query.sort]} ${direction} NULLS LAST, deal_id ASC`

    type PageJson = {
      pos: number
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
      created_at: string
      moved_at: string
      queued_at: string | null
      decided_at: string | null
      queue_entries: number
      queue_returns: number
      previous_queued_at: string | null
    }
    type RopJson = {
      rop: string | null
      orders: number
      confirmed: number
      no_answer: number
      rejected: number
      pending: number
      unconfirmed_shipped: number
    }

    const rows = await this.prisma.$queryRawUnsafe<
      { total_items: bigint; page: PageJson[]; by_rop: RopJson[] }[]
    >(
      `${InsightsRepository.queueSql(mode)},
       filtered AS (
         SELECT
           c.deal_id, c.rop, c.daily_no, c.outcome,
           c.created_at, c.moved_at, c.queued_at, c.decided_at,
           d."amountMinor" AS amount_minor_sort,
           d."title" AS title_sort
         FROM numbered c
         JOIN "deal" d ON d."id" = c.deal_id
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
        -- NULL, not an empty array: ANY over an empty array is false for every
        -- row, so an empty selection would render an empty table rather than
        -- the whole queue.
        WHERE ($3::text[] IS NULL OR c.outcome = ANY($3::text[]))
          AND ${InsightsRepository.ropMatch('$5')}
          ${InsightsRepository.SEARCH_SQL('$4')}
       ),
       page AS (
         SELECT f.*, row_number() OVER (ORDER BY ${order})::int AS pos
           FROM filtered f
          ORDER BY ${order}
          LIMIT $6 OFFSET $7
       ),
       decorated AS (
         SELECT
           p.pos,
           d."id" AS deal_id,
           p.rop,
           p.daily_no,
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
           p.outcome,
           p.created_at, p.moved_at, p.queued_at, p.decided_at,
           rep.entries AS queue_entries,
           rep.returns AS queue_returns,
           rep.previous_at AS previous_queued_at
         FROM page p
         JOIN "deal" d ON d."id" = p.deal_id
         JOIN "employee" e ON e."id" = d."employeeId"
         JOIN "deal_stage" st ON st."id" = d."stageId"
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
         LEFT JOIN "sales_source" src ON src."id" = d."sourceId"
         -- LATERAL, not a join: four line items would otherwise become four
         -- rows and the pager would count the same order four times.
         LEFT JOIN LATERAL (
           SELECT string_agg(pr."name" || ' - ' || di."quantity"::text || ' ta', E'\\n' ORDER BY pr."name") AS products
             FROM "deal_item" di
             JOIN "product" pr ON pr."id" = di."productId"
            WHERE di."dealId" = d."id"
         ) items ON true
         ${InsightsRepository.REPEAT_SQL}
       ),
       by_rop AS (
         SELECT
           c.rop,
           count(*)::int AS orders,
           count(*) FILTER (WHERE c.outcome = 'CONFIRMED')::int AS confirmed,
           count(*) FILTER (WHERE c.outcome = 'NO_ANSWER')::int AS no_answer,
           count(*) FILTER (WHERE c.outcome = 'REJECTED')::int AS rejected,
           count(*) FILTER (WHERE c.outcome = 'CONFIRM_NEW')::int AS pending,
           count(*) FILTER (WHERE c.outcome = 'UNCONFIRMED_SHIPPED')::int AS unconfirmed_shipped
         FROM numbered c
         JOIN "deal" d ON d."id" = c.deal_id
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
        -- NULL rops are KEPT and dropped by the caller: the tiles are this
        -- breakdown summed down its columns, so a row excluded here is an
        -- order missing from the headline total.
        WHERE TRUE
          ${InsightsRepository.SEARCH_SQL('$4')}
        GROUP BY c.rop
       )
       SELECT
         (SELECT count(*) FROM filtered)::bigint AS total_items,
         (SELECT coalesce(json_agg(x ORDER BY x.pos), '[]'::json) FROM decorated x) AS page,
         (SELECT coalesce(json_agg(r ORDER BY r.orders DESC), '[]'::json) FROM by_rop r) AS by_rop`,
      period.start,
      period.end,
      query.outcomes && query.outcomes.length > 0 ? [...query.outcomes] : null,
      query.q ?? null,
      query.rop ?? null,
      query.pageSize,
      offset,
    )

    const row = rows[0]
    // JSON carries timestamps as ISO text without a zone; they are UTC.
    const utc = (text: string | null): Date | null =>
      text === null ? null : new Date(text.endsWith('Z') ? text : `${text}Z`)

    return {
      totalItems: int(row?.total_items ?? 0n),
      rows: (row?.page ?? []).map((r) => {
        const queuedAt = utc(r.queued_at)
        const decidedAt = utc(r.decided_at)
        return {
          dealId: r.deal_id,
          rop: r.rop,
          dailyNo: r.daily_no,
          bitrixId: r.bitrix_id,
          orderCode: r.order_code,
          title: r.title,
          customerName: r.customer_name,
          customerPhones:
            r.customer_phones === null || r.customer_phones === ''
              ? []
              : r.customer_phones.split('\n'),
          employeeName: r.employee_name,
          products: r.products === null ? [] : r.products.split('\n'),
          region: r.region,
          deliveryAddress: r.delivery_address,
          sourceName: r.source_name,
          amountMinor: money(r.amount_minor),
          currency: r.currency,
          stageName: r.stage_name,
          outcome: r.outcome,
          createdAt: utc(r.created_at)!,
          movedAt: utc(r.moved_at)!,
          queuedAt,
          decidedAt,
          queueEntries: r.queue_entries,
          queueReturns: r.queue_returns,
          previousQueuedAt: utc(r.previous_queued_at),
          // Both ends or nothing: an order refused without ever being queued
          // has no waiting time, and zero would read as "decided instantly".
          hoursToDecide:
            decidedAt === null || queuedAt === null
              ? null
              : Math.round(((decidedAt.getTime() - queuedAt.getTime()) / 3_600_000) * 10) / 10,
        }
      }),
      byRop: (row?.by_rop ?? []).map((r) => ({
        // A group with no ROP is labelled rather than hidden: it still has to
        // be countable, and "(ROP yoʻq)" is a finding, not a gap.
        rop: r.rop ?? InsightsRepository.NO_ROP,
        orders: r.orders,
        confirmed: r.confirmed,
        noAnswer: r.no_answer,
        rejected: r.rejected,
        pending: r.pending,
        unconfirmedShipped: r.unconfirmed_shipped,
      })),
    }
  }

  async confirmationOrders(
    period: Period,
    query: ConfirmationOrderQuery,
    mode: ConfirmationQueueMode = 'window',
  ): Promise<{ totalItems: number; rows: ConfirmationOrderRow[] }> {
    // Allowlisted, never interpolated from the request: this reaches SQL.
    const sortColumn: Record<ConfirmationOrderSortValue, string> = {
      createdAt: 'c.created_at',
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
        created_at: Date
        moved_at: Date
        queued_at: Date | null
        decided_at: Date | null
        queue_entries: number
        queue_returns: number
        previous_queued_at: Date | null
        total_items: bigint
      }[]
    >(
      `${InsightsRepository.queueSql(mode)},
       /*
         PAGE FIRST, DECORATE AFTERWARDS.

         The filter, the sort and the LIMIT run over the bare cohort — deal id,
         ROP, outcome, four timestamps — and only the fifty rows that survive
         are joined to their customer, operator, stage, source and line items.
         It used to be the other way round: every row in the window was fully
         dressed, including a LATERAL over deal_item per row, and then all but
         fifty thrown away. For a month that was three thousand decorated rows
         for a page of fifty; for a year, eighteen thousand, which put the
         request past the twenty-second statement timeout and made «Shu yil»
         a 500 on this screen.

         The search predicate only ever needed the cohort, the deal and the
         customer, so it runs here in full; the total rides on the page rows
         as a window count, computed before the LIMIT cuts them.
       */
       page AS (
         SELECT
           c.deal_id, c.rop, c.daily_no, c.outcome,
           c.created_at, c.moved_at, c.queued_at, c.decided_at,
           (count(*) OVER ())::bigint AS total_items
         FROM numbered c
         JOIN "deal" d ON d."id" = c.deal_id
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
        -- NULL, not an empty array: ANY over an empty array is false for every
        -- row, so an empty selection would render an empty table rather than
        -- the whole queue.
        WHERE ($3::text[] IS NULL OR c.outcome = ANY($3::text[]))
          AND ${InsightsRepository.ropMatch('$5')}
          ${InsightsRepository.SEARCH_SQL('$4')}
        -- The deal id breaks ties, so paging cannot show one order twice and
        -- skip another when a thousand rows share a sort value.
        ORDER BY ${sortColumn[query.sort]} ${direction} NULLS LAST, d."id" ASC
        LIMIT $6 OFFSET $7
       )
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
         c.created_at AS created_at,
         c.moved_at AS moved_at,
         c.queued_at AS queued_at,
         c.decided_at AS decided_at,
         rep.entries AS queue_entries,
         rep.returns AS queue_returns,
         rep.previous_at AS previous_queued_at,
         c.total_items AS total_items
       FROM page c
       JOIN "deal" d ON d."id" = c.deal_id
       JOIN "employee" e ON e."id" = d."employeeId"
       JOIN "deal_stage" st ON st."id" = d."stageId"
       LEFT JOIN "customer" cust ON cust."id" = d."customerId"
       LEFT JOIN "sales_source" src ON src."id" = d."sourceId"
       -- LATERAL, not a join: four line items would otherwise become four rows
       -- and the pager would count the same order four times.
       LEFT JOIN LATERAL (
         SELECT string_agg(pr."name" || ' - ' || di."quantity"::text || ' ta', E'\\n' ORDER BY pr."name") AS products
           FROM "deal_item" di
           JOIN "product" pr ON pr."id" = di."productId"
          WHERE di."dealId" = d."id"
       ) items ON true
       ${InsightsRepository.REPEAT_SQL}
      -- The same order the page was cut in; a join does not promise to keep it.
      ORDER BY ${sortColumn[query.sort]} ${direction} NULLS LAST, d."id" ASC`,
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
          createdAt: new Date(r.created_at),
          movedAt: new Date(r.moved_at),
          queuedAt,
          decidedAt,
          queueEntries: int(r.queue_entries),
          queueReturns: int(r.queue_returns),
          previousQueuedAt: r.previous_queued_at === null ? null : new Date(r.previous_queued_at),
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
    const both = await this.commandCustomersPair(period, period)
    return both.now
  }

  /**
   * Both windows in one pass, because the expensive half is the same in each.
   *
   * `first_order` has no date bound — it cannot have one, since "was this
   * customer's FIRST order in the window" is a question about their whole
   * history — so it walks every revenue deal and groups by customer. Asked
   * twice, once for the period and once for the comparison beside it, that
   * scan was paid for twice on a screen that shows both numbers side by side.
   *
   * The two windows are adjacent for every calendar-anchored preset (a
   * comparison ends exactly where its period begins), so bounding the second
   * CTE by the outer edges of the pair reads no row the two calls read
   * separately.
   */
  async commandCustomersPair(
    period: Period,
    comparison: Period,
  ): Promise<{
    now: { ordering: number; fresh: number }
    previous: { ordering: number; fresh: number }
  }> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        ordering_now: bigint
        fresh_now: bigint
        ordering_prev: bigint
        fresh_prev: bigint
      }[]
    >(
      `
      WITH first_order AS (
        SELECT d."customerId" AS customer_id, min(d."createdAtSource") AS first_at
          FROM "deal" d
         WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
         GROUP BY d."customerId"
      ),
      ordered AS (
        SELECT d."customerId" AS customer_id,
               bool_or(d."createdAtSource" >= $1 AND d."createdAtSource" < $2) AS in_now,
               bool_or(d."createdAtSource" >= $3 AND d."createdAtSource" < $4) AS in_prev
          FROM "deal" d
         WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
           AND d."createdAtSource" >= LEAST($1, $3)
           AND d."createdAtSource" <  GREATEST($2, $4)
         GROUP BY d."customerId"
      )
      SELECT
        count(*) FILTER (WHERE o.in_now)::bigint AS ordering_now,
        count(*) FILTER (WHERE o.in_now AND f.first_at >= $1 AND f.first_at < $2)::bigint
          AS fresh_now,
        count(*) FILTER (WHERE o.in_prev)::bigint AS ordering_prev,
        count(*) FILTER (WHERE o.in_prev AND f.first_at >= $3 AND f.first_at < $4)::bigint
          AS fresh_prev
      FROM ordered o
      JOIN first_order f ON f.customer_id = o.customer_id
      `,
      period.start,
      period.end,
      comparison.start,
      comparison.end,
    )

    const r = rows[0]
    return {
      now: { ordering: int(r?.ordering_now ?? 0n), fresh: int(r?.fresh_now ?? 0n) },
      previous: { ordering: int(r?.ordering_prev ?? 0n), fresh: int(r?.fresh_prev ?? 0n) },
    }
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
      // Always the window cohort: this is a daily control chart, and a backlog
      // has no days to plot.
      `${InsightsRepository.queueSql('window')},
       perday AS (
         SELECT (c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date AS day,
                (count(*) FILTER (WHERE c.outcome = 'REJECTED')::float
                   / NULLIF(count(*), 0)::float * 100)::float AS share,
                count(*)::int AS orders,
                count(*) FILTER (WHERE c.outcome = 'REJECTED')::int AS rejected
           FROM classified c
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
  /**
   * Headcount alone, for the screen that prints only headcount.
   *
   * The command centre shows four numbers off the org chart — on the roster,
   * marked active, produced something, and how many units. `structure()`
   * answers that too, but it also aggregates every WON deal's money per
   * department to draw the chart's revenue column, and that half was measured
   * at 3.4 of its 3.5 seconds. Asking a cheaper question is the fix; making
   * the expensive one faster would still be paying for an answer nobody on
   * this screen reads.
   *
   * The employee side is unchanged, deliberately — same `active` union over
   * calls and won deals, same three counts — so the two screens cannot drift
   * into reporting different headcounts for the same day.
   */
  async commandHeadcount(period: Period): Promise<{
    employees: number
    active: number
    working: number
    departments: number
  }> {
    const rows = await this.prisma.$queryRawUnsafe<
      { employees: bigint; active: bigint; working: bigint; departments: bigint }[]
    >(
      `
      WITH active AS (
        SELECT e."id" AS id
          FROM "employee" e
         WHERE EXISTS (
                 SELECT 1 FROM "call_record" c
                  WHERE c."employeeId" = e."id"
                    AND c."startedAt" >= $1 AND c."startedAt" < $2
               )
            OR EXISTS (
                 SELECT 1 FROM "deal" d
                  WHERE d."employeeId" = e."id"
                    AND d."countsAsRevenue" AND d."status" = 'WON'
                    AND d."closedAt" >= $1 AND d."closedAt" < $2
               )
      )
      SELECT
        count(*)::bigint AS employees,
        count(*) FILTER (WHERE e."isActive")::bigint AS active,
        -- On the roster, marked active, and produced something. The gap
        -- between this and the count above is "who is here and who is not".
        count(*) FILTER (WHERE e."isActive" AND a.id IS NOT NULL)::bigint AS working,
        (SELECT count(*) FROM "department")::bigint AS departments
      FROM "employee" e
      LEFT JOIN active a ON a.id = e."id"
      WHERE e."departmentId" IS NOT NULL
      `,
      period.start,
      period.end,
    )

    const row = rows[0]
    return {
      employees: int(row?.employees ?? 0n),
      active: int(row?.active ?? 0n),
      working: int(row?.working ?? 0n),
      departments: int(row?.departments ?? 0n),
    }
  }

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
      /*
        Asked of the ROSTER, not of the call log.

        This used to union two DISTINCTs, which made Postgres materialise
        every call row in the window and de-duplicate it — 281 818 of
        call_record's 299 141 rows, correctly seq-scanned because 94% of the
        table matches, to learn which of 289 employees did something. Anchored
        on employee instead, it is 289 index-only probes that stop at the
        first hit. Measured: 800-1 800 ms against 93-158 ms, same 146 ids.
      */
      WITH active AS (
        SELECT e."id" AS id
          FROM "employee" e
         WHERE EXISTS (
                 SELECT 1 FROM "call_record" c
                  WHERE c."employeeId" = e."id"
                    AND c."startedAt" >= $1 AND c."startedAt" < $2
               )
            OR EXISTS (
                 SELECT 1 FROM "deal" d
                  WHERE d."employeeId" = e."id"
                    AND d."countsAsRevenue" AND d."status" = 'WON'
                    AND d."closedAt" >= $1 AND d."closedAt" < $2
               )
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
      /*
        The two conditions belong in the WHERE, not in the FILTER.

        They are the leading columns of deal_countsAsRevenue_status_closedAt_idx.
        Left in the aggregate FILTER they are unbound at scan time, so Postgres
        walked the whole index and heap-fetched 28 449 rows to keep 3 890.
        Moving them changes no answer — a department with no won deals still
        arrives through the LEFT JOIN below and is COALESCEd to zero, which was
        checked column by column across all 20 departments. Measured on the
        whole query: 3 527 ms against 992 ms.
      */
      sales AS (
        SELECT
          e."departmentId" AS dep_id,
          count(d."id")::bigint AS deals,
          sum(d."amountMinor")::text AS revenue
        FROM "deal" d
        JOIN "employee" e ON e."id" = d."employeeId"
        WHERE d."countsAsRevenue" AND d."status" = 'WON'
          AND d."closedAt" >= $1 AND d."closedAt" < $2
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
