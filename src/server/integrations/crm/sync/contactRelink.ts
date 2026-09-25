import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'

/**
 * A MERGED CONTACT IS ONE CUSTOMER, AND THE DASHBOARD HAS TO HEAR ABOUT IT.
 *
 * Bitrix24's duplicate merge moves every deal of the losing contact onto the
 * survivor and deletes the loser — and it does NOT bump the deals' DATE_MODIFY.
 * Measured on the portal 2026-09-25: deal 35736, created and last modified
 * 2025-07-12, now points at contact 579290, created 2026-08-05. The
 * incremental deal pass reads only `>=DATE_MODIFY`, so it never sees a merge:
 * the deal keeps its old `customerId`, the buyer stays two customers, and every
 * repeat purchase split across the pair reads as two first purchases. That is
 * the whole of «Mijoz qaytishi» — the cohort sizes, the return curve, the
 * second-order revenue share — and the lead cohort's repeat check besides.
 *
 * The client merged its Instagram duplicates across the whole base in
 * September 2026, so this is not a corner case.
 *
 * THE FIX RIDES THE DAILY SWEEP. That walk already reads every deal id; it now
 * reads `CONTACT_ID` alongside (`listDealContacts`), and this re-points the
 * deals whose contact moved. No extra portal request, and it keeps up with
 * merges done later, not just this one.
 *
 * A DEAL WHOSE CONTACT WAS REMOVED OUTRIGHT IS LEFT ALONE. A merge always
 * leaves a survivor; an empty `CONTACT_ID` is either a plain delete or a read
 * we cannot vouch for, and un-linking thousands of deals on the strength of
 * the second would do more damage than the stale link it replaces.
 */

/**
 * The most one pass may re-point: a quarter of the deals it was given, or 500
 * if that is more.
 *
 * A merge wave moves a few percent of deals. Most of the table «moving» at
 * once is far likelier to be the portal answering with the wrong column than a
 * real event, so a pass like that writes nothing and says so.
 */
export function relinkLimit(checked: number): number {
  return Math.max(500, Math.ceil(checked * 0.25))
}

export interface RelinkResult {
  /** Deals the portal gave a contact for. */
  readonly checked: number
  /** Deals re-pointed at the contact the portal holds now. */
  readonly relinked: number
  /** How many distinct old customers those deals were taken off. */
  readonly customersBefore: number
}

export async function relinkDealContacts(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  live: ReadonlyMap<string, string | null>,
): Promise<RelinkResult> {
  const pairs: [string, string][] = []
  for (const [dealId, contactId] of live) if (contactId !== null) pairs.push([dealId, contactId])
  if (pairs.length === 0) return { checked: 0, relinked: 0, customersBefore: 0 }

  /*
    One transaction, for the reason `sweepByAntiJoin` gives: the temp table is
    `ON COMMIT DROP`, and outside a transaction it would be gone before the
    next statement.
  */
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE IF NOT EXISTS "sync_deal_contact" (
           "externalId" TEXT PRIMARY KEY,
           "contactId"  TEXT NOT NULL
         ) ON COMMIT DROP`,
      )
      await tx.$executeRawUnsafe(`TRUNCATE "sync_deal_contact"`)

      const CHUNK = 5_000
      for (let i = 0; i < pairs.length; i += CHUNK) {
        const chunk = pairs.slice(i, i + CHUNK)
        await tx.$executeRawUnsafe(
          `INSERT INTO "sync_deal_contact" ("externalId", "contactId")
           SELECT * FROM unnest($1::text[], $2::text[])
           ON CONFLICT DO NOTHING`,
          chunk.map((p) => p[0]),
          chunk.map((p) => p[1]),
        )
      }

      /*
        WHAT HAS MOVED: the contact id kept on the deal differs from the
        portal's, or it agrees but the link points somewhere else (a write that
        raced the customer pass). The new customer may not be imported yet —
        then the link is cleared and the customer pass's `finalize` closes it
        from the contact id written here, as it does for every new deal.
      */
      const moved = `
        FROM "sync_deal_contact" l
        JOIN "deal" d
          ON d."externalSource" = $1::"ExternalSource"
         AND d."externalId" = l."externalId"
        LEFT JOIN "customer" c
          ON c."externalSource" = $1::"ExternalSource"
         AND c."externalId" = l."contactId"
       WHERE (d."metadata"->>'contactId') IS DISTINCT FROM l."contactId"
          OR (c."id" IS NOT NULL AND d."customerId" IS DISTINCT FROM c."id")`

      const [counted] = await tx.$queryRawUnsafe<{ deals: bigint; customers: bigint }[]>(
        `SELECT count(*)::bigint AS deals, count(DISTINCT d."customerId")::bigint AS customers ${moved}`,
        source,
      )
      const deals = Number(counted?.deals ?? 0)
      const customersBefore = Number(counted?.customers ?? 0)

      if (deals > relinkLimit(pairs.length)) {
        throw new Error(
          `${pairs.length} ta bitimdan ${deals} tasining kontakti oʻzgargan — bu juda koʻp, ` +
            `hech narsa yozilmadi`,
        )
      }
      if (deals === 0) return { checked: pairs.length, relinked: 0, customersBefore: 0 }

      const relinked = await tx.$executeRawUnsafe(
        `UPDATE "deal" AS t
            SET "customerId" = m."customerId",
                "metadata"   = jsonb_set(COALESCE(t."metadata", '{}'::jsonb), '{contactId}', to_jsonb(m."contactId")),
                "updatedAt"  = now()
           FROM (SELECT d."id", l."contactId", c."id" AS "customerId" ${moved}) m
          WHERE t."id" = m."id"`,
        source,
      )

      return { checked: pairs.length, relinked, customersBefore }
    },
    { timeout: 600_000, maxWait: 30_000 },
  )
}
