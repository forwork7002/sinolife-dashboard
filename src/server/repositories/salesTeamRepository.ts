/**
 * «Sotuv · ROP» — the leads each seller was handed, the teams they sit in,
 * and the plans an administrator types in. FAKT 1 / FAKT 2 are not here: they
 * are the sellers board's own cohort and live beside it, in
 * `InsightsRepository.salesTeamDays`.
 *
 * A SELLER'S LEAD IS A Первичный отдел DEAL. When the registrar marks a
 * Регистрация lead «Сделка успешна», the portal opens a deal for the same
 * contact in Первичный отдел (role QUALIFICATION) and hands it to a seller —
 * «Target tahlili» measured 1 470 of 1 518 such leads with that second deal.
 * So a QUALIFICATION deal created on a day, assigned to a seller, is one
 * «ЛИД» of theirs that day.
 *
 * «ЛИД РУЧ» — ONE THE SELLER OPENED THEMSELVES. A QUALIFICATION deal whose
 * contact had NO Регистрация deal in the fourteen days before it did not come
 * from the registrar; the seller made it (a repeat customer who called them,
 * a referral). The link is the contact, because the portal keeps no other:
 * the two deals share nothing else. Fourteen days is wider than any
 * registrar's queue and narrower than a customer coming back a month later.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import type { Period } from '@/server/domain/period/period'

import { InsightsRepository } from './insightsRepository'

/** One seller's Первичный отдел deals opened on one day. */
export interface SellerLeadDayRow {
  readonly day: string
  readonly employeeId: string
  readonly rop: string | null
  /** Handed over from Регистрация. */
  readonly leads: number
  /** Opened by the seller, with no Регистрация lead behind it. */
  readonly manualLeads: number
}

export interface TeamMember {
  readonly employeeId: string
  readonly fullName: string
  readonly rop: string
}

export interface PlanRows {
  readonly sellers: readonly { employeeId: string; amountMinor: bigint }[]
  readonly teams: readonly { rop: string; fakt1Minor: bigint | null; fakt2Minor: bigint | null }[]
}

/** How far back a Регистрация lead still explains a seller's new deal. */
export const LEAD_LINK_DAYS = 14

const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`)

export class SalesTeamRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  /**
   * Per day × seller: the Первичный отдел deals opened, split by whether a
   * Регистрация lead stands behind each. The lateral probe is on
   * `deal."customerId"` (indexed), one per deal in the window.
   */
  async leadDays(period: Period): Promise<SellerLeadDayRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { day: string; employee_id: string; rop: string | null; leads: bigint; manual: bigint }[]
    >(SalesTeamRepository.leadDaysSql(), period.start, period.end, this.tz, LEAD_LINK_DAYS)
    return rows.map((r) => ({
      day: r.day,
      employeeId: r.employee_id,
      rop: r.rop,
      leads: Number(r.leads),
      manualLeads: Number(r.manual),
    }))
  }

  static leadDaysSql(): string {
    return `
      SELECT
        /* ::text — a bare ::date is built at LOCAL midnight by node-postgres. */
        (q."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
        e."id" AS employee_id,
        ${InsightsRepository.ropNameSql('dep."name"')} AS rop,
        count(*) FILTER (WHERE reg.found IS NOT NULL)::bigint AS leads,
        count(*) FILTER (WHERE reg.found IS NULL)::bigint AS manual
      FROM "deal" q
      JOIN "pipeline" p ON p."id" = q."pipelineId" AND p."role" = 'QUALIFICATION'
      JOIN "employee" e ON e."id" = q."employeeId"
      LEFT JOIN "department" dep ON dep."id" = e."departmentId"
      LEFT JOIN LATERAL (
        SELECT 1 AS found
        FROM "deal" l
        JOIN "pipeline" lp ON lp."id" = l."pipelineId" AND lp."role" = 'LEAD'
        WHERE q."customerId" IS NOT NULL
          AND l."customerId" = q."customerId"
          AND l."createdAtSource" <= q."createdAtSource"
          AND l."createdAtSource" >= q."createdAtSource" - make_interval(days => $4::int)
        LIMIT 1
      ) reg ON true
      WHERE q."createdAtSource" >= $1 AND q."createdAtSource" < $2
      GROUP BY 1, 2, 3`
  }

  /**
   * Every active person in a ROP department — the team's roster, so a seller
   * with no lead and no order today is still a row (the sheet lists them at
   * zero, stajors included).
   */
  async members(): Promise<TeamMember[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ employee_id: string; full_name: string; rop: string }[]>(`
      SELECT e."id" AS employee_id, e."fullName" AS full_name, t.rop
      FROM "employee" e
      JOIN "department" dep ON dep."id" = e."departmentId"
      CROSS JOIN LATERAL (SELECT ${InsightsRepository.ropNameSql('dep."name"')} AS rop) t
      WHERE e."isActive" AND t.rop IS NOT NULL`)
    return rows.map((r) => ({ employeeId: r.employee_id, fullName: r.full_name, rop: r.rop }))
  }

  /** Names for people credited with orders who are not on any roster. */
  async names(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, fullName: true },
    })
    return new Map(rows.map((r) => [r.id, r.fullName]))
  }

  /** The plans for one month (`YYYY-MM`). */
  async plans(month: string): Promise<PlanRows> {
    const [sellers, teams] = await Promise.all([
      this.prisma.sellerDayPlan.findMany({
        where: { month: monthDate(month) },
        select: { employeeId: true, amountMinor: true },
      }),
      this.prisma.teamMonthPlan.findMany({
        where: { month: monthDate(month) },
        select: { rop: true, fakt1Minor: true, fakt2Minor: true },
      }),
    ])
    return { sellers, teams }
  }

  /**
   * Replace one month's plans with what the form sent, in ONE transaction.
   *
   * A null or zero amount deletes the row: «no plan» is the absence of a
   * row, never a plan of zero, which would read as «missed it entirely».
   */
  async savePlans(
    month: string,
    input: {
      sellers: readonly { employeeId: string; amountMinor: bigint | null }[]
      teams: readonly { rop: string; fakt1Minor: bigint | null; fakt2Minor: bigint | null }[]
    },
    by: string,
  ): Promise<void> {
    const m = monthDate(month)
    const positive = (v: bigint | null) => (v !== null && v > 0n ? v : null)
    await this.prisma.$transaction([
      ...input.sellers.map((s) => {
        const amount = positive(s.amountMinor)
        return amount === null
          ? this.prisma.sellerDayPlan.deleteMany({ where: { month: m, employeeId: s.employeeId } })
          : this.prisma.sellerDayPlan.upsert({
              where: { month_employeeId: { month: m, employeeId: s.employeeId } },
              create: { month: m, employeeId: s.employeeId, amountMinor: amount, updatedBy: by },
              update: { amountMinor: amount, updatedBy: by },
            })
      }),
      ...input.teams.map((t) => {
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
