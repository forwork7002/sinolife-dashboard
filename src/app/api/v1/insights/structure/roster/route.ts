import { departmentRosterQuerySchema } from '@/server/http/queryParams'
import { getHandler } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * One department's people, for the panel the org chart opens beside a card.
 *
 * Same gate as the chart itself, and now the same shape: an account holding the
 * section may see who works where. There is deliberately no per-department
 * authorisation and no 404 for a unit outside some scope — the tree this reads
 * from is already served whole to the same caller, so hiding one unit's roster
 * would withhold nothing the chart beside it does not already show.
 *
 * Dateless, like the chart. `departmentRosterQuerySchema` is built on the
 * shared `periodQuerySchema`, so the period parameters are still accepted and
 * ignored — the panel sends only `departmentId`.
 */
const ACCESS = { permission: 'employees:read', section: 'structure' } as const

export const GET = getHandler(ACCESS, departmentRosterQuerySchema, async (ctx) => {
  const data = await insightsService.departmentRoster(ctx.query.departmentId)

  return { data }
})
