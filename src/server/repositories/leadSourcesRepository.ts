import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import type { Period } from '@/server/domain/period/period'

/**
 * Регистрация deals created on one day, from one source, sitting in one stage
 * now — with the CRM form's title when a form opened the deal.
 */
export interface RegistrationDayRow {
  /** `YYYY-MM-DD` in the app timezone. */
  readonly day: string
  /** Portal SOURCE_ID, or null for a deal with no source. */
  readonly sourceId: string | null
  readonly source: string | null
  /**
   * The deal's title when it names a CRM form, else null. The form's NAME is
   * the domain's to read (`formNameOf`) — one regex, one home.
   */
  readonly formTitle: string | null
  readonly stage: string
  /** DealStatus: OPEN, WON or LOST. */
  readonly status: string
  /** The AI qualified it out of the DMs («ИИ квал сана» is filled). */
  readonly aiQualified: boolean
  readonly leads: number
}

/** Регистрация deals WON in a window, by source and the AI's mark. */
export interface QualifiedSourceRow {
  readonly sourceId: string | null
  readonly aiQualified: boolean
  readonly qualified: number
}

/** Deals the AI qualified in a window, in any pipeline, by the stage each sits in now. */
export interface AiQualifiedStageRow {
  /** In Регистрация (pipeline role LEAD); the rest have moved on to Первичный отдел, Доставка, … */
  readonly registration: boolean
  readonly stage: string
  /** DealStatus: OPEN, WON or LOST. */
  readonly status: string
  readonly leads: number
}

/** The «Сарафан» tile's deals: one pipeline, its word-of-mouth sources. */
export interface PipelineSourceCount {
  /** Created in the window. */
  readonly leads: number
  /** WON in the window, by `closedAt`. */
  readonly qualified: number
}

/** «ИИ обработка» deals — one per Instagram conversation — per day per page. */
export interface TriageDayRow {
  readonly day: string
  readonly sourceId: string | null
  readonly source: string | null
  readonly conversations: number
}

/**
 * «Lid manbalari» — two grouped scans over one creation window, and the
 * window's kval by the day it was WON (`qualifiedSources`).
 *
 * Pipelines by ROLE here, unlike «Lid kogortasi»: the question is «every lead
 * the portal registered», and LEAD / AI_TRIAGE are exactly Регистрация and
 * ИИ обработка (`PIPELINE_ROLE_BY_ID`). Both scans ride the
 * `createdAtSource` index and group before anything leaves the database —
 * a week is ~5 700 + ~4 700 deals, a few hundred rows on the wire.
 */
export class LeadSourcesRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  async registrationDays(period: Period): Promise<RegistrationDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        day: string
        source_id: string | null
        source: string | null
        form_title: string | null
        stage: string | null
        status: string
        ai_qualified: boolean
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
        /*
          The whole title, and only for a form: every deal one form opened
          carries the same title, so this groups to a handful of rows, while
          the other deals' titles (a name, a phone number) would not group at
          all.
        */
        CASE WHEN d."title" LIKE '%CRM-форм%' THEN d."title" END AS form_title,
        st."name" AS stage,
        d."status"::text AS status,
        (d."aiQualifiedAt" IS NOT NULL) AS ai_qualified,
        count(*)::bigint AS leads
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
      LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
      WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      `,
      period.start,
      period.end,
      this.tz,
    )
    return rows.map((r) => ({
      day: r.day,
      sourceId: r.source_id,
      source: r.source,
      formTitle: r.form_title,
      stage: r.stage ?? '—',
      status: r.status,
      aiQualified: r.ai_qualified,
      leads: Number(r.leads),
    }))
  }

  /**
   * Регистрация leads a registrar qualified («Сделка успешна») in the window —
   * by the day the deal was WON (`closedAt`), not the day it arrived. The RNP
   * sheet's «Регистрация» kval is the same count (`registrationDaysSql`'s
   * second arm), and it is the portal's own CLOSEDATE filter. Grouped by the
   * source and the AI's mark, so the channel tiles split the same count.
   */
  async qualifiedSources(period: Period): Promise<QualifiedSourceRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ source_id: string | null; ai_qualified: boolean; qualified: bigint }[]>(
      `
      SELECT
        s."externalId" AS source_id,
        (d."aiQualifiedAt" IS NOT NULL) AS ai_qualified,
        count(*)::bigint AS qualified
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
      WHERE d."status" = 'WON' AND d."closedAt" >= $1 AND d."closedAt" < $2
      GROUP BY 1, 2
      `,
      period.start,
      period.end,
    )
    return rows.map((r) => ({ sourceId: r.source_id, aiQualified: r.ai_qualified, qualified: Number(r.qualified) }))
  }

  /**
   * Deals of one pipeline on the given sources: created in the window, and
   * WON in it by `closedAt` — the «Сарафан» tile, which the client asked on
   * 2026-10-05 to count in Ecommerce alone. The window bounds both arms, so
   * the scan rides the `createdAtSource` and `closedAt` predicates together.
   */
  async pipelineSourceCount(period: Period, pipelineExternalId: string, sourceIds: readonly string[]): Promise<PipelineSourceCount> {
    const [row] = await this.prisma.$queryRawUnsafe<{ leads: bigint; qualified: bigint }[]>(
      `
      SELECT
        count(*) FILTER (WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2)::bigint AS leads,
        count(*) FILTER (WHERE d."status" = 'WON' AND d."closedAt" >= $1 AND d."closedAt" < $2)::bigint AS qualified
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."externalId" = $3
      JOIN "sales_source" s ON s."id" = d."sourceId" AND s."externalId" = ANY($4::text[])
      WHERE (d."createdAtSource" >= $1 AND d."createdAtSource" < $2)
         OR (d."status" = 'WON' AND d."closedAt" >= $1 AND d."closedAt" < $2)
      `,
      period.start,
      period.end,
      pipelineExternalId,
      [...sourceIds],
    )
    return { leads: Number(row?.leads ?? 0), qualified: Number(row?.qualified ?? 0) }
  }

  /**
   * Every deal whose «ИИ квал сана» falls in the window, whatever its pipeline
   * or creation day — the portal's own filter on that field (01.10.2026: 89 =
   * 72 Регистрация + 13 Первичный отдел + 4 Доставка), flagged by whether it
   * is in Регистрация. No index on the column: a sequential scan of `deal`,
   * behind the overview's 60-second memo.
   */
  async aiQualifiedStages(period: Period): Promise<AiQualifiedStageRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { registration: boolean; stage: string | null; status: string; leads: bigint }[]
    >(
      `
      SELECT COALESCE(p."role" = 'LEAD', false) AS registration, st."name" AS stage, d."status"::text AS status, count(*)::bigint AS leads
      FROM "deal" d
      LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
      LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
      WHERE d."aiQualifiedAt" >= $1 AND d."aiQualifiedAt" < $2
      GROUP BY 1, 2, 3
      `,
      period.start,
      period.end,
    )
    return rows.map((r) => ({
      registration: r.registration,
      stage: r.stage ?? '—',
      status: r.status,
      leads: Number(r.leads),
    }))
  }

  async triageDays(period: Period): Promise<TriageDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { day: string; source_id: string | null; source: string | null; conversations: bigint }[]
    >(
      `
      SELECT
        (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
        s."externalId" AS source_id,
        s."name" AS source,
        count(*)::bigint AS conversations
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'AI_TRIAGE'
      LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
      WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY 1, 2, 3
      `,
      period.start,
      period.end,
      this.tz,
    )
    return rows.map((r) => ({
      day: r.day,
      sourceId: r.source_id,
      source: r.source,
      conversations: Number(r.conversations),
    }))
  }
}
