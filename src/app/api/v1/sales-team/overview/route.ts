import { z } from 'zod'

import { can } from '@/server/auth/rbac'
import { getHandler } from '@/server/http/handler'
import { salesTeamService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like the rest of «Reklama samarasi»: every ROP team side by
 * side, with their plans. A ROP given TEAM scope is refused rather than
 * handed the other teams — narrowing it is a decision for the client, and
 * one that would have to reach the memo key too.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

const querySchema = z.object({
  /** `YYYY-MM`. The month the ROP sheet covers. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
  /** `YYYY-MM-DD` inside the month — the group sheet's day. Defaults to today. */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
})

/**
 * «Sotuv · ROP» — the client's ROP sheets for one month and one day of it.
 * Its own month and day, not the dashboard preset: both sheets are a
 * calendar month by construction. See salesTeamService.ts.
 */
export const GET = getHandler(ACCESS, querySchema, async (ctx) => {
  const data = await salesTeamService.overview({
    month: ctx.query.month,
    day: ctx.query.day,
    timeZone: ctx.timeZone,
    now: ctx.now,
    canEditPlans: can(ctx.principal, 'kpi:manage'),
  })
  return { data }
})
