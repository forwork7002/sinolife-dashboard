/**
 * Aggregation for the pulse (velocity/forecast/cycle/win-rate) and flow
 * (stage conversion/aging) endpoints.
 *
 * SQL for the same reason `InsightsRepository` is SQL: these questions touch
 * whole tables — every closed deal for a cycle percentile, every stage
 * transition for a dwell baseline — and the composite indexes
 * (`[countsAsRevenue, status, closedAt]`, `[dealId, enteredAt]`,
 * `[stageId, enteredAt]`) were built to answer them in the database.
 *
 * The three rules from `insightsRepository.ts` apply verbatim:
 *   1. `countsAsRevenue` named explicitly wherever money is touched;
 *   2. BigInt money crosses the driver as text;
 *   3. instants are compared as instants — the period boundaries arrive
 *      already resolved in Asia/Tashkent, and cycle/dwell figures are
 *      INTERVALS, which no timezone can shift. Nothing here truncates to a
 *      calendar date, so no AT TIME ZONE dance is needed.
 *
 * ONE RULE OF ITS OWN: unlike the older insights queries, these accept the
 * dashboard's people/source filters and the caller's authorisation scope.
 * Pulse feeds the overview hero band, which sits under the global filter row —
 * a hero number that ignores the filters beside it would be the "control that
 * appears to do nothing" bug in new clothes. Product/stage/text filters are
 * NOT applied (they would need joins these aggregates cannot honestly carry)
 * and the service documents that.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { STUCK_DWELL_MULTIPLIER } from '@/server/domain/analytics/pulse'
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

/** The slice of the dashboard filters these aggregates can honestly apply. */
export interface PulseDealFilters {
  readonly employeeIds?: readonly string[]
  readonly departmentIds?: readonly string[]
  readonly sourceIds?: readonly string[]
  /**
   * Authorisation scope — whose rows this caller may read at all.
   *
   * A LIST, because a scope can be a team. Null (or absent) is the whole
   * company; a non-null list is exhaustive and never empty, so an account that
   * narrows to nobody reads nothing rather than everything. Applied HERE
   * rather than in the UI so it cannot be bypassed by calling the API
   * directly, and ANDed with `employeeIds` above rather than replacing it: the
   * caller's own pick narrows the scope, it never widens it.
   */
  readonly restrictToEmployeeIds?: readonly string[] | null
}

/** Closed-cohort stats for one window (current or comparison). */
export interface ClosedDealStats {
  readonly wonCount: number
  readonly lostCount: number
  readonly wonAmountMinor: bigint
  readonly lostAmountMinor: bigint
  /** closedAt - createdAtSource percentiles over WON deals, in days. */
  /**
   * How many deals the percentiles beside this were actually taken over.
   *
   * Not `wonCount`: the percentiles exclude deals whose `closedAt` precedes
   * their creation, so the hint that named `wonCount` was crediting the median
   * to nine more deals than went into it.
   */
  readonly cycleCount: number
  readonly cycleP50Days: number | null
  readonly cycleP75Days: number | null
  readonly cycleP90Days: number | null
}

export interface OpenSnapshot {
  readonly openDeals: number
  readonly openValueMinor: bigint
}

/**
 * What the period's revenue is actually MADE OF.
 *
 * Revenue is bucketed by `closedAt`, and the median order on this portal takes
 * three weeks to close — so a month's revenue is mostly the PREVIOUS months'
 * orders arriving. Measured on August 2026: of 5.68 bn so'm closed, only
 * 1.68 bn (29%) came from orders created in August; 2.42 bn came from July's
 * and 1.25 bn from June's. Without this split a reader sees revenue quintuple
 * while intake is flat and concludes the company grew 5x, which it did not.
 *
 * `openFromPeriod` is the other half of the same fact: what this period took
 * in that has NOT closed yet, and will therefore land in a later month's
 * revenue. Scoped to the period on the creation clock, unlike `openSnapshot`,
 * which is every open deal in the company at this instant.
 */
export interface RevenueComposition {
  readonly ownDeals: number
  readonly ownAmountMinor: bigint
  readonly carriedDeals: number
  readonly carriedAmountMinor: bigint
  readonly openFromPeriodDeals: number
  readonly openFromPeriodMinor: bigint
}

export interface StageReachRow {
  readonly stageId: string
  readonly stageName: string
  readonly category: string
  readonly logisticsRole: string | null
  readonly sortOrder: number
  readonly pipelineId: string
  readonly pipelineName: string
  readonly dealCount: number
  /**
   * The pipeline's whole cohort — every deal created in the period that
   * belongs to it, whether or not it ever entered any stage.
   *
   * This is the ONE denominator every stage of the pipeline is measured
   * against. It is not the first stage's count: a deal can be created and
   * closed without a single history row, and dividing by a stage would make
   * the denominator depend on which stage happened to be first.
   */
  readonly cohortDeals: number
}

export interface StageAgingRow {
  readonly stageId: string
  readonly stageName: string
  readonly category: string
  readonly logisticsRole: string | null
  readonly sortOrder: number
  readonly pipelineName: string
  readonly openCount: number
  readonly openValueMinor: bigint
  readonly dwellP50Hours: number | null
  readonly dwellP90Hours: number | null
  /** Median completed dwell for this stage, all time. Null = no baseline. */
  readonly historicalP50Hours: number | null
  readonly stuckCount: number
  readonly stuckValueMinor: bigint
}

const EMPTY_CLOSED: ClosedDealStats = {
  wonCount: 0,
  lostCount: 0,
  wonAmountMinor: 0n,
  lostAmountMinor: 0n,
  cycleCount: 0,
  cycleP50Days: null,
  cycleP75Days: null,
  cycleP90Days: null,
}

export class PulseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Append filter conditions for the deal alias, mutating `params`.
   *
   * Id lists travel as ONE comma-joined text parameter split back apart with
   * `string_to_array`. The ids come out of the zod schema, which itself split
   * the query string on commas, so no id can contain one — and a single
   * parameter keeps the placeholder numbering static however many ids arrive.
   */
  private filterSql(filters: PulseDealFilters, params: unknown[], alias: string): string {
    const conditions: string[] = []

    if (filters.restrictToEmployeeIds?.length) {
      params.push(filters.restrictToEmployeeIds.join(','))
      conditions.push(`${alias}."employeeId" = ANY(string_to_array($${params.length}, ','))`)
    }
    if (filters.employeeIds?.length) {
      params.push(filters.employeeIds.join(','))
      conditions.push(`${alias}."employeeId" = ANY(string_to_array($${params.length}, ','))`)
    }
    if (filters.departmentIds?.length) {
      params.push(filters.departmentIds.join(','))
      conditions.push(
        `EXISTS (SELECT 1 FROM "employee" fe WHERE fe."id" = ${alias}."employeeId"` +
          ` AND fe."departmentId" = ANY(string_to_array($${params.length}, ',')))`,
      )
    }
    if (filters.sourceIds?.length) {
      params.push(filters.sourceIds.join(','))
      conditions.push(`${alias}."sourceId" = ANY(string_to_array($${params.length}, ','))`)
    }

    return conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`
  }

  /**
   * Everything the closed cohort can say, both windows in one scan.
   *
   * One query rather than two (the `findForAnalysis` pattern): the windows
   * are disjoint by construction — `previousEquivalent` ends where the
   * current period starts — so each row lands in exactly one bucket and the
   * `[countsAsRevenue, status, closedAt]` index serves both ranges.
   *
   * The cycle percentiles exclude rows where `closedAt` precedes
   * `createdAtSource`. Bitrix24 holds a handful of such deals (re-synced rows
   * whose source timestamps moved) and a negative duration in a
   * `percentile_cont` would drag the median below what any real deal took.
   */
  async closedDealStats(
    period: Period,
    comparison: Period,
    filters: PulseDealFilters,
  ): Promise<{ current: ClosedDealStats; previous: ClosedDealStats }> {
    const params: unknown[] = [period.start, period.end, comparison.start, comparison.end]
    const filterClause = this.filterSql(filters, params, 'd')

    const rows = await this.prisma.$queryRawUnsafe<
      {
        bucket: string
        won: bigint
        lost: bigint
        won_amount: MoneyText
        lost_amount: MoneyText
        cycle_count: bigint
        p50_days: number | null
        p75_days: number | null
        p90_days: number | null
      }[]
    >(
      `
      SELECT
        CASE WHEN d."closedAt" >= $1 AND d."closedAt" < $2 THEN 'current' ELSE 'previous' END
          AS bucket,
        count(*) FILTER (WHERE d."status" = 'WON')::bigint AS won,
        count(*) FILTER (WHERE d."status" = 'LOST')::bigint AS lost,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text AS won_amount,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'LOST')::text AS lost_amount,
        count(*) FILTER (
          WHERE d."status" = 'WON' AND d."closedAt" >= d."createdAtSource"
        )::bigint AS cycle_count,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (d."closedAt" - d."createdAtSource")) / 86400
        ) FILTER (WHERE d."status" = 'WON' AND d."closedAt" >= d."createdAtSource") AS p50_days,
        percentile_cont(0.75) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (d."closedAt" - d."createdAtSource")) / 86400
        ) FILTER (WHERE d."status" = 'WON' AND d."closedAt" >= d."createdAtSource") AS p75_days,
        percentile_cont(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (d."closedAt" - d."createdAtSource")) / 86400
        ) FILTER (WHERE d."status" = 'WON' AND d."closedAt" >= d."createdAtSource") AS p90_days
      FROM "deal" d
      WHERE d."countsAsRevenue"
        AND d."status" IN ('WON', 'LOST')
        AND d."closedAt" IS NOT NULL
        AND (
          (d."closedAt" >= $1 AND d."closedAt" < $2) OR
          (d."closedAt" >= $3 AND d."closedAt" < $4)
        )
        ${filterClause}
      GROUP BY 1
      `,
      ...params,
    )

    const byBucket = new Map(rows.map((r) => [r.bucket, r]))
    const pick = (bucket: 'current' | 'previous'): ClosedDealStats => {
      const row = byBucket.get(bucket)
      if (!row) return EMPTY_CLOSED
      return {
        wonCount: int(row.won),
        lostCount: int(row.lost),
        wonAmountMinor: money(row.won_amount),
        lostAmountMinor: money(row.lost_amount),
        cycleCount: int(row.cycle_count),
        cycleP50Days: floatOrNull(row.p50_days),
        cycleP75Days: floatOrNull(row.p75_days),
        cycleP90Days: floatOrNull(row.p90_days),
      }
    }

    return { current: pick('current'), previous: pick('previous') }
  }

  /** Open revenue deals RIGHT NOW — point-in-time, no period condition. */
  async openSnapshot(filters: PulseDealFilters): Promise<OpenSnapshot> {
    const params: unknown[] = []
    const filterClause = this.filterSql(filters, params, 'd')

    const rows = await this.prisma.$queryRawUnsafe<
      { open_deals: bigint; open_value: MoneyText }[]
    >(
      `
      SELECT count(*)::bigint AS open_deals, sum(d."amountMinor")::text AS open_value
      FROM "deal" d
      WHERE d."countsAsRevenue" AND d."status" = 'OPEN'
        ${filterClause}
      `,
      ...params,
    )

    const row = rows[0]
    return {
      openDeals: int(row?.open_deals ?? 0n),
      openValueMinor: money(row?.open_value ?? null),
    }
  }

  /**
   * The period's revenue split by WHEN the order was created, plus what the
   * period took in and has not closed.
   *
   * One query for three reads: the two revenue halves share a scan and the
   * open leg is a separate FILTER over the same table, so the three figures
   * can never come from three different instants.
   */
  async revenueComposition(
    period: Period,
    filters: PulseDealFilters,
  ): Promise<RevenueComposition> {
    const params: unknown[] = [period.start, period.end]
    const filterClause = this.filterSql(filters, params, 'd')

    const rows = await this.prisma.$queryRawUnsafe<
      {
        own_deals: bigint
        own_amount: MoneyText
        carried_deals: bigint
        carried_amount: MoneyText
        open_deals: bigint
        open_amount: MoneyText
      }[]
    >(
      `
      SELECT
        count(*) FILTER (
          WHERE d."status" = 'WON' AND d."closedAt" >= $1 AND d."closedAt" < $2
            AND d."createdAtSource" >= $1
        )::bigint AS own_deals,
        sum(d."amountMinor") FILTER (
          WHERE d."status" = 'WON' AND d."closedAt" >= $1 AND d."closedAt" < $2
            AND d."createdAtSource" >= $1
        )::text AS own_amount,
        count(*) FILTER (
          WHERE d."status" = 'WON' AND d."closedAt" >= $1 AND d."closedAt" < $2
            AND d."createdAtSource" < $1
        )::bigint AS carried_deals,
        sum(d."amountMinor") FILTER (
          WHERE d."status" = 'WON' AND d."closedAt" >= $1 AND d."closedAt" < $2
            AND d."createdAtSource" < $1
        )::text AS carried_amount,
        count(*) FILTER (
          WHERE d."status" = 'OPEN'
            AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
        )::bigint AS open_deals,
        sum(d."amountMinor") FILTER (
          WHERE d."status" = 'OPEN'
            AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
        )::text AS open_amount
      FROM "deal" d
      WHERE d."countsAsRevenue"
        /*
          THE SCAN IS BOUND HERE, NOT ONLY IN THE FILTERS.

          Every aggregate above admits a row only when it closed in the window
          or was created in it, so this disjunction changes no answer — but
          without it the WHERE was just countsAsRevenue and the query walked
          the whole deal table on every pulse read. This is the same mistake
          the structure() query documents ("3 527 ms against 992 ms"), in a
          more extreme form: no date bound reached the scan at all. Both
          halves ride an index — (countsAsRevenue, status, closedAt) and
          (createdAtSource) — which Postgres combines as a bitmap OR.
        */
        AND (
          (d."closedAt" >= $1 AND d."closedAt" < $2)
          OR (d."createdAtSource" >= $1 AND d."createdAtSource" < $2)
        )
        ${filterClause}
      `,
      ...params,
    )

    const row = rows[0]
    return {
      ownDeals: int(row?.own_deals ?? 0n),
      ownAmountMinor: money(row?.own_amount ?? null),
      carriedDeals: int(row?.carried_deals ?? 0n),
      carriedAmountMinor: money(row?.carried_amount ?? null),
      openFromPeriodDeals: int(row?.open_deals ?? 0n),
      openFromPeriodMinor: money(row?.open_amount ?? null),
    }
  }

  /** Revenue won inside one window. Used for period-to-date AND the previous full unit. */
  async wonRevenueInWindow(window: Period, filters: PulseDealFilters): Promise<bigint> {
    const params: unknown[] = [window.start, window.end]
    const filterClause = this.filterSql(filters, params, 'd')

    const rows = await this.prisma.$queryRawUnsafe<{ revenue: MoneyText }[]>(
      `
      SELECT sum(d."amountMinor")::text AS revenue
      FROM "deal" d
      WHERE d."countsAsRevenue" AND d."status" = 'WON'
        AND d."closedAt" >= $1 AND d."closedAt" < $2
        ${filterClause}
      `,
      ...params,
    )

    return money(rows[0]?.revenue ?? null)
  }

  /**
   * How far the deals CREATED in the period got, stage by stage.
   *
   * Ever-reached basis from stage HISTORY — the thing `stageFunnel()`
   * disclaims because current positions cannot say where a deal has BEEN. The
   * cohort is deals created in the window in REVENUE pipelines; a stage's
   * count is distinct cohort deals with a history row ever entering it.
   *
   * No `countsAsRevenue` here: this counts deals, not money, and the guard
   * exists to stop the same order being SUMMED twice (see `confirmations()` in
   * insightsRepository for the precedent). The revenue-pipeline join already
   * keeps the retention duplicates out.
   *
   * Every stage of every revenue pipeline is returned, zeros included — a
   * stage no deal reached is the finding, not noise to drop.
   */
  async stageReach(period: Period, filters: PulseDealFilters): Promise<StageReachRow[]> {
    const params: unknown[] = [period.start, period.end]
    const filterClause = this.filterSql(filters, params, 'd')

    const rows = await this.prisma.$queryRawUnsafe<
      {
        stage_id: string
        stage_name: string
        category: string
        logistics_role: string | null
        sort_order: number
        pipeline_id: string
        pipeline_name: string
        deal_count: bigint
        cohort_deals: bigint
      }[]
    >(
      `
      WITH cohort AS (
        SELECT d."id", d."pipelineId" AS pipeline_id
        FROM "deal" d
        JOIN "pipeline" pl ON pl."id" = d."pipelineId"
        WHERE pl."role" = 'REVENUE'
          AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
          ${filterClause}
      ),
      cohort_size AS (
        SELECT pipeline_id, count(*)::bigint AS cohort_deals
        FROM cohort GROUP BY 1
      ),
      reached AS (
        /*
          The numerator is scoped to the STAGE'S OWN PIPELINE, and it has to
          be. cohort_size buckets each deal by the pipeline it is in now, so
          a deal that moved between two revenue pipelines would otherwise land
          in one pipeline's denominator and the other's numerator — and a
          stage could then report more deals than its pipeline's whole cohort.
          Deals with history in both Доставка and Ecommerce exist in this
          database, so this is a real path, not a hypothetical one.
        */
        SELECT h."stageId" AS stage_id, count(DISTINCT h."dealId")::bigint AS deal_count
        FROM "deal_stage_history" h
        JOIN "deal_stage" st ON st."id" = h."stageId"
        JOIN cohort c ON c."id" = h."dealId" AND c.pipeline_id = st."pipelineId"
        GROUP BY 1
      )
      SELECT
        s."id" AS stage_id,
        s."name" AS stage_name,
        s."category"::text AS category,
        s."logisticsRole"::text AS logistics_role,
        s."sortOrder" AS sort_order,
        pl."id" AS pipeline_id,
        pl."name" AS pipeline_name,
        COALESCE(r.deal_count, 0)::bigint AS deal_count,
        COALESCE(cs.cohort_deals, 0)::bigint AS cohort_deals
      FROM "deal_stage" s
      JOIN "pipeline" pl ON pl."id" = s."pipelineId" AND pl."role" = 'REVENUE'
      LEFT JOIN reached r ON r.stage_id = s."id"
      LEFT JOIN cohort_size cs ON cs.pipeline_id = pl."id"
      ORDER BY pl."sortOrder", pl."name", s."sortOrder"
      `,
      ...params,
    )

    return rows.map((r) => ({
      stageId: r.stage_id,
      stageName: r.stage_name,
      category: r.category,
      logisticsRole: r.logistics_role,
      sortOrder: int(r.sort_order),
      pipelineId: r.pipeline_id,
      pipelineName: r.pipeline_name,
      dealCount: int(r.deal_count),
      cohortDeals: int(r.cohort_deals),
    }))
  }

  /**
   * Where the OPEN revenue deals are sitting, and for how long.
   *
   * Current dwell is `now - enteredAt` of the deal's OPEN history row — the
   * one with `leftAt IS NULL` matching the deal's current stage. Both
   * conditions, belt and braces: a re-synced deal can carry a stray open row
   * for a stage it left, and taking `max(enteredAt)` collapses duplicates.
   *
   * The stuck baseline is each stage's historical median over COMPLETED rows
   * (`leftAt - enteredAt`, all time) — open rows must not feed their own
   * threshold, or a stage that silts up would raise its baseline and declare
   * itself healthy. The 2x multiplier is `STUCK_DWELL_MULTIPLIER` from the
   * domain module, passed in as a parameter so the rule has one home.
   *
   * `now` is injected rather than read from the database clock so the figures
   * agree with everything else computed from `ctx.now` in the same request.
   */
  async stageAging(filters: PulseDealFilters, now: Date): Promise<StageAgingRow[]> {
    const params: unknown[] = [now, STUCK_DWELL_MULTIPLIER]
    const filterClause = this.filterSql(filters, params, 'd')

    const rows = await this.prisma.$queryRawUnsafe<
      {
        stage_id: string
        stage_name: string
        category: string
        logistics_role: string | null
        sort_order: number
        pipeline_name: string
        open_count: bigint
        open_value: MoneyText
        dwell_p50_hours: number | null
        dwell_p90_hours: number | null
        historical_p50_hours: number | null
        stuck_count: bigint
        stuck_value: MoneyText
      }[]
    >(
      `
      WITH hist AS (
        SELECT
          h."stageId" AS stage_id,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (h."leftAt" - h."enteredAt")) / 3600
          ) AS p50_hours
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
        JOIN "pipeline" pl ON pl."id" = s."pipelineId"
        WHERE pl."role" = 'REVENUE'
          AND h."leftAt" IS NOT NULL
          AND h."leftAt" >= h."enteredAt"
        GROUP BY 1
      ),
      open_now AS (
        SELECT
          d."id" AS deal_id,
          d."stageId" AS stage_id,
          d."amountMinor" AS amount,
          EXTRACT(EPOCH FROM ($1::timestamp - max(h."enteredAt"))) / 3600 AS dwell_hours
        FROM "deal" d
        JOIN "deal_stage_history" h
          ON h."dealId" = d."id" AND h."stageId" = d."stageId" AND h."leftAt" IS NULL
        JOIN "pipeline" pl ON pl."id" = d."pipelineId"
        WHERE d."countsAsRevenue" AND d."status" = 'OPEN' AND pl."role" = 'REVENUE'
          ${filterClause}
        GROUP BY d."id", d."stageId", d."amountMinor"
      )
      SELECT
        s."id" AS stage_id,
        s."name" AS stage_name,
        s."category"::text AS category,
        s."logisticsRole"::text AS logistics_role,
        s."sortOrder" AS sort_order,
        pl."name" AS pipeline_name,
        count(*)::bigint AS open_count,
        sum(o.amount)::text AS open_value,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY o.dwell_hours) AS dwell_p50_hours,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY o.dwell_hours) AS dwell_p90_hours,
        h.p50_hours AS historical_p50_hours,
        count(*) FILTER (
          WHERE h.p50_hours > 0 AND o.dwell_hours > $2 * h.p50_hours
        )::bigint AS stuck_count,
        sum(o.amount) FILTER (
          WHERE h.p50_hours > 0 AND o.dwell_hours > $2 * h.p50_hours
        )::text AS stuck_value
      FROM open_now o
      JOIN "deal_stage" s ON s."id" = o.stage_id
      JOIN "pipeline" pl ON pl."id" = s."pipelineId"
      LEFT JOIN hist h ON h.stage_id = o.stage_id
      GROUP BY s."id", s."name", s."category", s."logisticsRole", s."sortOrder",
               pl."name", pl."sortOrder", h.p50_hours
      ORDER BY pl."sortOrder", s."sortOrder"
      `,
      ...params,
    )

    return rows.map((r) => ({
      stageId: r.stage_id,
      stageName: r.stage_name,
      category: r.category,
      logisticsRole: r.logistics_role,
      sortOrder: int(r.sort_order),
      pipelineName: r.pipeline_name,
      openCount: int(r.open_count),
      openValueMinor: money(r.open_value),
      dwellP50Hours: floatOrNull(r.dwell_p50_hours),
      dwellP90Hours: floatOrNull(r.dwell_p90_hours),
      historicalP50Hours: floatOrNull(r.historical_p50_hours),
      stuckCount: int(r.stuck_count),
      stuckValueMinor: money(r.stuck_value),
    }))
  }
}
