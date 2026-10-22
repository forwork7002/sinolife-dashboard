/**
 * «Registratsiya» — the day's handed-out leads per ROP team, and the
 * administrator's daily split of them. See `domain/registration/leadSplit.ts`.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import {
  type BezkvalHistoryRow,
  type BezkvalLeadRow,
  bezkvalClients,
  bezkvalDayRows,
} from '@/server/domain/registration/bezkval'
import { type BezkvalDayRow, canonicalRop, type DistributedDayRow, type SavedSplit, type SplitShare } from '@/server/domain/registration/leadSplit'
import type { RosterMember, SellerCallRow, SellerLeadRow } from '@/server/domain/registration/ropReport'

import { InsightsRepository } from './insightsRepository'

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`)

/** «Безквал»'s window read a week at a time — see `bezkvalLeads`. */
const BEZKVAL_CHUNK_DAYS = 7

/** `from`…`to` (inclusive calendar days) cut into runs of at most `size` days, in order. */
export function dayChunks(from: string, to: string, size: number): [string, string][] {
  const out: [string, string][] = []
  const step = (day: string, n: number) => {
    const t = new Date(`${day}T00:00:00Z`)
    t.setUTCDate(t.getUTCDate() + n)
    return t.toISOString().slice(0, 10)
  }
  for (let lo = from; lo <= to; lo = step(lo, size)) {
    const hi = step(lo, size - 1)
    out.push([lo, hi < to ? hi : to])
  }
  return out
}

/** A row of `bezkvalLeadsSql`, as node-postgres hands it over. */
export interface BezkvalLeadSqlRow {
  deal_id: string
  external_id: string | null
  at: Date
  day: string
  hour: number
  lead_guard: boolean
  born_category: number | null
  pipeline: string | null
  contact_id: string | null
  phones: string[] | null
  deal_phone: string | null
  rop: string | null
  rop_primary: string | null
  source?: string | null
  stage?: string | null
  pipeline_name?: string | null
}

export class RegistrationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** `from` / `to` are inclusive `YYYY-MM-DD`. */
  async distributedDays(from: string, to: string): Promise<DistributedDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ day: string; rop: string | null; leads: bigint; duplicates: bigint }[]>(
      RegistrationRepository.distributedDaysSql(),
      from,
      to,
    )
    return rows.map((r) => ({ day: r.day, rop: r.rop, leads: Number(r.leads), duplicates: Number(r.duplicates) }))
  }

  /**
   * The ROP is read exactly as «RNP jadvali»'s `leadDaysSql` reads it — the
   * team the person heads, then the team they sit in, else null — so the two
   * screens agree on every team's leads. Except on a day the portal re-stamps
   * old deals as handed out (26.09: 1 704): since 2026-10-02 /rnp counts only
   * a deal created at most 30 days before, and this screen still counts them
   * all — the bound was decided for /rnp's «Квал лид сони»; «Lidlar» was
   * left as it was, pending its own decision.
   *
   * NOT THE REGISTRATION DEAL. When a lead is handed out the portal stamps
   * «Лид таркатилган сана» on the Регистрация deal too (29.09: 54 of 343 deals
   * with that date sat in Регистрация, 52 of them the same contact as a
   * handed-out deal, none with a ROP). Counting them would put a lead in
   * «Jami» twice, so a Регистрация deal is left out — unless it names a ROP:
   * a handed-out deal moved back to Регистрация still went to that ROP, and
   * /rnp counts it, so this screen does too.
   *
   * A DUPLICATE is the same contact handed out again the same day: every deal
   * after the contact's first (by creation) that day. A deal with no contact
   * is its own lead.
   */
  static distributedDaysSql(): string {
    return `
      WITH dist AS (
        SELECT
          d."leadDistributedOn" AS day,
          ${RegistrationRepository.leadRopSql()} AS rop,
          row_number() OVER (
            PARTITION BY d."leadDistributedOn", COALESCE(d."customerId", d."id")
            ORDER BY d."createdAtSource", d."id"
          ) AS nth
        ${RegistrationRepository.handedOutSql('BETWEEN $1::date AND $2::date')}
      )
      SELECT
        /* ::text — a bare DATE is built at LOCAL midnight by node-postgres. */
        day::text AS day,
        rop,
        count(*)::bigint AS leads,
        count(*) FILTER (WHERE nth > 1)::bigint AS duplicates
      FROM dist
      GROUP BY 1, 2`
  }

  /**
   * The ROP a handed-out deal went to — ONE rule for «Lidlar» and /rnp
   * (`RnpRepository.leadDaysSql` reads it too), so the two never disagree:
   * the team the «РОП (Первичка)» person heads — of two, the one they sit
   * in — then the team they sit in, else null («Taqsimlanmagan»). The
   * client's portal filter (2026-09-30).
   *
   * BACK TO THAT RULE ON 2026-10-13 (the user: «avval qanday tortilgan
   * bo'lsa, eskisiga qaytarish kerak»). From 07.10 «ROP KVAL LID» came first,
   * then the seller's team: the field also sits on the desk's WON copy, which
   * carries the hand-out day too, so a lead counted twice (13.10: Azizbek 39
   * where the portal had 26), and it names another ROP than «РОП (Первичка)»
   * on ~40% of the day's deals (Sevinch for Maftuna, Asliddin for Sadriddin).
   *
   * Reads `d`, `e` and `dep` from `handedOutJoinsSql`.
   */
  static leadRopSql(): string {
    return `COALESCE(
            (SELECT ${InsightsRepository.ropNameSql('h."name"')}
               FROM "department" h
              WHERE h."headId" = d."leadRopEmployeeId" AND h."isActive"
                AND ${InsightsRepository.ropNameSql('h."name"')} IS NOT NULL
              ORDER BY (h."id" = e."departmentId") DESC, h."name"
              LIMIT 1),
            ${InsightsRepository.ropNameSql('dep."name"')}
          )`
  }

  /** The joins `leadRopSql` reads, on a `"deal" d`. */
  static handedOutJoinsSql(): string {
    return `LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
        LEFT JOIN "employee" e ON e."id" = d."leadRopEmployeeId"
        LEFT JOIN "department" dep ON dep."id" = e."departmentId"`
  }

  /** The handed-out deals whose «Лид таркатилган сана» matches `dayPredicate`; see `distributedDaysSql`. */
  private static handedOutSql(dayPredicate: string): string {
    return `FROM "deal" d
        ${RegistrationRepository.handedOutJoinsSql()}
        WHERE d."leadDistributedOn" ${dayPredicate}
          AND (p."role" IS DISTINCT FROM 'LEAD' OR d."leadRopEmployeeId" IS NOT NULL)`
  }

  /** «Безквал» per day × ROP: `from` / `to` are inclusive `YYYY-MM-DD` in `timeZone`. See `domain/registration/bezkval.ts`. */
  async bezkvalDays(from: string, to: string, timeZone: string): Promise<BezkvalDayRow[]> {
    return bezkvalDayRows(bezkvalClients(await this.bezkvalLeads(from, to, timeZone)))
  }

  /**
   * Every lead of `from`…`to` (inclusive, `timeZone` days); `detail` adds the
   * source, stage and pipeline names.
   *
   * A MONTH IS READ IN WEEKS, SIDE BY SIDE (2026-10-22). One statement over
   * the grid's 29 settled days ran past the web pool's 20 s statement timeout
   * cold on production — the old «Безквал» read did, that afternoon: a past
   * day on «Lidlar» answered 500. Each lead belongs to one day by its own
   * instant, so the weeks never overlap and simply add up.
   */
  async bezkvalLeads(from: string, to: string, timeZone: string, detail = false): Promise<BezkvalLeadRow[]> {
    const sql = RegistrationRepository.bezkvalLeadsSql(detail)
    const parts = await Promise.all(
      dayChunks(from, to, BEZKVAL_CHUNK_DAYS).map(([lo, hi]) => this.prisma.$queryRawUnsafe<BezkvalLeadSqlRow[]>(sql, lo, hi, timeZone)),
    )
    return parts.flat().map(RegistrationRepository.bezkvalLeadOf)
  }

  /** One row of `bezkvalLeadsSql` as the domain reads it — shared with `RnpRepository.bezkvalDays`. */
  static bezkvalLeadOf(r: BezkvalLeadSqlRow): BezkvalLeadRow {
    return {
      dealId: r.deal_id,
      externalId: r.external_id,
      day: r.day,
      at: r.at,
      hour: Number(r.hour),
      leadGuard: r.lead_guard,
      bornCategory: r.born_category === null ? null : Number(r.born_category),
      pipeline: r.pipeline,
      contactId: r.contact_id,
      phones: r.phones ?? [],
      dealPhone: r.deal_phone,
      rop: r.rop,
      ropPrimary: r.rop_primary,
      ...(r.source !== undefined ? { source: r.source, stage: r.stage ?? null, pipelineName: r.pipeline_name ?? null } : {}),
    }
  }

  /**
   * The leads of a window of Tashkent days, ONE ROW PER DEAL — the client's
   * spec of 2026-10-22, grouped into clients in `domain/registration/bezkval.ts`
   * (union-find over a contact's numbers is not a GROUP BY). In SQL:
   *
   * A LEAD: born in Регистрация (#0) or Первичный отдел (#12) by its
   * `crm_deal_birth` row, or standing in one of them now (an «ИИ обработка»
   * deal moved into Регистрация, a deal the births feed has not reached).
   * Every stage, «Дубликат (лид)» too.
   *
   * ITS INSTANT: «Лид тушган сана» when «Как поступил лид» names Lead Guard —
   * the deal reached the portal after the fact — else DATE_CREATE. A late deal
   * is found through the arrival index, so the window reads both indexes and
   * keeps a deal whose instant falls inside it.
   *
   * ITS NUMBERS: `phone_nines` over every number of the contact (the function
   * the migration made, the last nine digits). Its contact: the customer's
   * portal id, else the id the deal names while the customer pass has not
   * linked it yet — two such deals are still one contact.
   *
   * ITS ROP: «ROP KVAL LID» and «РОП (Первичка)», each as the team that person
   * heads (or a «… rop» registrar's unit, `bezkvalOwnerRopSql`), else the
   * person's own name — the spec takes the name from the portal's user list,
   * never a list typed here, so a name the field holds is never lost.
   */
  static bezkvalLeadsSql(detail = false): string {
    const lo = `(($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    const hi = `(($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    const local = `(x.at AT TIME ZONE 'UTC' AT TIME ZONE $3)`
    /*
      THE ROP NAMES ONCE PER PERSON, NOT PER DEAL: a month is ~90 000 deals
      and a dozen people in the two fields, and the head / «… rop» rule is two
      correlated reads — so the window is read first (MATERIALIZED) and the
      names of the people it names after, then joined back.
    */
    return `
      WITH w AS MATERIALIZED (
        SELECT d."id" AS deal_id,
               d."externalId" AS external_id,
               x.at,
               ${local}::date::text AS day,
               extract(hour FROM ${local})::int AS hour,
               x.lead_guard,
               b."categoryId" AS born_category,
               p."externalId" AS pipeline,
               COALESCE(cu."externalId", d."metadata"->>'contactId') AS contact_id,
               CASE WHEN cu."id" IS NULL THEN '{}'::text[] ELSE phone_nines(cu."phones" || cu."phone") END AS phones,
               d."dealPhone" AS deal_phone,
               d."ropKvalLidEmployeeId" AS rop_id,
               d."leadRopEmployeeId" AS rop_primary_id${
                 detail
                   ? `,
               s."name" AS source,
               st."name" AS stage,
               p."name" AS pipeline_name`
                   : ''
               }
          FROM "deal" d
          CROSS JOIN LATERAL (
            SELECT COALESCE(d."leadVia" ILIKE '%lead guard%' AND d."leadArrivedAt" IS NOT NULL, false) AS lead_guard
          ) g
          CROSS JOIN LATERAL (
            SELECT CASE WHEN g.lead_guard THEN d."leadArrivedAt" ELSE d."createdAtSource" END AS at, g.lead_guard
          ) x
          LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
          LEFT JOIN LATERAL (
            SELECT b."categoryId"
              FROM "crm_deal_birth" b
             WHERE b."dealExternalId" = d."externalId" AND b."externalSource" = d."externalSource"
             ORDER BY b."bornAt", b."externalId"
             LIMIT 1
          ) b ON true
          LEFT JOIN "customer" cu ON cu."id" = d."customerId"${
            detail
              ? `
          LEFT JOIN "sales_source" s ON s."id" = d."sourceId"
          LEFT JOIN "deal_stage" st ON st."id" = d."stageId"`
              : ''
          }
         WHERE ((d."createdAtSource" >= ${lo} AND d."createdAtSource" < ${hi})
                OR (d."leadArrivedAt" >= ${lo} AND d."leadArrivedAt" < ${hi}))
           AND x.at >= ${lo} AND x.at < ${hi}
           AND (b."categoryId" IN (0, 12) OR p."externalId" IN ('0', '12'))
      ),
      names AS MATERIALIZED (
        SELECT o."id", COALESCE(${RegistrationRepository.bezkvalOwnerRopSql('o')}, o."fullName") AS name
          FROM "employee" o
         WHERE o."id" IN (SELECT rop_id FROM w UNION SELECT rop_primary_id FROM w)
      )
      SELECT w.*, k.name AS rop, lr.name AS rop_primary
        FROM w
        LEFT JOIN names k ON k."id" = w.rop_id
        LEFT JOIN names lr ON lr."id" = w.rop_primary_id`
  }

  /**
   * What came BEFORE the day for each of its numbers and number-less
   * contacts — «30 kunda yangi» and «Butunlay yangi» (the spec's 4.5).
   * `$1` the day, `$2` its numbers (nine digits), `$3` its contacts' portal
   * ids, `$4` the time zone.
   *
   * A number finds every contact that holds it (`phone_nines`, through its
   * GIN index — the portal's `crm.duplicate.findbycomm`), and through them
   * their deals; a contact key finds its own. Per key: the latest LEAD (the
   * rule and the instant of `bezkvalLeadsSql`) of the 30 days before the day,
   * and the latest deal of any pipeline but HR (#8) before it. A deal's
   * secondary contacts are not read (the sync keeps CONTACT_ID only).
   */
  static bezkvalHistorySql(): string {
    const lo = `(($1::date)::timestamp AT TIME ZONE $4 AT TIME ZONE 'UTC')`
    return `
      WITH owners AS MATERIALIZED (
        SELECT DISTINCT 'p:' || n.nine AS key, cu."id" AS customer_id
          FROM "customer" cu
          CROSS JOIN LATERAL unnest(phone_nines(cu."phones" || cu."phone")) AS n(nine)
         WHERE phone_nines(cu."phones" || cu."phone") && $2::text[]
           AND n.nine = ANY($2::text[])
        UNION
        SELECT 'c:' || cu."externalId", cu."id"
          FROM "customer" cu
         WHERE cu."externalId" = ANY($3::text[])
      ),
      -- LATERAL behind OFFSET 0 (no pull-up), so each contact's deals come off
      -- the customerId index: joined plainly, the planner took «owners» for
      -- millions of rows and hashed every deal of the portal (PGlite, 2026-10-22).
      prior AS (
        SELECT o.key, y.*
          FROM owners o
          CROSS JOIN LATERAL (
            SELECT d."externalId" AS external_id,
                   p."name" AS pipeline,
                   x.at,
                   (b."categoryId" IN (0, 12) OR p."externalId" IN ('0', '12')) AS is_lead
              FROM "deal" d
              LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
              CROSS JOIN LATERAL (
                SELECT CASE WHEN COALESCE(d."leadVia" ILIKE '%lead guard%' AND d."leadArrivedAt" IS NOT NULL, false)
                            THEN d."leadArrivedAt" ELSE d."createdAtSource" END AS at
              ) x
              LEFT JOIN LATERAL (
                SELECT b."categoryId"
                  FROM "crm_deal_birth" b
                 WHERE b."dealExternalId" = d."externalId" AND b."externalSource" = d."externalSource"
                 ORDER BY b."bornAt", b."externalId"
                 LIMIT 1
              ) b ON true
             WHERE d."customerId" = o.customer_id
               AND x.at < ${lo}
               AND p."externalId" IS DISTINCT FROM '8'
            OFFSET 0
          ) y
      )
      SELECT DISTINCT ON (key)
             key,
             external_id,
             pipeline,
             at,
             max(at) FILTER (WHERE is_lead AND at >= ${lo} - interval '30 days') OVER (PARTITION BY key) AS last_lead_at
        FROM prior
       ORDER BY key, at DESC, external_id DESC`
  }

  /** `bezkvalHistorySql` for one day's keys. */
  async bezkvalHistory(day: string, timeZone: string, phones: readonly string[], contactIds: readonly string[]): Promise<BezkvalHistoryRow[]> {
    if (phones.length === 0 && contactIds.length === 0) return []
    const rows = await this.prisma.$queryRawUnsafe<
      { key: string; external_id: string | null; pipeline: string | null; at: Date; last_lead_at: Date | null }[]
    >(RegistrationRepository.bezkvalHistorySql(), day, [...phones], [...contactIds], timeZone)
    return rows.map((r) => ({
      key: r.key,
      lastLeadAt: r.last_lead_at,
      lastDeal: { externalId: r.external_id, at: r.at, pipeline: r.pipeline },
    }))
  }

  /** Where the births feed is whole from (`lead_watch_sync` row 'births'), or null before its first pass. */
  async dealBirthsFrom(): Promise<Date | null> {
    const row = await this.prisma.leadWatchSync.findUnique({ where: { id: 'births' }, select: { state: true, lastSuccessAt: true } })
    if (!row?.lastSuccessAt) return null
    const from = (row.state as { from?: unknown } | null)?.from
    return typeof from === 'string' && !Number.isNaN(new Date(from).getTime()) ? new Date(from) : null
  }

  /**
   * The ROP an owner (the `employee` row aliased `o`) stands for in «Безквал»:
   * the team they head — of two, the one they sit in, as `leadRopSql` reads a
   * head — then, for a registrar whose portal name carries «rop» («Davlat
   * imomaliyev 104 rop», the client 2026-10-05), the ROP unit the portal lists
   * them in (`department_member`; the primary first) — else null. Any other
   * registrar sitting in a ROP's unit owns the deal as the desk, not as that ROP.
   */
  private static bezkvalOwnerRopSql(o: string): string {
    return `COALESCE(
            (SELECT ${InsightsRepository.ropNameSql('h."name"')}
               FROM "department" h
              WHERE h."headId" = ${o}."id" AND h."isActive"
                AND ${InsightsRepository.ropNameSql('h."name"')} IS NOT NULL
              ORDER BY (h."id" = ${o}."departmentId") DESC, h."name"
              LIMIT 1),
            (SELECT ${InsightsRepository.ropNameSql('md."name"')}
               FROM "department_member" m
               JOIN "department" md ON md."id" = m."departmentId" AND md."isActive"
              WHERE m."employeeId" = ${o}."id"
                AND ${o}."fullName" ~* '(^|[^[:alpha:]])rop([^[:alpha:]]|$)'
                AND ${InsightsRepository.ropNameSql('md."name"')} IS NOT NULL
              ORDER BY m."isPrimary" DESC, md."name"
              LIMIT 1)
          )`
  }

  /** The handed-out leads of `from`…`to` (inclusive) per ROP team × seller. */
  async sellerLeads(from: string, to: string): Promise<SellerLeadRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ rop: string | null; employee_id: string | null; leads: bigint }[]>(
      RegistrationRepository.sellerLeadsSql(),
      from,
      to,
    )
    return rows.map((r) => ({ rop: r.rop, employeeId: r.employee_id, leads: Number(r.leads) }))
  }

  /**
   * «Лид сони» of «ROP otchet»: the deals `distributedDaysSql` counts — the
   * same rows, the same team — cut by the person the deal is with, the
   * operator the portal stamped or else its owner, exactly the person the
   * sellers board credits the order to. So a group's leads sum to its «Olgan
   * lid», duplicates included, as the portal counts them.
   */
  static sellerLeadsSql(): string {
    return `
      SELECT
        ${RegistrationRepository.leadRopSql()} AS rop,
        COALESCE(d."operatorEmployeeId", d."employeeId") AS employee_id,
        count(*)::bigint AS leads
      ${RegistrationRepository.handedOutSql('BETWEEN $1::date AND $2::date')}
      GROUP BY 1, 2`
  }

  /**
   * Every active person in a ROP team — the team's head and everybody whose
   * PRIMARY unit it is — so a seller with no lead and no order today is still
   * a row, as on the client's sheet. Primary, never `department_member`: this
   * is a money table, and a person in two units would sit on two teams' rows.
   * A head is in the team they head — of several, the one they sit in, as
   * `leadRopSql` reads it, then the first by name.
   */
  async roster(): Promise<RosterMember[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ employee_id: string; full_name: string; rop: string; is_head: boolean }[]>(
      RegistrationRepository.rosterSql(),
    )
    return rows.map((r) => ({ employeeId: r.employee_id, fullName: r.full_name, rop: r.rop, isHead: r.is_head }))
  }

  /** `roster`'s statement. Exported for its test. */
  static rosterSql(): string {
    return `
      SELECT DISTINCT ON (x.employee_id) x.employee_id, e."fullName" AS full_name, x.rop, x.is_head
        FROM (
          SELECT h."headId" AS employee_id, ${InsightsRepository.ropNameSql('h."name"')} AS rop, true AS is_head, 0 AS rank, h."id" AS unit_id, h."name"
            FROM "department" h
           WHERE h."isActive" AND h."headId" IS NOT NULL
          UNION ALL
          SELECT m."id", ${InsightsRepository.ropNameSql('dep."name"')}, false, 1, dep."id", dep."name"
            FROM "employee" m
            JOIN "department" dep ON dep."id" = m."departmentId" AND dep."isActive"
        ) x
        JOIN "employee" e ON e."id" = x.employee_id AND e."isActive"
       WHERE x.rop IS NOT NULL
       ORDER BY x.employee_id, x.rank, (x.unit_id = e."departmentId") DESC, x."name"`
  }

  /** Names for people credited with leads or orders who are on no roster. */
  async names(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await this.prisma.employee.findMany({ where: { id: { in: [...ids] } }, select: { id: true, fullName: true } })
    return new Map(rows.map((r) => [r.id, r.fullName]))
  }

  /** One day's connected calls per person; `start` / `end` are the day's instants, end exclusive. */
  async sellerCalls(start: Date, end: Date): Promise<SellerCallRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ employee_id: string; connected: bigint; talk_sec: bigint }[]>(
      RegistrationRepository.sellerCallsSql(),
      start,
      end,
    )
    return rows.map((r) => ({ employeeId: r.employee_id, connected: Number(r.connected), talkSec: Number(r.talk_sec) }))
  }

  /**
   * «Дозвон» and «Длительность» of «ROP otchet»: the «Ulangan» and «Suhbat
   * vaqti» `InsightsRepository.callActivity` gives the same person — every
   * direction, talk time over connected legs only — so the two screens never
   * disagree about one seller's day. Read off the (employeeId, startedAt) index.
   */
  static sellerCallsSql(): string {
    return `
      SELECT
        c."employeeId" AS employee_id,
        count(*)::bigint AS connected,
        COALESCE(sum(c."durationSec"), 0)::bigint AS talk_sec
      FROM "call_record" c
      WHERE c."connected"
        AND c."employeeId" IS NOT NULL
        AND c."startedAt" >= $1 AND c."startedAt" < $2
      GROUP BY 1`
  }

  async split(day: string): Promise<SavedSplit | null> {
    const rows = await this.prisma.registrationSplit.findMany({
      where: { day: dateOf(day) },
      select: { rop: true, shareBp: true, updatedAt: true },
    })
    if (rows.length === 0) return null
    const updatedAt = rows.reduce((t, r) => (r.updatedAt > t ? r.updatedAt : t), rows[0]!.updatedAt)
    return { rows: rows.map((r) => ({ rop: r.rop, shareBp: r.shareBp })), updatedAt: updatedAt.toISOString() }
  }

  /** The latest day before `day` that has a split, with its rows. */
  async previousSplit(day: string): Promise<{ day: string; rows: SplitShare[] } | null> {
    const last = await this.prisma.registrationSplit.findFirst({
      where: { day: { lt: dateOf(day) } },
      orderBy: { day: 'desc' },
      select: { day: true },
    })
    if (!last) return null
    const rows = await this.prisma.registrationSplit.findMany({
      where: { day: last.day },
      select: { rop: true, shareBp: true },
    })
    return { day: last.day.toISOString().slice(0, 10), rows }
  }

  /**
   * Replace the day's split. One transaction: a reader never sees half of it.
   * The day's advisory lock makes two saves of one day take turns — without it
   * both deletes run first and the second insert dies on the unique index.
   * Team names are stored canonical, as the screen reads them.
   */
  async saveSplit(day: string, rows: readonly SplitShare[], by: string): Promise<void> {
    const date = dateOf(day)
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('registration_split:' || $1))`, day)
      await tx.registrationSplit.deleteMany({ where: { day: date } })
      await tx.registrationSplit.createMany({
        data: rows.map((r) => ({ day: date, rop: canonicalRop(r.rop), shareBp: r.shareBp, updatedBy: by })),
      })
    })
  }
}
