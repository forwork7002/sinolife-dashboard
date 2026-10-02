import { can } from '@/server/auth/rbac'
import { zonedDateKey } from '@/server/domain/period/period'
import { ApiError } from '@/server/http/errors'
import { getHandler, mutationHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { groupIntakeBodySchema, overviewQuerySchema } from '../schema'

export const dynamic = 'force-dynamic'

/** COMPANY-WIDE, like the split and «ROP otchet» beside it; typing asks `kpi:manage` inside. */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/** «Guruhlar · безквал / квал» — one day. See groupIntake.ts. */
export const GET = getHandler(ACCESS, overviewQuerySchema, async (ctx) => {
  const data = await registrationService.groupIntake({
    day: ctx.query.day ?? zonedDateKey(ctx.now, ctx.timeZone),
    canEdit: can(ctx.principal, 'kpi:manage'),
  })
  return { data }
})

/** Save the groups' typed «безквал» for a day. Groups not sent keep theirs. */
export const POST = mutationHandler(ACCESS, groupIntakeBodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Безквал sonini faqat administrator kiritadi.')
  // A day still to come has no intake yet; a number typed there is a typo.
  if (ctx.body.day > zonedDateKey(ctx.now, ctx.timeZone)) throw ApiError.validation('Kelajakdagi kun uchun kiritib boʻlmaydi.')
  await registrationService.saveGroupIntake(ctx.body.day, ctx.body.rows, ctx.principal.userId)
  return { data: { saved: true } }
})
