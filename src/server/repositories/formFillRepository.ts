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

/**
 * How far around the window the fills are read for `unfilledCteSql`: a fill
 * is written seconds before its deal, and a returning contact's earlier fill
 * up to a day before — two days back and one ahead hold both with room.
 */
export function unfilledFillBounds(period: Period): [Date, Date] {
  const DAY = 86_400_000
  return [new Date(period.start.getTime() - 2 * DAY), new Date(period.end.getTime() + DAY)]
}

/**
 * THE LEAD GUARD'S DEALS ARE LEADS TOO (2026-11-04, the owner: «Lead Guard
 * lidlarini sanash»). Bitrix24's own Facebook link opens a CRM-form deal AND
 * files a fill on it (`crm_form_fill`, owner = that deal); when the link is
 * down Lead Guard opens the same deal — title «Заполнение CRM-формы "<form>"»
 * — through the REST API, and no fill is filed. 04.11.2026 13:42 the link
 * broke: the fills stopped (0 for seven hours), Lead Guard opened 190 such
 * deals, and every count that reads the fills — «Bitrix lid», «Qamrov»,
 * «Ген лид» — fell to half of what had arrived.
 *
 * `unfilled` is the window's form deals of `reg` (a CTE with `id`, `ext` —
 * the portal id —, `created`, `title`, `customer`) with no fill behind them:
 * none filed on the deal itself, and none filed on ANY deal of the same
 * contact from a day before it to a day after. The second rule keeps a lead
 * from counting twice: a copy the portal's «Qayta zayavka» robot opens for a
 * returning contact (its fill lands on the OLD deal), and a lead the portal
 * opens itself AFTER Lead Guard did — past its 150-minute wait, or once the
 * link is back (the owner, 04.11: «150 daqiqadan keyin ochsa-chi?»): the
 * portal's deal carries the fill, Lead Guard's is then not added. A contact
 * who truly filled twice that day counts once — short by one, never double. Portal check 04.11:
 * 595 form deals, 249 with no fill on them (86 the AI targetolog's own
 * forms', 163 the people's), 0 of them with a fill of the contact in the day
 * before. The fills are read from `$from` to `$to` (`unfilledFillBounds`).
 */
export function unfilledCteSql(reg: string, from: string, to: string): string {
  return `form_fill AS MATERIALIZED (
        SELECT f."ownerExternalId" AS owner, f."filledAt" AS at, od."customerId" AS customer
        FROM "crm_form_fill" f
        LEFT JOIN "deal" od ON od."externalSource" = 'BITRIX24' AND od."externalId" = f."ownerExternalId"
        WHERE f."ownerTypeId" = '2' AND f."filledAt" >= ${from} AND f."filledAt" < ${to}
      ),
      unfilled AS (
        SELECT r.id
        FROM ${reg} r
        WHERE r.title LIKE '%CRM-форм%'
          AND NOT EXISTS (SELECT 1 FROM form_fill ff WHERE ff.owner = r.ext)
          AND NOT EXISTS (
            SELECT 1 FROM form_fill ff
            WHERE r.customer IS NOT NULL AND ff.customer = r.customer
              AND ff.at >= r.created - interval '1 day' AND ff.at <= r.created + interval '1 day'
          )
      )`
}
