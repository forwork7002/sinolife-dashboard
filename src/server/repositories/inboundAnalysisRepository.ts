import type { PrismaClient } from '@/generated/prisma/client'
import type { HistoryCall } from '@/server/domain/calls/inboundAnalysis'

/**
 * «Kiruvchi tahlil»'s own reads, beside `InboundCallsRepository`'s calls and
 * contacts: each caller's conversations either way, and where each contact
 * stands now.
 */
export class InboundAnalysisRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Every call to or from each number (`phoneKey`: the last nine digits) from
   * `from` on, inbound and outbound — what «the last real conversation» and
   * «talked afterwards» are read from. The keys are a HASH join, as in
   * `InboundCallsRepository.outboundTo`, never a per-row `= ANY` over a
   * month's thousands of numbers; the `startedAt` index bounds the scan.
   */
  async history(keys: readonly string[], from: Date): Promise<HistoryCall[]> {
    if (keys.length === 0) return []
    const rows = await this.prisma.$queryRawUnsafe<
      { key: string; started_at: Date; duration_sec: number; outbound: boolean }[]
    >(
      `
      WITH k AS (SELECT DISTINCT unnest($2::text[]) AS key)
      SELECT k.key,
             r."startedAt" AS started_at,
             r."durationSec" AS duration_sec,
             -- CALLBACK is the portal ringing the client back: ours, as OUTBOUND is.
             r."direction" <> 'INBOUND' AS outbound
      FROM "call_record" r
      JOIN k ON k.key = right(regexp_replace(r."phoneNumber", '[^0-9]', '', 'g'), 9)
      WHERE r."startedAt" >= $1
      ORDER BY r."startedAt"
      `,
      from,
      [...keys],
    )
    return rows.map((r) => ({
      key: r.key,
      startedAt: r.started_at,
      durationSec: Number(r.duration_sec),
      outbound: r.outbound,
    }))
  }

  /** Each contact's newest deal, by the portal's creation time: its funnel and stage as the portal names them. */
  async currentDeals(
    customerIds: readonly string[],
  ): Promise<Map<string, { pipeline: string | null; stage: string | null }>> {
    if (customerIds.length === 0) return new Map()
    const rows = await this.prisma.$queryRawUnsafe<
      { customer_id: string; pipeline: string | null; stage: string | null }[]
    >(
      `
      SELECT DISTINCT ON (d."customerId")
             d."customerId" AS customer_id, p."name" AS pipeline, st."name" AS stage
      FROM "deal" d
      LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
      LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
      WHERE d."customerId" = ANY($1::text[])
      ORDER BY d."customerId", d."createdAtSource" DESC, d."id" DESC
      `,
      [...customerIds],
    )
    return new Map(rows.map((r) => [r.customer_id, { pipeline: r.pipeline, stage: r.stage }]))
  }
}
