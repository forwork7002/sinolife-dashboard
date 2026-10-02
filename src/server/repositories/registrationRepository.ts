/**
 * «Registratsiya» — the day's handed-out leads per ROP team, and the
 * administrator's daily split of them. See `domain/registration/leadSplit.ts`.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import type { IntakeRow } from '@/server/domain/registration/groupIntake'
import { canonicalRop, type DistributedDayRow, type SavedSplit, type SplitShare } from '@/server/domain/registration/leadSplit'
import type { RosterMember, SellerCallRow, SellerLeadRow } from '@/server/domain/registration/ropReport'

import { InsightsRepository } from './insightsRepository'

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`)

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
   * screens agree on every team's leads.
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
   * The ROP a handed-out deal went to: the team the «РОП (Первичка)» person
   * heads, then the team they sit in, else null. Reads `d` and `dep` from
   * `handedOutSql`.
   */
  private static leadRopSql(): string {
    return `COALESCE(
            (SELECT ${InsightsRepository.ropNameSql('h."name"')}
               FROM "department" h
              WHERE h."headId" = d."leadRopEmployeeId" AND h."isActive"
                AND ${InsightsRepository.ropNameSql('h."name"')} IS NOT NULL
              ORDER BY h."name"
              LIMIT 1),
            ${InsightsRepository.ropNameSql('dep."name"')}
          )`
  }

  /** The handed-out deals whose «Лид таркатилган сана» matches `dayPredicate`; see `distributedDaysSql`. */
  private static handedOutSql(dayPredicate: string): string {
    return `FROM "deal" d
        LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
        LEFT JOIN "employee" e ON e."id" = d."leadRopEmployeeId"
        LEFT JOIN "department" dep ON dep."id" = e."departmentId"
        WHERE d."leadDistributedOn" ${dayPredicate}
          AND (p."role" IS DISTINCT FROM 'LEAD' OR d."leadRopEmployeeId" IS NOT NULL)`
  }

  /** One day's handed-out leads per ROP team × seller. */
  async sellerLeads(day: string): Promise<SellerLeadRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ rop: string | null; employee_id: string | null; leads: bigint }[]>(
      RegistrationRepository.sellerLeadsSql(),
      day,
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
      ${RegistrationRepository.handedOutSql('= $1::date')}
      GROUP BY 1, 2`
  }

  /**
   * Every active person in a ROP team — the team's head and everybody whose
   * PRIMARY unit it is — so a seller with no lead and no order today is still
   * a row, as on the client's sheet. Primary, never `department_member`: this
   * is a money table, and a person in two units would sit on two teams' rows.
   * A head is in the team they head (the first by name, if several).
   */
  async roster(): Promise<RosterMember[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ employee_id: string; full_name: string; rop: string; is_head: boolean }[]>(`
      SELECT DISTINCT ON (x.employee_id) x.employee_id, e."fullName" AS full_name, x.rop, x.is_head
        FROM (
          SELECT h."headId" AS employee_id, ${InsightsRepository.ropNameSql('h."name"')} AS rop, true AS is_head, 0 AS rank, h."name"
            FROM "department" h
           WHERE h."isActive" AND h."headId" IS NOT NULL
          UNION ALL
          SELECT m."id", ${InsightsRepository.ropNameSql('dep."name"')}, false, 1, dep."name"
            FROM "employee" m
            JOIN "department" dep ON dep."id" = m."departmentId" AND dep."isActive"
        ) x
        JOIN "employee" e ON e."id" = x.employee_id AND e."isActive"
       WHERE x.rop IS NOT NULL
       ORDER BY x.employee_id, x.rank, x."name"`)
    return rows.map((r) => ({ employeeId: r.employee_id, fullName: r.full_name, rop: r.rop, isHead: r.is_head }))
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

  /** The day's typed «безквал», one row per group somebody typed. */
  async groupIntake(day: string): Promise<IntakeRow[]> {
    return this.prisma.registrationGroupIntake.findMany({ where: { day: dateOf(day) }, select: { group: true, leads: true } })
  }

  /**
   * Set each group sent, in ONE transaction. A null deletes the row: «nobody
   * typed it» is no row, never a zero. Groups not sent are left as they are.
   */
  async saveGroupIntake(day: string, rows: readonly { group: string; leads: number | null }[], by: string): Promise<void> {
    const date = dateOf(day)
    await this.prisma.$transaction(
      rows.map((r) =>
        r.leads === null
          ? this.prisma.registrationGroupIntake.deleteMany({ where: { day: date, group: r.group } })
          : this.prisma.registrationGroupIntake.upsert({
              where: { day_group: { day: date, group: r.group } },
              create: { day: date, group: r.group, leads: r.leads, updatedBy: by },
              update: { leads: r.leads, updatedBy: by },
            }),
      ),
    )
  }
}
