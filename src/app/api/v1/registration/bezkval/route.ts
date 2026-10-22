import { zonedDateKey } from '@/server/domain/period/period'
import { getHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { overviewQuerySchema } from '../schema'

export const dynamic = 'force-dynamic'

/** COMPANY-WIDE, like the month grid it opens up: every team's clients side by side. */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/** «Bezkval lidlar» — one day's leads, clients, new ones and ROPs. See domain/registration/bezkval.ts. */
export const GET = getHandler(ACCESS, overviewQuerySchema, async (ctx) => {
  const data = await registrationService.bezkvalDay({
    day: ctx.query.day ?? zonedDateKey(ctx.now, ctx.timeZone),
    timeZone: ctx.timeZone,
    now: ctx.now,
    brand: ctx.query.brand,
  })
  return { data }
})
