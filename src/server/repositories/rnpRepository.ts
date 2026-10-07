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
 *     from 16.09; the screen says so. Only a FRESH hand-out counts (since
 *     2026-10-02): see `leadDaysSql`.
 *   Регистрация — Регистрация (role LEAD) deals by creation day, «Дубликат
 *     (лид)» apart (the red «Дубликат» is a lead); the kval lead is the registrar's «Сделка успешна» (WON),
 *     by the day it was closed. «ИИ квал» is NOT a kval: the AI hands the
 *     deal back to Регистрация (200 of 263 on 21.09 sat there), where the
 *     registrar decides.
 *   БАЗА дозвон — connected calls by the people of the team (primary
 *     department), inbound and outbound. The spec matched the sheet to the
 *     call on 02.09 and 21.09 (Charos 130 / 149).
 *   Склад — the day an order first reached Доставка, and how many stood in
 *     «Заказ в мой склад» (Logistika's «не собран») when the day ended.
 */

import { TZDate } from '@date-fns/tz'

import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import { NOT_PACKED_STAGES } from '@/server/integrations/crm/bitrix24/mapping'

import { InsightsRepository } from './insightsRepository'
import { dealFormTitleSql, formAliasJoinSql, formAliasOverSql, leadFormTitleSql, sourceDescriptionSql } from './leadFormSql'
import { type RnpCostLine, type RnpCostProject, SETTING_LEAD_VALUE } from '@/server/domain/rnp/rnpSheet'

/** Deals handed to one ROP on one day. `rop` null: not handed to a ROP team. */
export interface RnpLeadDayRow {
  readonly day: string
  readonly rop: string | null
  readonly leads: number
}

export interface RnpRegistrationDayRow {
  readonly day: string
  /** The lead's SOURCE_ID, and the CRM form's full title when it came from one — what decides its brand. */
  readonly sourceId: string | null
  readonly formTitle: string | null
  /** «Проект» (`productLine`) — named, it decides the brand before source and form (`leadBrand`). */
  readonly productLine: string | null
  /** Регистрация deals created, «Дубликат (лид)» excluded (the red «Дубликат» is a lead). */
  readonly leads: number
  readonly duplicates: number
  /** «Сделка успешна», by the day it was closed. */
  readonly qualified: number
  /** «ИИ обработка» conversations opened. */
  readonly aiConversations: number
}

/** One team's connected calls on one day. */
export interface RnpCallDayRow {
  readonly day: string
  readonly rop: string
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

export interface RnpRegistrarKvalRow {
  readonly day: string
  readonly registrar: string | null
  readonly qualified: number
}

/** A P&L cost typed by hand (`rnp_manual_cost`). */
export interface RnpManualCostRow {
  readonly day: string
  readonly project: RnpCostProject
  readonly line: RnpCostLine
  /** Soʻm. */
  readonly amount: number
}

/** A ROP team's «Ходим сони» typed by hand (`rnp_manual_headcount`). */
export interface RnpManualHeadcountRow {
  readonly day: string
  readonly rop: string
  readonly heads: number
}

export interface RnpTeamFaktPlan {
  readonly rop: string
  readonly fakt1Minor: bigint | null
  readonly fakt2Minor: bigint | null
}

const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`)

/*
  A TRANSACTION QUEUES FOR A CONNECTION AS LONG AS A PLAIN QUERY DOES
  (2026-10-06). Prisma gives a transaction 2 s to get one (`maxWait`'s
  default); the pool lets every other query queue for 20 s
  (`connectionTimeoutMillis`, prisma.ts). With all eight connections busy
  for over 2 s — a cold month build beside another screen — a typed plan,
  cost or «Ходим сони» failed with P2028 and its cell turned red, while every
  read on the page waited and succeeded. ONE constant for this file's four
  transactions — the three saves and the registration history's — and
  `rnpPlanSave.test.ts` reads the pool's figure out of prisma.ts, so a pool
  that waits longer or shorter fails the gate instead of leaving these
  behind.
*/
const CONNECTION_WAIT_MS = 20_000

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
    )
    return rows.map((r) => ({ day: r.day, rop: r.rop, leads: Number(r.leads) }))
  }

  /**
   * THE ROP IS THE TEAM THE PERSON HEADS, then the team they sit in. The
   * field names a person — Saidazizxo'ja Latipov — and the sheet a team;
   * «РОП (Первичка)» holds the head, so headship is the first reading, and a
   * deputy filed inside a ROP department the second. Anyone else (user 10,
   * the registration desk's head, who holds leads not yet handed out) is
   * null: «Taqsimlanmagan». A person heading TWO ROP units counts in the one
   * they sit in (2026-10-02): Shohjaxon also headed «Saida(ROP)» on
   * production, and the first by name filed all his leads under «Саида РОП».
   *
   * EVERY PIPELINE, as the client counts it (2026-09-30): Bitrix24's deal list
   * filtered by «Лид таркатилган сана» and «РОП (Первичка)», nothing else — a
   * handed-out lead now sitting in «База» or back in «Регистрация» still went
   * to that ROP.
   *
   * ONLY A FRESH HAND-OUT (the client's decision of 2026-10-02): a deal
   * created at most 30 days before «Лид таркатилган сана». On 26.09 the
   * portal re-stamped the date on 1 704 old Первичный отдел deals (June
   * 2025–January 2026, 715 of them to Azizbek), and every one counted as a
   * lead handed out that day: Azizbek read 752 where the client's sheet
   * typed 37 — the fresh ones, exactly, as on 17.09 (47). The bound is
   * `createdAtSource`, not «Лид тушган сана», which is empty before 14.09.
   * Its five hours of zone at the 30-day edge are immaterial: a re-stamped
   * deal is months past it. «Lidlar» counts its hand-outs without this bound
   * (`RegistrationRepository.handedOutSql`), so the two can differ on a day
   * like 26.09.
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
            ORDER BY (h."id" = e."departmentId") DESC, h."name"
            LIMIT 1),
          ${InsightsRepository.ropNameSql('dep."name"')}
        ) AS rop,
        count(*)::bigint AS leads
      FROM "deal" d
      LEFT JOIN "employee" e ON e."id" = d."leadRopEmployeeId"
      LEFT JOIN "department" dep ON dep."id" = e."departmentId"
      WHERE d."leadDistributedOn" BETWEEN $1::date AND $2::date
        AND d."createdAtSource" >= d."leadDistributedOn" - interval '30 days'
      GROUP BY 1, 2`
  }

  /**
   * `statementTimeoutMs` lifts the pool's 20 s limit for this one statement
   * (SET LOCAL, inside its own transaction, so the pooled connection goes
   * back unchanged). The month's history needs it: on production (2026-09-30)
   * the scan took 6.7 s warm and ran past 20 s cold, beside the month's other
   * reads on a one-core database — and a timeout there is a screen that fails.
   */
  async registrationDays(from: string, to: string, statementTimeoutMs?: number): Promise<RnpRegistrationDayRow[]> {
    type Row = {
      day: string
      source_id: string | null
      form_title: string | null
      product_line: string | null
      leads: bigint
      duplicates: bigint
      qualified: bigint
      ai: bigint
    }
    const sql = RnpRepository.registrationDaysSql()
    const rows = statementTimeoutMs
      ? await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.trunc(statementTimeoutMs)}`)
            return tx.$queryRawUnsafe<Row[]>(sql, from, to, this.tz)
          },
          { maxWait: CONNECTION_WAIT_MS, timeout: statementTimeoutMs + 5_000 },
        )
      : await this.prisma.$queryRawUnsafe<Row[]>(sql, from, to, this.tz)
    return rows.map((r) => ({
      day: r.day,
      sourceId: r.source_id,
      formTitle: r.form_title,
      productLine: r.product_line,
      leads: Number(r.leads),
      duplicates: Number(r.duplicates),
      qualified: Number(r.qualified),
      aiConversations: Number(r.ai),
    }))
  }

  /**
   * Three clocks, one day column: a lead on the day it was registered, a
   * kval on the day the registrar closed it, a conversation on the day it
   * opened. A duplicate is «Дубликат (лид)» only, read by NAME — the same
   * rule as `isLeadDuplicate` on «Lid manbalari», so the two screens agree on
   * what one is. The red «Дубликат» at the end of the pipeline is a lead here
   * (the client's rule, 2026-10-02).
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
    /*
      Grouped by source, CRM-form title and «Проект» as well as the day, so the P&L can
      tell a Collagen lead from a Zextra one — the SAME scan, which is the
      whole cost of this statement; a form's deals share one title, so the
      rows stay a few hundred. Two arms UNIONed and summed rather than a FULL
      JOIN: the join key would hold nulls, and a FULL JOIN will not hash on
      IS NOT DISTINCT FROM. A repeat lead's form comes from its
      SOURCE_DESCRIPTION (leadFormSql.ts), so it is not brandless here while
      «Roistat» and «Lidlar» give it a brand.
    */
    const duplicate = `COALESCE(r.stage, '') ~ '[Дд]убл[^(]*\\([[:space:]]*[Лл]ид'`
    /*
      ONE READ OF THE WINDOW'S DEALS (`reg`, MATERIALIZED): the form aliases
      are built from the same rows the first arm counts, so recovering a
      repeat lead's form costs no second pass over the month — this is the
      scan that runs 7–10 s cold on production.
    */
    return `
      WITH reg AS MATERIALIZED (
        SELECT d."createdAtSource" AS created, p."role"::text AS role, st."name" AS stage,
               s."externalId" AS source_id, d."title" AS title, ${sourceDescriptionSql('d')} AS sd,
               NULLIF(btrim(d."productLine"), '') AS product_line
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" IN ('LEAD', 'AI_TRIAGE')
        LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
        LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
        WHERE d."createdAtSource" >= ${lo} AND d."createdAtSource" < ${hi}
      ),
      ${formAliasOverSql(`(SELECT r.sd, r.title FROM reg r WHERE r.role = 'LEAD') fd`)},
      arms AS (
        SELECT ${day('r.created')} AS day,
               r.source_id,
               ${leadFormTitleSql('r.title', 'r.sd', 'r.source_id', 'fa.title')} AS form_title,
               r.product_line,
               count(*) FILTER (WHERE r.role = 'LEAD' AND NOT ${duplicate}) AS leads,
               count(*) FILTER (WHERE r.role = 'LEAD' AND ${duplicate}) AS duplicates,
               0::bigint AS qualified,
               count(*) FILTER (WHERE r.role = 'AI_TRIAGE') AS ai
        FROM reg r
        LEFT JOIN form_alias fa ON fa.sd = r.sd
        GROUP BY 1, 2, 3, 4
        UNION ALL
        SELECT ${day('d."closedAt"')} AS day,
               s."externalId" AS source_id,
               ${dealFormTitleSql('d', 's', 'fa')} AS form_title,
               NULLIF(btrim(d."productLine"), '') AS product_line,
               0, 0, count(*), 0
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
        LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
        ${formAliasJoinSql('d', 'fa')}
        WHERE d."status" = 'WON' AND d."closedAt" >= ${lo} AND d."closedAt" < ${hi}
        GROUP BY 1, 2, 3, 4
      )
      SELECT day::text AS day, source_id, form_title, product_line,
             sum(leads)::bigint AS leads,
             sum(duplicates)::bigint AS duplicates,
             sum(qualified)::bigint AS qualified,
             sum(ai)::bigint AS ai
      FROM arms
      GROUP BY 1, 2, 3, 4`
  }

  async callDays(from: string, to: string): Promise<RnpCallDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { day: string; rop: string; connected: bigint }[]
    >(RnpRepository.callDaysSql(), from, to, this.tz)
    return rows.map((r) => ({ day: r.day, rop: r.rop, connected: Number(r.connected) }))
  }

  /**
   * Connected calls per team per day, for the people of ROP teams only.
   * Inbound and outbound (`callDirection`, by Bitrix24's CALL_TYPE since
   * 2026-10-02); a callback leg (CALL_TYPE 4) is left out — the portal has
   * logged none since 15.09, so the choice has never moved a number. The
   * team is the PRIMARY department, as on «Qoʻngʻiroqlar».
   */
  static callDaysSql(): string {
    return `
      SELECT
        (c."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
        t.rop,
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
      GROUP BY 1, 2`
  }

  async warehouseDays(from: string, to: string, now: Date): Promise<RnpWarehouseDayRow[]> {
    const [entered, stays] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ day: string; entered: bigint }[]>(RnpRepository.enteredDaysSql(), from, to, this.tz),
      this.prisma.$queryRawUnsafe<{ deal_id: string; entered_at: Date; left_at: Date | null }[]>(
        RnpRepository.packingStaysSql(),
        from,
        to,
        this.tz,
        NOT_PACKED_STAGES,
      ),
    ])
    const enteredOn = new Map(entered.map((r) => [r.day, Number(r.entered)]))
    const ends = dayEnds(from, to, this.tz, now)
    const standing = notPackedAt(
      stays.map((r) => ({ dealId: r.deal_id, enteredAt: r.entered_at, leftAt: r.left_at })),
      ends.map((e) => e.end),
    )
    return ends.map((e, i) => ({ day: e.day, entered: enteredOn.get(e.day) ?? 0, notPacked: standing[i]! }))
  }

  /**
   * An order's FIRST arrival in Доставка, per Tashkent day. The rows of the
   * month are read off the (stageId, enteredAt) index and each one is kept
   * only if the deal had no earlier Доставка row — one probe on
   * (dealId, enteredAt) apiece. The first version grouped the pipeline's
   * whole history per deal and ran 9–77 s on production (2026-09-28).
   */
  static enteredDaysSql(): string {
    const lo = `(($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    const hi = `(($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    return `
      SELECT (h."enteredAt" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
             count(DISTINCT h."dealId")::bigint AS entered
      FROM "deal_stage_history" h
      JOIN "deal_stage" s ON s."id" = h."stageId"
      JOIN "pipeline" p ON p."id" = s."pipelineId" AND p."externalId" = '6'
      WHERE h."enteredAt" >= ${lo} AND h."enteredAt" < ${hi}
        AND NOT EXISTS (
          SELECT 1
          FROM "deal_stage_history" h0
          JOIN "deal_stage" s0 ON s0."id" = h0."stageId" AND s0."pipelineId" = s."pipelineId"
          WHERE h0."dealId" = h."dealId" AND h0."enteredAt" < h."enteredAt"
        )
      GROUP BY 1`
  }

  /**
   * Every stay in a packing stage that overlaps the month: those that began
   * in the 62 days before it or inside it and were left in it or after it,
   * plus the stays still open on a deal standing there now however old — an
   * order parked since spring is «не собран» on every day of this month, and
   * a lower bound alone would lose it.
   *
   * AN OPEN STAY COMES ONLY FROM THE SECOND ARM (2026-10-02). `leftAt` is
   * written from the deal's next SYNCED row, and stage history is synced for
   * some pipelines only: a deal that left packing for one of the others keeps
   * an open stay for good, and the first arm counted it «не собран» every day
   * for up to 62 days. The second arm asks the deal where it stands now.
   */
  static packingStaysSql(): string {
    const lo = `(($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    const hi = `(($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    return `
      WITH packing AS (
        SELECT s."id" FROM "deal_stage" s WHERE s."externalId" = ANY($4::text[])
      )
      SELECT h."dealId" AS deal_id, h."enteredAt" AS entered_at, h."leftAt" AS left_at
      FROM "deal_stage_history" h
      WHERE h."stageId" IN (SELECT "id" FROM packing)
        AND h."enteredAt" >= ${lo} - interval '62 days' AND h."enteredAt" < ${hi}
        AND h."leftAt" >= ${lo}
      UNION
      SELECT h."dealId", h."enteredAt", h."leftAt"
      FROM "deal" d
      JOIN "deal_stage_history" h ON h."dealId" = d."id" AND h."stageId" = d."stageId" AND h."leftAt" IS NULL
      WHERE d."stageId" IN (SELECT "id" FROM packing)
        AND h."enteredAt" < ${hi}`
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

  /**
   * The registrar's kval per Tashkent day: Регистрация deals (role LEAD) at
   * «Сделка успешна», by the day they were closed, per «Регистрация» label.
   * A WON deal the backfill has not reached yet has no registrar and is
   * counted under null — the screen shows it, so the rows still add up to
   * «Квал лид».
   */
  async registrarKvalDays(from: string, to: string): Promise<RnpRegistrarKvalRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ day: string; registrar: string | null; qualified: bigint }[]>(
      RnpRepository.registrarKvalDaysSql(),
      from,
      to,
      this.tz,
    )
    return rows.map((r) => ({ day: r.day, registrar: r.registrar, qualified: Number(r.qualified) }))
  }

  static registrarKvalDaysSql(): string {
    return `
      SELECT (d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
             d."registrar",
             count(*)::bigint AS qualified
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      WHERE d."status" = 'WON'
        AND d."closedAt" >= (($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')
        AND d."closedAt" < (($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')
      GROUP BY 1, 2`
  }

  /** The month's hand-typed P&L costs; `from` / `to` are inclusive `YYYY-MM-DD`. */
  async manualCosts(from: string, to: string): Promise<RnpManualCostRow[]> {
    const rows = await this.prisma.rnpManualCost.findMany({
      where: { day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      select: { day: true, project: true, line: true, amountSom: true },
    })
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      project: r.project as RnpCostProject,
      line: r.line as RnpCostLine,
      amount: Number(r.amountSom),
    }))
  }

  /** Write typed cells: a number sets the day's cost, null clears it. One transaction. */
  async saveManualCosts(
    cells: readonly { day: string; project: RnpCostProject; line: RnpCostLine; value: number | null }[],
    by: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      cells.map((c) => {
        const day = new Date(`${c.day}T00:00:00Z`)
        return c.value === null
          ? this.prisma.rnpManualCost.deleteMany({ where: { day, project: c.project, line: c.line } })
          : this.prisma.rnpManualCost.upsert({
              where: { day_project_line: { day, project: c.project, line: c.line } },
              create: { day, project: c.project, line: c.line, amountSom: BigInt(c.value), updatedBy: by },
              update: { amountSom: BigInt(c.value), updatedBy: by },
            })
      }),
      { maxWait: CONNECTION_WAIT_MS },
    )
  }

  /** The month's hand-typed «Ходим сони»; `from` / `to` are inclusive `YYYY-MM-DD`. */
  async manualHeadcount(from: string, to: string): Promise<RnpManualHeadcountRow[]> {
    const rows = await this.prisma.rnpManualHeadcount.findMany({
      where: { day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      select: { day: true, rop: true, heads: true },
    })
    return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), rop: r.rop, heads: r.heads }))
  }

  /** Write typed headcounts: a number sets the team's day, null clears it. One transaction. */
  async saveManualHeadcount(cells: readonly { day: string; rop: string; value: number | null }[], by: string): Promise<void> {
    await this.prisma.$transaction(
      cells.map((c) => {
        const day = new Date(`${c.day}T00:00:00Z`)
        return c.value === null
          ? this.prisma.rnpManualHeadcount.deleteMany({ where: { day, rop: c.rop } })
          : this.prisma.rnpManualHeadcount.upsert({
              where: { day_rop: { day, rop: c.rop } },
              create: { day, rop: c.rop, heads: c.value, updatedBy: by },
              update: { heads: c.value, updatedBy: by },
            })
      }),
      { maxWait: CONNECTION_WAIT_MS },
    )
  }

  async plans(month: string): Promise<{ rows: RnpPlanRow[]; fakt: RnpTeamFaktPlan[] }> {
    const [rows, fakt, inherited] = await Promise.all([
      this.prisma.rnpPlan.findMany({
        where: { month: monthDate(month) },
        select: { team: true, metric: true, fromDay: true, valueCenti: true },
      }),
      this.prisma.teamMonthPlan.findMany({
        where: { month: monthDate(month) },
        select: { rop: true, fakt1Minor: true, fakt2Minor: true },
      }),
      this.inheritedLeadValues(month),
    ])
    const own = new Set(rows.filter((r) => r.metric === SETTING_LEAD_VALUE).map((r) => r.team))
    return { rows: [...rows, ...inherited.filter((r) => !own.has(r.team))], fakt }
  }

  /**
   * A lead's value is the sheet's constant (400 000, then 500 000 from the
   * 14th of September), not a plan: a team (or the company, '') the month
   * gave none keeps the last value it had in force — its latest earlier
   * month's last row, from day 1. No form writes it since «Rejalar» was
   * removed. The month's own rows win, team by team (`plans`).
   */
  private async inheritedLeadValues(month: string): Promise<RnpPlanRow[]> {
    const rows = await this.prisma.rnpPlan.findMany({
      where: { month: { lt: monthDate(month) }, metric: SETTING_LEAD_VALUE },
      orderBy: [{ month: 'desc' }, { fromDay: 'desc' }],
      select: { team: true, metric: true, fromDay: true, valueCenti: true },
    })
    const last = new Map<string, RnpPlanRow>()
    for (const r of rows) if (!last.has(r.team)) last.set(r.team, { ...r, fromDay: 1 })
    return [...last.values()]
  }

  /**
   * Write typed plan cells: a number sets the month's plan (from day 1), null
   * clears it. A team's FAKT 1 / FAKT 2 live in `team_month_plan` (one row
   * per team, both columns); every other plan in `rnp_plan`. One transaction.
   */
  async savePlanCells(
    month: string,
    cells: readonly { team: string; metric: string; value: number | null }[],
    by: string,
  ): Promise<void> {
    const m = monthDate(month)
    const centi = (v: number) => BigInt(Math.round(v * 100))
    await this.prisma.$transaction(async (tx) => {
      for (const c of cells) {
        if (c.team !== '' && (c.metric === 'fakt1' || c.metric === 'fakt2')) {
          const column = c.metric === 'fakt1' ? 'fakt1Minor' : 'fakt2Minor'
          const value = c.value === null ? null : centi(c.value)
          const row = await tx.teamMonthPlan.upsert({
            where: { month_rop: { month: m, rop: c.team } },
            create: { month: m, rop: c.team, [column]: value, updatedBy: by },
            update: { [column]: value, updatedBy: by },
            select: { fakt1Minor: true, fakt2Minor: true },
          })
          // «No plan» is the absence of a row, never a row of two nulls.
          if (row.fakt1Minor === null && row.fakt2Minor === null) await tx.teamMonthPlan.delete({ where: { month_rop: { month: m, rop: c.team } } })
          continue
        }
        const key = { month: m, team: c.team, metric: c.metric, fromDay: 1 }
        if (c.value === null) await tx.rnpPlan.deleteMany({ where: key })
        else
          await tx.rnpPlan.upsert({
            where: { month_team_metric_fromDay: key },
            create: { ...key, valueCenti: centi(c.value), updatedBy: by },
            update: { valueCenti: centi(c.value), updatedBy: by },
          })
      }
    }, { maxWait: CONNECTION_WAIT_MS, timeout: 15_000 })
  }
}

/**
 * Each day of [from, to] with the instant it ends — Tashkent midnight, or
 * `now` for a day not over yet. Days that have not begun are left out.
 */
export function dayEnds(from: string, to: string, timeZone: string, now: Date): { day: string; end: Date }[] {
  const out: { day: string; end: Date }[] = []
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86_400_000)) {
    const day = d.toISOString().slice(0, 10)
    const start = zonedMidnight(day, timeZone)
    if (start >= now) break
    const next = zonedMidnight(new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10), timeZone)
    out.push({ day, end: next < now ? next : now })
  }
  return out
}

/** The instant a calendar day begins in `timeZone`. */
function zonedMidnight(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(new TZDate(y!, m! - 1, d!, timeZone).getTime())
}

/**
 * How many distinct orders were standing in a packing stage at each instant:
 * a stay covers an instant it began before and had not left by. Exported for
 * its test.
 */
export function notPackedAt(
  stays: readonly { dealId: string; enteredAt: Date; leftAt: Date | null }[],
  instants: readonly Date[],
): number[] {
  return instants.map((t) => {
    const standing = new Set<string>()
    for (const s of stays) {
      if (s.enteredAt < t && (s.leftAt === null || s.leftAt >= t)) standing.add(s.dealId)
    }
    return standing.size
  })
}
