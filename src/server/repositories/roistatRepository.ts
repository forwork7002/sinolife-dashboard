/**
 * «Roistat» — Meta spend, Регистрация leads and the sales they became, cut
 * twelve ways.
 *
 * TWO SOURCES THAT NEVER JOIN PER ROW. UTM_* is empty on all but a handful of
 * the portal's deals (17 of 4 321 created 03–05.10.2026), so no lead can be
 * tied to the campaign, adset or ad that bought it. The Meta cuts therefore
 * carry Meta's own figures only, and the Bitrix24 cuts carry spend only where
 * the money can honestly be placed — the day, the targetolog who owns the ad
 * account, the product its budget counts towards. The service decides that;
 * this file only reads.
 *
 * THE BITRIX HALF IS A LEAD COHORT. A lead is a Регистрация deal (role LEAD)
 * on the day it was registered. When the registrar marks it «Сделка успешна»
 * the portal opens a second deal for the same contact in Первичный отдел, and
 * that deal id moves on through Тасдиклаш into Доставка (see the header of
 * targetRepository.ts). Each such sales deal is tied back to its ORIGIN LEAD —
 * the same contact's Регистрация deal opened up to 30 days before it, a WON one
 * first — and counted on that lead's day, so a window's revenue is what that
 * window's leads brought («Выручка привязана к дате лида», as the client's own
 * Roistat page put it). A sales deal with no such lead (a seller's own, a
 * returning customer) is counted on its own creation day, so no sale drops out.
 *
 *   orders — the sales deal reached Тасдиклаш or Доставка («Заказы»).
 *   sold   — Доставка, WON: delivered and paid («Продажи»).
 *
 * The same counters «Target tahlili» uses, so the two screens agree. База
 * (RETENTION) is never read — it re-records Доставка's orders.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import { type Period, monthPieces, zonedMonthKey } from '@/server/domain/period/period'
import { brandTeams } from '@/server/domain/rnp/rnpSheet'
import { ROISTAT_NO_PRODUCT } from '@/server/domain/roistat/roistatCuts'

import { InsightsRepository } from './insightsRepository'
import {
  ORIGIN_LEAD_DAYS,
  dealFormTitleSql,
  formAliasByMonthCteSql,
  formAliasCteSql,
  formAliasJoinSql,
  formBrandOfTitleSql,
  leadFormTitleSql,
  originLeadOrderSql,
  saleFormTitleSql,
  sourceDescriptionSql,
} from './leadFormSql'

/** Additive Bitrix24 counters for one group. Money in minor units, as stored. */
export interface RoistatBitrixCounters {
  readonly leads: number
  readonly clean: number
  readonly kval: number
  readonly orders: number
  readonly orderedMinor: bigint
  readonly sold: number
  readonly soldMinor: bigint
  readonly newCustomers: number
  readonly dealDaysSum: number
  readonly dealCount: number
}

/**
 * One grouping-set row. Exactly the columns of its set are filled; the rest are
 * null, and `set` says which set it is — a null inside a set is a real «not
 * stated», never a rolled-up total.
 */
export interface RoistatBitrixRow extends RoistatBitrixCounters {
  readonly set: 'total' | 'day' | 'form' | 'source' | 'product' | 'region' | 'rop' | 'seller' | 'registrar'
  readonly day: string | null
  readonly sourceId: string | null
  readonly sourceName: string | null
  readonly formTitle: string | null
  /** The deal's own «Таргетолог» field. */
  readonly targetolog: string | null
  readonly productLine: string | null
  readonly region: string | null
  readonly rop: string | null
  readonly seller: string | null
  readonly registrar: string | null
  /**
   * What the Collagen / Zextra switch files the row by — filled only when the
   * scan was asked for them (`brandKeys`), null otherwise. A lead row carries
   * its own source, form and «Проект» (`brandLine`; `brandTeam` null); a sale row carries the
   * BRAND its origin lead's form names in `brandForm` ('Collagen' / 'Zextra'
   * / null — `originFormBrandSql`'s reading, not a title), the team that sold
   * it (`brandTeam` set) and what its line items say (`brandProduct`,
   * `DealProductBrand`) — the brand of a sale is its form's, else its
   * product's, the team only when it has neither (`saleBrand`). Every grouping set is
   * then split by these, so one key row can come back several times.
   */
  readonly brandSource: string | null
  readonly brandForm: string | null
  readonly brandLine: string | null
  readonly brandTeam: string | null
  readonly brandProduct: string | null
  /**
   * The brand the switch files the row by, ALREADY DECIDED — set on a stored
   * month's rows only (`RoistatService` folds a brand-keyed month to its
   * brands before the worker stores it, the five inputs above then null);
   * absent on every row a statement returns.
   */
  readonly brand?: 'Collagen' | 'Zextra' | null
}

/** One Meta ad (or adset, or campaign) over the window, hiring not yet removed. */
export interface RoistatMetaRow {
  readonly accountId: string
  readonly accountName: string
  readonly campaignId: string
  readonly campaignName: string
  readonly objective: string
  /** Null on the campaign grain. */
  readonly adsetId: string | null
  readonly adsetName: string | null
  /** Null on the campaign and adset grains. */
  readonly adId: string | null
  readonly adName: string | null
  readonly spendMicroUsd: bigint
  readonly impressions: number
  readonly reach: number
  readonly clicks: number
  readonly leads: number
}

export type RoistatMetaGrain = 'camp' | 'adset' | 'ad'

/** The columns that name a row's group — every one but the counters. */
const ROW_KEYS = [
  'set', 'day', 'sourceId', 'sourceName', 'formTitle', 'targetolog', 'productLine', 'region', 'rop', 'seller', 'registrar',
  'brandSource', 'brandForm', 'brandLine', 'brandTeam', 'brandProduct',
] as const satisfies readonly (keyof RoistatBitrixRow)[]

/**
 * Scan rows of several windows — a window's months — as the one statement
 * over all of them returns them: rows naming the same group are added up,
 * every counter (the sum of the day sums is the window's day sum). First
 * appearance keeps a group's place.
 */
export function mergeBitrixRows(rows: readonly RoistatBitrixRow[]): RoistatBitrixRow[] {
  const merged = new Map<string, { -readonly [K in keyof RoistatBitrixRow]: RoistatBitrixRow[K] }>()
  for (const row of rows) {
    // A decided brand is part of the group; «not decided» (a statement's row) is told apart from «no brand».
    const key = JSON.stringify([...ROW_KEYS.map((k) => row[k]), row.brand === undefined ? '?' : row.brand])
    const into = merged.get(key)
    if (!into) {
      merged.set(key, { ...row })
      continue
    }
    into.leads += row.leads
    into.clean += row.clean
    into.kval += row.kval
    into.orders += row.orders
    into.orderedMinor += row.orderedMinor
    into.sold += row.sold
    into.soldMinor += row.soldMinor
    into.newCustomers += row.newCustomers
    into.dealDaysSum += row.dealDaysSum
    into.dealCount += row.dealCount
  }
  return [...merged.values()]
}

/** The grouping sets each shape reads (`bitrix`'s `shape`). */
const SHAPE_SETS: Record<'all' | 'days' | 'total', ReadonlySet<RoistatBitrixRow['set']> | null> = {
  all: null,
  days: new Set(['total', 'day']),
  total: new Set(['total']),
}

/**
 * What `bitrix(period, now, shape, brandKeys)` returns, cut from the rows of
 * the WIDEST read of the same window — `bitrix(period, now, 'all', true)`,
 * folded to its brands (`foldBitrixToBrand`, roistatService.ts): its grouping
 * sets narrowed to the shape's, and, unkeyed, its brands added back together.
 * Every set reads the same rows whatever else is grouped beside it, and a
 * brand-keyed set is its unkeyed set split by brand — so the stored month
 * answers every question of that month, and the brand switch every slice.
 */
export function bitrixRowsOfShape(
  widest: readonly RoistatBitrixRow[],
  shape: 'all' | 'days' | 'total',
  brandKeys: boolean,
): RoistatBitrixRow[] {
  const sets = SHAPE_SETS[shape]
  const kept = sets === null ? widest : widest.filter((row) => sets.has(row.set))
  if (brandKeys) return [...kept]
  return mergeBitrixRows(
    kept.map(({ brand: _brand, ...row }) => ({ ...row, brandSource: null, brandForm: null, brandLine: null, brandTeam: null, brandProduct: null })),
  )
}

function money(value: string | null | undefined): bigint {
  return value === null || value === undefined ? 0n : BigInt(value)
}

function int(value: unknown): number {
  return Number(value ?? 0)
}

export class RoistatRepository {
  private readonly tz: string

  /** `poolStatementTimeoutMs` — as `InsightsRepository`'s: a limit the pool already sets needs no transaction. */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly poolStatementTimeoutMs = 0,
  ) {
    this.tz = env.APP_TIMEZONE
  }

  /**
   * Every Bitrix24 counter on the screen, from ONE scan — the tiles, the nine
   * Bitrix cuts and the chart's revenue are groupings of the same rows read
   * at the same instant, so each cut's ИТОГО is the tiles' figure.
   *
   * `shape` narrows the grouping: `total` reads the () set alone (the
   * previous window's tiles), `days` the () and (day) sets («Kunlar
   * boʻyicha», polled by every open Savdo dinamikasi tab — the seven other
   * cuts would be computed and thrown away).
   *
   * `brandKeys` adds the brand inputs to every grouping set, for a screen
   * narrowed to one brand: the rule (RNP's `leadBrand` for a lead,
   * `saleBrand` for a sale — its origin lead's form's brand, else its line
   * items', else its team) lives in TypeScript.
   *
   * A WINDOW IS THE SUM OF ITS MONTHS (2026-10-28): every row of it falls in
   * the month of its lead's day, and each month's piece reads exactly what it
   * reads as a window of its own — its sales up to a month past it, its
   * short names from its own month (`formAliasByMonthCteSql`). So the rows of
   * a year are the rows of its months added up (`mergeBitrixRows`), which is
   * what lets `RoistatService` read the closed months from the sync worker's
   * store. A window inside one month runs the statement it always ran.
   *
   * `statementTimeoutMs` — the sync worker's own bound (SET LOCAL, one
   * transaction); a screen's read runs under the pool's.
   */
  async bitrix(
    period: Period,
    now: Date,
    shape: 'all' | 'days' | 'total' = 'all',
    brandKeys = false,
    statementTimeoutMs?: number,
  ): Promise<RoistatBitrixRow[]> {
    /*
      The form (leadFormSql.ts — a repeat lead's from its SOURCE_DESCRIPTION)
      is grouped by the full scan and read by the brand switch; «Kunlar
      boʻyicha» and the previous window's tiles group none and skip it.
    */
    const forms = shape === 'all' || brandKeys
    // Sales deals open after their lead; none can belong to the window once a month has passed.
    const scanEnd = new Date(Math.min(now.getTime(), period.end.getTime() + ORIGIN_LEAD_DAYS * 86_400_000))
    const pieces = monthPieces(period)
    // Short names learned per month — only where the window has more than one and the form is read at all.
    const bucketed = forms && pieces.length > 1
    const originDays = ORIGIN_LEAD_DAYS * 86_400_000
    const formAlias = !forms
      ? ''
      : bucketed
        ? formAliasByMonthCteSql(
            pieces.map((piece) => ({
              bucket: zonedMonthKey(piece.start, period.timeZone),
              from: new Date(piece.start.getTime() - originDays),
              to: new Date(piece.end.getTime() + originDays),
            })),
            '$7',
            '$4',
          )
        : formAliasCteSql('$7', '$4')
    /* The month a row's lead day falls in — the bucket its short names were learned for. */
    const monthOf = (instant: string) => `to_char(${instant} AT TIME ZONE 'UTC' AT TIME ZONE $3, 'YYYY-MM')`
    const leadAliasJoin = bucketed
      ? `LEFT JOIN form_alias fa ON fa.bucket = ${monthOf('d."createdAtSource"')} AND fa.sd = ${sourceDescriptionSql('d')}`
      : formAliasJoinSql('d', 'fa')
    const saleAliasJoin = bucketed
      ? `LEFT JOIN form_alias ofa ON ofa.bucket = ${monthOf('COALESCE(o.created, sb."createdAtSource")')} AND ofa.sd = o.sd`
      : 'LEFT JOIN form_alias ofa ON ofa.sd = o.sd'
    const brandColumns = ['b_source', 'b_form', 'b_line', 'b_team', 'b_product']
    const setColumns: readonly (readonly string[])[] = shape === 'total'
      ? [[]]
      : shape === 'days'
        ? [[], ['day']]
        : [
            [],
            ['day'],
            // The source too: a lead no form opened is labelled by its channel (DM page, «Исход», …).
            ['form_title', 'targetolog', 'source_id'],
            ['source_id', 'source_name'],
            ['source_id', 'product_form', 'product_line'],
            ['region'],
            ['rop'],
            ['seller'],
            ['registrar'],
          ]
    const sets = setColumns
      .map((columns) => `(${[...columns, ...(brandKeys ? brandColumns : [])].join(', ')})`)
      .join(', ')
    /*
      GROUPING() may only name columns the GROUP BY groups, so a narrowed
      read answers every other flag as «rolled up» and every other key as
      null itself.
    */
    const keys = ['day', 'source_id', 'source_name', 'form_title', 'product_form', 'targetolog', 'product_line', 'region', 'rop', 'seller', 'registrar']
    const flags: readonly (readonly [string, string])[] = [
      ['g_day', 'day'],
      ['g_form', 'form_title'],
      ['g_targetolog', 'targetolog'],
      ['g_source', 'source_id'],
      ['g_source_name', 'source_name'],
      ['g_product', 'product_line'],
      ['g_region', 'region'],
      ['g_rop', 'rop'],
      ['g_seller', 'seller'],
      ['g_registrar', 'registrar'],
    ]
    const grouped = (column: string) => shape === 'all' || (shape === 'days' && column === 'day')
    const columns = [
      ...flags.map(([alias, column]) => `${grouped(column) ? `GROUPING(${column})::int` : '1'} AS ${alias},`),
      ...keys.map((key) => `${grouped(key) ? key : `NULL::text AS ${key}`},`),
      ...brandColumns.map((key) => `${brandKeys ? key : `NULL::text AS ${key}`},`),
    ].join('\n        ')

    const rows = await this.query<
      {
        g_day: number
        g_form: number
        g_targetolog: number
        g_source: number
        g_source_name: number
        g_product: number
        g_region: number
        g_rop: number
        g_seller: number
        g_registrar: number
        day: string | null
        source_id: string | null
        source_name: string | null
        form_title: string | null
        product_form: string | null
        targetolog: string | null
        product_line: string | null
        region: string | null
        rop: string | null
        seller: string | null
        registrar: string | null
        b_source: string | null
        b_form: string | null
        b_line: string | null
        b_team: string | null
        b_product: string | null
        leads: bigint
        clean: bigint
        kval: bigint
        orders: bigint
        ordered_minor: string | null
        sold: bigint
        sold_minor: string | null
        new_customers: bigint
        deal_days_sum: number | null
        deal_count: bigint
      }[]
    >(
      statementTimeoutMs,
      `
      WITH ${forms ? `${formAlias},` : ''}
      lead_rows AS (
        SELECT
          /*
            ::text, never a bare ::date — node-postgres builds a DATE at LOCAL
            midnight, which on a Tashkent machine is the day before.
          */
          (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
          s."externalId" AS source_id,
          s."name" AS source_name,
          ${forms ? dealFormTitleSql('d', 's', 'fa') : `CASE WHEN d."title" LIKE '%CRM-форм%' THEN d."title" END`} AS form_title,
          -- The «Товар» cut reads a lead's form (leadBrand); a sale's product_line is already its brand.
          ${forms ? dealFormTitleSql('d', 's', 'fa') : 'NULL::text'} AS product_form,
          NULLIF(btrim(d."targetolog"), '') AS targetolog,
          -- «Проект»: named, it is the lead's brand after its form's name, before its source (leadBrand).
          NULLIF(btrim(d."productLine"), '') AS product_line,
          NULL::text AS region,
          NULL::text AS rop,
          NULL::text AS seller,
          NULLIF(btrim(d."registrar"), '') AS registrar,
          1 AS lead,
          /*
            «Дубликат (лид)» only, as rnpRepository spells it: the case
            written out, because ~* on Cyrillic follows the database's
            ctype and under a C locale matches nothing.
          */
          CASE WHEN COALESCE(st."name", '') ~ '[Дд]убл[^(]*\\([[:space:]]*[Лл]ид' THEN 0 ELSE 1 END AS clean,
          CASE WHEN d."status" = 'WON' THEN 1 ELSE 0 END AS kval,
          0 AS ordered, 0::bigint AS ordered_minor,
          0 AS sold, 0::bigint AS sold_minor,
          0 AS new_customer,
          NULL::double precision AS deal_days,
          s."externalId" AS b_source,
          ${forms ? dealFormTitleSql('d', 's', 'fa') : 'NULL::text'} AS b_form,
          NULLIF(btrim(d."productLine"), '') AS b_line,
          NULL::text AS b_team,
          NULL::text AS b_product
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
        LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
        LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
        ${forms ? leadAliasJoin : ''}
        WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      ),
      /*
        MATERIALIZED: the sales deals are chosen first, so the per-deal
        product probe (pb) and the origin-lead probe run on them alone, never
        on the window's Регистрация deals the planner could otherwise reach
        before the pipeline filter.

        ORDERS ONLY (2026-10-27). A Квалификация deal adds 0 to every counter
        — ordered, sold, new_customer and deal_days all ask for CONFIRMATION
        or REVENUE — and a cut row with nothing in it is dropped
        (roistatService rows), so it only cost its probes.
      */
      sale_base AS MATERIALIZED (
        SELECT
          d."id", d."customerId", d."createdAtSource", d."closedAt", d."status"::text AS status,
          p."role"::text AS role, d."amountMinor", d."title", d."targetolog", d."productLine",
          d."region", d."operatorTeamSource", d."operatorNameSource", d."operatorEmployeeId", d."sourceId"
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" IN ('CONFIRMATION', 'REVENUE')
        WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $4
      ),
      /*
        THE WINDOW IS DECIDED BEFORE THE PER-SALE PROBES (2026-10-27). A sale
        belongs to the window its origin lead opened in, so sale_base reads a
        month past the window's end ($4) — for a past month twice the sales
        it keeps. Only the origin probe is needed to tell; the product,
        team, first-order and form probes then run on the kept sales alone.
        Before this, one full month timed out at 20 s on the one-core
        database (/analytics/sales-days, /roistat/overview).
      */
      sale_origin AS MATERIALIZED (
        SELECT
          sb.*,
          o.created AS o_created, o.source_id AS o_source_id, o.source_name AS o_source_name,
          o.title AS o_title, o.sd AS o_sd, o.targetolog AS o_targetolog, o.registrar AS o_registrar
        FROM sale_base sb
        /*
          The ORIGIN LEAD: this contact's Регистрация deal opened up to
          ${ORIGIN_LEAD_DAYS} days before the sales deal — a WON one first,
          since «Сделка успешна» is what opens the sales deal, then the latest.
        */
        LEFT JOIN LATERAL (
          SELECT
            l."createdAtSource" AS created,
            ls."externalId" AS source_id,
            ls."name" AS source_name,
            l."title" AS title,
            ${sourceDescriptionSql('l')} AS sd,
            NULLIF(btrim(l."targetolog"), '') AS targetolog,
            NULLIF(btrim(l."registrar"), '') AS registrar
          FROM "deal" l
          JOIN "pipeline" lp ON lp."id" = l."pipelineId" AND lp."role" = 'LEAD'
          LEFT JOIN "sales_source" ls ON ls."id" = l."sourceId"
          WHERE sb."customerId" IS NOT NULL
            AND l."customerId" = sb."customerId"
            AND l."createdAtSource" <= sb."createdAtSource"
            AND l."createdAtSource" > sb."createdAtSource" - interval '${ORIGIN_LEAD_DAYS} days'
          ORDER BY ${originLeadOrderSql('l')}
          LIMIT 1
        ) o ON true
        WHERE COALESCE(o.created, sb."createdAtSource") >= $1
          AND COALESCE(o.created, sb."createdAtSource") < $2
      ),
      sale_rows AS (
        SELECT
          (COALESCE(o.created, sb."createdAtSource") AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
          /*
            A SALE WITH AN ORIGIN LEAD TAKES THAT LEAD'S FIELDS, EMPTY OR NOT.
            Switched on whether the lead was found, never value by value: a
            lead with no source sits in «Manbasiz» in lead_rows, and a
            per-value fallback to the sales deal's own source would file its
            sale in another row — sales with no leads beside them, and a
            conversion that is not one. Only a sale with no lead at all reads
            its own deal.

            ITS «ТОВАР» IS ITS BRAND BY saleBrand's RULE — the brand switch's,
            so the «Товар» cut and the switch never disagree: the brand its
            origin lead's CRM form names (sfb, 2026-10-15), else what it was
            paid for (the client, 2026-10-06: the dominant line item's brand,
            pb, «Boshqa» when that product is neither brand's), else, with no
            line item, its team's (tm against $5 / $6, each brand's teams).
            The cut reads it as it stands (product_form is NULL here): the
            form title beside it, alias-recovered, could name another brand
            than sfb, which reads no alias, as every other screen's sale.
          */
          CASE WHEN o.created IS NOT NULL THEN o.source_id ELSE ss."externalId" END AS source_id,
          CASE WHEN o.created IS NOT NULL THEN o.source_name ELSE ss."name" END AS source_name,
          CASE
            WHEN o.created IS NOT NULL THEN ${forms ? leadFormTitleSql('o.title', 'o.sd', 'o.source_id', 'ofa.title') : `CASE WHEN o.title LIKE '%CRM-форм%' THEN o.title END`}
            WHEN sb."title" LIKE '%CRM-форм%' THEN sb."title"
          END AS form_title,
          NULL::text AS product_form,
          CASE WHEN o.created IS NOT NULL THEN o.targetolog ELSE NULLIF(btrim(sb."targetolog"), '') END AS targetolog,
          CASE
            WHEN sfb.brand IS NOT NULL THEN sfb.brand
            WHEN pb.brand = '-' THEN '${ROISTAT_NO_PRODUCT}'
            WHEN pb.brand IS NOT NULL THEN pb.brand
            WHEN tm.team = ANY($5::text[]) THEN 'Collagen'
            WHEN tm.team = ANY($6::text[]) THEN 'Zextra'
            ELSE '${ROISTAT_NO_PRODUCT}'
          END AS product_line,
          NULLIF(btrim(sb."region"), '') AS region,
          tm.team AS rop,
          COALESCE(e."fullName", NULLIF(btrim(sb."operatorNameSource"), '')) AS seller,
          o.registrar,
          0 AS lead, 0 AS clean, 0 AS kval,
          CASE WHEN sb.role IN ('CONFIRMATION', 'REVENUE') THEN 1 ELSE 0 END AS ordered,
          CASE WHEN sb.role IN ('CONFIRMATION', 'REVENUE') THEN sb."amountMinor" ELSE 0 END AS ordered_minor,
          CASE WHEN sb.role = 'REVENUE' AND sb.status = 'WON' THEN 1 ELSE 0 END AS sold,
          CASE WHEN sb.role = 'REVENUE' AND sb.status = 'WON' THEN sb."amountMinor" ELSE 0 END AS sold_minor,
          /*
            A NEW customer: this is their first paid order ever. Asked only of
            the sold deals, through the customerId index.
          */
          CASE
            WHEN sb.role = 'REVENUE' AND sb.status = 'WON' AND sb."customerId" IS NOT NULL
             AND sb."closedAt" IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM "deal" prior
               WHERE prior."customerId" = sb."customerId"
                 AND prior."id" <> sb."id"
                 AND prior."countsAsRevenue" AND prior."status" = 'WON'
                 AND prior."closedAt" < sb."closedAt"
             )
            THEN 1 ELSE 0
          END AS new_customer,
          CASE
            WHEN sb.role = 'REVENUE' AND sb.status = 'WON' AND o.created IS NOT NULL AND sb."closedAt" IS NOT NULL
            THEN GREATEST(EXTRACT(EPOCH FROM (sb."closedAt" - o.created)) / 86400.0, 0)::double precision
          END AS deal_days,
          NULL::text AS b_source,
          -- A sale's b_form is a BRAND, not a title: what its origin lead's form names (sfb), read first by saleBrand.
          sfb.brand AS b_form,
          NULL::text AS b_line,
          -- The rop column again: the team decides a sale with no form and no line item (rnpSheet saleBrand).
          tm.team AS b_team,
          pb.brand AS b_product
        FROM sale_origin sb
        LEFT JOIN LATERAL (SELECT ${InsightsRepository.dealProductBrandSql('sb')} AS brand) pb ON true
        LEFT JOIN "sales_source" ss ON ss."id" = sb."sourceId"
        LEFT JOIN "employee" e ON e."id" = sb."operatorEmployeeId"
        LEFT JOIN "department" dep ON dep."id" = e."departmentId"
        LEFT JOIN LATERAL (SELECT COALESCE(
            ${InsightsRepository.teamSql('sb."operatorTeamSource"', 'e."id"', 'dep."name"')},
            '${InsightsRepository.NO_ROP}'
          ) AS team) tm ON true
        -- The origin lead the probe in sale_origin found, under the names the columns above read.
        CROSS JOIN LATERAL (
          SELECT sb.o_created AS created, sb.o_source_id AS source_id, sb.o_source_name AS source_name,
            sb.o_title AS title, sb.o_sd AS sd, sb.o_targetolog AS targetolog, sb.o_registrar AS registrar
        ) o
        ${forms ? saleAliasJoin : ''}
        -- The brand the origin lead's form names — originFormBrandSql's reading, over the lead joined above.
        LEFT JOIN LATERAL (
          SELECT ${formBrandOfTitleSql(saleFormTitleSql('o.created IS NOT NULL', 'o.title', 'o.sd', 'sb."title"'))} AS brand
        ) sfb ON true
      ),
      base AS (
        SELECT * FROM lead_rows
        UNION ALL
        SELECT * FROM sale_rows
      )
      SELECT
        ${columns}
        sum(lead)::bigint AS leads,
        sum(clean)::bigint AS clean,
        sum(kval)::bigint AS kval,
        sum(ordered)::bigint AS orders,
        sum(ordered_minor)::text AS ordered_minor,
        sum(sold)::bigint AS sold,
        sum(sold_minor)::text AS sold_minor,
        sum(new_customer)::bigint AS new_customers,
        sum(deal_days) AS deal_days_sum,
        count(deal_days)::bigint AS deal_count
      FROM base
      GROUP BY GROUPING SETS (${sets})
      `,
      period.start,
      period.end,
      this.tz,
      scanEnd,
      brandTeams('Collagen'),
      brandTeams('Zextra'),
      // Origin leads open up to ORIGIN_LEAD_DAYS before the window; their forms' aliases are read that far back too.
      ...(forms ? [new Date(period.start.getTime() - ORIGIN_LEAD_DAYS * 86_400_000)] : []),
    )

    return rows.map((r) => {
      const grouped = (flag: number) => flag === 0
      const set: RoistatBitrixRow['set'] = grouped(r.g_day)
        ? 'day'
        : grouped(r.g_product)
          ? 'product'
          : grouped(r.g_form)
            ? 'form'
            : grouped(r.g_source)
              ? 'source'
              : grouped(r.g_region)
                ? 'region'
                : grouped(r.g_rop)
                  ? 'rop'
                  : grouped(r.g_seller)
                    ? 'seller'
                    : grouped(r.g_registrar)
                      ? 'registrar'
                      : 'total'
      return {
        set,
        day: r.day,
        sourceId: r.source_id,
        sourceName: r.source_name,
        // The «Товар» set groups a lead's form as product_form (a sale's is NULL there): the cut reads it as the form.
        formTitle: set === 'product' ? r.product_form : r.form_title,
        targetolog: r.targetolog,
        productLine: r.product_line,
        region: r.region,
        rop: r.rop,
        seller: r.seller,
        registrar: r.registrar,
        brandSource: r.b_source ?? null,
        brandForm: r.b_form ?? null,
        brandLine: r.b_line ?? null,
        brandTeam: r.b_team ?? null,
        brandProduct: r.b_product ?? null,
        leads: int(r.leads),
        clean: int(r.clean),
        kval: int(r.kval),
        orders: int(r.orders),
        orderedMinor: money(r.ordered_minor),
        sold: int(r.sold),
        soldMinor: money(r.sold_minor),
        newCustomers: int(r.new_customers),
        dealDaysSum: Number(r.deal_days_sum ?? 0),
        dealCount: int(r.deal_count),
      }
    })
  }

  /** One statement, under `statementTimeoutMs` (SET LOCAL, its own transaction) when given. */
  private async query<T>(statementTimeoutMs: number | undefined, sql: string, ...values: unknown[]): Promise<T> {
    if (!statementTimeoutMs || statementTimeoutMs <= this.poolStatementTimeoutMs) return this.prisma.$queryRawUnsafe<T>(sql, ...values)
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.trunc(statementTimeoutMs)}`)
        return tx.$queryRawUnsafe<T>(sql, ...values)
      },
      { maxWait: 20_000, timeout: statementTimeoutMs + 5_000 },
    )
  }

  /**
   * Meta's figures at one grain over a window of calendar days, inclusive —
   * from the ad-level table, summed up to the adset or campaign. `parent`
   * narrows adsets to one campaign, ads to one adset.
   *
   * Grouped by id; the name is the newest one imported (`max` of the pair
   * would pick a lexically later OLD name, so the latest row's name is taken).
   */
  async meta(grain: RoistatMetaGrain, from: string, to: string, parent: string | null): Promise<RoistatMetaRow[]> {
    const adset = grain !== 'camp'
    const ad = grain === 'ad'
    const keys = ['"accountId"', '"campaignId"', ...(adset ? ['"adsetId"'] : []), ...(ad ? ['"adId"'] : [])]
    const parentColumn = grain === 'adset' ? '"campaignId"' : grain === 'ad' ? '"adsetId"' : null
    const rows = await this.prisma.$queryRawUnsafe<
      {
        account_id: string
        account_name: string
        campaign_id: string
        campaign_name: string
        objective: string
        adset_id: string | null
        adset_name: string | null
        ad_id: string | null
        ad_name: string | null
        spend: string | null
        impressions: string | null
        reach: string | null
        clicks: string | null
        leads: bigint | null
      }[]
    >(
      `
      SELECT
        "accountId" AS account_id,
        (array_agg("accountName" ORDER BY "date" DESC))[1] AS account_name,
        "campaignId" AS campaign_id,
        (array_agg("campaignName" ORDER BY "date" DESC))[1] AS campaign_name,
        (array_agg("objective" ORDER BY "date" DESC))[1] AS objective,
        ${adset ? `"adsetId" AS adset_id, (array_agg("adsetName" ORDER BY "date" DESC))[1] AS adset_name,` : 'NULL::text AS adset_id, NULL::text AS adset_name,'}
        ${ad ? `"adId" AS ad_id, (array_agg("adName" ORDER BY "date" DESC))[1] AS ad_name,` : 'NULL::text AS ad_id, NULL::text AS ad_name,'}
        sum("spendMicroUsd")::text AS spend,
        sum("impressions")::text AS impressions,
        sum("reach")::text AS reach,
        sum("clicks")::text AS clicks,
        sum("leads")::bigint AS leads
      FROM "meta_ad_insight_daily"
      WHERE "date" >= $1::date AND "date" <= $2::date
        ${parentColumn ? `AND ($3::text IS NULL OR ${parentColumn} = $3::text)` : 'AND $3::text IS NULL'}
      GROUP BY ${keys.join(', ')}
      `,
      from,
      to,
      parentColumn ? parent : null,
    )
    return rows.map((r) => ({
      accountId: r.account_id,
      accountName: r.account_name,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      objective: r.objective,
      adsetId: r.adset_id,
      adsetName: r.adset_name,
      adId: r.ad_id,
      adName: r.ad_name,
      spendMicroUsd: money(r.spend),
      impressions: int(r.impressions),
      reach: int(r.reach),
      clicks: int(r.clicks),
      leads: int(r.leads),
    }))
  }

  /** The name a campaign or adset was last imported under, for the breadcrumb. */
  async metaName(kind: 'campaign' | 'adset', id: string): Promise<{ name: string; campaignId: string; campaignName: string } | null> {
    const column = kind === 'campaign' ? '"campaignId"' : '"adsetId"'
    const rows = await this.prisma.$queryRawUnsafe<
      { name: string; campaign_id: string; campaign_name: string }[]
    >(
      `
      SELECT ${kind === 'campaign' ? '"campaignName"' : '"adsetName"'} AS name,
             "campaignId" AS campaign_id, "campaignName" AS campaign_name
      FROM "meta_ad_insight_daily"
      WHERE ${column} = $1
      ORDER BY "date" DESC
      LIMIT 1
      `,
      id,
    )
    const row = rows[0]
    return row ? { name: row.name, campaignId: row.campaign_id, campaignName: row.campaign_name } : null
  }

  /** When the ad grain was last read; null means never. */
  async metaImportedAt(): Promise<Date | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ at: Date | null }[]>(
      `SELECT max("importedAt") AS at FROM "meta_ad_insight_daily"`,
    )
    return rows[0]?.at ?? null
  }
}
