import { z } from 'zod'

import { toPeriodDto, trailingDays } from '@/server/domain/period/period'
import { getHandler } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * `cohort` again since 2026-09-17. It moved to `customers` on 2026-09-16 with
 * a band on «Mijozlar va qoʻngʻiroqlar»; that screen became «Qoʻngʻiroqlar»
 * and dropped the band, and «Mijoz qaytishi» is the only reader left.
 * `section` names the screen, so it moves with the screen.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'cohort' } as const

/**
 * «Mijozlar oqimi» — arrivals, returns, sources and who went quiet.
 *
 * RESOLVES ITS OWN WINDOW, exactly as `/insights/concentration` does and for
 * the same reason. The screen's period control was removed on 2026-09-15 —
 * it drove nothing on the cohort matrix beside it, which needs the whole
 * history — and the one place it did reach was that sibling endpoint, which
 * inherited the dashboard's «Bugun» default and reported twelve customers
 * and one first-to-second pair under a critical-red gauge. An endpoint here
 * wired to the same nonexistent control would fail identically, so this one
 * resolves the window itself and hands a `Period` down rather than reading
 * `now`/`timeZone` inside the service — matching the shape its sibling
 * already shipped in, rather than sitting beside it in a different one.
 *
 * `days` exists so the window can be widened without a deploy; it is
 * deliberately not wired to any control, and the resolved span rides back
 * in `meta.period`, the same place `/insights/concentration` puts its own,
 * so the screen prints the dates it actually got. NINETY, not thirty and
 * not a year, because `sources[].repeatPercent` on this same payload is
 * measured on a ninety-day maturity horizon — one span across the card is
 * one fewer thing for a reader to hold.
 *
 * The schema carries that one field written out rather than left at
 * `z.object({})`, for the same reason `/insights/concentration`'s is: a
 * parameter with no control wired to it is a decision made on purpose, and
 * it has to be visible here to be checked, not merely absent.
 */
const schema = z.object({ days: z.coerce.number().int().min(30).max(365).default(90) })

export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const period = trailingDays(ctx.query.days, { timeZone: ctx.timeZone, now: ctx.now })
  const data = await insightsService.customerFlow(ctx.currency, period)
  return { data, meta: { period: toPeriodDto(period) } }
})
