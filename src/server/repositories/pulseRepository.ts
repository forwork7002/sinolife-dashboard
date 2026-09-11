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
import { DELIVERY_PIPELINE_EXTERNAL_ID } from '@/server/integrations/crm/bitrix24/mapping'

/** A money column as Postgres returns it: text, to survive the driver. */
type MoneyText = string | null

function money(value: MoneyText): bigint {
  return value === null || value === undefined ? 0n : BigInt(value)
}

function int(value: unknown): number {
  return Number(value ?? 0)
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

/**
 * One column of the portal's Доставка kanban, as this dashboard reads it.
 *
 * Deliberately NOT `StageAgingRow` minus fields. That row exists to answer
 * "how long has this been sitting here" and pays for it with an ordered-set
 * aggregate over the whole stage history; this one answers "how many orders
 * are in this column and what are they worth", which the `deal` table alone
 * can say. Two questions, two reads, and the cheap one is the one a floor
 * opens all day.
 */
export interface DeliveryStageRow {
  readonly stageId: string
  /**
   * AS STORED, which means PREFIXED: «Доставка · В пути».
   *
   * The importer writes the funnel into the stage name because stage ids
   * repeat across pipelines (`C6:WON` and `C14:WON` are different stages) and
   * a bare name is ambiguous in a filter list. On a board that is entirely one
   * funnel the prefix is thirteen characters of noise per row, so the SERVICE
   * strips it — and needs `pipelineName` beside it to strip exactly the right
   * thing rather than guess at a separator.
   */
  readonly stageName: string
  readonly pipelineName: string
  readonly category: string
  readonly sortOrder: number
  readonly openCount: number
  readonly openValueMinor: bigint
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
   * The Доставка funnel as the portal's own kanban draws it: one row per
   * column, the orders standing in it now, and what they are worth.
   *
   * THE CLIENT READS THIS BOARD IN BITRIX24 EVERY DAY and asked on 2026-09-10
   * for the same columns here, under the same names — «shu yerdagi barcha
   * boʻlimlardagi malumotlar hammasi qanday nomlangan boʻlsa shunday
   * yozishingni istardim, chunki biz bitrix24da shunaqa oʻqishga oʻrgangan
   * edik». So `s."name"` is passed through untouched, in Russian, in the
   * portal's `sortOrder`. Translating «В пути» would be the one change that
   * makes the number unreconcilable against the screen it is copied from.
   *
   * NO WINDOW, AND THAT IS THE MEASUREMENT. A kanban column is a snapshot of
   * where orders stand at this moment — an order that arrived in June and is
   * still in VODIY is in that column today. Dating it by the report window
   * would answer a different question and disagree with the portal by more
   * every month. `filterSql` carries no date bound, which is what makes it the
   * right filter set to reuse here.
   *
   * STARTS FROM THE STAGES, NOT FROM THE DEALS, so an EMPTY column is still a
   * column. `Подготовка товара 0` and `Заказ в мой склад 0` are the first two
   * the client screenshotted; a `GROUP BY` over deals would have dropped both
   * and quietly renumbered the board. Hence the LEFT JOIN, and hence the
   * filters riding in its ON clause rather than in the WHERE — moved to the
   * WHERE they would turn the outer join back into an inner one and delete the
   * empty columns again, which is the classic way this query goes wrong.
   *
   * ONE FUNNEL, NAMED BY ITS ID. `pl."role" = 'REVENUE'` admits Ecommerce too;
   * see `DELIVERY_PIPELINE_EXTERNAL_ID`.
   *
   * THE CLOSING COLUMNS ARE LEFT OUT — measured on the portal's own stage
   * table, that is exactly three of eighteen: «Отказ предварительно» (6160,
   * LOST), «Доставлено» (6170, WON) and «Отказ» (6180, LOST). No OPEN deal can
   * be in any of them, so each could only ever print a permanent zero beside
   * fifteen live columns. Filtered on the CATEGORY rather than by naming the
   * three, so a renamed stage does not quietly reappear as a row of noughts.
   */
  async deliveryBoard(filters: PulseDealFilters): Promise<DeliveryStageRow[]> {
    const params: unknown[] = [DELIVERY_PIPELINE_EXTERNAL_ID]
    const filterClause = this.filterSql(filters, params, 'd')

    const rows = await this.prisma.$queryRawUnsafe<
      {
        stage_id: string
        stage_name: string
        pipeline_name: string
        category: string
        sort_order: number
        open_count: bigint
        open_value: MoneyText
      }[]
    >(
      `
      SELECT
        s."id" AS stage_id,
        s."name" AS stage_name,
        s."category"::text AS category,
        s."sortOrder" AS sort_order,
        pl."name" AS pipeline_name,
        count(d."id")::bigint AS open_count,
        sum(d."amountMinor")::text AS open_value
      FROM "deal_stage" s
      JOIN "pipeline" pl ON pl."id" = s."pipelineId"
      LEFT JOIN "deal" d
        ON d."stageId" = s."id"
       AND d."status" = 'OPEN'
       AND d."countsAsRevenue"
       ${filterClause}
      WHERE pl."externalId" = $1
        AND s."isActive"
        AND s."category" NOT IN ('WON', 'LOST')
      GROUP BY s."id", s."name", s."category", s."sortOrder", pl."name"
      ORDER BY s."sortOrder"
      `,
      ...params,
    )

    return rows.map((r) => ({
      stageId: r.stage_id,
      stageName: r.stage_name,
      pipelineName: r.pipeline_name,
      category: r.category,
      sortOrder: int(r.sort_order),
      openCount: int(r.open_count),
      openValueMinor: money(r.open_value),
    }))
  }
}
