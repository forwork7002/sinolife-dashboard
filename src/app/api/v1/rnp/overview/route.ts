import { z } from 'zod'

import { can } from '@/server/auth/rbac'
import { getHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE: every ROP team, the registration desk and the Meta spend side
 * by side, with every team's plans. A ROP given TEAM scope is refused rather
 * than handed the other teams — narrowing it would have to reach the memo key
 * too.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'rnp' } as const

const querySchema = z.object({
  /** `YYYY-MM`. The sheet is one calendar month by construction. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
})

/** «RNP jadvali» — the client's «РНП» sheet for one month. See rnpService.ts. */
export const GET = getHandler(ACCESS, querySchema, async (ctx) => {
  const data = await rnpService.overview({
    month: ctx.query.month,
    timeZone: ctx.timeZone,
    now: ctx.now,
    canEditPlans: can(ctx.principal, 'kpi:manage'),
  })
  return { data }
})
