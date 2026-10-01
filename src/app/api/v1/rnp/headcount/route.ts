import { can } from '@/server/auth/rbac'
import { zonedDateKey } from '@/server/domain/period/period'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

import { headcountBodySchema } from './schema'

export const dynamic = 'force-dynamic'

/** Who may type «Ходим сони» — the same two conditions as the plans form and the costs. */
const ACCESS = { permission: 'analytics:read:all', section: 'rnp' } as const

/** Save a ROP team's typed «Ходим сони» of «RNP jadvali». */
export const POST = mutationHandler(ACCESS, headcountBodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Xodimlar sonini faqat administrator kirita oladi.')
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
