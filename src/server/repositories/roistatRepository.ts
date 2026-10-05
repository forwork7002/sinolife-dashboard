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
import type { Period } from '@/server/domain/period/period'

import { InsightsRepository } from './insightsRepository'

/** How far after the window a sales deal may open and still be the window's lead's. */
const ORIGIN_LEAD_DAYS = 30

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

function money(value: string | null | undefined): bigint {
  return value === null || value === undefined ? 0n : BigInt(value)
}

function int(value: unknown): number {
  return Number(value ?? 0)
}

export class RoistatRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  /**
   * Every Bitrix24 counter on the screen, from ONE scan — the tiles, the nine
   * Bitrix cuts and the chart's revenue are groupings of the same rows read
   * at the same instant, so each cut's ИТОГО is the tiles' figure.
   *
   * `totalOnly` reads the () set alone: the previous window's tiles.
   */
  async bitrix(period: Period, now: Date, totalOnly = false): Promise<RoistatBitrixRow[]> {
    // Sales deals open after their lead; none can belong to the window once a month has passed.
    const scanEnd = new Date(Math.min(now.getTime(), period.end.getTime() + ORIGIN_LEAD_DAYS * 86_400_000))
    const sets = totalOnly
      ? '()'
      : `(),
        (day),
        (form_title, targetolog),
        (source_id, source_name),
        (source_id, form_title, product_line),
        (region),
        (rop),
        (seller),
        (registrar)`
    /*
      GROUPING() may only name columns the GROUP BY groups, so the totals-only
      read answers every flag as «rolled up» and every key as null itself.
    */
    const keys = ['day', 'source_id', 'source_name', 'form_title', 'targetolog', 'product_line', 'region', 'rop', 'seller', 'registrar']
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
    const columns = [
      ...flags.map(([alias, column]) => `${totalOnly ? '1' : `GROUPING(${column})::int`} AS ${alias},`),
      ...keys.map((key) => `${totalOnly ? `NULL::text AS ${key}` : key},`),
    ].join('\n        ')

    const rows = await this.prisma.$queryRawUnsafe<
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
        targetolog: string | null
        product_line: string | null
        region: string | null
        rop: string | null
        seller: string | null
        registrar: string | null
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
      `
      WITH lead_rows AS (
        SELECT
          /*
            ::text, never a bare ::date — node-postgres builds a DATE at LOCAL
            midnight, which on a Tashkent machine is the day before.
          */
          (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
          s."externalId" AS source_id,
          s."name" AS source_name,
          CASE WHEN d."title" LIKE '%CRM-форм%' THEN d."title" END AS form_title,
          NULLIF(btrim(d."targetolog"), '') AS targetolog,
          NULL::text AS product_line,
          NULL::text AS region,
          NULL::text AS rop,
          NULL::text AS seller,
          NULLIF(btrim(d."registrar"), '') AS registrar,
          1 AS lead,
          /*
            «Дубликат (лид)» only — isLeadDuplicate's rule, as rnpRepository
            spells it: the case written out, because ~* on Cyrillic follows the
            database's ctype and under a C locale matches nothing.
          */
          CASE WHEN COALESCE(st."name", '') ~ '[Дд]убл[^(]*\\([[:space:]]*[Лл]ид' THEN 0 ELSE 1 END AS clean,
          CASE WHEN d."status" = 'WON' THEN 1 ELSE 0 END AS kval,
          0 AS ordered, 0::bigint AS ordered_minor,
          0 AS sold, 0::bigint AS sold_minor,
          0 AS new_customer,
          NULL::double precision AS deal_days
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
        LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
        LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
        WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      ),
      sale_base AS (
        SELECT
          d."id", d."customerId", d."createdAtSource", d."closedAt", d."status"::text AS status,
          p."role"::text AS role, d."amountMinor", d."title", d."targetolog", d."productLine",
          d."region", d."operatorTeamSource", d."operatorNameSource", d."operatorEmployeeId", d."sourceId"
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" IN ('QUALIFICATION', 'CONFIRMATION', 'REVENUE')
        WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $4
      ),
      sale_rows AS (
        SELECT
          (COALESCE(o.created, sb."createdAtSource") AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
          /*
            A SALE WITH AN ORIGIN LEAD TAKES THAT LEAD'S FIELDS, EMPTY OR NOT.
            Switched on whether the lead was found, never value by value: a
            lead with no source sits in «не указано» in lead_rows, and a
            per-value fallback to the sales deal's own source would file its
            sale in another row — sales with no leads beside them, and a
            conversion that is not one. Only a sale with no lead at all reads
            its own deal; its «Товар» likewise, so a Collagen-named product
            line cannot pull a «Boshqa» lead's sale into Collagen.
          */
          CASE WHEN o.created IS NOT NULL THEN o.source_id ELSE ss."externalId" END AS source_id,
          CASE WHEN o.created IS NOT NULL THEN o.source_name ELSE ss."name" END AS source_name,
          CASE
            WHEN o.created IS NOT NULL THEN o.form_title
            WHEN sb."title" LIKE '%CRM-форм%' THEN sb."title"
          END AS form_title,
          CASE WHEN o.created IS NOT NULL THEN o.targetolog ELSE NULLIF(btrim(sb."targetolog"), '') END AS targetolog,
          CASE WHEN o.created IS NULL THEN NULLIF(btrim(sb."productLine"), '') END AS product_line,
          NULLIF(btrim(sb."region"), '') AS region,
          COALESCE(
            ${InsightsRepository.ropNameSql('sb."operatorTeamSource"')},
            ${InsightsRepository.ropNameSql('dep."name"')},
            '${InsightsRepository.NO_ROP}'
          ) AS rop,
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
          END AS deal_days
        FROM sale_base sb
        LEFT JOIN "sales_source" ss ON ss."id" = sb."sourceId"
        LEFT JOIN "employee" e ON e."id" = sb."operatorEmployeeId"
        LEFT JOIN "department" dep ON dep."id" = e."departmentId"
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
            CASE WHEN l."title" LIKE '%CRM-форм%' THEN l."title" END AS form_title,
            NULLIF(btrim(l."targetolog"), '') AS targetolog,
            NULLIF(btrim(l."registrar"), '') AS registrar
          FROM "deal" l
          JOIN "pipeline" lp ON lp."id" = l."pipelineId" AND lp."role" = 'LEAD'
          LEFT JOIN "sales_source" ls ON ls."id" = l."sourceId"
          WHERE sb."customerId" IS NOT NULL
            AND l."customerId" = sb."customerId"
            AND l."createdAtSource" <= sb."createdAtSource"
            AND l."createdAtSource" > sb."createdAtSource" - interval '${ORIGIN_LEAD_DAYS} days'
          ORDER BY (l."status" = 'WON') DESC, l."createdAtSource" DESC
          LIMIT 1
        ) o ON true
        WHERE COALESCE(o.created, sb."createdAtSource") >= $1
          AND COALESCE(o.created, sb."createdAtSource") < $2
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
        formTitle: r.form_title,
        targetolog: r.targetolog,
        productLine: r.product_line,
        region: r.region,
        rop: r.rop,
        seller: r.seller,
        registrar: r.registrar,
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
