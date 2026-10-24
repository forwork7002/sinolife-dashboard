import { z } from 'zod'

import { can } from '@/server/auth/rbac'
import { narrowRnpSheet } from '@/server/domain/rnp/rnpScope'
import { ApiError } from '@/server/http/errors'
import { getHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * Company-wide for an ALL account and for one holding «RNP jadvali» as
 * «Butun kompaniya» (widened): every ROP team, the registration desk and the
 * Meta spend side by side, with every team's plans. A TEAM account holding it
 * as «Oʻz boʻlimi» (2026-10-24) reads its own teams' blocks and logistics and
 * nothing else (`narrowRnpSheet`, cut from the finished sheet — the month's
 * memo stays one company-wide answer). OWN is refused: the sheet has no row
 * smaller than a team.
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
  const restrict = ctx.scope.restrictToEmployeeIds
  if (restrict !== null && ctx.principal.dataScope !== 'TEAM') {
    throw ApiError.forbidden('RNP jadvali jamoa boʻyicha: shaxsiy hisobga u faqat «Butun kompaniya» sifatida ochiladi.')
  }
  // Not on a widened read, nor a narrowed one: the write is judged on the stored scope and refused.
  const canEditPlans = can(ctx.principal, 'kpi:manage') && !ctx.principal.widened && ctx.principal.dataScope === 'ALL'
  const [data, ownTeams, scopeTeams] = await Promise.all([
    rnpService.overview({
      month: ctx.query.month,
      timeZone: ctx.timeZone,
      now: ctx.now,
      canEditPlans,
    }),
    // A ROP types their own team's «Ходим сони» (POST /rnp/headcount judges it the same way).
    canEditPlans ? Promise.resolve(new Set<string>()) : rnpService.headcountTeamsOf(ctx.principal.employeeId),
    restrict === null ? Promise.resolve(null) : rnpService.teamsOf(restrict),
  ])
  const sheet = scopeTeams === null ? data : narrowRnpSheet(data, scopeTeams)
  return { data: { ...sheet, headcountTeams: [...ownTeams] } }
})
