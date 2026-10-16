import type { PrismaClient } from '@/generated/prisma/client'
import type { FormFillCoverage, FormFillDayRow } from '@/server/domain/leads/formFills'
import type { Period } from '@/server/domain/period/period'
import { parseFormFillsState } from '@/server/integrations/crm/sync/formFillFeed'

/**
 * `crm_form_fill`'s two reads, shared by «Target tahlili» and «Lidlar» so the
 * two screens count Meta's form leads on the portal side alike.
 */

/** What the table covers (`formFillFeed.ts`' bookmark); null until a pass has caught up. */
export async function readFormFillCoverage(prisma: PrismaClient): Promise<FormFillCoverage | null> {
  const clock = await prisma.leadWatchSync.findUnique({ where: { id: 'forms' }, select: { state: true, lastSuccessAt: true } })
  const state = parseFormFillsState(clock?.state ?? null)
  return state && clock?.lastSuccessAt ? { from: state.from, through: clock.lastSuccessAt } : null
}

/**
 * The window's fills by the Tashkent day they were filled and their subject.
 * `filledAt` is a naive UTC instant, so the day is taken in two steps — see
 * *Invariants* in CLAUDE.md. One index range on `filledAt`.
 */
export async function readFormFillDays(prisma: PrismaClient, period: Period, timeZone: string): Promise<FormFillDayRow[]> {
  const rows = await prisma.$queryRawUnsafe<{ day: string; subject: string; fills: number }[]>(
    `
    SELECT ("filledAt" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day, "subject", count(*)::int AS fills
    FROM "crm_form_fill"
    WHERE "filledAt" >= $1 AND "filledAt" < $2
    GROUP BY 1, 2
    `,
    period.start,
    period.end,
    timeZone,
  )
  return rows.map((r) => ({ day: r.day, subject: r.subject, fills: Number(r.fills) }))
}
