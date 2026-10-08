/**
 * «Reklama samarasi» — the two ledgers the client's ad sheets are typed from.
 *
 *   Bitrix24 — Регистрация leads (pipeline role LEAD) from the target pages,
 *              counted per day × page × stage. Dated by creation, in the app
 *              timezone, as «Target tahlili» dates them.
 *   Meta     — campaign × day rows from `meta_campaign_daily`, which say which
 *              sheet each dollar belongs on (see `campaignChannel`).
 *
 * The spend rows are never joined: a Meta row has no Bitrix24 id and a lead
 * has no campaign. They meet only on the calendar day and the page, in the
 * service — except `campaignLeads`, where Meta's own lead meets its deal on
 * the phone.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import type { Period } from '@/server/domain/period/period'
import { leadBucket } from '@/server/domain/reklama/leadQuality'
import type { ManualSpendChannel, ManualSpendRow } from '@/server/domain/reklama/manualSpend'
import type { TargetProduct } from '@/server/domain/types'

/** Leads created on one day, on one page, sitting in one stage now. */
export interface LeadStageDayRow {
  /** `YYYY-MM-DD` in the app timezone. */
  readonly day: string
  /** Portal SOURCE_ID. */
  readonly sourceId: string
  readonly source: string
  readonly stage: string
  /** DealStatus: OPEN, WON or LOST. */
  readonly status: string
  /** «Проект» (`productLine`) — named, it decides the brand before the page (`leadBrand`). */
  readonly productLine: string | null
  readonly leads: number
}

/** One Meta campaign's day. */
export interface CampaignDayRow {
  readonly date: string
  readonly accountId: string
  readonly accountName: string
  readonly campaignId: string
  readonly campaignName: string
  readonly objective: string
  readonly spendMicroUsd: bigint
  readonly impressions: number
  readonly clicks: number
  readonly leads: number
  readonly conversations: number
}

/** One Meta campaign's lead-form leads of the window, met with the portal by phone. */
export interface CampaignLeadRow {
  readonly campaignId: string
  /** Meta leads read into `meta_lead` — below Meta's own count when a form's page is closed to the token. */
  readonly leads: number
  /** Those found as a Регистрация deal. */
  readonly matched: number
  /** Those whose deal is «Сделка успешна» (WON) — the kval. */
  readonly qualified: number
  /**
   * The matched deals by what became of them (`leadBucket`, the stage each
   * sits in now) — «Barcha manbalar»'s columns. With `qualified` they sum to
   * `matched`.
   */
  readonly noAnswer: number
  readonly lowQuality: number
  readonly duplicate: number
  readonly open: number
}

/**
 * How long a write may wait for a pooled connection — RNP's typed cells wait
 * the same (rnpRepository.ts): the pool runs full under the scans, and
 * Prisma's default 2 s would fail a save with a 500.
 */
const CONNECTION_WAIT_MS = 20_000

export class ReklamaRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  /**
   * Регистрация leads per day × page × stage, from ONE grouped scan.
   *
   * Only the pages named: a lead with no source is not a page an ad points
   * at. База, Первичный отдел and the rest are not leads and are not read.
   * Grouped by «Проект» too, so the brand switch can file a lead by it.
   */
  async leadStageDays(period: Period, sourceIds: readonly string[]): Promise<LeadStageDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        day: string
        source_id: string
        source: string
        stage: string
        status: string
        product_line: string | null
        leads: bigint
      }[]
    >(
      `
      SELECT
        /*
          ::text, never a bare ::date — node-postgres builds a DATE at LOCAL
          midnight, which on a Tashkent machine is the day before.
        */
        (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
        s."externalId" AS source_id,
        s."name" AS source,
        st."name" AS stage,
        d."status"::text AS status,
        NULLIF(btrim(d."productLine"), '') AS product_line,
        count(*)::bigint AS leads
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      JOIN "deal_stage" st ON st."id" = d."stageId"
      JOIN "sales_source" s ON s."id" = d."sourceId"
      WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
        AND s."externalId" = ANY($4::text[])
      GROUP BY 1, 2, 3, 4, 5, 6
      `,
      period.start,
      period.end,
      this.tz,
      [...sourceIds],
    )
    return rows.map((r) => ({
      day: r.day,
      sourceId: r.source_id,
      source: r.source,
      stage: r.stage,
      status: r.status,
      productLine: r.product_line,
      leads: Number(r.leads),
    }))
  }

  /** The pages as the portal names them today: id → name. */
  async sources(sourceIds: readonly string[]): Promise<{ externalId: string; name: string }[]> {
    const rows = await this.prisma.salesSource.findMany({
      where: { externalId: { in: [...sourceIds] } },
      select: { externalId: true, name: true },
    })
    return rows.map((r) => ({ externalId: r.externalId!, name: r.name }))
  }

  /**
   * Meta campaign-days over a window of calendar days, inclusive.
   *
   * Bare dates on both sides — the account's reporting day is never an
   * instant — so the window is the period's first and last Tashkent day.
   */
  async campaignDays(from: string, to: string): Promise<CampaignDayRow[]> {
    const rows = await this.prisma.metaCampaignDaily.findMany({
      where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      select: {
        date: true,
        accountId: true,
        accountName: true,
        campaignId: true,
        campaignName: true,
        objective: true,
        spendMicroUsd: true,
        impressions: true,
        clicks: true,
        leads: true,
        conversations: true,
      },
      orderBy: { date: 'asc' },
    })
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      accountId: r.accountId,
      accountName: r.accountName,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      objective: r.objective,
      spendMicroUsd: r.spendMicroUsd,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      leads: r.leads,
      conversations: r.conversations,
    }))
  }

  /**
   * Each campaign's Meta leads filed in the period, and how many of them are a
   * kval on the portal — the one place a Meta row and a Bitrix24 row DO meet.
   *
   * A deal names no campaign, so the two meet on the PHONE: the lead's
   * numbers (`meta_lead.phoneKeys`, last nine digits) against every number of
   * the deal's contact. A lead takes the Регистрация deal of that phone opened
   * nearest to it, from ten minutes before (the clocks) to two days after (the
   * portal's robot files a returning contact's form late). The nearest, not
   * «a WON one if any»: a person who filled two campaigns' forms has two
   * deals, and each campaign is judged by its own. And a deal is one lead's:
 * when the portal filed one deal for two forms, the nearer lead has it.
   *
   * Dated by the lead's own time, so the window is the spend's window. Only
   * the Регистрация deals around the window are read, never every contact.
   */
  async campaignLeads(period: Period): Promise<CampaignLeadRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { campaign_id: string; stage: string | null; status: string | null; leads: bigint }[]
    >(
      `
      WITH ml AS (
        SELECT m."id", m."campaignId", m."createdTime", m."phoneKeys"
        FROM "meta_lead" m
        WHERE m."createdTime" >= $1 AND m."createdTime" < $2 AND m."campaignId" <> ''
      ),
      mk AS (
        SELECT ml."id", ml."createdTime", unnest(ml."phoneKeys") AS key FROM ml
      ),
      dk AS MATERIALIZED (
        SELECT DISTINCT d."id", d."createdAtSource" AS created, d."status"::text AS status,
               COALESCE(ds."name", '') AS stage, k.key
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
        LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"
        JOIN "customer" c ON c."id" = d."customerId"
        CROSS JOIN LATERAL (
          SELECT right(regexp_replace(ph, '[^0-9]', '', 'g'), 9) AS key
          FROM unnest(c."phones" || ARRAY[c."phone"]) AS ph
          WHERE length(regexp_replace(ph, '[^0-9]', '', 'g')) >= 9
            -- 000000000, 999999999: a placeholder the floor types, never a person.
            AND right(regexp_replace(ph, '[^0-9]', '', 'g'), 9) !~ '^([0-9])\\1{8}$'
        ) k
        WHERE d."createdAtSource" >= $1::timestamp - interval '10 minutes'
          AND d."createdAtSource" < $2::timestamp + interval '2 days'
      ),
      nearest AS (
        SELECT DISTINCT ON (mk."id") mk."id", dk."id" AS deal_id, dk.status, dk.stage,
               abs(extract(epoch FROM dk.created - mk."createdTime")) AS apart
        FROM mk
        JOIN dk ON dk.key = mk.key
          AND dk.created >= mk."createdTime" - interval '10 minutes'
          AND dk.created < mk."createdTime" + interval '2 days'
        ORDER BY mk."id", abs(extract(epoch FROM dk.created - mk."createdTime")), dk."id"
      ),
      -- ONE DEAL, ONE LEAD: two forms filled within the reach of one deal (the portal filed one)
      -- would make its kval both campaigns'. The nearer lead keeps it; the other found no deal.
      hit AS (
        SELECT DISTINCT ON (n.deal_id) n."id", n.status, n.stage
        FROM nearest n
        ORDER BY n.deal_id, n.apart, n."id"
      )
      -- One row per campaign and outcome; a lead with no deal has neither stage nor status.
      SELECT
        ml."campaignId" AS campaign_id,
        hit.stage,
        hit.status,
        count(*)::bigint AS leads
      FROM ml
      LEFT JOIN hit ON hit."id" = ml."id"
      GROUP BY 1, 2, 3
      `,
      period.start,
      period.end,
    )
    const out = new Map<string, { -readonly [K in keyof CampaignLeadRow]: CampaignLeadRow[K] }>()
    for (const r of rows) {
      const row =
        out.get(r.campaign_id) ??
        out
          .set(r.campaign_id, { campaignId: r.campaign_id, leads: 0, matched: 0, qualified: 0, noAnswer: 0, lowQuality: 0, duplicate: 0, open: 0 })
          .get(r.campaign_id)!
      const n = Number(r.leads)
      row.leads += n
      if (r.status === null) continue
      row.matched += n
      const bucket = leadBucket(r.stage ?? '', r.status)
      row[bucket === 'success' ? 'qualified' : bucket] += n
    }
    return [...out.values()]
  }

  /** When the campaign grain was last read; null means never. */
  async campaignsImportedAt(): Promise<Date | null> {
    const latest = await this.prisma.metaCampaignDaily.aggregate({ _max: { importedAt: true } })
    return latest._max.importedAt
  }

  /** The hand-typed ad money of the window (`reklama_manual_spend`); `from` / `to` are inclusive `YYYY-MM-DD`. */
  async manualSpend(from: string, to: string): Promise<ManualSpendRow[]> {
    const rows = await this.prisma.reklamaManualSpend.findMany({
      where: { day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      select: { day: true, project: true, channel: true, amountCents: true },
    })
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      project: r.project as TargetProduct,
      channel: r.channel as ManualSpendChannel,
      amountCents: r.amountCents,
    }))
  }

  /** Write typed cells: cents set the day's money, null clears it. One transaction. */
  async saveManualSpend(
    cells: readonly { day: string; project: TargetProduct; channel: ManualSpendChannel; cents: number | null }[],
    by: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      cells.map((c) => {
        const day = new Date(`${c.day}T00:00:00Z`)
        return c.cents === null
          ? this.prisma.reklamaManualSpend.deleteMany({ where: { day, project: c.project, channel: c.channel } })
          : this.prisma.reklamaManualSpend.upsert({
              where: { day_project_channel: { day, project: c.project, channel: c.channel } },
              create: { day, project: c.project, channel: c.channel, amountCents: c.cents, updatedBy: by },
              update: { amountCents: c.cents, updatedBy: by },
            })
      }),
      { maxWait: CONNECTION_WAIT_MS },
    )
  }
}
