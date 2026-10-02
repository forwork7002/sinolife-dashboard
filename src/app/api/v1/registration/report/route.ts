import { zonedDateKey } from '@/server/domain/period/period'
import { getHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { overviewQuerySchema } from '../schema'

export const dynamic = 'force-dynamic'

/**
 * COMPANY-WIDE, like the split beside it: every ROP team's sellers and their
 * money side by side. A ROP given TEAM scope is refused rather than handed
 * the other teams.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/** «ROP otchet» — one day, every ROP team seller by seller. See ropReport.ts. */
export const GET = getHandler(ACCESS, overviewQuerySchema, async (ctx) => {
  const data = await registrationService.report({
    day: ctx.query.day ?? zonedDateKey(ctx.now, ctx.timeZone),
    timeZone: ctx.timeZone,
    now: ctx.now,
  })
  return { data }
})
