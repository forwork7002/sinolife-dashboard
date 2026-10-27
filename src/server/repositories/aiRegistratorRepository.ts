import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { type AiCall, type Handoff, type SaleDeal, type SellerCall, readTransferAttempts } from '@/server/domain/aiRegistrator/aiRegistrator'
import type { AiCallPush } from '@/server/integrations/aiRegistrator/ingest'

/** The Регистрация deal a call or a hand-off is about, as the store holds it now. */
export interface LeadDealRow {
  readonly externalId: string
  readonly customerId: string | null
  readonly title: string
  readonly pipeline: string | null
  readonly stage: string | null
  readonly status: 'OPEN' | 'WON' | 'LOST'
  readonly createdAt: Date
}

/** A human registrar's qualified lead: WON «Регистрация» deal, never called by the agent. */
export interface ClassicLeadRow {
  readonly externalId: string
  readonly customerId: string | null
  readonly closedAt: Date
}

/**
 * «AI registrator»'s reads and its one write. `ai_registrator_call` is the
 * agent's own record; everything else is the synced portal — the two meet on
 * the Регистрация deal's portal id at read time, so a push that lands before
 * the sync has read its deal simply shows as «not synced yet» until it has.
 */
export class AiRegistratorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** One pushed call, idempotent by `callId`: a retried push rewrites the same row with the same facts. */
  async upsert(call: AiCallPush): Promise<void> {
    const data = {
      dealExternalId: call.dealId,
      phone: call.phone,
      attempt: call.attempt,
      startedAt: new Date(call.startedAt),
      answeredAt: call.answeredAt ? new Date(call.answeredAt) : null,
      endedAt: new Date(call.endedAt),
      durationSec: call.durationSec,
      outcome: call.outcome,
      transferredTo: call.transferredTo || null,
      transferAttempts: call.transferAttempts.length > 0 ? (call.transferAttempts as Prisma.InputJsonValue) : Prisma.DbNull,
      result: call.result ? (call.result as Prisma.InputJsonValue) : Prisma.DbNull,
      isTest: call.isTest,
    }
    await this.prisma.aiRegistratorCall.upsert({
      where: { callId: call.callId },
      create: { callId: call.callId, ...data },
      update: data,
    })
  }

  /**
   * The sellers' own Bitrix24 calls that could cover a moment in [from, to]: started up to three hours before
   * `from` (the longest calls run that long) and up to a minute after `to`.
   */
  async sellerCalls(employeeIds: readonly string[], from: Date, to: Date): Promise<SellerCall[]> {
    if (employeeIds.length === 0) return []
    const rows = await this.prisma.callRecord.findMany({
      where: {
        employeeId: { in: [...employeeIds] },
        startedAt: { gte: new Date(from.getTime() - 3 * 3_600_000), lte: new Date(to.getTime() + 60_000) },
      },
      select: { employeeId: true, direction: true, phoneNumber: true, startedAt: true, durationSec: true, connected: true },
      orderBy: { startedAt: 'asc' },
    })
    return rows.flatMap((r) =>
      r.employeeId
        ? [{ employeeId: r.employeeId, direction: r.direction, phone: r.phoneNumber, startedAt: r.startedAt, durationSec: r.durationSec, connected: r.connected }]
        : [],
    )
  }

  /** Every call that STARTED in [start, end), tests included (the caller sets them apart). */
  async calls(start: Date, end: Date): Promise<AiCall[]> {
    const rows = await this.prisma.aiRegistratorCall.findMany({
      where: { startedAt: { gte: start, lt: end } },
      orderBy: { startedAt: 'asc' },
    })
    return rows.map((r) => ({
      callId: r.callId,
      dealExternalId: r.dealExternalId,
      phone: r.phone,
      attempt: r.attempt,
      startedAt: r.startedAt,
      answeredAt: r.answeredAt,
      durationSec: r.durationSec,
      outcome: r.outcome,
      transferredTo: r.transferredTo,
      transferAttempts: readTransferAttempts(r.transferAttempts),
      result: typeof r.result === 'object' && r.result !== null && !Array.isArray(r.result) ? (r.result as Record<string, unknown>) : null,
      isTest: r.isTest,
    }))
  }

  /** The Регистрация deals behind these portal ids — the ones the sync has read so far. */
  async leadDeals(externalIds: readonly string[]): Promise<Map<string, LeadDealRow>> {
    if (externalIds.length === 0) return new Map()
    const rows = await this.prisma.$queryRawUnsafe<
      {
        external_id: string
        customer_id: string | null
        title: string
        pipeline: string | null
        stage: string | null
        status: 'OPEN' | 'WON' | 'LOST'
        created_at: Date
      }[]
    >(
      `
      SELECT d."externalId" AS external_id, d."customerId" AS customer_id, d."title",
             p."name" AS pipeline, st."name" AS stage, d."status"::text AS status,
             d."createdAtSource" AS created_at
      FROM "deal" d
      LEFT JOIN "pipeline" p ON p."id" = d."pipelineId"
      LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
      WHERE d."externalSource" = 'BITRIX24' AND d."externalId" = ANY($1::text[])
      `,
      [...externalIds],
    )
    return new Map(
      rows.map((r) => [
        r.external_id,
        {
          externalId: r.external_id,
          customerId: r.customer_id,
          title: r.title,
          pipeline: r.pipeline,
          stage: r.stage,
          status: r.status,
          createdAt: r.created_at,
        },
      ]),
    )
  }

  /**
   * KLASSIK: Регистрация deals a human registrar qualified in [start, end) —
   * WON by `closedAt` with «Регистрация» filled — that the agent never called
   * (a test call aside). Read through `deal_status_closedAt_idx`.
   */
  async classicLeads(start: Date, end: Date): Promise<ClassicLeadRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ external_id: string; customer_id: string | null; closed_at: Date }[]>(
      `
      SELECT d."externalId" AS external_id, d."customerId" AS customer_id, d."closedAt" AS closed_at
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      WHERE d."status" = 'WON'
        AND d."closedAt" >= $1 AND d."closedAt" < $2
        AND d."externalSource" = 'BITRIX24'
        AND NULLIF(btrim(d."registrar"), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "ai_registrator_call" c
          WHERE c."dealExternalId" = d."externalId" AND NOT c."isTest"
        )
      ORDER BY d."closedAt"
      `,
      start,
      end,
    )
    return rows.map((r) => ({ externalId: r.external_id, customerId: r.customer_id, closedAt: r.closed_at }))
  }

  /**
   * EVERY hand-off these contacts ever had: each WON Регистрация deal at its
   * `closedAt`, and each of the agent's transfers at its call's start. The
   * sales are shared out over all of them (`assignSales`), not only over the
   * window's, so a sale a later lead earned is not credited to an earlier one.
   */
  async handoffs(customerIds: readonly string[]): Promise<Handoff[]> {
    if (customerIds.length === 0) return []
    const rows = await this.prisma.$queryRawUnsafe<{ lead_key: string; customer_id: string; at: Date }[]>(
      `
      SELECT d."externalId" AS lead_key, d."customerId" AS customer_id, d."closedAt" AS at
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      WHERE d."customerId" = ANY($1::text[]) AND d."status" = 'WON' AND d."closedAt" IS NOT NULL
        AND d."externalSource" = 'BITRIX24'
      UNION ALL
      SELECT c."dealExternalId" AS lead_key, d."customerId" AS customer_id, c."startedAt" AS at
      FROM "ai_registrator_call" c
      JOIN "deal" d ON d."externalSource" = 'BITRIX24' AND d."externalId" = c."dealExternalId"
      WHERE c."outcome" = 'interested_transferred' AND NOT c."isTest"
        AND d."customerId" = ANY($1::text[])
      `,
      [...customerIds],
    )
    return rows.map((r) => ({ leadKey: r.lead_key, customerId: r.customer_id, at: r.at }))
  }

  /** These contacts' Первичный отдел / Тасдиклаш / Доставка deals opened in [from, to). База and the rest never. */
  async sales(customerIds: readonly string[], from: Date, to: Date): Promise<SaleDeal[]> {
    if (customerIds.length === 0) return []
    const rows = await this.prisma.$queryRawUnsafe<
      {
        external_id: string
        customer_id: string
        role: SaleDeal['role']
        status: SaleDeal['status']
        counts_as_revenue: boolean
        amount_minor: string
        created_at: Date
        pipeline: string | null
        stage: string | null
        operator_id: string | null
        owner_id: string
      }[]
    >(
      `
      SELECT d."externalId" AS external_id, d."customerId" AS customer_id, p."role"::text AS role,
             d."status"::text AS status, d."countsAsRevenue" AS counts_as_revenue,
             d."amountMinor"::text AS amount_minor, d."createdAtSource" AS created_at,
             p."name" AS pipeline, st."name" AS stage,
             d."operatorEmployeeId" AS operator_id, d."employeeId" AS owner_id
      FROM "deal" d
      JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" IN ('QUALIFICATION', 'CONFIRMATION', 'REVENUE')
      LEFT JOIN "deal_stage" st ON st."id" = d."stageId"
      WHERE d."customerId" = ANY($1::text[])
        AND d."createdAtSource" >= $2 AND d."createdAtSource" < $3
      ORDER BY d."createdAtSource", d."id"
      `,
      [...customerIds],
      from,
      to,
    )
    return rows.map((r) => ({
      externalId: r.external_id,
      customerId: r.customer_id,
      role: r.role,
      status: r.status,
      countsAsRevenue: r.counts_as_revenue,
      amountMinor: BigInt(r.amount_minor),
      createdAt: r.created_at,
      pipeline: r.pipeline,
      stage: r.stage,
      operatorId: r.operator_id,
      ownerId: r.owner_id,
    }))
  }

  /** Everyone, active or not — the floor-number index is built over the whole roster, as the sync builds it. */
  async roster(): Promise<{ id: string; fullName: string }[]> {
    return this.prisma.employee.findMany({ select: { id: true, fullName: true } })
  }
}
