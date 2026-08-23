/**
 * Prisma-backed implementation of the sync engine's persistence seams.
 *
 * The engine itself knows nothing about Prisma; this is the adapter. Keeping
 * it behind an interface is what lets the engine's behaviour — idempotence,
 * watermarks, failure isolation — be tested with in-memory fakes.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import type {
  ExternalSourceValue,
  SyncEntityValue,
  SyncModeValue,
  SyncStatusValue,
} from '@/server/domain/types'
import type { SyncRunRecord, SyncStore } from './SyncEngine'

export class PrismaSyncStore implements SyncStore {
  constructor(private readonly prisma: PrismaClient) {}

  async beginRun(input: {
    provider: string
    entity: SyncEntityValue
    mode: SyncModeValue
  }): Promise<SyncRunRecord> {
    const row = await this.prisma.syncLog.create({
      data: {
        provider: input.provider as ExternalSourceValue,
        entity: input.entity,
        mode: input.mode,
        status: 'RUNNING',
      },
      select: { id: true },
    })

    return { id: row.id, entity: input.entity, mode: input.mode }
  }

  async finishRun(input: {
    id: string
    status: SyncStatusValue
    recordsRead: number
    recordsCreated: number
    recordsUpdated: number
    recordsSkipped: number
    recordsFailed: number
    errorMessage?: string
  }): Promise<void> {
    await this.prisma.syncLog.update({
      where: { id: input.id },
      data: {
        status: input.status,
        finishedAt: new Date(),
        recordsRead: input.recordsRead,
        recordsCreated: input.recordsCreated,
        recordsUpdated: input.recordsUpdated,
        recordsSkipped: input.recordsSkipped,
        recordsFailed: input.recordsFailed,
        // Truncated: a provider error can be enormous, and the column is an
        // operator summary, not a transcript.
        errorMessage: input.errorMessage?.slice(0, 2_000),
      },
    })
  }

  async getCursor(
    provider: string,
    entity: SyncEntityValue,
  ): Promise<Date | undefined> {
    const row = await this.prisma.syncCursor.findUnique({
      where: {
        provider_entity: {
          provider: provider as ExternalSourceValue,
          entity,
        },
      },
      select: { lastSyncedAt: true },
    })

    return row?.lastSyncedAt ?? undefined
  }

  async setCursor(
    provider: string,
    entity: SyncEntityValue,
    watermark: Date,
  ): Promise<void> {
    const key = { provider: provider as ExternalSourceValue, entity }

    await this.prisma.syncCursor.upsert({
      where: { provider_entity: key },
      create: { ...key, lastSyncedAt: watermark },
      update: { lastSyncedAt: watermark },
    })
  }
}
