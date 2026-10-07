import { can } from '@/server/auth/rbac'
import { zonedDateKey } from '@/server/domain/period/period'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

import { headcountBodySchema } from './schema'

export const dynamic = 'force-dynamic'

/**
 * Who may type «Ходим сони»: anyone given the RNP screen gets this far; the
 * body is then judged per cell below. Not `analytics:read:all` — a ROP's
 * account is TEAM-scoped, and a mutation never widens (`widenForSection`).
 */
const ACCESS = { permission: 'analytics:read:own', section: 'rnp' } as const

/**
 * Save a ROP team's typed «Ходим сони» of «RNP jadvali».
 *
 * A company-wide editor (`kpi:manage` on an ALL account — the plans form's
 * two conditions) types any team. Anyone else types only the teams their
 * linked employee HEADS (the client 2026-10-07: «ROPlar oʻz xodimini oʻzi
 * kiritsin, faqat oʻzinikini») — judged on who they are, not on a scope.
 */
export const POST = mutationHandler(ACCESS, headcountBodySchema, async (ctx) => {
  const editsAll = can(ctx.principal, 'kpi:manage') && ctx.principal.dataScope === 'ALL'
  if (!editsAll) {
    const own = await rnpService.headcountTeamsOf(ctx.principal.employeeId)
    if (own.size === 0) throw ApiError.forbidden('Xodimlar sonini administrator yoki jamoaning ROPi kirita oladi.')
    const foreign = ctx.body.cells.find((c) => !own.has(c.rop))
    if (foreign) throw ApiError.forbidden(`«${foreign.rop}» jamoasining xodimlar sonini faqat oʻsha jamoa ROPi kirita oladi.`)
  }
  // The sheet shows no day after today; a number typed there would be saved and never shown.
  const today = zonedDateKey(ctx.now, ctx.timeZone)
  if (ctx.body.cells.some((c) => c.day > today)) throw ApiError.validation('Kelajakdagi kun uchun xodimlar sonini kiritib boʻlmaydi.')
  // Only a team the month's sheet draws — no rows for names nobody will ever see.
  const teams = await rnpService.headcountTeams({ month: ctx.body.month, timeZone: ctx.timeZone, now: ctx.now })
  const unknown = ctx.body.cells.find((c) => !teams.has(c.rop))
  if (unknown) throw ApiError.validation(`«${unknown.rop}» bu oy jadvalida ROP sifatida yoʻq.`)
  await rnpService.saveManualHeadcount(ctx.body.cells, ctx.principal.userId)
  return { data: { saved: true } }
})
