import { z } from 'zod'

import { toPeriodDto, trailingDays } from '@/server/domain/period/period'
import { getHandler } from '@/server/http/handler'
import { concentrationService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'cohort' } as const

/**
 * Concentration resolves its OWN window, and does not take the page's.
 *
 * It used to take `analyticsQuerySchema` like every other analytics route, so
 * it inherited the dashboard period — which defaults to «Bugun». Read on
 * production on 2026-09-15 that meant twelve customers, one first-to-second
 * pair and a cohort of four, under «Top-10 mijoz ulushi 89%» painted critical
 * red. Nothing was miscomputed; the sample was a day's trading and the screen
 * did not say so.
 *
 * Every figure here is a SHAPE — a Pareto share, a median interval, a
 * repurchase rate — and a shape needs a sample. Ninety days is the default
 * because it is also the repurchase horizon the same payload reports on, so
 * the band is read against one span rather than two. `days` is a parameter and
 * not a constant so the window can be widened without a deploy; it is not
 * wired to any control, and the screen prints the dates it gets back.
 */
const schema = z.object({ days: z.coerce.number().int().min(30).max(365).default(90) })

export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const period = trailingDays(ctx.query.days, { timeZone: ctx.timeZone, now: ctx.now })
  const data = await concentrationService.concentration(period)
  return { data, meta: { period: toPeriodDto(period) } }
})
