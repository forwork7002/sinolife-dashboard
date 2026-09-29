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

import { TZDate } from '@date-fns/tz'

import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import { NOT_PACKED_STAGES } from '@/server/integrations/crm/bitrix24/mapping'

import { InsightsRepository } from './insightsRepository'

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

export interface RnpRegistrarKvalRow {
  readonly day: string
  readonly registrar: string | null
  readonly qualified: number
}

export interface RnpRegistrarGroupRow {
  readonly registrar: string
  readonly group: string
}

export interface RnpManualDayRow {
  readonly day: string
  readonly team: string
  readonly metric: string
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
      {
        day: string
        source_id: string | null
        form_title: string | null
        leads: bigint
        duplicates: bigint
        qualified: bigint
        ai: bigint
      }[]
    >(RnpRepository.registrationDaysSql(), from, to, this.tz)
    return rows.map((r) => ({
      day: r.day,
      sourceId: r.source_id,
      formTitle: r.form_title,
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
    /*
      Grouped by source and CRM-form title as well as the day, so the P&L can
      tell a Collagen lead from a Zextra one — the SAME scan, which is the
      whole cost of this statement; a form's deals share one title, so the
      rows stay a few hundred. Two arms UNIONed and summed rather than a FULL
      JOIN: the join key would hold nulls, and a FULL JOIN will not hash on
      IS NOT DISTINCT FROM.
    */
    const form = `CASE WHEN d."title" LIKE '%CRM-форм%' THEN d."title" END`
    return `
      WITH arms AS (
        SELECT ${day('d."createdAtSource"')} AS day,
               s."externalId" AS source_id,
               ${form} AS form_title,
               count(*) FILTER (WHERE p."role" = 'LEAD' AND COALESCE(st."name", '') !~ '[Дд]убл') AS leads,
               count(*) FILTER (WHERE p."role" = 'LEAD' AND COALESCE(st."name", '') ~ '[Дд]убл') AS duplicates,
               0::bigint AS qualified,
               count(*) FILTER (WHERE p."role" = 'AI_TRIAGE') AS ai
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" IN ('LEAD', 'AI_TRIAGE')
        LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
        LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
        WHERE d."createdAtSource" >= ${lo} AND d."createdAtSource" < ${hi}
        GROUP BY 1, 2, 3
        UNION ALL
        SELECT ${day('d."closedAt"')} AS day,
               s."externalId" AS source_id,
               ${form} AS form_title,
               0, 0, count(*), 0
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
        LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
        WHERE d."status" = 'WON' AND d."closedAt" >= ${lo} AND d."closedAt" < ${hi}
        GROUP BY 1, 2, 3
      )
      SELECT day::text AS day, source_id, form_title,
             sum(leads)::bigint AS leads,
             sum(duplicates)::bigint AS duplicates,
             sum(qualified)::bigint AS qualified,
             sum(ai)::bigint AS ai
      FROM arms
      GROUP BY 1, 2, 3`
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
   * in the 62 days before it or inside it, plus the stays still open on a
   * deal standing there now however old — an order parked since spring is
   * «не собран» on every day of this month, and a lower bound alone would
   * lose it.
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
        AND (h."leftAt" IS NULL OR h."leftAt" >= ${lo})
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

  /**
   * The month's registrar → «guruh» assignments — or, for a month nobody has
   * grouped yet, the latest earlier month's: the desk does not reshuffle on
   * the 1st, and without this every October kval would fall to «Guruhsiz»
   * until somebody retyped September's groups. Saving the form writes the
   * month's own rows, which then win.
   */
  async registrarGroups(month: string): Promise<RnpRegistrarGroupRow[]> {
    const own = await this.prisma.rnpRegistrarGroup.findMany({
      where: { month: monthDate(month) },
      select: { registrar: true, group: true },
    })
    if (own.length > 0) return own
    const previous = await this.prisma.rnpRegistrarGroup.findFirst({
      where: { month: { lt: monthDate(month) } },
      orderBy: { month: 'desc' },
      select: { month: true },
    })
    if (!previous) return []
    return this.prisma.rnpRegistrarGroup.findMany({
      where: { month: previous.month },
      select: { registrar: true, group: true },
    })
  }

  /** Replace what the form names; a null group removes the registrar from every group. */
  async saveRegistrarGroups(
    month: string,
    rows: readonly { registrar: string; group: string | null }[],
    by: string,
  ): Promise<void> {
    const m = monthDate(month)
    /*
      The form sends only what changed. On a month still reading the previous
      month's groups, write those down first — or the one change saved would
      become the month's only row and every inherited group would vanish.
    */
    const hasOwn = (await this.prisma.rnpRegistrarGroup.count({ where: { month: m } })) > 0
    const inherited = hasOwn ? [] : await this.registrarGroups(month)
    await this.prisma.$transaction([
      ...inherited.map((g) =>
        this.prisma.rnpRegistrarGroup.create({ data: { month: m, registrar: g.registrar, group: g.group, updatedBy: by } }),
      ),
      ...rows.map((r) =>
        r.group === null
          ? this.prisma.rnpRegistrarGroup.deleteMany({ where: { month: m, registrar: r.registrar } })
          : this.prisma.rnpRegistrarGroup.upsert({
              where: { month_registrar: { month: m, registrar: r.registrar } },
              create: { month: m, registrar: r.registrar, group: r.group, updatedBy: by },
              update: { group: r.group, updatedBy: by },
            }),
      ),
    ])
  }

  /** Every typed day cell of [from, to] (inclusive `YYYY-MM-DD`). */
  async manualDays(from: string, to: string): Promise<RnpManualDayRow[]> {
    const rows = await this.prisma.rnpManualDay.findMany({
      where: { day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      select: { day: true, team: true, metric: true, valueCenti: true },
    })
    return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), team: r.team, metric: r.metric, valueCenti: r.valueCenti }))
  }

  /**
   * Write what the screen sent, in ONE transaction. Null deletes the cell —
   * «nobody typed it» is the absence of a row. Unlike a plan, ZERO and
   * NEGATIVE values are kept: a Telegram channel that lost 16 subscribers
   * typed -16, and a day with no posts typed 0.
   */
  async saveManualDays(
    rows: readonly { day: string; team: string; metric: string; valueCenti: bigint | null }[],
    by: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      rows.map((r) => {
        const key = { day: new Date(`${r.day}T00:00:00Z`), team: r.team, metric: r.metric }
        return r.valueCenti === null
          ? this.prisma.rnpManualDay.deleteMany({ where: key })
          : this.prisma.rnpManualDay.upsert({
              where: { day_team_metric: key },
              create: { ...key, valueCenti: r.valueCenti, updatedBy: by },
              update: { valueCenti: r.valueCenti, updatedBy: by },
            })
      }),
    )
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
