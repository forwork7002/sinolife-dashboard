import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'

/**
 * THE TASDIQLASH QUEUE FOLLOWS THE PORTAL'S DELETIONS WITHIN MINUTES.
 *
 * The full sweep (`listDealIds` + `deleteMissing`) walks every deal and runs
 * once a day, for the portal-budget reasons written over `SWEEP_EVERY`. So an
 * order posted to the queue and then deleted in Bitrix24 stayed on the board
 * until the next night — reported by the client on 2026-09-24.
 *
 * This check asks the portal about the queue's recent orders ONLY: the deals
 * that moved through a confirmation stage since `since`. That is a few hundred
 * to a few thousand ids, one `crm.deal.list` invocation per fifty, instead of
 * the daily walk's ~9 300. The full sweep still runs and still covers
 * everything older.
 */

/**
 * The most a single check may delete before it refuses: 25 deals, or 2% of
 * what it checked if that is more.
 *
 * A real deletion is a handful of test or duplicate orders. Hundreds «gone» at
 * once is far likelier to be the webhook losing sight of a pipeline (a
 * permission change answers with empty lists, not an error) than hundreds of
 * real deletions — and the delete cascades to stage history the incremental
 * sync will never re-read. So a check like that deletes NOTHING and says so;
 * the daily sweep, which has its own guards, is left to decide.
 */
export function goneLimit(checked: number): number {
  return Math.max(25, Math.ceil(checked * 0.02))
}

/** The ids asked about that the portal did not return. Throws past `goneLimit`. */
export function goneDeals(candidates: readonly string[], live: ReadonlySet<string>): string[] {
  const gone = candidates.filter((id) => !live.has(id))
  if (gone.length > goneLimit(candidates.length)) {
    throw new Error(
      `${candidates.length} ta bitimdan ${gone.length} tasi portalda yoʻq — bu juda koʻp, ` +
        `hech narsa oʻchirilmadi (kunlik tozalash hal qiladi)`,
    )
  }
  return gone
}

export interface RecentDeletionResult {
  readonly checked: number
  readonly deleted: number
}

export async function sweepRecentConfirmations(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  existing: (ids: readonly string[]) => Promise<ReadonlySet<string>>,
  since: Date,
): Promise<RecentDeletionResult> {
  /*
    The queue's population, read the way the queue reads it: a move into one
    of the stages that carry a confirmation signal. Wider than the board's
    cohort (which needs a C4:NEW arrival) on purpose — a deal the board does
    not list costs one id in a fifty-id filter, and a deal it does list that
    this missed would be the bug all over again.
  */
  const rows = await prisma.$queryRawUnsafe<{ externalId: string }[]>(
    `SELECT DISTINCT d."externalId"
       FROM "deal_stage" s
       JOIN "deal_stage_history" h ON h."stageId" = s."id" AND h."enteredAt" >= $2
       JOIN "deal" d ON d."id" = h."dealId"
      WHERE s."confirmationSignal" IS NOT NULL
        AND d."externalSource" = $1::"ExternalSource"
        AND d."externalId" IS NOT NULL`,
    source,
    since,
  )
  const candidates = rows.map((r) => r.externalId)
  if (candidates.length === 0) return { checked: 0, deleted: 0 }

  const live = await existing(candidates)
  const gone = goneDeals(candidates, live)
  if (gone.length === 0) return { checked: candidates.length, deleted: 0 }

  // Cascades to deal_item, payment and deal_stage_history, as the full sweep's
  // delete does.
  const deleted = await prisma.$executeRawUnsafe(
    `DELETE FROM "deal"
      WHERE "externalSource" = $1::"ExternalSource"
        AND "externalId" = ANY($2::text[])`,
    source,
    gone,
  )
  return { checked: candidates.length, deleted }
}
