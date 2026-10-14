import { zonedDateKey } from '@/server/domain/period/period'
import { getHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { reportQuerySchema } from '../schema'

export const dynamic = 'force-dynamic'

/**
 * COMPANY-WIDE: every ROP team's sellers and their money side by side. A ROP
 * given TEAM scope is refused rather than handed the other teams (an account
 * holding «RNP jadvali» company-wide reads it, as it reads every team's block).
 * Section `rnp` since 2026-10-07, when «ROP otchet» moved there from «Lidlar».
 */
const ACCESS = { permission: 'analytics:read:all', section: 'rnp' } as const

/** «ROP otchet» — one day, a month or a range, every ROP team seller by seller. See ropReport.ts. */
export const GET = getHandler(ACCESS, reportQuerySchema, async (ctx) => {
  const day = ctx.query.day ?? zonedDateKey(ctx.now, ctx.timeZone)
  const data = await registrationService.report({
    from: ctx.query.from ?? day,
    to: ctx.query.to ?? day,
    timeZone: ctx.timeZone,
    now: ctx.now,
    brand: ctx.query.brand,
  })
  return { data }
})
