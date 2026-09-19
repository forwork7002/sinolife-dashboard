/**
 * «Target tahlili» — the leads paid targeting bought, and what they became.
 *
 * TWO KINDS OF DEAL, ONE CONTACT. On this portal a lead is a deal in
 * Регистрация (role LEAD). When the registrar marks it «Сделка успешна» the
 * portal opens a SECOND deal for the same contact in Первичный отдел (role
 * QUALIFICATION), copying SOURCE_ID and the targetolog; that deal is the one a
 * seller works, and it is the same deal id that then moves on through
 * Тасдиклаш (CONFIRMATION) into Доставка (REVENUE). Measured on the client's
 * own export for 16.08–15.09.2026: of 1 518 leads marked «Сделка успешна»,
 * 1 470 have a Первичный отдел / Доставка deal for the same contact.
 *
 * So the screen counts two sets over one creation window and never adds them:
 *
 *   lead — a LEAD-role deal. «Leadlar» on screen.
 *   sale — a QUALIFICATION / CONFIRMATION / REVENUE deal. Where it sits NOW
 *          says what became of it: still with a seller, in confirmation, on
 *          its way, delivered, or refused.
 *
 * Both are cut by their OWN source and targetolog, which the portal copies
 * from one to the other, so a per-source row pairs the leads and the sales of
 * that source without joining a lead to its sale. The lead LIST is the one
 * place that does join them — per row, after the page's LIMIT — because a
 * reader looking at one lead wants to know what happened to it.
 *
 * База (RETENTION) is never read: it re-records orders that already exist in
 * Доставка, and counting it doubles the money. AI triage and HR are not leads.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import type { Period } from '@/server/domain/period/period'

/** A money column as Postgres returns it: text, to survive the driver. */
function money(value: string | null | undefined): bigint {
  return value === null || value === undefined ? 0n : BigInt(value)
}

function int(value: unknown): number {
  return Number(value ?? 0)
}

/**
 * What a row with no targetolog, creative or source is filed under.
 *
 * One string, used in the SQL and in the filter, so «Ko'rsatilmagan» picked in
 * a dropdown finds exactly the rows that were grouped under it.
 */
export const NOT_STATED = 'Koʻrsatilmagan'

export interface TargetWindow {
  readonly period: Period
  /** Portal SOURCE_IDs to count; null counts every source. */
  readonly sourceIds: readonly string[] | null
}

/** One group's counters, for leads and for the sales they became. */
export interface TargetCountersRow {
  readonly leads: number
  /** Distinct contacts among the leads — a person who wrote twice is one. */
  readonly leadCustomers: number
  /** Leads the registrar passed on («Сделка успешна»). */
  readonly leadWon: number
  /** Leads closed as lost: refused, duplicate, unreachable, foreign number. */
  readonly leadLost: number
  /** Sales deals opened from these sources. */
  readonly sales: number
  /** …that reached confirmation or delivery — an ORDER. */
  readonly orders: number
  readonly orderedMinor: bigint
  readonly delivered: number
  readonly deliveredMinor: bigint
  readonly returned: number
  readonly returnedMinor: bigint
  /** In Доставка, not yet delivered or refused. */
  readonly inTransit: number
  /** In Тасдиклаш right now. */
  readonly confirming: number
  /** Closed by the seller without an order. */
  readonly sellerLost: number
}

export interface TargetGroupRow extends TargetCountersRow {
  readonly key: string
}

export interface TargetStageRow {
  readonly kind: 'lead' | 'sale'
  readonly pipeline: string
  readonly stage: string
  readonly category: string
  readonly deals: number
  readonly amountMinor: bigint
}

export interface TargetSummaryRows {
  readonly total: TargetCountersRow
  readonly sources: readonly TargetGroupRow[]
  readonly targetologs: readonly TargetGroupRow[]
  readonly creatives: readonly TargetGroupRow[]
  /** `YYYY-MM-DD` in the app timezone, oldest first. */
  readonly days: readonly TargetGroupRow[]
  readonly stages: readonly TargetStageRow[]
}

export interface TargetLeadFilter extends TargetWindow {
  /** A source NAME, as the summary groups it. */
  readonly source?: string
  /** A targetolog, or `NOT_STATED` for the leads that carry none. */
  readonly targetolog?: string
  /** A Регистрация stage name. */
  readonly stage?: string
  /** Deal id, title, customer name or phone — a substring. */
  readonly search?: string
  readonly limit: number
  readonly offset: number
}

export interface TargetLeadRow {
  readonly bitrixId: string | null
  readonly createdAt: Date
  readonly title: string
  readonly customerName: string | null
  readonly phone: string | null
  readonly source: string
  readonly targetolog: string | null
  readonly creative: string | null
  readonly primarySource: string | null
  readonly stage: string
  readonly stageCategory: string
  readonly registrar: string | null
  /** The first sales deal this contact opened on or after the lead. */
  readonly sale: {
    readonly bitrixId: string | null
    readonly createdAt: Date
    readonly pipeline: string
    readonly role: string
    readonly stage: string
    readonly status: string
    readonly amountMinor: bigint
    readonly seller: string | null
  } | null
}

export interface TargetSourceOption {
  readonly externalId: string
  readonly name: string
  readonly isTarget: boolean
}

/**
 * The window and the source set, shared by every statement here.
 *
 * `$1`/`$2` are the window; `sources` names the parameter holding the SOURCE_ID
 * list, null for «every source». Numbered by the caller because the summary
 * also binds the timezone and the lead list does not — and Postgres refuses a
 * statement carrying a parameter it cannot type, so an unused `$3` is an error.
 *
 * A deal with no source at all is only counted when every source is — it is
 * certainly not a target lead, and "no source" is not a page an ad points at.
 */
function baseFrom(sources: string, extraJoins = ''): string {
  return `
  FROM "deal" d
  JOIN "pipeline" p ON p."id" = d."pipelineId"
  JOIN "deal_stage" st ON st."id" = d."stageId"
  LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
  ${extraJoins}
  WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
    AND (${sources}::text[] IS NULL OR s."externalId" = ANY(${sources}::text[]))`
}

export class TargetRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  /**
   * Every counter on the screen, from ONE scan.
   *
   * GROUPING SETS rather than five statements, so the tiles, the three tables,
   * the daily chart and the stage bars are groupings of the same rows read at
   * the same instant and cannot disagree with each other.
   */
  async summary(window: TargetWindow): Promise<TargetSummaryRows> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        g_source: number
        g_targetolog: number
        g_creative: number
        g_day: number
        g_stage: number
        source: string | null
        targetolog: string | null
        creative: string | null
        day: string | null
        kind: string | null
        pipeline: string | null
        stage: string | null
        category: string | null
        stage_order: number | null
        pipeline_order: number | null
        leads: bigint
        lead_customers: bigint
        lead_won: bigint
        lead_lost: bigint
        sales: bigint
        orders: bigint
        ordered_minor: string | null
        delivered: bigint
        delivered_minor: string | null
        returned: bigint
        returned_minor: string | null
        in_transit: bigint
        confirming: bigint
        seller_lost: bigint
        stage_amount: string | null
      }[]
    >(
      `
      WITH base AS (
        SELECT
          CASE WHEN p."role" = 'LEAD' THEN 'lead' ELSE 'sale' END AS kind,
          p."role"::text AS role,
          p."name" AS pipeline,
          p."sortOrder" AS pipeline_order,
          d."status"::text AS status,
          st."name" AS stage,
          st."category"::text AS category,
          st."sortOrder" AS stage_order,
          COALESCE(s."name", $5) AS source,
          COALESCE(NULLIF(btrim(d."targetolog"), ''), $5) AS targetolog,
          COALESCE(NULLIF(btrim(d."creative"), ''), $5) AS creative,
          /*
            ::text, never a bare ::date — node-postgres builds a DATE at LOCAL
            midnight, which on a Tashkent machine is the day before.
          */
          (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
          d."amountMinor" AS amount,
          d."customerId" AS customer_id
        ${baseFrom('$4')}
          AND p."role" IN ('LEAD', 'QUALIFICATION', 'CONFIRMATION', 'REVENUE')
      )
      SELECT
        GROUPING(source)::int     AS g_source,
        GROUPING(targetolog)::int AS g_targetolog,
        GROUPING(creative)::int   AS g_creative,
        GROUPING(day)::int        AS g_day,
        GROUPING(stage)::int      AS g_stage,
        source, targetolog, creative, day, kind, pipeline, stage,
        min(category)       AS category,
        min(stage_order)    AS stage_order,
        min(pipeline_order) AS pipeline_order,
        count(*) FILTER (WHERE kind = 'lead')::bigint AS leads,
        count(DISTINCT customer_id) FILTER (WHERE kind = 'lead')::bigint AS lead_customers,
        count(*) FILTER (WHERE kind = 'lead' AND status = 'WON')::bigint AS lead_won,
        count(*) FILTER (WHERE kind = 'lead' AND status = 'LOST')::bigint AS lead_lost,
        count(*) FILTER (WHERE kind = 'sale')::bigint AS sales,
        count(*) FILTER (WHERE role IN ('CONFIRMATION', 'REVENUE'))::bigint AS orders,
        COALESCE(sum(amount) FILTER (WHERE role IN ('CONFIRMATION', 'REVENUE')), 0)::text AS ordered_minor,
        count(*) FILTER (WHERE role = 'REVENUE' AND status = 'WON')::bigint AS delivered,
        COALESCE(sum(amount) FILTER (WHERE role = 'REVENUE' AND status = 'WON'), 0)::text AS delivered_minor,
        count(*) FILTER (WHERE role = 'REVENUE' AND status = 'LOST')::bigint AS returned,
        COALESCE(sum(amount) FILTER (WHERE role = 'REVENUE' AND status = 'LOST'), 0)::text AS returned_minor,
        count(*) FILTER (WHERE role = 'REVENUE' AND status = 'OPEN')::bigint AS in_transit,
        count(*) FILTER (WHERE role = 'CONFIRMATION')::bigint AS confirming,
        count(*) FILTER (WHERE role = 'QUALIFICATION' AND status = 'LOST')::bigint AS seller_lost,
        COALESCE(sum(amount), 0)::text AS stage_amount
      FROM base
      GROUP BY GROUPING SETS (
        (source), (targetolog), (creative), (day), (kind, pipeline, stage), ()
      )
      `,
      window.period.start,
      window.period.end,
      this.tz,
      window.sourceIds ? [...window.sourceIds] : null,
      NOT_STATED,
    )

    const counters = (row: (typeof rows)[number]): TargetCountersRow => ({
      leads: int(row.leads),
      leadCustomers: int(row.lead_customers),
      leadWon: int(row.lead_won),
      leadLost: int(row.lead_lost),
      sales: int(row.sales),
      orders: int(row.orders),
      orderedMinor: money(row.ordered_minor),
      delivered: int(row.delivered),
      deliveredMinor: money(row.delivered_minor),
      returned: int(row.returned),
      returnedMinor: money(row.returned_minor),
      inTransit: int(row.in_transit),
      confirming: int(row.confirming),
      sellerLost: int(row.seller_lost),
    })

    const only = (flag: keyof Pick<(typeof rows)[number], 'g_source' | 'g_targetolog' | 'g_creative' | 'g_day' | 'g_stage'>) =>
      rows.filter(
        (r) =>
          r[flag] === 0 &&
          (['g_source', 'g_targetolog', 'g_creative', 'g_day', 'g_stage'] as const).every(
            (other) => other === flag || r[other] === 1,
          ),
      )

    const group = (
      flag: 'g_source' | 'g_targetolog' | 'g_creative' | 'g_day',
      keyOf: (r: (typeof rows)[number]) => string | null,
    ): TargetGroupRow[] =>
      only(flag).map((r) => ({ key: keyOf(r) ?? NOT_STATED, ...counters(r) }))

    /*
      The () arm is always emitted — an aggregate with no GROUP BY columns
      returns one row even over nothing — so a missing total means the
      statement changed shape, not that the window was empty.
    */
    const totalRow = rows.find(
      (r) =>
        r.g_source === 1 && r.g_targetolog === 1 && r.g_creative === 1 && r.g_day === 1 && r.g_stage === 1,
    )
    if (!totalRow) throw new Error('target summary: the grand-total grouping set is missing')

    const byLeadsThenSales = (a: TargetGroupRow, b: TargetGroupRow) =>
      b.leads - a.leads || b.sales - a.sales || a.key.localeCompare(b.key, 'ru')

    return {
      total: counters(totalRow),
      sources: group('g_source', (r) => r.source).sort(byLeadsThenSales),
      targetologs: group('g_targetolog', (r) => r.targetolog).sort(byLeadsThenSales),
      creatives: group('g_creative', (r) => r.creative).sort(byLeadsThenSales),
      days: group('g_day', (r) => r.day).sort((a, b) => a.key.localeCompare(b.key)),
      stages: only('g_stage')
        .map((r) => ({
          row: r,
          stage: {
            kind: r.kind === 'lead' ? ('lead' as const) : ('sale' as const),
            pipeline: r.pipeline ?? '',
            stage: r.stage ?? '',
            category: r.category ?? 'IN_PROGRESS',
            deals: int(r.leads) + int(r.sales),
            amountMinor: money(r.stage_amount),
          },
        }))
        .sort(
          (a, b) =>
            (a.row.pipeline_order ?? 0) - (b.row.pipeline_order ?? 0) ||
            (a.row.stage_order ?? 0) - (b.row.stage_order ?? 0),
        )
        .map((x) => x.stage),
    }
  }

  /**
   * One page of leads, newest first, each with what became of it.
   *
   * The sale is found PER ROW, after the LIMIT: the first QUALIFICATION /
   * CONFIRMATION / REVENUE deal the same contact opened on or after the lead.
   * That is a lateral lookup on `deal."customerId"` (indexed), so a page costs
   * a page's worth of index probes rather than a second pass over the window.
   * A lead without a contact has no sale to find and says so.
   */
  async leads(filter: TargetLeadFilter): Promise<{ rows: TargetLeadRow[]; total: number }> {
    const params: unknown[] = [
      filter.period.start,
      filter.period.end,
      filter.sourceIds ? [...filter.sourceIds] : null,
      NOT_STATED,
      filter.source ?? null,
      filter.targetolog ?? null,
      filter.stage ?? null,
      filter.search ? `%${escapeLike(filter.search)}%` : null,
    ]

    const filters = `
        AND p."role" = 'LEAD'
        AND ($5::text IS NULL OR COALESCE(s."name", $4) = $5)
        AND ($6::text IS NULL OR COALESCE(NULLIF(btrim(d."targetolog"), ''), $4) = $6)
        AND ($7::text IS NULL OR st."name" = $7)
        AND (
          $8::text IS NULL
          OR d."externalId" ILIKE $8
          OR d."title" ILIKE $8
          OR c."name" ILIKE $8
          OR c."phone" ILIKE $8
        )`
    const customerJoin = 'LEFT JOIN "customer" c ON c."id" = d."customerId"'

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        {
          bitrix_id: string | null
          created_at: Date
          title: string
          customer_name: string | null
          phone: string | null
          source: string
          targetolog: string | null
          creative: string | null
          primary_source: string | null
          stage: string
          category: string
          registrar: string | null
          sale_bitrix_id: string | null
          sale_created_at: Date | null
          sale_pipeline: string | null
          sale_role: string | null
          sale_stage: string | null
          sale_status: string | null
          sale_amount: string | null
          sale_seller: string | null
        }[]
      >(
        `
        WITH page AS (
          SELECT
            d."id",
            d."externalId" AS bitrix_id,
            d."createdAtSource" AS created_at,
            d."title",
            d."customerId" AS customer_id,
            c."name" AS customer_name,
            c."phone",
            COALESCE(s."name", $4) AS source,
            NULLIF(btrim(d."targetolog"), '') AS targetolog,
            NULLIF(btrim(d."creative"), '') AS creative,
            NULLIF(btrim(d."primarySource"), '') AS primary_source,
            st."name" AS stage,
            st."category"::text AS category,
            e."fullName" AS registrar
          ${baseFrom('$3', `${customerJoin}
          LEFT JOIN "employee" e ON e."id" = d."employeeId"`)}
          ${filters}
          ORDER BY d."createdAtSource" DESC, d."id" DESC
          LIMIT ${Math.trunc(filter.limit)} OFFSET ${Math.trunc(filter.offset)}
        )
        SELECT
          page.*,
          sale.bitrix_id  AS sale_bitrix_id,
          sale.created_at AS sale_created_at,
          sale.pipeline   AS sale_pipeline,
          sale.role       AS sale_role,
          sale.stage      AS sale_stage,
          sale.status     AS sale_status,
          sale.amount::text AS sale_amount,
          sale.seller     AS sale_seller
        FROM page
        LEFT JOIN LATERAL (
          SELECT
            x."externalId" AS bitrix_id,
            x."createdAtSource" AS created_at,
            xp."name" AS pipeline,
            xp."role"::text AS role,
            xs."name" AS stage,
            x."status"::text AS status,
            x."amountMinor" AS amount,
            /*
              The seller as the portal stamped them at the sale when it did,
              else today's owner — the same fallback every board here uses.
            */
            COALESCE(oe."fullName", xe."fullName") AS seller
          FROM "deal" x
          JOIN "pipeline" xp ON xp."id" = x."pipelineId"
            AND xp."role" IN ('QUALIFICATION', 'CONFIRMATION', 'REVENUE')
          JOIN "deal_stage" xs ON xs."id" = x."stageId"
          LEFT JOIN "employee" xe ON xe."id" = x."employeeId"
          LEFT JOIN "employee" oe ON oe."id" = x."operatorEmployeeId"
          WHERE page.customer_id IS NOT NULL
            AND x."customerId" = page.customer_id
            AND x."createdAtSource" >= page.created_at
          ORDER BY x."createdAtSource" ASC
          LIMIT 1
        ) sale ON true
        ORDER BY page.created_at DESC, page."id" DESC
        `,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<{ total: bigint }[]>(
        `
        SELECT count(*)::bigint AS total
        ${baseFrom('$3', customerJoin)}
        ${filters}
        `,
        ...params,
      ),
    ])

    return {
      rows: rows.map((r) => ({
        bitrixId: r.bitrix_id,
        createdAt: r.created_at,
        title: r.title,
        customerName: r.customer_name,
        phone: r.phone,
        source: r.source,
        targetolog: r.targetolog,
        creative: r.creative,
        primarySource: r.primary_source,
        stage: r.stage,
        stageCategory: r.category,
        registrar: r.registrar,
        sale:
          r.sale_pipeline === null
            ? null
            : {
                bitrixId: r.sale_bitrix_id,
                createdAt: r.sale_created_at ?? r.created_at,
                pipeline: r.sale_pipeline,
                role: r.sale_role ?? '',
                stage: r.sale_stage ?? '',
                status: r.sale_status ?? 'OPEN',
                amountMinor: money(r.sale_amount),
                seller: r.sale_seller,
              },
      })),
      total: int(counted[0]?.total),
    }
  }

  /** Every source the portal names, flagged when it is paid targeting. */
  async sources(targetIds: readonly string[]): Promise<TargetSourceOption[]> {
    const rows = await this.prisma.salesSource.findMany({
      where: { externalId: { not: null } },
      select: { externalId: true, name: true },
      orderBy: { name: 'asc' },
    })
    const wanted = new Set(targetIds)
    return rows.map((r) => ({
      externalId: r.externalId!,
      name: r.name,
      isTarget: wanted.has(r.externalId!),
    }))
  }
}

/** A search term as a LIKE literal: its own % and _ are text, not wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}
