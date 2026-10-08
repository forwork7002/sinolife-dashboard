import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'

/**
 * The portal's outgoing events, queued for the worker — `crm_event`. The
 * route writes; `sync/crmEvents.ts` reads, applies and prunes.
 */
export class CrmEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(source: ExternalSourceValue, event: string, externalId: string): Promise<void> {
    await this.prisma.crmEvent.create({ data: { source, event, externalId } })
  }
}
