import { can } from '@/server/auth/rbac'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

import { planBodySchema } from './schema'

export const dynamic = 'force-dynamic'

/** Who may type a plan — the same two conditions as the costs and the headcount. */
const ACCESS = { permission: 'analytics:read:all', section: 'rnp' } as const

/** Save typed plan cells (column C) of «RNP jadvali». */
export const POST = mutationHandler(ACCESS, planBodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Rejani faqat administrator kirita oladi.')
  // Only a cell the month's sheet leaves open — a computed plan is the sheet's formula, never typed.
  const open = await rnpService.planInputs({ month: ctx.body.month, timeZone: ctx.timeZone, now: ctx.now })
  const closed = ctx.body.cells.find((c) => !open.has(`${c.team}|${c.metric}`))
  if (closed) throw ApiError.validation(`«${closed.team || 'kompaniya'} · ${closed.metric}» rejasi qoʻlda kiritilmaydi.`)
  await rnpService.savePlanCells(ctx.body.month, ctx.body.cells, ctx.principal.userId)
  return { data: { saved: true } }
})
