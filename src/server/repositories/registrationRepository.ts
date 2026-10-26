/**
 * «Registratsiya» — the day's handed-out leads per ROP team, and the
 * administrator's daily split of them. See `domain/registration/leadSplit.ts`.
 */

import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { zonedHourStart } from '@/server/domain/period/period'
import {
  type BezkvalBucket,
  type BezkvalClientDealDto,
  type BezkvalClientDto,
  type BezkvalCountedDay,
  type BezkvalHistoryRow,
  type BezkvalKeyKind,
  type BezkvalLeadRow,
  bezkvalClientRows,
  bezkvalClients,
  historyIndex,
  phoneTail,
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

/** Which births `bezkvalLeadsSql` reads: Регистрация's and «ИИ»'s moves into it, or Первичный отдел's. */
export type BezkvalFlow = 'bezkval' | 'kval'

/** A row of `bezkvalLeadsSql`, as node-postgres hands it over. */
export interface BezkvalLeadSqlRow {
  deal_id: string
  external_id: string | null
  at: Date
  day: string
  hour: number
  entry: string
  lead_guard: boolean
  contact_id: string | null
  phones: string[] | null
  deal_phone: string | null
  rop_kval: string | null
  rop_primary: string | null
  owner_rop: string | null
  owner_desk: boolean
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

  /**
   * «Безквал» per day × ROP, `from` / `to` inclusive — READ FROM WHAT THE
   * WORKER STORED (`bezkval_client`, 2026-10-24), never computed here: the
   * month computed per request ran past the web pool's 20 s statement timeout
   * on production. See `computeBezkvalDay` for how a day is counted.
   */
  async bezkvalDays(from: string, to: string): Promise<BezkvalDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ day: string; rop: string | null; leads: bigint; deals: bigint }[]>(
      RegistrationRepository.storedBezkvalDaysSql(),
      from,
      to,
    )
    return rows.map((r) => ({ day: r.day, rop: r.rop, leads: Number(r.leads), deals: Number(r.deals) }))
  }

  /** `bezkvalDays`'s statement — shared with `RnpRepository.bezkvalDays`. ::text: a bare DATE is built at LOCAL midnight by node-postgres. */
  static storedBezkvalDaysSql(): string {
    return `
      SELECT c."day"::text AS day, c."rop", count(*)::bigint AS leads, sum(c."dealCount")::bigint AS deals
        FROM "bezkval_client" c
       WHERE c."day" BETWEEN $1::date AND $2::date
       GROUP BY 1, 2`
  }

  /** The stored clients of one day — безквал and kval — and when the worker computed it (null: not yet). */
  async storedBezkvalDay(day: string): Promise<{ computedAt: Date | null; clients: BezkvalClientDto[]; kval: BezkvalClientDto[] }> {
    const [mark, rows, kval] = await Promise.all([
      this.prisma.bezkvalDay.findUnique({ where: { day: dateOf(day) }, select: { computedAt: true } }),
      this.prisma.bezkvalClient.findMany({ where: { day: dateOf(day) } }),
      this.prisma.kvalClient.findMany({ where: { day: dateOf(day) } }),
    ])
    const byFirst = (a: BezkvalClientDto, b: BezkvalClientDto) => (a.deals[0]?.at ?? '').localeCompare(b.deals[0]?.at ?? '')
    const clients = rows
      .map(
        (r): BezkvalClientDto => ({
          phone: r.phone,
          kind: r.kind as BezkvalKeyKind,
          rop: r.rop,
          // A row counted before the buckets were stored: a team, else nobody's.
          bucket: (r.bucket as BezkvalBucket | null) ?? (r.rop === null ? 'unassigned' : 'rop'),
          source: r.source,
          hour: r.hour,
          status: r.newEver ? 'new' : r.new30 ? 'old' : 't30',
          multiRop: r.multiRop,
          previous: (r.previous as BezkvalClientDto['previous'] | null) ?? null,
          deals: r.deals as unknown as BezkvalClientDealDto[],
        }),
      )
      .sort(byFirst)
    const kvalClients = kval
      .map(
        (r): BezkvalClientDto => ({
          phone: r.phone,
          kind: r.kind as BezkvalKeyKind,
          rop: r.rop,
          bucket: r.bucket as BezkvalBucket,
          source: r.source,
          hour: r.hour,
          status: null,
          multiRop: false,
          previous: null,
          deals: r.deals as unknown as BezkvalClientDealDto[],
        }),
      )
      .sort(byFirst)
    return { computedAt: mark?.computedAt ?? null, clients, kval: kvalClients }
  }

  /** When each day of `from`…`to` was computed, and by which rules; a day missing has never been. */
  async bezkvalComputedDays(from: string, to: string): Promise<Map<string, { at: Date; rules: string | null }>> {
    const rows = await this.prisma.bezkvalDay.findMany({
      where: { day: { gte: dateOf(from), lte: dateOf(to) } },
      select: { day: true, computedAt: true, rules: true },
    })
    return new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), { at: r.computedAt, rules: r.rules }]))
  }

  /** Both stage-history feeds — births and moves — have reached the newest row at least once (`bezkvalRefresh.ts`). */
  async bezkvalReady(): Promise<boolean> {
    const rows = await this.prisma.leadWatchSync.findMany({
      where: { id: { in: ['births', 'moves'] }, lastSuccessAt: { not: null } },
      select: { id: true },
    })
    return rows.length === 2
  }

  /**
   * ONE DAY OF «БЕЗКВАЛ», COUNTED — the sync worker's job (`bezkvalRefresh.ts`):
   * the day's kirim deals (`bezkvalLeadsSql`), grouped into clients by
   * union-find, each client's numbers looked up before the day
   * (`bezkvalHistorySql`), the ROP names folded to today's teams («RNP
   * jadvali»'s `canonicalRop`); and beside them the day's Первичный отдел
   * births, grouped the same way — «Kval».
   */
  async computeBezkvalDay(day: string, timeZone: string): Promise<BezkvalCountedDay> {
    // One after the other, not side by side: the database has one core and the worker's pool five connections.
    const deals = await this.bezkvalLeads(day, day, timeZone, true, 'bezkval')
    const kvalDeals = await this.bezkvalLeads(day, day, timeZone, true, 'kval')
    const clients = bezkvalClients(deals)
    const tails = [...new Set(clients.flatMap((c) => c.phones.map(phoneTail)))]
    const contacts = [...new Set(clients.filter((c) => c.phones.length === 0).flatMap((c) => c.contactIds))]
    const history = await this.bezkvalHistory(day, timeZone, tails, contacts)
    // Noon UTC falls on the same calendar day in every zone this app runs in.
    const dayStart = zonedHourStart(new Date(`${day}T12:00:00Z`), timeZone, 0)
    const canon = (rop: string | null) => (rop === null ? null : canonicalRop(rop))
    const folded = ({ key, client }: { key: string; client: BezkvalClientDto }) => ({
      key,
      client: { ...client, rop: canon(client.rop), deals: client.deals.map((d) => ({ ...d, rop: canon(d.rop) })) },
    })
    return {
      clients: bezkvalClientRows(day, clients, { index: historyIndex(history), dayStart }).map(folded),
      kval: bezkvalClientRows(day, bezkvalClients(kvalDeals), null).map(folded),
    }
  }

  /** Replace one day's stored clients — безквал and kval — in one transaction, so a reader sees the day before or after, never half. */
  async storeBezkvalDay(day: string, counted: BezkvalCountedDay, at: Date, rules: string): Promise<void> {
    const date = dateOf(day)
    await this.prisma.$transaction(
      async (tx) => {
        await tx.bezkvalClient.deleteMany({ where: { day: date } })
        await tx.kvalClient.deleteMany({ where: { day: date } })
        for (let i = 0; i < counted.clients.length; i += 1_000) {
          await tx.bezkvalClient.createMany({
            data: counted.clients.slice(i, i + 1_000).map(({ key, client: c }) => ({
              day: date,
              key,
              rop: c.rop,
              bucket: c.bucket,
              kind: c.kind,
              phone: c.phone,
              hour: c.hour,
              source: c.source,
              new30: c.status !== 't30',
              newEver: c.status === 'new',
              multiRop: c.multiRop,
              previous: c.previous === null ? Prisma.DbNull : (c.previous as Prisma.InputJsonValue),
              deals: c.deals as unknown as Prisma.InputJsonValue,
              dealCount: c.deals.length,
            })),
          })
        }
        for (let i = 0; i < counted.kval.length; i += 1_000) {
          await tx.kvalClient.createMany({
            data: counted.kval.slice(i, i + 1_000).map(({ key, client: c }) => ({
              day: date,
              key,
              rop: c.rop,
              bucket: c.bucket,
              kind: c.kind,
              phone: c.phone,
              hour: c.hour,
              source: c.source,
              deals: c.deals as unknown as Prisma.InputJsonValue,
              dealCount: c.deals.length,
            })),
          })
        }
        const deals = counted.clients.reduce((n, r) => n + r.client.deals.length, 0)
        const kvalDeals = counted.kval.reduce((n, r) => n + r.client.deals.length, 0)
        const marks = { computedAt: at, deals, clients: counted.clients.length, rules, kvalDeals, kvalClients: counted.kval.length }
        await tx.bezkvalDay.upsert({ where: { day: date }, create: { day: date, ...marks }, update: marks })
      },
      { maxWait: 30_000, timeout: 60_000 },
    )
  }

  /** Who heads each ROP team now, by its canonical name — the names on the client's own sheet. */
  async ropHeads(): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRawUnsafe<{ team: string; head: string }[]>(RegistrationRepository.ropHeadsSql())
    const out = new Map<string, string>()
    for (const r of rows) {
      const team = canonicalRop(r.team)
      if (!out.has(team)) out.set(team, r.head)
    }
    return out
  }

  /** `ropHeads`' statement. */
  static ropHeadsSql(): string {
    return `
      SELECT ${InsightsRepository.ropNameSql('h."name"')} AS team, e."fullName" AS head
        FROM "department" h
        JOIN "employee" e ON e."id" = h."headId"
       WHERE h."isActive" AND ${InsightsRepository.ropNameSql('h."name"')} IS NOT NULL
       ORDER BY 1, h."name"`
  }

  /**
   * Every kirim of `from`…`to` (inclusive, `timeZone` days) — or, `flow`
   * 'kval', every Первичный отдел birth; `detail` adds the source, stage and
   * pipeline names.
   *
   * A MONTH IS READ IN WEEKS, SIDE BY SIDE (2026-10-22). One statement over
   * the grid's 29 settled days ran past the web pool's 20 s statement timeout
   * cold on production — the old «Безквал» read did, that afternoon: a past
   * day on «Lidlar» answered 500. Each kirim belongs to one day by its own
   * instant, so the weeks never overlap and simply add up.
   */
  async bezkvalLeads(from: string, to: string, timeZone: string, detail = false, flow: BezkvalFlow = 'bezkval'): Promise<BezkvalLeadRow[]> {
    const sql = RegistrationRepository.bezkvalLeadsSql(detail, flow)
    const parts = await Promise.all(
      dayChunks(from, to, BEZKVAL_CHUNK_DAYS).map(([lo, hi]) => this.prisma.$queryRawUnsafe<BezkvalLeadSqlRow[]>(sql, lo, hi, timeZone)),
    )
    return parts.flat().map(RegistrationRepository.bezkvalLeadOf)
  }

  /** One row of `bezkvalLeadsSql` as the domain reads it. */
  static bezkvalLeadOf(r: BezkvalLeadSqlRow): BezkvalLeadRow {
    return {
      dealId: r.deal_id,
      externalId: r.external_id,
      day: r.day,
      at: r.at,
      hour: Number(r.hour),
      entry: r.entry === 'ai' ? 'ai' : 'created',
      leadGuard: r.lead_guard,
      contactId: r.contact_id,
      phones: r.phones ?? [],
      dealPhone: r.deal_phone,
      ropKval: r.rop_kval,
      ropPrimary: r.rop_primary,
      ownerRop: r.owner_rop,
      ownerDesk: r.owner_desk,
      ...(r.source !== undefined ? { source: r.source, stage: r.stage ?? null, pipelineName: r.pipeline_name ?? null } : {}),
    }
  }

  /**
   * The kirim deals of a window of Tashkent days, ONE ROW PER DEAL — the
   * client's spec v2 (2026-10-26), grouped into clients in
   * `domain/registration/bezkval.ts` (union-find over a contact's numbers is
   * not a GROUP BY). In SQL:
   *
   * A KIRIM (the spec's 5.1): a deal CREATED in Регистрация (#0) — its
   * `crm_deal_birth` row says so, or, while the births feed has not read it,
   * it stands there now — at its birth's instant; or a deal MOVED into #0
   * from «ИИ обработка» (#20) — a `crm_deal_move` row into #0 whose previous
   * row, the deal's birth or its move before, is in #20 (history ids rise
   * with time across both) — at the move's instant. A deal back from
   * Первичный отдел is not one. Every stage, «Дубликат (лид)» too; a deal in
   * twice in a window is kept at its first entry. `flow` 'kval' reads the
   * births of Первичный отдел (#12) instead, and no moves.
   *
   * ITS NUMBERS go out raw (the domain normalises them, `phoneKey`): every
   * number of the contact — the customer's portal id, else the id the deal
   * names while the customer pass has not linked it yet — and the deal's own
   * «Телефон ракам».
   *
   * ITS PEOPLE (the spec's 5.5), each read once: «ROP KVAL LID», «РОП
   * (Первичка)» and «Ответственный», as the ROP team the person stands for
   * (`bezkvalPersonRopSql`); and whether the owner is the desk — portal user
   * 10 or 1. «Как поступил лид» naming Lead Guard only marks the deal: its
   * day is DATE_CREATE, never «Лид тушган сана» (two hours early on form
   * leads — the spec's fact 4).
   */
  static bezkvalLeadsSql(detail = false, flow: BezkvalFlow = 'bezkval'): string {
    const lo = `(($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    const hi = `(($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`
    const local = `(l.at AT TIME ZONE 'UTC' AT TIME ZONE $3)`
    const category = flow === 'bezkval' ? 0 : 12
    /*
      SET-BASED, NOT PER DEAL (2026-10-22, production). The first version read
      each deal's birth through a LATERAL lookup and normalised each contact's
      numbers with phone_nines() per row: with «crm_deal_birth» new and still
      filling, the planner had no statistics for it, and a month ran past the
      20 s statement timeout — the grid answered 500. The window is read once
      (MATERIALIZED, off the createdAtSource index, an hour wider each side so
      a birth stamped a moment after DATE_CREATE is not lost), its births once
      for its ids, the people once each. The one lookup per row is a move's
      previous category — a few hundred moves a day, each off the deal-id
      indexes of the two small history tables.
    */
    const moves =
      flow === 'bezkval'
        ? `
        UNION ALL
        SELECT d."id", mv."movedAt", 'ai'
          FROM "crm_deal_move" mv
          JOIN "deal" d ON d."externalSource" = mv."externalSource" AND d."externalId" = mv."dealExternalId"
         WHERE mv."categoryId" = 0 AND mv."movedAt" >= ${lo} AND mv."movedAt" < ${hi}
           AND (SELECT e.category
                  FROM (SELECT b."categoryId" AS category, b."externalId"::bigint AS id
                          FROM "crm_deal_birth" b
                         WHERE b."externalSource" = mv."externalSource" AND b."dealExternalId" = mv."dealExternalId"
                        UNION ALL
                        SELECT pm."categoryId", pm."externalId"::bigint
                          FROM "crm_deal_move" pm
                         WHERE pm."externalSource" = mv."externalSource" AND pm."dealExternalId" = mv."dealExternalId") e
                 WHERE e.id < mv."externalId"::bigint
                 ORDER BY e.id DESC
                 LIMIT 1) = 20`
        : ''
    return `
      WITH made AS MATERIALIZED (
        SELECT d."id" AS deal_id,
               d."externalId" AS external_id,
               d."externalSource" AS external_source,
               d."createdAtSource" AS created_at,
               p."externalId" AS pipeline
          FROM "deal" d
          LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
         WHERE d."createdAtSource" >= ${lo} - interval '1 hour' AND d."createdAtSource" < ${hi} + interval '1 hour'
      ),
      born AS MATERIALIZED (
        SELECT DISTINCT ON (b."externalSource", b."dealExternalId") b."externalSource", b."dealExternalId", b."categoryId", b."bornAt"
          FROM "crm_deal_birth" b
         WHERE b."dealExternalId" IN (SELECT external_id FROM made)
         ORDER BY b."externalSource", b."dealExternalId", b."bornAt", b."externalId"
      ),
      entered AS (
        SELECT m.deal_id, COALESCE(born."bornAt", m.created_at) AS at, 'created' AS entry
          FROM made m
          LEFT JOIN born ON born."dealExternalId" = m.external_id AND born."externalSource" = m.external_source
         WHERE CASE WHEN born."categoryId" IS NULL THEN m.pipeline = '${category}' ELSE born."categoryId" = ${category} END${moves}
      ),
      w AS MATERIALIZED (
        SELECT DISTINCT ON (e.deal_id) e.deal_id, e.at, e.entry
          FROM entered e
         WHERE e.at >= ${lo} AND e.at < ${hi}
         ORDER BY e.deal_id, e.at
      ),
      lead AS MATERIALIZED (
        SELECT w.deal_id,
               w.at,
               w.entry,
               d."externalId" AS external_id,
               d."customerId" AS customer_id,
               d."metadata"->>'contactId' AS meta_contact,
               d."dealPhone" AS deal_phone,
               COALESCE(d."leadVia" ILIKE '%lead guard%', false) AS lead_guard,
               d."ropKvalLidEmployeeId" AS rop_id,
               d."leadRopEmployeeId" AS rop_primary_id,
               d."employeeId" AS owner_id${
                 detail
                   ? `,
               d."sourceId" AS source_id,
               d."stageId" AS stage_id,
               d."pipelineId" AS pipeline_id`
                   : ''
               }
          FROM w
          JOIN "deal" d ON d."id" = w.deal_id
      ),
      people AS MATERIALIZED (
        SELECT o."id",
               ${RegistrationRepository.bezkvalPersonRopSql('o')} AS rop,
               (o."externalSource" = 'BITRIX24' AND o."externalId" IN ('1', '10')) AS desk
          FROM "employee" o
         WHERE o."id" IN (SELECT rop_id FROM lead UNION SELECT rop_primary_id FROM lead UNION SELECT owner_id FROM lead)
      )
      SELECT l.deal_id,
             l.external_id,
             l.at,
             ${local}::date::text AS day,
             extract(hour FROM ${local})::int AS hour,
             l.entry,
             l.lead_guard,
             COALESCE(cu."externalId", l.meta_contact) AS contact_id,
             CASE WHEN cu."id" IS NULL THEN '{}'::text[] ELSE array_remove(cu."phones" || cu."phone", NULL) END AS phones,
             l.deal_phone,
             k.rop AS rop_kval,
             lr.rop AS rop_primary,
             ow.rop AS owner_rop,
             COALESCE(ow.desk, false) AS owner_desk${
               detail
                 ? `,
             s."name" AS source,
             st."name" AS stage,
             p."name" AS pipeline_name`
                 : ''
             }
        FROM lead l
        LEFT JOIN "customer" cu ON cu."id" = l.customer_id
        LEFT JOIN people k ON k."id" = l.rop_id
        LEFT JOIN people lr ON lr."id" = l.rop_primary_id
        LEFT JOIN people ow ON ow."id" = l.owner_id${
          detail
            ? `
        LEFT JOIN "sales_source" s ON s."id" = l.source_id
        LEFT JOIN "deal_stage" st ON st."id" = l.stage_id
        LEFT JOIN "pipeline" p ON p."id" = l.pipeline_id`
            : ''
        }`
  }

  /**
   * What came BEFORE the day — «Yangi», «Takror 30 kun», «Takror eski» (the
   * spec's 5.4). `$1` the day, `$2` the last nine digits of its numbers, `$3`
   * its number-less clients' contact ids, `$4` the time zone.
   *
   * A number finds every contact that holds it (`phone_nines`, through its GIN
   * index — candidates by their last nine digits; the domain keeps the exact
   * numbers, `historyIndex`); a contact id finds its own. Per contact: its
   * numbers, and its latest deal CREATED before the day began in any pipeline
   * but HR (#8). A contact with none is not returned. A deal's secondary
   * contacts are not read (the sync keeps CONTACT_ID only).
   */
  static bezkvalHistorySql(): string {
    const lo = `(($1::date)::timestamp AT TIME ZONE $4 AT TIME ZONE 'UTC')`
    /*
      ONE INDEX PROBE PER NUMBER, NOT ONE ARRAY (2026-10-26, PGlite). Asked
      «phone_nines(…) && <a day's ~1 100 numbers>» the planner reckons most
      contacts match, and scans them all, normalising every number of every
      contact: 4 s on 120 000 contacts, the portal has 430 000. One
      single-number containment per number, behind OFFSET 0, keeps each a
      GIN probe. The contact-id arm is skipped outright when there are none.
    */
    return `
      WITH owners AS MATERIALIZED (
        SELECT cu."id" AS customer_id, cu."externalId" AS contact_id, array_remove(cu."phones" || cu."phone", NULL) AS phones
          FROM unnest($2::text[]) AS t(tail)
          CROSS JOIN LATERAL (
            SELECT c."id", c."externalId", c."phones", c."phone"
              FROM "customer" c
             WHERE phone_nines(c."phones" || c."phone") @> ARRAY[t.tail]
            OFFSET 0
          ) cu
        UNION
        SELECT cu."id", cu."externalId", array_remove(cu."phones" || cu."phone", NULL)
          FROM "customer" cu
         WHERE cardinality($3::text[]) > 0 AND cu."externalId" = ANY($3::text[])
      )
      -- One indexed probe per contact (customerId), its newest deal first.
      SELECT o.contact_id, o.phones, y.external_id, y.pipeline, y.at
        FROM owners o
        CROSS JOIN LATERAL (
          SELECT d."externalId" AS external_id, p."name" AS pipeline, d."createdAtSource" AS at
            FROM "deal" d
            LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
           WHERE d."customerId" = o.customer_id
             AND d."createdAtSource" < ${lo}
             AND p."externalId" IS DISTINCT FROM '8'
           ORDER BY d."createdAtSource" DESC, d."externalId" DESC
           LIMIT 1
        ) y`
  }

  /** `bezkvalHistorySql` for one day's numbers (their last nine digits) and number-less contacts. */
  async bezkvalHistory(day: string, timeZone: string, tails: readonly string[], contactIds: readonly string[]): Promise<BezkvalHistoryRow[]> {
    if (tails.length === 0 && contactIds.length === 0) return []
    const rows = await this.prisma.$queryRawUnsafe<
      { contact_id: string | null; phones: string[] | null; external_id: string | null; pipeline: string | null; at: Date }[]
    >(RegistrationRepository.bezkvalHistorySql(), day, [...tails], [...contactIds], timeZone)
    return rows.map((r) => ({
      contactId: r.contact_id,
      phones: r.phones ?? [],
      lastDeal: { externalId: r.external_id, at: r.at, pipeline: r.pipeline },
    }))
  }

  /**
   * The ROP team a person (the `employee` row aliased `o`) stands for in
   * «Безквал» — the spec's 5.5, steps 1–2 (and 4 for «Ответственный»): the
   * «(ROP)» team they head — of two, the one they sit in, as `leadRopSql`
   * reads a head — else the «(ROP)» team they sit in: their primary unit,
   * then any unit the portal lists them in (`department_member`, the primary
   * first) — else null. «ROP KVAL LID» names an operator on Lead Guard deals
   * (7010, 6968 — the spec's fact 5): their team's ROP is the ROP.
   */
  static bezkvalPersonRopSql(o: string): string {
    return `COALESCE(
            (SELECT ${InsightsRepository.ropNameSql('h."name"')}
               FROM "department" h
              WHERE h."headId" = ${o}."id" AND h."isActive"
                AND ${InsightsRepository.ropNameSql('h."name"')} IS NOT NULL
              ORDER BY (h."id" = ${o}."departmentId") DESC, h."name"
              LIMIT 1),
            (SELECT ${InsightsRepository.ropNameSql('dep."name"')}
               FROM "department" dep
              WHERE dep."id" = ${o}."departmentId" AND dep."isActive"),
            (SELECT ${InsightsRepository.ropNameSql('md."name"')}
               FROM "department_member" m
               JOIN "department" md ON md."id" = m."departmentId" AND md."isActive"
              WHERE m."employeeId" = ${o}."id"
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
