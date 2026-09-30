import { can } from '@/server/auth/rbac'
import { zonedDateKey } from '@/server/domain/period/period'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

import { costsBodySchema } from './schema'

export const dynamic = 'force-dynamic'

/**
 * Who may type the P&L's cost lines — the same two conditions as the plans
 * form: `analytics:read:all` at the gate, `kpi:manage` inside.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'rnp' } as const

/** Save typed P&L costs of «RNP jadvali». */
export const POST = mutationHandler(ACCESS, costsBodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Xarajatlarni faqat administrator kirita oladi.')
  // The sheet shows no day after today; a cost typed there would be saved and never counted.
  const today = zonedDateKey(ctx.now, ctx.timeZone)
  if (ctx.body.cells.some((c) => c.day > today)) throw ApiError.validation('Kelajakdagi kun uchun xarajat kiritib boʻlmaydi.')
  await rnpService.saveManualCosts(ctx.body.cells, ctx.principal.userId)
  return { data: { saved: true } }
})
