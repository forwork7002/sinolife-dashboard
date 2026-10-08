import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'

/**
 * «СОТУВЧИ (ПЕРВИЧКА)» ON A KVAL DEAL THE SYNC STORED WITHOUT IT.
 *
 * «RNP jadvali» credits a kval lead to the ROP team of its seller
 * (`deal.primarySellerEmployeeId`, 2026-10-08), and two kinds of row have
 * none although the portal names one:
 *
 * - every kval deal read before the column existed — the `>=DATE_MODIFY` pass
 *   never offers an untouched deal again (5 796 closed 16.09–08.10.2026);
 * - a deal given to a seller the roster did not know yet: the reference pass
 *   is three-hourly, a new hire takes leads the day their account is opened,
 *   and an unknown person is written as null, not skipped.
 *
 * So the kval deals with no seller are asked about by id, and the ones the
 * portal names a seller on are written again — the first pass fills the
 * history (~116 invocations), every later one finds a handful or nothing.
 */

/** A deals pass writes at most this many rows at once (one `batchWalk` round trip); so does this. */
const PAGE = 2_500

/**
 * Регистрация deals at «Сделка успешна», closed since `since`, with no seller
 * stored. Served by the (status, closedAt) index.
 */
export async function kvalDealsWithoutSeller(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  since: Date,
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ externalId: string }[]>(kvalDealsWithoutSellerSql(), source, since)
  return rows.map((r) => r.externalId)
}

/** `kvalDealsWithoutSeller`'s statement. Exported for its test. */
export function kvalDealsWithoutSellerSql(): string {
  return `SELECT d."externalId"
       FROM "deal" d
       JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'
      WHERE d."status" = 'WON'
        AND d."closedAt" >= $2
        AND d."primarySellerEmployeeId" IS NULL
        AND d."externalSource" = $1::"ExternalSource"
        AND d."externalId" IS NOT NULL`
}

export interface KvalSellerRereadResult {
  readonly checked: number
  /** The portal named a seller on the re-read; only these are written. */
  readonly named: number
  /** Not written — a stage or person the reference pass has not brought yet; tried again next time. */
  readonly skipped: number
}

/**
 * Re-read the candidates through `fetch` and write the ones the portal names
 * a seller on with `persist` — the ordinary deal upsert, as
 * `rereadClosedTriageDeals`. A deal the portal did not return is left alone
 * (the deletion sweeps own «gone»), and so is one it names no seller on: it
 * would be rewritten every pass to change nothing.
 *
 * A PAGE AT A TIME, each read and written before the next: the first pass is
 * ~5 800 deals, and the deal handler writes a batch in one 60-second
 * transaction — a failure there would have sent the engine to 5 800 single
 * writes. A page that fails keeps the ones before it.
 */
export async function rereadKvalSellers<D>(
  candidates: readonly string[],
  fetch: (ids: readonly string[]) => Promise<readonly D[]>,
  persist: (deals: readonly D[]) => Promise<{ failed: number; skipped: number }>,
  hasSeller: (deal: D) => boolean,
): Promise<KvalSellerRereadResult> {
  let named = 0
  let skipped = 0
  for (let first = 0; first < candidates.length; first += PAGE) {
    const deals = (await fetch(candidates.slice(first, first + PAGE))).filter(hasSeller)
    if (deals.length === 0) continue
    const written = await persist(deals)
    if (written.failed > 0) throw new Error(`${written.failed} ta bitim yozilmadi`)
    named += deals.length
    skipped += written.skipped
  }
  return { checked: candidates.length, named, skipped }
}
