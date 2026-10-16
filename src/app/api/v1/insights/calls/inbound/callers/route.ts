import { z } from 'zod'

import { INBOUND_GROUPS } from '@/server/domain/calls/inboundCalls'
import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { inboundCallsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds — the same as `/insights/calls/inbound`. */
const ACCESS = { permission: 'analytics:read:all', section: 'customers' } as const

const schema = periodQuerySchema.and(z.object({ group: z.enum(INBOUND_GROUPS) }))

/**
 * A group tile on «Kiruvchi qoʻngʻiroqlar» opened up («Соф янги» first): the
 * numbers it counts, one row each (`InboundCallsService.callers`).
 */
export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await inboundCallsService.callers(period, ctx.query.group, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
