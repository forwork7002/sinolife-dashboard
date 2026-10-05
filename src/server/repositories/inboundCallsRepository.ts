import type { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import type { ContactHistory, InboundCall } from '@/server/domain/calls/inboundCalls'

/**
 * «Kiruvchi qoʻngʻiroqlar» — the window's inbound calls, the contacts behind
 * them and every deal those contacts hold.
 *
 * Three statements rather than one: the grouping is per NUMBER and per FIRST
 * CALL (`domain/calls/inboundCalls.ts`), which SQL could do only with a
 * window function over a join that multiplies each call by the contact's
 * deals. A month is ~15 000 calls, ~10 000 contacts and their deals — rows,
 * not aggregates, but small ones.
 */
export class InboundCallsRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  async inboundCalls(start: Date, end: Date): Promise<InboundCall[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        phone: string | null
        started_at: Date
        duration_sec: number
        customer_id: string | null
        day: string
      }[]
    >(
      `
      SELECT
        r."phoneNumber" AS phone,
        r."startedAt" AS started_at,
        r."durationSec" AS duration_sec,
        r."customerId" AS customer_id,
        -- ::text, never a bare ::date: node-postgres builds a DATE at LOCAL midnight.
        (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day
      FROM "call_record" r
      WHERE r."direction" = 'INBOUND'
        AND r."startedAt" >= $1 AND r."startedAt" < $2
      ORDER BY r."startedAt", r."externalId"
      `,
      start,
      end,
      this.tz,
    )
    return rows.map((r) => ({
      phone: r.phone,
      startedAt: r.started_at,
      durationSec: Number(r.duration_sec),
      customerId: r.customer_id,
      day: r.day,
    }))
  }

  async outboundByDay(start: Date, end: Date): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRawUnsafe<{ day: string; calls: bigint }[]>(
      `
      SELECT
        (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day,
        count(*)::bigint AS calls
      FROM "call_record" r
      WHERE r."direction" = 'OUTBOUND'
        AND r."startedAt" >= $1 AND r."startedAt" < $2
      GROUP BY 1
      `,
      start,
      end,
      this.tz,
    )
    return new Map(rows.map((r) => [r.day, Number(r.calls)]))
  }

  /**
   * Each contact's portal creation time and EVERY deal it holds now, with the
   * deal's pipeline and stage as the portal names them (`pipeline.externalId`
   * is the CATEGORY_ID, `deal_stage.externalId` the STAGE_ID).
   */
  async contactHistories(customerIds: readonly string[]): Promise<Map<string, ContactHistory>> {
    if (customerIds.length === 0) return new Map()
    const [customers, deals] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ id: string; created_at: Date | null }[]>(
        `SELECT c."id", c."createdAtSource" AS created_at FROM "customer" c WHERE c."id" = ANY($1::text[])`,
        customerIds,
      ),
      this.prisma.$queryRawUnsafe<
        { customer_id: string; pipeline: string | null; stage: string | null; created_at: Date }[]
      >(
        `
        SELECT d."customerId" AS customer_id, p."externalId" AS pipeline,
               st."externalId" AS stage, d."createdAtSource" AS created_at
        FROM "deal" d
        LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
        LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
        WHERE d."customerId" = ANY($1::text[])
        `,
        customerIds,
      ),
    ])

    const out = new Map<string, { createdAt: Date | null; deals: ContactHistory['deals'][number][] }>()
    for (const c of customers) out.set(c.id, { createdAt: c.created_at, deals: [] })
    for (const d of deals) {
      out.get(d.customer_id)?.deals.push({ pipeline: d.pipeline, stage: d.stage, createdAt: d.created_at })
    }
    return out
  }
}
