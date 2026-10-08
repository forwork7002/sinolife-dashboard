import { can } from '@/server/auth/rbac'
import { zonedDateKey } from '@/server/domain/period/period'
import { usdToCents } from '@/server/domain/reklama/manualSpend'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { leadSourcesService } from '@/server/services/container'

import { manualSpendBodySchema } from './schema'

export const dynamic = 'force-dynamic'

/**
 * Who may type the «Telegram» card's days on «Targetologlar · kunlik» (a tab
 * of «Lidlar») — the same two conditions as RNP's typed cells:
 * `analytics:read:all` at the section's gate, `kpi:manage` inside.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/** Save the hand-typed ad money (Telegram) of «Targetologlar · kunlik». */
export const POST = mutationHandler(ACCESS, manualSpendBodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Xarajatlarni faqat administrator kirita oladi.')
  // The strip shows no day after today; money typed there would be saved and never shown.
  const today = zonedDateKey(ctx.now, ctx.timeZone)
  if (ctx.body.cells.some((c) => c.day > today)) throw ApiError.validation('Kelajakdagi kun uchun xarajat kiritib boʻlmaydi.')
  await leadSourcesService.saveManualSpend(
    ctx.body.cells.map((c) => ({ day: c.day, project: c.project, channel: c.channel, cents: usdToCents(c.value) })),
    ctx.principal.userId,
  )
  return { data: { saved: true } }
})
