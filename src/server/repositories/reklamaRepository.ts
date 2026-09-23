/**
 * «Reklama samarasi» — the two ledgers the client's ad sheets are typed from.
 *
 *   Bitrix24 — Регистрация leads (pipeline role LEAD) from the target pages,
 *              counted per day × page × stage. Dated by creation, in the app
 *              timezone, as «Target tahlili» dates them.
 *   Meta     — campaign × day rows from `meta_campaign_daily`, which say which
 *              sheet each dollar belongs on (see `campaignChannel`).
 *
 * The two are never joined: a Meta row has no Bitrix24 id and a lead has no
 * campaign. They meet only on the calendar day and the page, in the service.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import type { Period } from '@/server/domain/period/period'

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
   */
  async leadStageDays(period: Period, sourceIds: readonly string[]): Promise<LeadStageDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        day: string
        source_id: string
        source: string
        stage: string
        status: string
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
        count(*)::bigint AS leads
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      JOIN "deal_stage" st ON st."id" = d."stageId"
      JOIN "sales_source" s ON s."id" = d."sourceId"
      WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
        AND s."externalId" = ANY($4::text[])
      GROUP BY 1, 2, 3, 4, 5
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

  /** When the campaign grain was last read; null means never. */
  async campaignsImportedAt(): Promise<Date | null> {
    const latest = await this.prisma.metaCampaignDaily.aggregate({ _max: { importedAt: true } })
    return latest._max.importedAt
  }
}
