import { z } from 'zod'

import { can } from '@/server/auth/rbac'
import { getHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE FOR EVERY CALLER (2026-10-05, the client: «rnp jadvali …
 * global bo'ladi, rnp hammaga»). Every ROP team, the registration desk and the
 * Meta spend side by side, with every team's plans — the sheet the ROPs are
 * run by, so a ROP reads the whole of it, not their own block. Until then a
 * TEAM-scoped account was refused here. `ctx.scope` is deliberately NOT read:
 * the answer, and its memo, are the same for everyone. Who sees the screen at
 * all is still the `rnp` section on the account; who may type plans is still
 * `kpi:manage`. Pinned as such in `routeAccess.test.ts` (COMPANY_WIDE).
 */
const ACCESS = { permission: 'analytics:read:own', section: 'rnp' } as const

const querySchema = z.object({
  /**
   * `YYYY-MM`. The sheet is one calendar month by construction. Bounded: the
   * portal's data starts in 2025, and each month asks the Central Bank for a
   * rate per day — a request for 1900-01 is refused, not built.
   */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
    .refine((m) => m >= '2025-01' && m <= '2100-12', 'Month out of range'),
})

/** «RNP jadvali» — the client's «РНП» sheet for one month. See rnpService.ts. */
export const GET = getHandler(ACCESS, querySchema, async (ctx) => {
  const data = await rnpService.overview({
    month: ctx.query.month,
    timeZone: ctx.timeZone,
    now: ctx.now,
    // Not on a widened read: the write is judged on the stored scope and refused.
    canEditPlans: can(ctx.principal, 'kpi:manage') && !ctx.principal.widened,
  })
  return { data }
})
