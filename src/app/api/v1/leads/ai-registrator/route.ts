import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { aiRegistratorService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like «Lidlar»: the AI's calls belong to no sales team, and
 * the comparison sets every seller side by side on purpose. Its own section
 * since 2026-10-23, so it reaches the accounts granted «AI registrator» and
 * not every account holding «Lidlar».
 */
const ACCESS = { permission: 'analytics:read:all', section: 'airegistrator' } as const

/**
 * «AI registrator» — the agent's calls in the window, the leads it put through
 * to a seller followed to their sales, beside the human registrars' leads of
 * the same window. See aiRegistratorService.ts.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await aiRegistratorService.report(period, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
