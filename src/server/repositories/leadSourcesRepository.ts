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
  readonly leads: number
}

/** «ИИ обработка» deals — one per Instagram conversation — per day per page. */
export interface TriageDayRow {
  readonly day: string
  readonly sourceId: string | null
  readonly source: string | null
  readonly conversations: number
}

/**
 * «Lid manbalari» — two grouped scans over one creation window.
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
        count(*)::bigint AS leads
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
      LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
      WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY 1, 2, 3, 4, 5, 6
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
