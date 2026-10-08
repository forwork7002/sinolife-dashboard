import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'

/**
 * The portal's outgoing events, queued for the worker — `crm_event`. The
 * route writes; `sync/crmEvents.ts` reads, applies and prunes.
 */
export class CrmEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * One pending row per (deal, event), however many times the portal says it:
   * a robot touching a deal twenty times before the next drain costs one
   * re-read either way, and the table should say so. Two inserts racing past
   * the check can still both land — harmless, the drain reads each id once.
   */
  async record(source: ExternalSourceValue, event: string, externalId: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "crm_event" ("source", "event", "externalId")
      SELECT ${source}::"ExternalSource", ${event}, ${externalId}
       WHERE NOT EXISTS (
         SELECT 1 FROM "crm_event"
          WHERE "source" = ${source}::"ExternalSource"
            AND "externalId" = ${externalId}
            AND "event" = ${event}
            AND "processedAt" IS NULL
       )`
  }
}
