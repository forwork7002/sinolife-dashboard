/**
 * «RNP jadvali» — everything the client's «СентябрРНП» sheet reads that is
 * not FAKT 1 / FAKT 2 (those are the queue cohort, in
 * `InsightsRepository.rnpTeamDays`). Every statement groups by Tashkent day
 * before anything leaves the database; a month is a few hundred rows.
 *
 * WHAT EACH ROW OF THE SHEET IS, measured against obey.bitrix24.kz on
 * 2026-09-28 (the client's written spec, `sentyabr_rnp_bitrix_spec.md`):
 *
 *   ROP olgan lid — a deal in Первичный отдел / Тасдиклаш / Доставка whose
 *     «Лид таркатилган сана» is the day, credited to the ROP in
 *     «РОП (Первичка)». One lead is one deal: the deal keeps its id as it
 *     moves on (21.09: 338 deals, two sharing a contact), so deals are
 *     counted, not folded. The portal's figures for 21.09 — Sevinch 38,
 *     Saidaziz 41, Maftuna 27 — are the sheet's. Filled on every deal only
 *     from 16.09; the screen says so.
 *   Регистрация — Регистрация (role LEAD) deals by creation day, «Дубликат»
 *     stages apart; the kval lead is the registrar's «Сделка успешна» (WON),
 *     by the day it was closed. «ИИ квал» is NOT a kval: the AI hands the
 *     deal back to Регистрация (200 of 263 on 21.09 sat there), where the
 *     registrar decides.
 *   БАЗА дозвон — connected calls by the people of the team (primary
 *     department), inbound and outbound. The spec matched the sheet to the
 *     call on 02.09 and 21.09 (Charos 130 / 149).
 *   Склад — the day an order first reached Доставка, and how many stood in
 *     «Заказ в мой склад» (Logistika's «не собран») when the day ended.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'

import { InsightsRepository } from './insightsRepository'

/** Deals handed to one ROP on one day. `rop` null: not handed to a ROP team. */
export interface RnpLeadDayRow {
  readonly day: string
  readonly rop: string | null
  readonly leads: number
}

export interface RnpRegistrationDayRow {
  readonly day: string
  /** Регистрация deals created, «Дубликат» stages excluded. */
  readonly leads: number
  readonly duplicates: number
  /** «Сделка успешна», by the day it was closed. */
  readonly qualified: number
  /** «ИИ обработка» conversations opened. */
  readonly aiConversations: number
}

/** One person's connected calls on one day, with the team they sit in. */
export interface RnpCallDayRow {
  readonly day: string
  readonly rop: string
  readonly employeeId: string
  readonly isHead: boolean
  readonly connected: number
}

export interface RnpWarehouseDayRow {
  readonly day: string
  /** Orders whose first Доставка stage was entered that day. */
  readonly entered: number
  /** Orders standing in «Заказ в мой склад» when the day ended (now, for today). */
  readonly notPacked: number
}

export interface RnpTeam {
  readonly rop: string
  /** The department head's name; null when the portal names none. */
  readonly head: string | null
}

export interface RnpPlanRow {
  readonly team: string
  readonly metric: string
  readonly fromDay: number
  readonly valueCenti: bigint
}

export interface RnpTeamFaktPlan {
  readonly rop: string
  readonly fakt1Minor: bigint | null
  readonly fakt2Minor: bigint | null
}

/** Первичный отдел, Тасдиклаш, Доставка — where a handed-out lead lives. */
const LEAD_PIPELINES = ['12', '4', '6']

const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`)

/*
  EVERY BOUND IS A NAIVE UTC TIMESTAMP, like the columns it is compared with.
  Prisma's DateTime columns are `timestamp(3)` holding UTC, so a Tashkent
  midnight is written `(date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC'`:
  the first step makes it an instant, the second turns it back into the UTC
  wall clock the column stores. Stopping at the instant (a timestamptz) would
  make Postgres cast the COLUMN through the session's TimeZone — Asia/Tashkent
  on the local cluster, whatever the server says in production — and a day's
  end would move by five hours between the two.

  `now` ($4) arrives from the Prisma adapter already as a naive UTC string,
  so it is cast to `timestamp` and nothing else: `::timestamptz` would read
  that string in the session's zone as well.
*/
export class RnpRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  /** `from` / `to` are inclusive `YYYY-MM-DD`. */
  async leadDays(from: string, to: string): Promise<RnpLeadDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ day: string; rop: string | null; leads: bigint }[]>(
      RnpRepository.leadDaysSql(),
      from,
      to,
      LEAD_PIPELINES,
    )
    return rows.map((r) => ({ day: r.day, rop: r.rop, leads: Number(r.leads) }))
  }

  /**
   * THE ROP IS THE TEAM THE PERSON HEADS, then the team they sit in. The
   * field names a person — Saidazizxo'ja Latipov — and the sheet a team;
   * «РОП (Первичка)» holds the head, so headship is the first reading, and a
   * deputy filed inside a ROP department the second. Anyone else (user 10,
   * the registration desk's head, who holds leads not yet handed out) is
   * null: «Taqsimlanmagan».
   */
  static leadDaysSql(): string {
    return `
      SELECT
        /* ::text — a bare DATE is built at LOCAL midnight by node-postgres. */
        d."leadDistributedOn"::text AS day,
        COALESCE(
          (SELECT ${InsightsRepository.ropNameSql('h."name"')}
             FROM "department" h
            WHERE h."headId" = d."leadRopEmployeeId" AND h."isActive"
              AND ${InsightsRepository.ropNameSql('h."name"')} IS NOT NULL
            ORDER BY h."name"
            LIMIT 1),
          ${InsightsRepository.ropNameSql('dep."name"')}
        ) AS rop,
        count(*)::bigint AS leads
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."externalId" = ANY($3::text[])
      LEFT JOIN "employee" e ON e."id" = d."leadRopEmployeeId"
      LEFT JOIN "department" dep ON dep."id" = e."departmentId"
      WHERE d."leadDistributedOn" BETWEEN $1::date AND $2::date
      GROUP BY 1, 2`
  }

  async registrationDays(from: string, to: string): Promise<RnpRegistrationDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { day: string; leads: bigint; duplicates: bigint; qualified: bigint; ai: bigint }[]
    >(RnpRepository.registrationDaysSql(), from, to, this.tz)
    return rows.map((r) => ({
      day: r.day,
      leads: Number(r.leads),
      duplicates: Number(r.duplicates),
      qualified: Number(r.qualified),
      aiConversations: Number(r.ai),
    }))
  }

  /**
   * Three clocks, one day column: a lead on the day it was registered, a
   * kval on the day the registrar closed it, a conversation on the day it
   * opened. A duplicate is a stage whose NAME says so — the same reading as
   * `leadBucket` on «Lid manbalari», so the two screens agree on what one is.
   *
   * THE CASE IS SPELLED OUT, NOT `~*`: case-insensitive matching of Cyrillic
   * follows the database's ctype, and under a C locale «Дубликат» does not
   * match 'дубл' — measured on a local cluster, where every duplicate was
   * counted as a lead.
   */
  static registrationDaysSql(): string {
    const day = (col: string) => `(${col} AT TIME ZONE 'UTC' AT TIME ZONE $3)::date`
    const lo = `(($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    const hi = `(($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    return `
      WITH created AS (
        SELECT ${day('d."createdAtSource"')} AS day,
               count(*) FILTER (WHERE p."role" = 'LEAD' AND COALESCE(st."name", '') !~ '[Дд]убл') AS leads,
               count(*) FILTER (WHERE p."role" = 'LEAD' AND COALESCE(st."name", '') ~ '[Дд]убл') AS duplicates,
               count(*) FILTER (WHERE p."role" = 'AI_TRIAGE') AS ai
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" IN ('LEAD', 'AI_TRIAGE')
        LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
        WHERE d."createdAtSource" >= ${lo} AND d."createdAtSource" < ${hi}
        GROUP BY 1
      ),
      won AS (
        SELECT ${day('d."closedAt"')} AS day, count(*) AS qualified
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
        WHERE d."status" = 'WON' AND d."closedAt" >= ${lo} AND d."closedAt" < ${hi}
        GROUP BY 1
      )
      SELECT COALESCE(c.day, w.day)::text AS day,
             COALESCE(c.leads, 0)::bigint AS leads,
             COALESCE(c.duplicates, 0)::bigint AS duplicates,
             COALESCE(w.qualified, 0)::bigint AS qualified,
             COALESCE(c.ai, 0)::bigint AS ai
      FROM created c
      FULL JOIN won w ON w.day = c.day`
  }

  async callDays(from: string, to: string): Promise<RnpCallDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { day: string; rop: string; employee_id: string; is_head: boolean; connected: bigint }[]
    >(RnpRepository.callDaysSql(), from, to, this.tz)
    return rows.map((r) => ({
      day: r.day,
      rop: r.rop,
      employeeId: r.employee_id,
      isHead: r.is_head,
      connected: Number(r.connected),
    }))
  }

  /**
   * Connected calls per person per day, for the people of ROP teams only.
   * Inbound and outbound; a callback leg is the portal ringing an operator,
   * not a conversation with a customer. The team is the PRIMARY department,
   * as on «Qoʻngʻiroqlar».
   */
  static callDaysSql(): string {
    return `
      SELECT
        (c."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
        t.rop,
        e."id" AS employee_id,
        COALESCE(dep."headId" = e."id", false) AS is_head,
        count(*)::bigint AS connected
      FROM "call_record" c
      JOIN "employee" e ON e."id" = c."employeeId"
      JOIN "department" dep ON dep."id" = e."departmentId"
      CROSS JOIN LATERAL (SELECT ${InsightsRepository.ropNameSql('dep."name"')} AS rop) t
      WHERE c."connected"
        AND c."direction" IN ('INBOUND', 'OUTBOUND')
        AND c."startedAt" >= (($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')
        AND c."startedAt" < (($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')
        AND t.rop IS NOT NULL
      GROUP BY 1, 2, 3, 4`
  }

  async warehouseDays(from: string, to: string, now: Date): Promise<RnpWarehouseDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ day: string; entered: bigint; not_packed: bigint }[]>(
      RnpRepository.warehouseDaysSql(),
      from,
      to,
      this.tz,
      now,
    )
    return rows.map((r) => ({ day: r.day, entered: Number(r.entered), notPacked: Number(r.not_packed) }))
  }

  /**
   * Both halves read Доставка's stage history, which the sync keeps whole
   * for that pipeline (`historyPipelines` 6/14/10/4). «Entered» is an order's
   * FIRST Доставка row, so an order bounced back and forth is counted once,
   * on the day it first arrived. «Not packed» is a snapshot at each day's
   * end — rows in a WAREHOUSE-role stage entered before it and not left by
   * it — and at `now` for a day not yet over, so today reads the kanban.
   */
  static warehouseDaysSql(): string {
    return `
      WITH days AS (
        SELECT g::date AS day,
               LEAST((g::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC', $4::timestamp) AS day_end
        FROM generate_series($1::date, $2::date, interval '1 day') g
      ),
      first_entry AS (
        SELECT h."dealId", min(h."enteredAt") AS entered_at
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
        JOIN "pipeline" p ON p."id" = s."pipelineId" AND p."externalId" = '6'
        /* Only deals that moved inside Доставка this month can have arrived in it. */
        WHERE h."dealId" IN (
          SELECT h2."dealId"
          FROM "deal_stage_history" h2
          JOIN "deal_stage" s2 ON s2."id" = h2."stageId"
          JOIN "pipeline" p2 ON p2."id" = s2."pipelineId" AND p2."externalId" = '6'
          WHERE h2."enteredAt" >= (($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')
            AND h2."enteredAt" < (($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')
        )
        GROUP BY h."dealId"
        HAVING min(h."enteredAt") >= (($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')
           AND min(h."enteredAt") < (($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')
      ),
      entered AS (
        SELECT (entered_at AT TIME ZONE 'UTC' AT TIME ZONE $3)::date AS day, count(*) AS n
        FROM first_entry GROUP BY 1
      ),
      waiting AS (
        SELECT h."dealId", h."enteredAt", h."leftAt"
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId" AND s."logisticsRole" = 'WAREHOUSE'
        WHERE h."enteredAt" < (($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')
          AND (h."leftAt" IS NULL OR h."leftAt" >= (($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC'))
      )
      SELECT d.day::text AS day,
             COALESCE(e.n, 0)::bigint AS entered,
             (SELECT count(DISTINCT w."dealId") FROM waiting w
               WHERE w."enteredAt" < d.day_end AND (w."leftAt" IS NULL OR w."leftAt" >= d.day_end))::bigint AS not_packed
      FROM days d
      LEFT JOIN entered e ON e.day = d.day
      WHERE d.day_end > (d.day::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
  }

  /** Every active ROP department, with its head. */
  async teams(): Promise<RnpTeam[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ rop: string; head: string | null }[]>(`
      SELECT DISTINCT ON (t.rop) t.rop, e."fullName" AS head
      FROM "department" dep
      CROSS JOIN LATERAL (SELECT ${InsightsRepository.ropNameSql('dep."name"')} AS rop) t
      LEFT JOIN "employee" e ON e."id" = dep."headId"
      WHERE dep."isActive" AND t.rop IS NOT NULL
      ORDER BY t.rop, (e."fullName" IS NULL)`)
    return rows.map((r) => ({ rop: r.rop, head: r.head }))
  }

  async plans(month: string): Promise<{ rows: RnpPlanRow[]; fakt: RnpTeamFaktPlan[] }> {
    const [rows, fakt] = await Promise.all([
      this.prisma.rnpPlan.findMany({
        where: { month: monthDate(month) },
        select: { team: true, metric: true, fromDay: true, valueCenti: true },
      }),
      this.prisma.teamMonthPlan.findMany({
        where: { month: monthDate(month) },
        select: { rop: true, fakt1Minor: true, fakt2Minor: true },
      }),
    ])
    return { rows, fakt }
  }

  /**
   * Replace what the form names, in ONE transaction. FAKT 1 / FAKT 2 go to
   * `team_month_plan` — the plan «Sotuv · ROP» reads — so the two screens
   * cannot hold two different plans for one team. A null value deletes: «no
   * plan» is the absence of a row, never a plan of zero.
   */
  async savePlans(
    month: string,
    input: {
      rows: readonly { team: string; metric: string; fromDay: number; valueCenti: bigint | null }[]
      fakt: readonly RnpTeamFaktPlan[]
    },
    by: string,
  ): Promise<void> {
    const m = monthDate(month)
    const positive = (v: bigint | null) => (v !== null && v > 0n ? v : null)
    await this.prisma.$transaction([
      ...input.rows.map((r) => {
        const value = positive(r.valueCenti)
        const key = { month: m, team: r.team, metric: r.metric, fromDay: r.fromDay }
        return value === null
          ? this.prisma.rnpPlan.deleteMany({ where: key })
          : this.prisma.rnpPlan.upsert({
              where: { month_team_metric_fromDay: key },
              create: { ...key, valueCenti: value, updatedBy: by },
              update: { valueCenti: value, updatedBy: by },
            })
      }),
      ...input.fakt.map((t) => {
        const fakt1 = positive(t.fakt1Minor)
        const fakt2 = positive(t.fakt2Minor)
        return fakt1 === null && fakt2 === null
          ? this.prisma.teamMonthPlan.deleteMany({ where: { month: m, rop: t.rop } })
          : this.prisma.teamMonthPlan.upsert({
              where: { month_rop: { month: m, rop: t.rop } },
              create: { month: m, rop: t.rop, fakt1Minor: fakt1, fakt2Minor: fakt2, updatedBy: by },
              update: { fakt1Minor: fakt1, fakt2Minor: fakt2, updatedBy: by },
            })
      }),
    ])
  }
}
