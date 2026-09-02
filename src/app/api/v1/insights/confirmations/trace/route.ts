import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'confirmation' } as const

/**
 * One order's trace through Тасдиклаш.
 *
 * No period, on purpose. The board is windowed and this is not: the question
 * is what happened to THIS order, and half of it happening before the selected
 * window would be the half worth reading.
 *
 * `dealId` is bounded because it reaches SQL as a parameter, and the caller's
 * data scope is spread into the repository call so an OWN-scoped account
 * cannot read the trace of somebody else's order by typing an id.
 */
const schema = z.object({ dealId: z.string().min(1).max(64) })

export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const data = await insightsService.confirmationTrace(ctx.query.dealId, {
    restrictToEmployeeIds: ctx.scope.restrictToEmployeeId
      ? [ctx.scope.restrictToEmployeeId]
      : null,
  })
  return { data }
})
