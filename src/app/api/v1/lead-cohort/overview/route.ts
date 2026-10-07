import { getHandler } from '@/server/http/handler'
import { leadCohortService } from '@/server/services/container'

import { overviewQuerySchema } from './schema'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like the rest of «Lidlar»: every ROP's leads side
 * by side. A ROP given TEAM scope is refused rather than handed the company —
 * the «ROP» filter here is a dimension the reader picks, not a scope.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/**
 * «Lid kogortasi» — leads by the Tashkent day they arrived, against how many
 * days later they were handed to a seller. See leadCohortService.ts.
 */
export const GET = getHandler(ACCESS, overviewQuerySchema, async (ctx) => {
  const data = await leadCohortService.overview({
    from: ctx.query.from,
    to: ctx.query.to,
    pipelines: ctx.query.pipelines,
    rop: ctx.query.rop ?? null,
    brand: ctx.query.brand,
    timeZone: ctx.timeZone,
    now: ctx.now,
  })
  return { data }
})
