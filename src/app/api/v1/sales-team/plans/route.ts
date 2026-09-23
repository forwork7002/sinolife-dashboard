import { z } from 'zod'

import { can } from '@/server/auth/rbac'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { salesTeamService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who may change a plan — TWO conditions, and the gate states the first.
 *
 * `analytics:read:all`: the plans are every team's, with no employee scope to
 * narrow by, so a TEAM-scoped ROP must not rewrite another ROP's plan — the
 * same refusal the overview makes (routeAccess.test.ts pins it).
 * `kpi:manage`, checked inside: of the company-wide readers, only the
 * administrators and managers the KPI plans were always meant for.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'marketing' } as const

/** Whole soʻm, as the form types it; up to a trillion, never negative. */
const som = z.number().int().min(0).max(1_000_000_000_000).nullable()

const bodySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
  teams: z
    .array(z.object({ rop: z.string().trim().min(1).max(200), fakt1: som, fakt2: som }))
    .max(200),
  sellers: z
    .array(z.object({ employeeId: z.string().min(1).max(64), dayPlan: som }))
    .max(2000),
})

const minor = (v: number | null) => (v === null ? null : BigInt(v) * 100n)

/**
 * Save one month's plans — the «Rejalar» form on «Sotuv · ROP». Replaces
 * what it names; an empty or zero amount removes that plan.
 */
export const POST = mutationHandler(ACCESS, bodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Rejalarni faqat administrator oʻzgartira oladi.')
  await salesTeamService.savePlans(
    ctx.body.month,
    {
      teams: ctx.body.teams.map((t) => ({ rop: t.rop, fakt1Minor: minor(t.fakt1), fakt2Minor: minor(t.fakt2) })),
      sellers: ctx.body.sellers.map((s) => ({ employeeId: s.employeeId, amountMinor: minor(s.dayPlan) })),
    },
    ctx.principal.userId,
  )
  return { data: { saved: true } }
})
