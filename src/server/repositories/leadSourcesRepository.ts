import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import { CALL_DATA_FLOOR, callWindowStart } from '@/lib/callQuality'
import type { Period } from '@/server/domain/period/period'

import { dealFormTitleSql, formAliasCteSql, formAliasJoinSql, formAliasOverSql, leadFormTitleSql, replayActSql, replayedCteSql, sourceDescriptionSql } from './leadFormSql'

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
  /** «Проект» (`productLine`) — named, it decides the brand before source and form (`leadBrand`). */
  readonly productLine: string | null
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
  /** The deal's title when it names a CRM form — what the Collagen / Zextra switch reads after the source. */
  readonly formTitle: string | null
  /** «Проект» (`productLine`) — named, it decides the brand before source and form (`leadBrand`). */
  readonly productLine: string | null
  readonly aiQualified: boolean
  readonly qualified: number
}

/** Deals the AI qualified in a window, in any pipeline, by the stage each sits in now. */
export interface AiQualifiedStageRow {
  /** In Регистрация (pipeline role LEAD); the rest have moved on to Первичный отдел, Доставка, … */
  readonly registration: boolean
  /** Source and CRM-form title — for the Collagen / Zextra switch (`leadBrand`). */
  readonly sourceId: string | null
  readonly formTitle: string | null
  /** «Проект» (`productLine`) — named, it decides the brand before source and form (`leadBrand`). */
  readonly productLine: string | null
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
        product_line: string | null
        stage: string | null
        status: string
        ai_qualified: boolean
        leads: bigint
      }[]
    >(
      `
      /*
        ONE READ OF THE WINDOW'S DEALS (\`reg\`, MATERIALIZED): the form aliases
        come from the rows this scan counts, so a repeat lead's form costs no
        second pass over the window (as RNP's \`registrationDaysSql\`).
      */
      WITH reg AS MATERIALIZED (
        SELECT d."id" AS id, d."createdAtSource" AS created, d."title" AS title, ${sourceDescriptionSql('d')} AS sd,
               ${replayActSql(sourceDescriptionSql('d'))} AS act,
               d."sourceId", d."stageId", d."status", d."aiQualifiedAt", NULLIF(btrim(d."productLine"), '') AS product_line
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
        WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      ),
      ${formAliasOverSql('(SELECT r.sd, r.title FROM reg r) fd')},
      /*
        A late «Qayta zayavka» copy — a form filled days before the portal's
        robot opened its deal — is no lead of the day it was opened (05.10:
        1 071 of them). The same rule as «RNP jadvali» (\`replayedCteSql\`).
      */
      ${replayedCteSql('(SELECT r.id, r.created, r.act FROM reg r) q0', '$1')}
      SELECT
        /*
          ::text, never a bare ::date — node-postgres builds a DATE at LOCAL
          midnight, which on a Tashkent machine is the day before.
        */
        (r.created AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
        s."externalId" AS source_id,
        s."name" AS source,
        /*
          The whole title, and only for a form: every deal one form opened
          carries the same title, so this groups to a handful of rows, while
          the other deals' titles (a name, a phone number) would not group at
          all. A repeat lead's form comes from its SOURCE_DESCRIPTION
          (leadFormSql.ts).
        */
        ${leadFormTitleSql('r.title', 'r.sd', 's."externalId"', 'fa.title')} AS form_title,
        r.product_line,
        st."name" AS stage,
        r."status"::text AS status,
        (r."aiQualifiedAt" IS NOT NULL) AS ai_qualified,
        count(*)::bigint AS leads
      FROM reg r
      LEFT JOIN "deal_stage" st ON st."id" = r."stageId"
      LEFT JOIN "sales_source" s ON s."id" = r."sourceId"
      LEFT JOIN form_alias fa ON fa.sd = r.sd
      WHERE NOT EXISTS (SELECT 1 FROM replayed rp WHERE rp.id = r.id)
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
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
      productLine: r.product_line,
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
   * source and the AI's mark, so the channel tiles split the same count,
   * and by the form title, so the Collagen / Zextra switch can read a form
   * kval's brand (its source is «Ген лид», which names none).
   */
  async qualifiedSources(period: Period): Promise<QualifiedSourceRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { source_id: string | null; form_title: string | null; product_line: string | null; ai_qualified: boolean; qualified: bigint }[]
    >(
      `
      WITH ${formAliasCteSql('$1', '$2')}
      SELECT
        s."externalId" AS source_id,
        ${dealFormTitleSql('d', 's', 'fa')} AS form_title,
        NULLIF(btrim(d."productLine"), '') AS product_line,
        (d."aiQualifiedAt" IS NOT NULL) AS ai_qualified,
        count(*)::bigint AS qualified
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
      ${formAliasJoinSql('d', 'fa')}
      WHERE d."status" = 'WON' AND d."closedAt" >= $1 AND d."closedAt" < $2
      GROUP BY 1, 2, 3, 4
      `,
      period.start,
      period.end,
    )
    return rows.map((r) => ({
      sourceId: r.source_id,
      formTitle: r.form_title,
      productLine: r.product_line,
      aiQualified: r.ai_qualified,
      qualified: Number(r.qualified),
    }))
  }

  /**
   * Inbound calls in the window — «Входящий»'s second line, the same count
   * «Qoʻngʻiroqlar» → «Kiruvchi qoʻngʻiroqlar» prints. Null for a window that
   * ends before `CALL_DATA_FLOOR`: call data is wrong there, not zero.
   */
  async inboundCallCount(period: Period): Promise<number | null> {
    if (period.end <= CALL_DATA_FLOOR) return null
    const [row] = await this.prisma.$queryRawUnsafe<{ calls: bigint }[]>(
      `
      SELECT count(*)::bigint AS calls
      FROM "call_record" r
      WHERE r."direction" = 'INBOUND' AND r."startedAt" >= $1 AND r."startedAt" < $2
      `,
      callWindowStart(period.start),
      period.end,
    )
    return Number(row?.calls ?? 0)
  }

  /**
   * Every deal whose «ИИ квал сана» falls in the window, whatever its pipeline
   * or creation day — the portal's own filter on that field (01.10.2026: 89 =
   * 72 Регистрация + 13 Первичный отдел + 4 Доставка), flagged by whether it
   * is in Регистрация. Read through `deal_aiQualifiedAt_idx` (2026-10-06);
   * it was a sequential scan of the whole table on every build.
   */
  async aiQualifiedStages(period: Period): Promise<AiQualifiedStageRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        registration: boolean
        source_id: string | null
        form_title: string | null
        product_line: string | null
        stage: string | null
        status: string
        leads: bigint
      }[]
    >(
      `
      SELECT
        COALESCE(p."role" = 'LEAD', false) AS registration,
        s."externalId" AS source_id,
        /*
          The form as every other read names it (leadFormSql.ts, 2026-10-06
          audit): a renamed repeat lead keeps its form, and so its brand,
          here too. No short-name alias: those come from the window's
          Регистрация deals by creation, and this read takes any pipeline and
          any creation day.
        */
        ${leadFormTitleSql('d."title"', sourceDescriptionSql('d'), 's."externalId"', 'NULL')} AS form_title,
        NULLIF(btrim(d."productLine"), '') AS product_line,
        st."name" AS stage,
        d."status"::text AS status,
        count(*)::bigint AS leads
      FROM "deal" d
      LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
      LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
      LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
      WHERE d."aiQualifiedAt" >= $1 AND d."aiQualifiedAt" < $2
      GROUP BY 1, 2, 3, 4, 5, 6
      `,
      period.start,
      period.end,
    )
    return rows.map((r) => ({
      registration: r.registration,
      sourceId: r.source_id,
      formTitle: r.form_title,
      productLine: r.product_line,
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
