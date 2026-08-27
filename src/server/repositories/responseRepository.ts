/**
 * Aggregation for the response endpoint: how fast, how persistently, and how
 * productively the phone gets worked.
 *
 * SQL because the call log holds over a million rows, and every question here
 * joins it against deals. Every call query is bounded by a `startedAt` window
 * so the `[startedAt]` / `[employeeId, startedAt]` indexes carry it — an
 * unbounded join over the log is a sequential scan of a million rows dressed
 * as analytics.
 *
 * The three rules from `insightsRepository.ts` apply verbatim:
 *   1. `countsAsRevenue` named explicitly wherever money is touched;
 *   2. BigInt money crosses the driver as text;
 *   3. period boundaries arrive already resolved in Asia/Tashkent; the one
 *      calendar truncation here (the attempts grouping day) does the
 *      AT TIME ZONE dance.
 *
 * DEAL COHORTS ARE REVENUE-PIPELINE ONLY. The portal copies the same order
 * into retention and qualification pipelines; joining calls onto every copy
 * would measure the same phone call two or three times. `countsAsRevenue`
 * on the deal side keeps one order = one measurement — the same trick
 * `stageReach` uses, applied to calls.
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

function floatOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

/**
 * "Never connected" only counts after this many fruitless dials — fewer is a
 * customer not yet reached, not one who cannot be. The number comes from the
 * operators' own refusal vocabulary: «5 уринишда богланиб болмади».
 */
export const NEVER_CONNECTED_MIN_ATTEMPTS = 5

/**
 * How far before the period a closed deal's calls are still counted.
 *
 * A deal closed this month was worked before it closed, so its calls cannot
 * be bounded to the period alone — but an unbounded lower edge would scan the
 * whole log. Ninety days covers the whole-deal cycle far past its p90 (a few
 * days); anything older attached to a deal closing now is noise, not effort.
 */
export const EFFORT_LOOKBACK_DAYS = 90

export interface FirstTouchStats {
  /** Revenue deals created in the period. */
  readonly deals: number
  /** Of those, deals with at least one outbound call after creation. */
  readonly called: number
  /** Creation → first outbound call percentiles, minutes, over called deals. */
  readonly p50Minutes: number | null
  readonly p90Minutes: number | null
  /** First-called within 15 / 60 minutes. Counts, against ALL cohort deals. */
  readonly within15: number
  readonly within60: number
}

export interface AttemptStats {
  /** Dialling targets: a deal, or a customer+day where no deal is linked. */
  readonly groups: number
  /** Targets where some dial eventually connected. */
  readonly connectedGroups: number
  /** Dials up to AND INCLUDING the first connect; 1 = reached first try. */
  readonly medianAttemptsToConnect: number | null
  /** Targets never connected after >= NEVER_CONNECTED_MIN_ATTEMPTS dials. */
  readonly neverConnectedAfterMin: number
}

/** Call effort accumulated by deals that closed in the period, per outcome. */
export interface OutcomeEffortRow {
  readonly status: string
  readonly deals: number
  readonly avgCalls: number | null
  /** Connected talk-seconds only — dialling is not conversation. */
  readonly avgTalkSeconds: number | null
}

/**
 * One employee's period revenue and connected talk time, side by side.
 * `employeeId: null` collects calls the log never attributed to a person, so
 * the overall ratio still sums over everything.
 */
export interface EmployeeTalkRow {
  readonly employeeId: string | null
  readonly fullName: string | null
  readonly revenueMinor: bigint
  readonly talkSeconds: number
}

export class ResponseRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  /**
   * Deal creation → first OUTBOUND call, per deal created in the period.
   *
   * The join is by `dealId` first and `customerId` as the fallback — many
   * calls are logged against the contact rather than the deal, and dropping
   * them would overstate "never called" threefold. Either way the call must
   * start AT OR AFTER the deal's creation: a call made before the deal
   * existed answered some earlier order.
   *
   * Calls are bounded to the period window. A deal created in the period's
   * last hour whose first call lands after the boundary files under "no call
   * yet" — the honest cost of a bounded query, material only at the very edge
   * since first touches are measured in minutes. The percentiles cover called
   * deals only; the no-call share is reported BESIDE them, never blended in
   * as some enormous fake duration.
   *
   * The 15/60-minute counts divide by ALL cohort deals, not just called ones:
   * "called within 15 minutes" is a claim about the order flow, and a deal
   * nobody called is a deal not called within 15 minutes.
   */
  async firstTouch(period: Period): Promise<FirstTouchStats> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        deals: bigint
        called: bigint
        p50_minutes: number | null
        p90_minutes: number | null
        within_15: bigint
        within_60: bigint
      }[]
    >(
      `
      WITH cohort AS (
        SELECT d."id", d."customerId" AS customer_id, d."createdAtSource" AS created_at
        FROM "deal" d
        WHERE d."countsAsRevenue"
          AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      ),
      by_deal AS (
        SELECT c."dealId" AS deal_id, min(c."startedAt") AS first_call
        FROM "call_record" c
        JOIN cohort ch ON ch."id" = c."dealId"
        WHERE c."direction" = 'OUTBOUND'
          AND c."startedAt" >= $1 AND c."startedAt" < $2
          AND c."startedAt" >= ch.created_at
        GROUP BY 1
      ),
      by_customer AS (
        SELECT ch."id" AS deal_id, min(c."startedAt") AS first_call
        FROM "call_record" c
        JOIN cohort ch ON ch.customer_id = c."customerId"
        WHERE c."direction" = 'OUTBOUND'
          AND c."startedAt" >= $1 AND c."startedAt" < $2
          AND c."startedAt" >= ch.created_at
        GROUP BY 1
      ),
      timed AS (
        SELECT
          EXTRACT(EPOCH FROM (COALESCE(bd.first_call, bc.first_call) - ch.created_at)) / 60
            AS minutes
        FROM cohort ch
        LEFT JOIN by_deal bd ON bd.deal_id = ch."id"
        LEFT JOIN by_customer bc ON bc.deal_id = ch."id"
      )
      SELECT
        count(*)::bigint AS deals,
        count(minutes)::bigint AS called,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS p50_minutes,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes) AS p90_minutes,
        count(*) FILTER (WHERE minutes <= 15)::bigint AS within_15,
        count(*) FILTER (WHERE minutes <= 60)::bigint AS within_60
      FROM timed
      `,
      period.start,
      period.end,
    )

    const row = rows[0]

    return {
      deals: int(row?.deals ?? 0n),
      called: int(row?.called ?? 0n),
      p50Minutes: floatOrNull(row?.p50_minutes ?? null),
      p90Minutes: floatOrNull(row?.p90_minutes ?? null),
      within15: int(row?.within_15 ?? 0n),
      within60: int(row?.within_60 ?? 0n),
    }
  }

  /**
   * How many dials it takes to reach someone.
   *
   * The dialling target is the deal where the call is linked to one, else
   * customer + Tashkent calendar day — the same person dialled about the same
   * thing on Monday and again on Thursday is two campaigns, not a seventh
   * attempt. Calls linked to neither a deal nor a customer cannot be grouped
   * and are excluded.
   *
   * `medianAttemptsToConnect` counts up to AND INCLUDING the connecting dial:
   * 1 means reached on the first try. The alternative reading — failures
   * before the connect — makes the healthy case a zero, which reads like
   * missing data on every screen it lands on.
   */
  async attempts(period: Period): Promise<AttemptStats> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        groups: bigint
        connected_groups: bigint
        median_attempts: number | null
        never_connected: bigint
      }[]
    >(
      `
      WITH outbound AS (
        SELECT
          COALESCE(
            c."dealId",
            c."customerId" || '@' ||
              to_char(c."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE $3, 'YYYY-MM-DD')
          ) AS grp,
          c."startedAt",
          c."connected"
        FROM "call_record" c
        WHERE c."direction" = 'OUTBOUND'
          AND c."startedAt" >= $1 AND c."startedAt" < $2
          AND (c."dealId" IS NOT NULL OR c."customerId" IS NOT NULL)
      ),
      ranked AS (
        SELECT
          grp,
          "connected",
          row_number() OVER (PARTITION BY grp ORDER BY "startedAt") AS attempt_no
        FROM outbound
      ),
      grouped AS (
        SELECT
          grp,
          min(attempt_no) FILTER (WHERE "connected") AS first_connect_attempt,
          count(*)::int AS attempts
        FROM ranked
        GROUP BY grp
      )
      SELECT
        count(*)::bigint AS groups,
        count(first_connect_attempt)::bigint AS connected_groups,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY first_connect_attempt) AS median_attempts,
        count(*) FILTER (
          WHERE first_connect_attempt IS NULL AND attempts >= $4::int
        )::bigint AS never_connected
      FROM grouped
      `,
      period.start,
      period.end,
      this.tz,
      NEVER_CONNECTED_MIN_ATTEMPTS,
    )

    const row = rows[0]

    return {
      groups: int(row?.groups ?? 0n),
      connectedGroups: int(row?.connected_groups ?? 0n),
      medianAttemptsToConnect: floatOrNull(row?.median_attempts ?? null),
      neverConnectedAfterMin: int(row?.never_connected ?? 0n),
    }
  }

  /**
   * Call effort per closed deal, split by how the deal ended.
   *
   * The cohort is revenue deals CLOSED in the period — the outcome is the
   * grouping key, and an open deal has none yet.
   *
   * Attribution is by CUSTOMER, not by `dealId`. That is a fact about the
   * portal, not a preference: of ~300k call records exactly ONE carries a
   * `dealId`, while 99.8% carry a `customerId` — a dealId join returned zero
   * calls for every deal and the page confidently reported "0 qoʻngʻiroq",
   * which claims "no effort was spent" when the truth was "the portal does
   * not link calls to deals". So a deal's effort is the calls to ITS customer
   * during ITS lifetime (createdAtSource → closedAt). A customer with two
   * open deals can have a call counted against both — disclosed in the UI
   * caption; the deal-lifetime window keeps the overlap small.
   *
   * Deals with no customer link cannot be attributed at all and are excluded
   * from the averages rather than rendered as zeros. The global lower bound
   * `period.start − EFFORT_LOOKBACK_DAYS` keeps the scan on the `startedAt`
   * index; a deal created before that loses its earliest calls (the lookback
   * IS that bound). Deals with zero calls inside the window stay in the
   * averages — under-worked losses are the finding this split exists for.
   */
  async effortByOutcome(period: Period): Promise<OutcomeEffortRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { status: string; deals: bigint; avg_calls: number | null; avg_talk: number | null }[]
    >(
      `
      WITH closed AS (
        SELECT d."id", d."status", d."customerId", d."createdAtSource", d."closedAt"
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."status" IN ('WON', 'LOST')
          AND d."closedAt" >= $1 AND d."closedAt" < $2
          AND d."customerId" IS NOT NULL
      ),
      effort AS (
        SELECT
          cl."id",
          cl."status",
          count(c."id")::int AS calls,
          COALESCE(sum(c."durationSec") FILTER (WHERE c."connected"), 0)::int AS talk_seconds
        FROM closed cl
        LEFT JOIN "call_record" c
          ON c."customerId" = cl."customerId"
         AND c."startedAt" >= GREATEST(
               cl."createdAtSource",
               $1::timestamp - make_interval(days => $3::int)
             )
         AND c."startedAt" < COALESCE(cl."closedAt", $2)
        GROUP BY cl."id", cl."status"
      )
      SELECT
        e."status"::text AS status,
        count(*)::bigint AS deals,
        avg(e.calls)::float8 AS avg_calls,
        avg(e.talk_seconds)::float8 AS avg_talk
      FROM effort e
      GROUP BY e."status"
      `,
      period.start,
      period.end,
      EFFORT_LOOKBACK_DAYS,
    )

    return rows.map((r) => ({
      status: r.status,
      deals: int(r.deals),
      avgCalls: floatOrNull(r.avg_calls),
      avgTalkSeconds: floatOrNull(r.avg_talk),
    }))
  }

  /**
   * Period revenue and connected talk time per employee, side by side.
   *
   * A FULL OUTER JOIN of the two aggregates: someone who sold without a
   * single logged call and someone who talked all month and sold nothing are
   * both rows — each is one half of the ratio at its worst, and either half
   * missing is exactly what the number exists to surface. The division and
   * the one-talk-hour floor live in the service, next to their documentation.
   */
  async employeeTalkRevenue(period: Period): Promise<EmployeeTalkRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        employee_id: string | null
        full_name: string | null
        revenue: MoneyText
        talk_seconds: bigint
      }[]
    >(
      `
      WITH talk AS (
        SELECT
          c."employeeId" AS employee_id,
          COALESCE(sum(c."durationSec") FILTER (WHERE c."connected"), 0)::bigint AS talk_seconds
        FROM "call_record" c
        WHERE c."startedAt" >= $1 AND c."startedAt" < $2
        GROUP BY 1
      ),
      rev AS (
        SELECT d."employeeId" AS employee_id, sum(d."amountMinor")::text AS revenue
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."status" = 'WON'
          AND d."closedAt" >= $1 AND d."closedAt" < $2
        GROUP BY 1
      )
      SELECT
        COALESCE(t.employee_id, r.employee_id) AS employee_id,
        e."fullName" AS full_name,
        r.revenue,
        COALESCE(t.talk_seconds, 0)::bigint AS talk_seconds
      FROM talk t
      FULL OUTER JOIN rev r ON r.employee_id = t.employee_id
      LEFT JOIN "employee" e ON e."id" = COALESCE(t.employee_id, r.employee_id)
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => ({
      employeeId: r.employee_id,
      fullName: r.full_name,
      revenueMinor: money(r.revenue),
      talkSeconds: int(r.talk_seconds),
    }))
  }
}
