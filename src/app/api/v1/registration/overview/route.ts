import { can } from '@/server/auth/rbac'
import { zonedDateKey } from '@/server/domain/period/period'
import { getHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { overviewQuerySchema } from '../schema'

export const dynamic = 'force-dynamic'

/**
 * COMPANY-WIDE: every ROP team's share of the day's leads side by side. A ROP
 * given TEAM scope is refused rather than handed the other teams.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/** One day's handed-out leads per ROP against the day's split (on «Lidlar» since 2026-10-02). See registrationService.ts. */
export const GET = getHandler(ACCESS, overviewQuerySchema, async (ctx) => {
  const data = await registrationService.overview({
    day: ctx.query.day ?? zonedDateKey(ctx.now, ctx.timeZone),
    timeZone: ctx.timeZone,
    // Not on a widened read: the write is judged on the stored scope and refused.
    canEdit: can(ctx.principal, 'kpi:manage') && !ctx.principal.widened,
    brand: ctx.query.brand,
  })
  return { data }
})
