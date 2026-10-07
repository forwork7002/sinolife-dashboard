import { zonedDateKey } from '@/server/domain/period/period'
import { getHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { overviewQuerySchema } from '../schema'

export const dynamic = 'force-dynamic'

/**
 * COMPANY-WIDE: every ROP team's sellers and their money side by side. A ROP
 * given TEAM scope is refused rather than handed the other teams (an account
 * holding «RNP jadvali» company-wide reads it, as it reads every team's block).
 * Section `rnp` since 2026-10-07, when «ROP otchet» moved there from «Lidlar».
 */
const ACCESS = { permission: 'analytics:read:all', section: 'rnp' } as const

/** «ROP otchet» — one day, every ROP team seller by seller. See ropReport.ts. */
export const GET = getHandler(ACCESS, overviewQuerySchema, async (ctx) => {
  const data = await registrationService.report({
    day: ctx.query.day ?? zonedDateKey(ctx.now, ctx.timeZone),
    timeZone: ctx.timeZone,
    now: ctx.now,
    brand: ctx.query.brand,
  })
  return { data }
})
