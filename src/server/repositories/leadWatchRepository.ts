import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'

import { formAliasOverSql, leadFormTitleSql, replayActSql, replayedCteSql, sourceDescriptionSql } from './leadFormSql'

/** One Регистрация deal created in the window, as the lead watch reads it. */
export interface WatchLeadRow {
  /** The Bitrix24 deal id. */
  readonly dealId: string
  readonly title: string
  readonly customerName: string | null
  readonly createdAt: Date
  /** DealStatus: OPEN, WON or LOST. */
  readonly status: string
  /** The portal's STAGE_ID, as `deal_stage."externalId"` stores it. */
  readonly stageId: string | null
  /** Portal SOURCE_ID. */
  readonly sourceId: string | null
  readonly source: string | null
  /** The CRM form's title when a form opened the deal (`leadFormSql.ts`); the name is the domain's to read. */
  readonly formTitle: string | null
  /** «Проект». */
  readonly productLine: string | null
  /** «Ответственный». */
  readonly owner: string | null
  /** «РОП (Первичка)», by name; null when the field is empty or names nobody we hold. */
  readonly rop: string | null
  /** «РОП (Первичка)» is filled. */
  readonly ropAssigned: boolean
  /** The newest call since the window opened on the deal or on its contact — outgoing, or connected. */
  readonly lastCallAt: Date | null
  /** A late «Qayta zayavka» copy (`replayedCteSql`). */
  readonly replayed: boolean
}

/** Регистрация deals of one clock hour of one day, from one source and one form. */
export interface WatchFeedHourRow {
  /** `YYYY-MM-DD` in the app timezone. */
  readonly day: string
  /** 0–23 in the app timezone. */
  readonly hour: number
  readonly sourceId: string | null
  readonly source: string | null
  readonly formTitle: string | null
  readonly leads: number
}

/** An open-line chat a person holds open, with the deal it belongs to when we hold it. */
export interface WatchChatRow {
  /** The activity's portal id. */
  readonly chatId: string
  readonly subject: string
  readonly openedAt: Date
  /** The chat's responsible, by name. */
  readonly responsible: string | null
  /** Null when the deal is not imported (yet) — every field below is then null too. */
  readonly dealId: string | null
  readonly dealTitle: string | null
  readonly customerName: string | null
  readonly sourceId: string | null
  readonly formTitle: string | null
  readonly productLine: string | null
  readonly rop: string | null
}

/** A contact's most recent deal, any pipeline. */
export interface LatestDealRow {
  readonly customerId: string
  readonly dealId: string
  readonly sourceId: string | null
  readonly formTitle: string | null
  readonly productLine: string | null
}

/**
 * «Лид назорати» — today's Регистрация leads row by row, the week before by
 * clock hour, and the open chats.
 *
 * EVERY STATEMENT IS BOUNDED BY A CREATION WINDOW OR BY A HANDFUL OF IDS —
 * the production database was saturated once (2026-10-05) and this screen is
 * rebuilt every minute. Nothing here reads the deal table at large:
 *
 *   `todayLeads`   one day of Регистрация through `createdAtSource` (the
 *                  `[pipelineId, createdAtSource]` index «Lidlar» and RNP ride),
 *                  1 000–2 300 rows, and today's calls through
 *                  `call_record."startedAt"` — ~12 400 rows folded to the
 *                  newest per contact and per deal BEFORE the join;
 *   `feedHours`    the same scan over seven closed days, grouped in SQL to a
 *                  few thousand rows, and memoised by its caller — a closed
 *                  day's intake does not move;
 *   `openChats`    a table of dozens, each row joined to its deal by the
 *                  deal's own unique key;
 *   `latestDeals`  the `customerId` index, for the few callers nobody rang back.
 *
 * Pipelines by ROLE, as on «Lid manbalari»: LEAD is Регистрация
 * (`PIPELINE_ROLE_BY_ID`).
 */
export class LeadWatchRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  /**
   * Every Регистрация deal created in [`start`, `end`) — today — whatever its
   * status: the open ones are the watch's rows, all of them are the hour
   * chart's intake. «Исход» is the caller's to leave out, by `leadChannel` —
   * a form wins over its source there, and SQL must not hold a second rule.
   */
  async todayLeads(start: Date, end: Date): Promise<WatchLeadRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        deal_id: string
        title: string
        customer: string | null
        created: Date
        status: string
        stage_id: string | null
        source_id: string | null
        source: string | null
        form_title: string | null
        product_line: string | null
        owner: string | null
        rop: string | null
        rop_assigned: boolean
        last_call_at: Date | null
        replayed: boolean
      }[]
    >(LeadWatchRepository.todayLeadsSql(), start, end)
    return rows.map((r) => ({
      dealId: r.deal_id,
      title: r.title,
      customerName: r.customer,
      createdAt: r.created,
      status: r.status,
      stageId: r.stage_id,
      sourceId: r.source_id,
      source: r.source,
      formTitle: r.form_title,
      productLine: r.product_line,
      owner: r.owner,
      rop: r.rop,
      ropAssigned: r.rop_assigned,
      lastCallAt: r.last_call_at,
      replayed: r.replayed,
    }))
  }

  static todayLeadsSql(): string {
    return `
      /*
        ONE READ OF THE DAY'S DEALS (\`reg\`, MATERIALIZED), as «Lid manbalari»
        reads its window: the form aliases and the late «Qayta zayavka» copies
        both come from the rows this scan returns.
      */
      WITH reg AS MATERIALIZED (
        SELECT d."id" AS id, d."externalId" AS external_id, d."createdAtSource" AS created, d."title" AS title,
               ${sourceDescriptionSql('d')} AS sd,
               ${replayActSql(sourceDescriptionSql('d'))} AS act,
               d."sourceId", d."stageId", d."status", d."customerId", d."employeeId",
               /*
                 WHO THE LEAD WAS HANDED TO. «РОП (Первичка)» is what the spec
                 names, and it was EMPTY on all 778 Регистрация deals of
                 2026-10-09 (measured on the portal): the portal stamps it on
                 the Первичный отдел deal. On Регистрация the hand-out is
                 «ROP KVAL LID» (474 of the 778), so either one is a ROP.
               */
               COALESCE(d."leadRopEmployeeId", d."ropKvalLidEmployeeId") AS rop_id,
               NULLIF(btrim(d."productLine"), '') AS product_line
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
        WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      ),
      ${formAliasOverSql('(SELECT r.sd, r.title FROM reg r) fd')},
      ${replayedCteSql('(SELECT r.id, r.created, r.act FROM reg r) q0', '$1')},
      /*
        TODAY'S CALLS, FOLDED BEFORE THEY ARE JOINED. A lead created today can
        only have been rung today, so the \`startedAt\` index bounds the scan
        to the day (~12 400 rows) and each fold leaves one row per contact and
        per deal — two hash joins. Asked per lead instead (\`NOT EXISTS … OR\`)
        it would walk the day's calls once for every lead: \`call_record\` has
        no index on \`customerId\`.

        The telephony links a call to the CONTACT, almost never to the deal
        (measured on the portal, 2026-10-09), so both are read. Whether the
        newest call came AFTER the lead was created is the domain's to judge.

        ONLY A CALL THAT MEANS THE LEAD WAS WORKED: an outgoing one, answered
        or not, or any call that connected (a second of conversation). The
        customer's own ring that nobody picked up is the opposite of that,
        and counted here it would take an unanswered lead OFF «no call».
      */
      called_contact AS (
        SELECT c."customerId" AS customer_id, max(c."startedAt") AS last_at
        FROM "call_record" c
        WHERE c."startedAt" >= $1 AND c."customerId" IS NOT NULL
          AND (c."direction" = 'OUTBOUND' OR c."durationSec" > 0)
        GROUP BY 1
      ),
      called_deal AS (
        SELECT c."dealId" AS deal_id, max(c."startedAt") AS last_at
        FROM "call_record" c
        WHERE c."startedAt" >= $1 AND c."dealId" IS NOT NULL
          AND (c."direction" = 'OUTBOUND' OR c."durationSec" > 0)
        GROUP BY 1
      )
      SELECT
        r.external_id AS deal_id,
        r.title,
        NULLIF(btrim(cu."name"), '') AS customer,
        r.created,
        r."status"::text AS status,
        st."externalId" AS stage_id,
        s."externalId" AS source_id,
        s."name" AS source,
        ${leadFormTitleSql('r.title', 'r.sd', 's."externalId"', 'fa.title')} AS form_title,
        r.product_line,
        o."fullName" AS owner,
        rp."fullName" AS rop,
        (r.rop_id IS NOT NULL) AS rop_assigned,
        -- GREATEST skips a NULL: the newer of the two, or the one there is.
        GREATEST(cc.last_at, cd.last_at) AS last_call_at,
        EXISTS (SELECT 1 FROM replayed x WHERE x.id = r.id) AS replayed
      FROM reg r
      LEFT JOIN "deal_stage" st ON st."id" = r."stageId"
      LEFT JOIN "sales_source" s ON s."id" = r."sourceId"
      LEFT JOIN form_alias fa ON fa.sd = r.sd
      LEFT JOIN "customer" cu ON cu."id" = r."customerId"
      LEFT JOIN "employee" o ON o."id" = r."employeeId"
      LEFT JOIN "employee" rp ON rp."id" = r.rop_id
      LEFT JOIN called_contact cc ON cc.customer_id = r."customerId"
      LEFT JOIN called_deal cd ON cd.deal_id = r.id
      WHERE r.external_id IS NOT NULL`
  }

  /**
   * Регистрация deals created in [`start`, `end`) by Tashkent day, clock
   * hour, source and form — the days BEFORE today, for «usually at this
   * hour». Late «Qayta zayavka» copies left out, as on «Lidlar»: on 05.10.2026
   * the robot opened 1 071 of them between 18:00 and 20:00, and a week of
   * «usual» for those two hours would have carried them.
   */
  async feedHours(start: Date, end: Date): Promise<WatchFeedHourRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { day: string; hour: number; source_id: string | null; source: string | null; form_title: string | null; leads: bigint }[]
    >(LeadWatchRepository.feedHoursSql(), start, end, this.tz)
    return rows.map((r) => ({
      day: r.day,
      hour: Number(r.hour),
      sourceId: r.source_id,
      source: r.source,
      formTitle: r.form_title,
      leads: Number(r.leads),
    }))
  }

  static feedHoursSql(): string {
    return `
      WITH reg AS MATERIALIZED (
        SELECT d."id" AS id, d."createdAtSource" AS created, d."title" AS title,
               ${sourceDescriptionSql('d')} AS sd,
               ${replayActSql(sourceDescriptionSql('d'))} AS act,
               d."sourceId"
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
        WHERE d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      ),
      ${formAliasOverSql('(SELECT r.sd, r.title FROM reg r) fd')},
      ${replayedCteSql('(SELECT r.id, r.created, r.act FROM reg r) q0', '$1')}
      SELECT
        /*
          The two-step AT TIME ZONE: the column is naive UTC, and the one-step
          form would read it as Tashkent local. ::text, never a bare ::date —
          node-postgres builds a DATE at LOCAL midnight.
        */
        (r.created AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
        extract(hour FROM (r.created AT TIME ZONE 'UTC' AT TIME ZONE $3))::int AS hour,
        s."externalId" AS source_id,
        s."name" AS source,
        ${leadFormTitleSql('r.title', 'r.sd', 's."externalId"', 'fa.title')} AS form_title,
        count(*)::bigint AS leads
      FROM reg r
      LEFT JOIN "sales_source" s ON s."id" = r."sourceId"
      LEFT JOIN form_alias fa ON fa.sd = r.sd
      WHERE NOT EXISTS (SELECT 1 FROM replayed x WHERE x.id = r.id)
      GROUP BY 1, 2, 3, 4, 5`
  }

  /**
   * The open-line chats the worker holds (`open_line_chat` — a person's, open
   * now, of about the last day), each with its deal — ANY pipeline: a chat is
   * waiting wherever its deal stands.
   *
   * The deal and the responsible are joined HERE, by their portal ids, and
   * were deliberately not resolved when the row was written: a chat arrives a
   * tick before the deal it opened. No short-name form alias — those come
   * from a window's Регистрация deals, and this reads any deal of any day.
   */
  async openChats(): Promise<WatchChatRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        chat_id: string
        subject: string
        opened_at: Date
        responsible: string | null
        deal_id: string | null
        deal_title: string | null
        customer: string | null
        source_id: string | null
        form_title: string | null
        product_line: string | null
        rop: string | null
      }[]
    >(LeadWatchRepository.openChatsSql())
    return rows.map((r) => ({
      chatId: r.chat_id,
      subject: r.subject,
      openedAt: r.opened_at,
      responsible: r.responsible,
      dealId: r.deal_id,
      dealTitle: r.deal_title,
      customerName: r.customer,
      sourceId: r.source_id,
      formTitle: r.form_title,
      productLine: r.product_line,
      rop: r.rop,
    }))
  }

  static openChatsSql(): string {
    return `
      SELECT
        c."externalId" AS chat_id,
        c."subject" AS subject,
        c."openedAt" AS opened_at,
        resp."fullName" AS responsible,
        d."externalId" AS deal_id,
        d."title" AS deal_title,
        NULLIF(btrim(cu."name"), '') AS customer,
        s."externalId" AS source_id,
        ${leadFormTitleSql('d."title"', sourceDescriptionSql('d'), 's."externalId"', 'NULL')} AS form_title,
        NULLIF(btrim(d."productLine"), '') AS product_line,
        rp."fullName" AS rop
      FROM "open_line_chat" c
      LEFT JOIN "deal" d ON d."externalSource" = c."externalSource" AND d."externalId" = c."dealExternalId"
      LEFT JOIN "customer" cu ON cu."id" = d."customerId"
      LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
      LEFT JOIN "employee" resp
             ON resp."externalSource" = c."externalSource" AND resp."externalId" = c."responsibleExternalId"
      -- The ROP as \`todayLeads\` reads it: «РОП (Первичка)», else «ROP KVAL LID».
      LEFT JOIN "employee" rp ON rp."id" = COALESCE(d."leadRopEmployeeId", d."ropKvalLidEmployeeId")
      ORDER BY c."openedAt"`
  }

  /**
   * Each contact's most recent deal, any pipeline — where «Ochish» lands for
   * a missed call, and the only place its brand can come from (the call
   * itself names no line). Through the `customerId` index; the callers nobody
   * rang back are a few dozen at most.
   */
  async latestDeals(customerIds: readonly string[]): Promise<LatestDealRow[]> {
    if (customerIds.length === 0) return []
    const rows = await this.prisma.$queryRawUnsafe<
      { customer_id: string; deal_id: string; source_id: string | null; form_title: string | null; product_line: string | null }[]
    >(LeadWatchRepository.latestDealsSql(), [...customerIds])
    return rows.map((r) => ({
      customerId: r.customer_id,
      dealId: r.deal_id,
      sourceId: r.source_id,
      formTitle: r.form_title,
      productLine: r.product_line,
    }))
  }

  static latestDealsSql(): string {
    return `
      SELECT DISTINCT ON (d."customerId")
        d."customerId" AS customer_id,
        d."externalId" AS deal_id,
        s."externalId" AS source_id,
        ${leadFormTitleSql('d."title"', sourceDescriptionSql('d'), 's."externalId"', 'NULL')} AS form_title,
        NULLIF(btrim(d."productLine"), '') AS product_line
      FROM "deal" d
      LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
      WHERE d."customerId" = ANY($1::text[]) AND d."externalId" IS NOT NULL
      ORDER BY d."customerId", d."createdAtSource" DESC, d."id" DESC`
  }

  /**
   * When the worker last read each of the watch's own feeds whole
   * (`lead_watch_sync`, written by `leadWatchFeeds.ts`); null for a feed that
   * has never succeeded — a worker that has not been deployed yet, say.
   */
  async feedClocks(): Promise<{ calls: Date | null; chats: Date | null }> {
    const rows = await this.prisma.leadWatchSync.findMany({ select: { id: true, lastSuccessAt: true } })
    const at = (id: string) => rows.find((r) => r.id === id)?.lastSuccessAt ?? null
    return { calls: at('calls'), chats: at('chats') }
  }
}
