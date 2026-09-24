/**
 * «Lid kogortasi» — the routed-lead deals of three pipelines, one row each.
 *
 * Three windows in ONE scan, because the screen asks three questions of the
 * same deals: which leads ARRIVED in the window (the cohort rows), which were
 * DISTRIBUTED in it or today (the ROP breakdown and «bugun tarqatilgan»), and
 * which deals were CREATED in it with no arrival stamped at all (the «tushgan
 * sana yoʻq» count). Folding the copies into leads is the domain's job
 * (`leadCohort.ts`); this returns deals and nothing else.
 *
 * Pipelines by portal CATEGORY_ID (`pipeline."externalId"`), never by role:
 * the client named these three and «ИИ обработка» shares no role with any of
 * them, but a role re-mapped later must not quietly widen this screen.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { LEAD_PIPELINES, type LeadDealRow, type RepeatKind } from '@/server/domain/leadCohort/leadCohort'
import { env } from '@/server/config/env'

export class LeadCohortRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  /**
   * @param start  Tashkent midnight opening the window (instant).
   * @param end    Tashkent midnight after its last day (instant, exclusive).
   * @param from   The window's first day, `YYYY-MM-DD`.
   * @param to     Its last day, `YYYY-MM-DD`.
   * @param today  `YYYY-MM-DD` — distributed today is read whatever the window.
   */
  async deals(window: { start: Date; end: Date; from: string; to: string; today: string }): Promise<LeadDealRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: string
        customer_id: string | null
        pipeline: string
        arrived_at: Date | null
        distributed_on: string | null
        ai_at: Date | null
        rop_id: string | null
        repeat: string | null
        created_day: string
      }[]
    >(
      LeadCohortRepository.dealsSql(),
      window.start,
      window.end,
      window.from,
      window.to,
      window.today,
      this.tz,
      LEAD_PIPELINES.map(String),
    )
    return rows.map((r) => ({
      dealId: r.id,
      customerId: r.customer_id,
      pipeline: Number(r.pipeline),
      arrivedAt: r.arrived_at,
      distributedOn: r.distributed_on,
      aiQualifiedAt: r.ai_at,
      ropEmployeeId: r.rop_id,
      repeat: (r.repeat as RepeatKind | null) ?? null,
      createdDay: r.created_day,
    }))
  }

  static dealsSql(): string {
    return `
      SELECT
        d."id",
        d."customerId" AS customer_id,
        p."externalId" AS pipeline,
        d."leadArrivedAt" AS arrived_at,
        /* ::text — a bare DATE is built at LOCAL midnight by node-postgres. */
        d."leadDistributedOn"::text AS distributed_on,
        d."aiQualifiedAt" AS ai_at,
        d."leadRopEmployeeId" AS rop_id,
        d."repeatLead" AS repeat,
        (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $6)::date::text AS created_day
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."externalId" = ANY($7::text[])
      WHERE (d."leadArrivedAt" >= $1 AND d."leadArrivedAt" < $2)
         OR d."leadDistributedOn" BETWEEN $3::date AND $4::date
         OR d."leadDistributedOn" = $5::date
         OR (d."leadArrivedAt" IS NULL AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2)`
  }

  /** Display names for the ROPs the window names. */
  async names(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, fullName: true },
    })
    return new Map(rows.map((r) => [r.id, r.fullName]))
  }
}
