import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { ANALYTICS_READ } from '@/server/http/permissions'
import { searchService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * The one search box.
 *
 * `section: null` because it belongs to no screen — it looks across all of
 * them. That is not a hole: `SearchService` gates every group it returns on a
 * section the caller actually holds, and narrows the rows to the caller's data
 * scope, so an account still sees exactly what it could see by navigating.
 */
const ACCESS = { permission: ANALYTICS_READ, section: null } as const

const querySchema = z.object({
  q: z.string().trim().max(120).default(''),
})

export const GET = getHandler(ACCESS, querySchema, async (ctx) => ({
  data: await searchService.search(ctx.principal, ctx.scope, ctx.query.q, ctx.currency),
}))
