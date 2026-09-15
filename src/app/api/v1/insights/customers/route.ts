import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'cohort' } as const

/**
 * «Mijozlar oqimi» — arrivals, returns, sources and who went quiet.
 *
 * TAKES NO PARAMETERS AT ALL, and not because nobody got around to adding
 * one. The screen's period control was removed on 2026-09-15 — it drove
 * nothing on the matrix beside it, which needs the whole history, and the
 * one thing it did reach was `/insights/concentration`, which inherited the
 * dashboard's «Bugun» default and reported twelve customers and one
 * first-to-second pair under a critical-red gauge. An endpoint here that
 * read a period parameter would have the identical failure: nothing sets
 * it, so it would answer «Bugun» forever. `InsightsService.customerFlow`
 * resolves its own trailing ninety days instead (`trailingDays`,
 * `CUSTOMER_FLOW_DAYS`), the same fix `/insights/concentration` took, and
 * the window it picked rides back on the payload so the screen can print
 * the dates it actually got.
 *
 * The empty schema is written out rather than omitted so that giving this
 * endpoint a parameter later is a decision somebody makes, not an
 * oversight — the same convention `/meta/alerts` and `/meta/filters` use
 * for the same reason.
 */
const schema = z.object({})

export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const data = await insightsService.customerFlow(ctx.currency, ctx.now, ctx.timeZone)
  return { data }
})
