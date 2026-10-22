import { zonedDateKey } from '@/server/domain/period/period'
import { getHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { overviewQuerySchema } from '../../schema'

export const dynamic = 'force-dynamic'

/** COMPANY-WIDE, as `/registration/bezkval`: the rows behind its numbers. Numbers are masked. */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/** The day's «Безквал» clients, each with its deals and its earlier deal — the drill-down. */
export const GET = getHandler(ACCESS, overviewQuerySchema, async (ctx) => {
  const data = await registrationService.bezkvalClients({
    day: ctx.query.day ?? zonedDateKey(ctx.now, ctx.timeZone),
    timeZone: ctx.timeZone,
    brand: ctx.query.brand,
  })
  return { data }
})
