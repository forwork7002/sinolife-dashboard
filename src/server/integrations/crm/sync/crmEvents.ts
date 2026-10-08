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
  readonly receivedAt: Date
}

/** The oldest unprocessed events, oldest first. */
export async function pendingCrmEvents(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  limit: number,
): Promise<PendingCrmEvent[]> {
  const rows = await prisma.$queryRawUnsafe<
    { id: number | bigint; event: string; externalId: string; receivedAt: Date }[]
  >(
    `SELECT "id", "event", "externalId", "receivedAt"
       FROM "crm_event"
      WHERE "source" = $1::"ExternalSource" AND "processedAt" IS NULL
      ORDER BY "id"
      LIMIT $2`,
    source,
    limit,
  )
  return rows.map((r) => ({ id: Number(r.id), event: r.event, externalId: r.externalId, receivedAt: r.receivedAt }))
}

export async function markCrmEventsProcessed(prisma: PrismaClient, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return
  // The worker's clock, like `receivedAt` (Prisma's `now()`), so the prune
  // window below compares like with like whatever the session time zone.
  await prisma.$executeRawUnsafe(
    `UPDATE "crm_event" SET "processedAt" = $2 WHERE "id" = ANY($1::int[])`,
    ids,
    new Date(),
  )
}

/**
 * Pending rows received before `olderThan`, given up on — marked processed
 * and counted. A drain that keeps failing (a portal fault on one id, say)
 * would otherwise retry the same rows every few seconds for ever; the
 * nightly walk still owns whatever these named.
 */
export async function expireCrmEvents(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  olderThan: Date,
): Promise<number> {
  return prisma.$executeRawUnsafe(
    `UPDATE "crm_event" SET "processedAt" = $3
      WHERE "source" = $1::"ExternalSource" AND "processedAt" IS NULL AND "receivedAt" < $2`,
    source,
    olderThan,
    new Date(),
  )
}

/** Processed rows older than `olderThan` — the table is a queue, not a log. */
export async function pruneCrmEvents(prisma: PrismaClient, olderThan: Date): Promise<number> {
  return prisma.$executeRawUnsafe(`DELETE FROM "crm_event" WHERE "processedAt" < $1`, olderThan)
}

/**
 * The most a drain may delete on the portal's word alone: 100 deals, or 10%
 * of what it checked if that is more. The by-id read already keeps a deal
 * the portal still returns; this bounds what a flood of DELETE events (a
 * leaked token, a robot gone wrong) can take off in one go. Past it the
 * rest is held for the nightly walk, which has its own guards.
 */
export function confirmedGoneLimit(checked: number): number {
  return Math.max(100, Math.ceil(checked * 0.1))
}

/**
 * The oldest events naming at most `maxIds` distinct deals — the rest wait.
 * A drain is one `crm.deal.list` per fifty ids; this is what keeps a robot
 * rewriting thousands of deals from spending the tick's own budget.
 */
export function takeDistinct(events: readonly PendingCrmEvent[], maxIds: number): PendingCrmEvent[] {
  const ids = new Set<string>()
  const taken: PendingCrmEvent[] = []
  for (const e of events) {
    if (!ids.has(e.externalId)) {
      if (ids.size >= maxIds) continue
      ids.add(e.externalId)
    }
    taken.push(e)
  }
  return taken
}

/** Which of `externalIds` are deals this database holds. */
export async function localDealIds(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  externalIds: readonly string[],
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set()
  const rows = await prisma.$queryRawUnsafe<{ externalId: string }[]>(
    `SELECT "externalId" FROM "deal"
      WHERE "externalSource" = $1::"ExternalSource" AND "externalId" = ANY($2::text[])`,
    source,
    externalIds,
  )
  return new Set(rows.map((r) => r.externalId))
}

/**
 * A DELETE for a deal this database never held is nothing to do — not even a
 * read: the portal is not asked about it, the row is simply done. That keeps
 * a stream of deletions in a pipeline we do not import, or of made-up ids
 * from somebody holding the token, from spending a single invocation or
 * standing in front of a real deletion. An ADD/UPDATE for an unknown deal is
 * still read: that is how a new deal arrives.
 */
export function dropUnknownDeletes(
  events: readonly PendingCrmEvent[],
  local: ReadonlySet<string>,
): { apply: PendingCrmEvent[]; drop: PendingCrmEvent[] } {
  const apply: PendingCrmEvent[] = []
  const drop: PendingCrmEvent[] = []
  for (const e of events) {
    if (e.event === 'ONCRMDEALDELETE' && !local.has(e.externalId)) drop.push(e)
    else apply.push(e)
  }
  return { apply, drop }
}

export interface CrmEventsResult {
  readonly events: number
  /** Distinct deals the events named. */
  readonly checked: number
  /** Read back from the portal and written. */
  readonly written: number
  /** Not written — a stage or person the reference pass has not brought yet. */
  readonly skipped: number
  /** Not written — rejected outright; the tick's own pass, keyed on DATE_MODIFY, offers it again. */
  readonly failed: number
  /** Not returned by the portal, deleted here. */
  readonly deleted: number
  /** Not returned, NOT deleted: more than `goneLimit` / `confirmedGoneLimit` allows at once. */
  readonly held: number
}

/**
 * Apply `events`: read every named deal by id, write the ones the portal
 * returned, delete the ones it did not (subject to the limits above). Throws
 * before touching anything if the READ fails, so the events stay pending; a
 * deal the upsert rejects is only counted — the events are done with either
 * way, because a row that stays pending over one bad deal would be re-read
 * every few seconds for ever, and the tick's `>=DATE_MODIFY` pass re-offers
 * the deal anyway.
 */
export async function applyCrmEvents<D>(
  events: readonly PendingCrmEvent[],
  fetch: (ids: readonly string[]) => Promise<readonly D[]>,
  externalIdOf: (deal: D) => string,
  persist: (deals: readonly D[]) => Promise<{ failed: number; skipped: number }>,
  deleteDeals: (externalIds: readonly string[]) => Promise<number>,
): Promise<CrmEventsResult> {
  const none = { events: events.length, checked: 0, written: 0, skipped: 0, failed: 0, deleted: 0, held: 0 }
  if (events.length === 0) return none

  const ids = [...new Set(events.map((e) => e.externalId))]
  const toldDeleted = new Set(events.filter((e) => e.event === 'ONCRMDEALDELETE').map((e) => e.externalId))

  const deals = await fetch(ids)
  const returned = new Set(deals.map(externalIdOf))

  const gone = ids.filter((id) => !returned.has(id))
  const confirmedGone = gone.filter((id) => toldDeleted.has(id))
  const unconfirmedGone = gone.filter((id) => !toldDeleted.has(id))
  const holdConfirmed = confirmedGone.length > confirmedGoneLimit(ids.length)
  const holdUnconfirmed = unconfirmedGone.length > goneLimit(ids.length)
  const toDelete = [...(holdConfirmed ? [] : confirmedGone), ...(holdUnconfirmed ? [] : unconfirmedGone)]
  const held = (holdConfirmed ? confirmedGone.length : 0) + (holdUnconfirmed ? unconfirmedGone.length : 0)

  let written = 0
  let skipped = 0
  let failed = 0
  if (deals.length > 0) {
    const r = await persist(deals)
    skipped = r.skipped
    failed = r.failed
    written = deals.length - r.skipped - r.failed
  }

  const deleted = toDelete.length > 0 ? await deleteDeals(toDelete) : 0

  return {
    events: events.length,
    checked: ids.length,
    written,
    skipped,
    failed,
    deleted,
    held,
  }
}
