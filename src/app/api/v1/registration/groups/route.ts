import { zonedDateKey } from '@/server/domain/period/period'
import { getHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { overviewQuerySchema } from '../schema'

export const dynamic = 'force-dynamic'

/** COMPANY-WIDE, like «ROP otchet» beside it: every team's sellers and their money side by side. */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/** «Guruhlar» — the first of the month to `day`, every ROP team seller by seller. See groupPlan.ts. */
export const GET = getHandler(ACCESS, overviewQuerySchema, async (ctx) => {
  const data = await registrationService.groupPlan({
    day: ctx.query.day ?? zonedDateKey(ctx.now, ctx.timeZone),
    timeZone: ctx.timeZone,
    now: ctx.now,
  })
  return { data }
})
