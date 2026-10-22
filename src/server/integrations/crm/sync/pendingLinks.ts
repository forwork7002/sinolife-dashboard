/**
 * The optional links a deal was written without, filled once the reference
 * data names them — see `deal_pending_link` and the deals handler.
 *
 * NO PORTAL REQUEST. Everything needed is already in the database: the deal,
 * the portal id it named, and — after a reference or `RESOLVE` pass — the
 * source or employee row with that id. One UPDATE per column, then the rows
 * that resolved go. Only a column still NULL is filled: a deal re-read since
 * with a link that resolved keeps it.
 *
 * A row whose id never arrives (a source deleted in the portal, a user the
 * portal no longer returns) waits `PENDING_GIVE_UP_MS` and is dropped; the
 * deal keeps NULL, which is what it would have had anyway.
 */

import type { PrismaClient } from '@/generated/prisma/client'

const PENDING_GIVE_UP_MS = 7 * 86_400_000

/** Deal column → the table its id resolves in. A fixed list: these names go into SQL. */
const TARGETS = [
  { field: 'sourceId', table: 'sales_source' },
  { field: 'leadRopEmployeeId', table: 'employee' },
  { field: 'ropKvalLidEmployeeId', table: 'employee' },
  { field: 'createdByEmployeeId', table: 'employee' },
] as const

export interface PendingLinkRepair {
  /** Deal columns filled. */
  readonly filled: number
  /** Rows given up on after a week. */
  readonly dropped: number
  /** Rows still waiting. */
  readonly waiting: number
}

export async function repairPendingLinks(prisma: PrismaClient, now: Date = new Date()): Promise<PendingLinkRepair> {
  let filled = 0
  for (const { field, table } of TARGETS) {
    filled += await prisma.$executeRawUnsafe(
      `
      UPDATE "deal" d
      SET "${field}" = r."id", "updatedAt" = now()
      FROM "deal_pending_link" p
      JOIN "${table}" r ON r."externalSource" = p."externalSource" AND r."externalId" = p."externalRef"
      WHERE p."field" = $1
        AND d."externalSource" = p."externalSource"
        AND d."externalId" = p."dealExternalId"
        AND d."${field}" IS NULL
      `,
      field,
    )
    await prisma.$executeRawUnsafe(
      `
      DELETE FROM "deal_pending_link" p
      USING "${table}" r
      WHERE p."field" = $1 AND r."externalSource" = p."externalSource" AND r."externalId" = p."externalRef"
      `,
      field,
    )
  }
  const dropped = (
    await prisma.dealPendingLink.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - PENDING_GIVE_UP_MS) } } })
  ).count
  const waiting = await prisma.dealPendingLink.count()
  return { filled, dropped, waiting }
}

/** Rows written since `since` — new ids the maps did not hold, which a `RESOLVE` pass can bring. */
export async function pendingLinksSince(prisma: PrismaClient, since: Date | null): Promise<number> {
  return prisma.dealPendingLink.count(since ? { where: { createdAt: { gt: since } } } : undefined)
}
