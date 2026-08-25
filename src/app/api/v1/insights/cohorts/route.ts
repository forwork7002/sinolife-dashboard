import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Cohorts ignore the period filter on purpose.
 *
 * A retention matrix is a statement about the whole customer history — asking
 * "how many of March's buyers came back" only means something if you can see
 * every month since. `months` bounds how far back the ROWS start, not which
 * purchases count.
 */
const schema = z.object({ months: z.coerce.number().int().min(3).max(36).default(18) })

export const GET = getHandler('analytics:read:all', schema, async (ctx) => {
  const data = await insightsService.cohorts(ctx.currency, ctx.query.months)
  return { data }
})
