import { can } from '@/server/auth/rbac'
import { splitProblem } from '@/server/domain/registration/leadSplit'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { splitBodySchema } from '../schema'

export const dynamic = 'force-dynamic'

/**
 * Who may set the day's split — the same two conditions as «RNP jadvali»'s
 * plans: `analytics:read:all` at the gate, `kpi:manage` inside.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'registration' } as const

/** Replace one day's split of handed-out leads among the ROPs. */
export const POST = mutationHandler(ACCESS, splitBodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Taqsimotni faqat administrator belgilay oladi.')
  const problem = splitProblem(ctx.body.rows)
  if (problem) throw ApiError.validation(problem)
  await registrationService.saveSplit(ctx.body.day, ctx.body.rows, ctx.principal.userId)
  return { data: { saved: true } }
})
