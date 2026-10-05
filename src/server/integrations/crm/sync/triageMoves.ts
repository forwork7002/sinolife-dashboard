import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'

/**
 * «ИИ ОБРАБОТКА» → РЕГИСТРАЦИЯ IS A MOVE THE INCREMENTAL PASS CANNOT SEE.
 *
 * The AI closes a DM chat in «ИИ обработка» (C20:NEW → C20:WON) and, about ten
 * minutes later, the portal MOVES that same deal into Регистрация (stage
 * history TYPE_ID 5). The move does not touch DATE_MODIFY, so the
 * `>=DATE_MODIFY` deal pass never reads the deal again and it stays here at
 * C20:WON — out of «Lidlar»'s Регистрация count, «Сммщик ии» and «Жами»,
 * one deal too many in «ИИ обработка». Measured 2026-10-05: 1063094, 1064380
 * (04.10) and 1065836 (05.10); every C20:WON deal created since 28.09 was one.
 * Every other category move that week (2 446 of them, 1 753 deals) had bumped
 * DATE_MODIFY and was already right here.
 *
 * So the deals that LEFT C20:NEW are asked about by id — the only state such a
 * move starts from — and re-read in full: a few a day, ~500 in all.
 */

/**
 * «ИИ обработка» deals that left its first stage, last modified (by the
 * portal's clock) since `since`, or all of them when `since` is null.
 */
export async function closedTriageDealIds(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  since: Date | null,
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ externalId: string }[]>(
    `SELECT d."externalId"
       FROM "deal" d
       JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'AI_TRIAGE'
      WHERE d."status" <> 'OPEN'
        AND d."externalSource" = $1::"ExternalSource"
        AND d."externalId" IS NOT NULL${since ? ` AND d."updatedAtSource" >= $2` : ''}`,
    source,
    ...(since ? [since] : []),
  )
  return rows.map((r) => r.externalId)
}

export interface TriageRereadResult {
  readonly checked: number
  /** In Регистрация (or any pipeline but «ИИ обработка») after the re-read. */
  readonly moved: number
}

/**
 * Re-read the candidates through `fetch` and write them with `persist` — the
 * ordinary deal upsert. A deal the portal did not return is left alone: the
 * deletion sweeps own «gone».
 */
export async function rereadClosedTriageDeals<D>(
  candidates: readonly string[],
  fetch: (ids: readonly string[]) => Promise<readonly D[]>,
  persist: (deals: readonly D[]) => Promise<{ failed: number }>,
  isTriage: (deal: D) => boolean,
): Promise<TriageRereadResult> {
  if (candidates.length === 0) return { checked: 0, moved: 0 }
  const deals = await fetch(candidates)
  const moved = deals.filter((d) => !isTriage(d)).length
  const { failed } = await persist(deals)
  if (failed > 0) throw new Error(`${failed} ta bitim yozilmadi`)
  return { checked: candidates.length, moved }
}
