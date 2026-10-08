import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'
import { goneLimit } from './recentDeletions'

/**
 * THE PORTAL'S EVENTS, APPLIED — see `bitrix24/outgoingEvent.ts` for where
 * they come from.
 *
 * `/api/bitrix24/events` writes one `crm_event` row per event the portal
 * POSTs; the worker drains them between ticks, every few seconds. A deal
 * named by an event is read by id through the ordinary provider and written
 * through the ordinary deal upsert; a deal the portal no longer returns is
 * deleted here, as the deletion sweeps delete it — cascading to its stage
 * history, items and payments.
 *
 * TWO KINDS OF «GONE». A deal the portal said it DELETED is deleted, however
 * many there are: the portal told us. A deal an ADD/UPDATE named that the read
 * then did not return is gone too — deleted in the seconds between, or moved
 * to a pipeline we do not import — but a flood of those is what a pipeline
 * disappearing from the webhook's view looks like, so they fall under the
 * sweeps' `goneLimit`: past it, nothing is deleted and the nightly walk, with
 * its own guards, decides.
 */

export interface PendingCrmEvent {
  readonly id: number
  readonly event: string
  readonly externalId: string
}

/** The oldest unprocessed events, oldest first. */
export async function pendingCrmEvents(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  limit: number,
): Promise<PendingCrmEvent[]> {
  const rows = await prisma.$queryRawUnsafe<{ id: number | bigint; event: string; externalId: string }[]>(
    `SELECT "id", "event", "externalId"
       FROM "crm_event"
      WHERE "source" = $1::"ExternalSource" AND "processedAt" IS NULL
      ORDER BY "id"
      LIMIT $2`,
    source,
    limit,
  )
  return rows.map((r) => ({ id: Number(r.id), event: r.event, externalId: r.externalId }))
}

export async function markCrmEventsProcessed(prisma: PrismaClient, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return
  await prisma.$executeRawUnsafe(
    `UPDATE "crm_event" SET "processedAt" = NOW() WHERE "id" = ANY($1::int[])`,
    ids,
  )
}

/** Processed rows older than `olderThan` — the table is a queue, not a log. */
export async function pruneCrmEvents(prisma: PrismaClient, olderThan: Date): Promise<number> {
  return prisma.$executeRawUnsafe(`DELETE FROM "crm_event" WHERE "processedAt" < $1`, olderThan)
}

export interface CrmEventsResult {
  readonly events: number
  /** Distinct deals the events named. */
  readonly checked: number
  /** Read back from the portal and written. */
  readonly written: number
  /** Not written — a stage or person the reference pass has not brought yet. */
  readonly skipped: number
  /** Not returned by the portal, deleted here. */
  readonly deleted: number
  /** Not returned, NOT deleted: more than `goneLimit` allows at once. */
  readonly held: number
}

/**
 * Apply `events`: read every named deal by id, write the ones the portal
 * returned, delete the ones it did not (subject to the limit above). Throws
 * before touching anything if the read fails, so the events stay pending.
 */
export async function applyCrmEvents<D>(
  events: readonly PendingCrmEvent[],
  fetch: (ids: readonly string[]) => Promise<readonly D[]>,
  externalIdOf: (deal: D) => string,
  persist: (deals: readonly D[]) => Promise<{ failed: number; skipped: number }>,
  deleteDeals: (externalIds: readonly string[]) => Promise<number>,
): Promise<CrmEventsResult> {
  const none = { events: events.length, checked: 0, written: 0, skipped: 0, deleted: 0, held: 0 }
  if (events.length === 0) return none

  const ids = [...new Set(events.map((e) => e.externalId))]
  const toldDeleted = new Set(events.filter((e) => e.event === 'ONCRMDEALDELETE').map((e) => e.externalId))

  const deals = await fetch(ids)
  const returned = new Set(deals.map(externalIdOf))

  const gone = ids.filter((id) => !returned.has(id))
  const confirmedGone = gone.filter((id) => toldDeleted.has(id))
  const unconfirmedGone = gone.filter((id) => !toldDeleted.has(id))
  const overLimit = unconfirmedGone.length > goneLimit(ids.length)
  const toDelete = overLimit ? confirmedGone : gone

  let written = 0
  let skipped = 0
  if (deals.length > 0) {
    const r = await persist(deals)
    if (r.failed > 0) throw new Error(`${r.failed} ta bitim yozilmadi`)
    skipped = r.skipped
    written = deals.length - r.skipped
  }

  const deleted = toDelete.length > 0 ? await deleteDeals(toDelete) : 0

  return {
    events: events.length,
    checked: ids.length,
    written,
    skipped,
    deleted,
    held: overLimit ? unconfirmedGone.length : 0,
  }
}

/** The deletion the sweeps make, by portal id. */
export async function deleteDealsByExternalId(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  externalIds: readonly string[],
): Promise<number> {
  if (externalIds.length === 0) return 0
  return prisma.$executeRawUnsafe(
    `DELETE FROM "deal"
      WHERE "externalSource" = $1::"ExternalSource"
        AND "externalId" = ANY($2::text[])`,
    source,
    externalIds,
  )
}
