/**
 * «Registratsiya» — the day's handed-out leads per ROP team, and the
 * administrator's daily split of them. See `domain/registration/leadSplit.ts`.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { canonicalRop, type DistributedDayRow, type SavedSplit, type SplitShare } from '@/server/domain/registration/leadSplit'

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
          COALESCE(
            (SELECT ${InsightsRepository.ropNameSql('h."name"')}
               FROM "department" h
              WHERE h."headId" = d."leadRopEmployeeId" AND h."isActive"
                AND ${InsightsRepository.ropNameSql('h."name"')} IS NOT NULL
              ORDER BY h."name"
              LIMIT 1),
            ${InsightsRepository.ropNameSql('dep."name"')}
          ) AS rop,
          row_number() OVER (
            PARTITION BY d."leadDistributedOn", COALESCE(d."customerId", d."id")
            ORDER BY d."createdAtSource", d."id"
          ) AS nth
        FROM "deal" d
        LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
        LEFT JOIN "employee" e ON e."id" = d."leadRopEmployeeId"
        LEFT JOIN "department" dep ON dep."id" = e."departmentId"
        WHERE d."leadDistributedOn" BETWEEN $1::date AND $2::date
          AND (p."role" IS DISTINCT FROM 'LEAD' OR d."leadRopEmployeeId" IS NOT NULL)
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
