import { can } from '@/server/auth/rbac'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { sellerPlanBodySchema } from '../schema'

export const dynamic = 'force-dynamic'

/** The same two conditions as the split: `analytics:read:all` at the gate, `kpi:manage` inside. */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/** Set the sellers' day plans for a month — «ROP otchet»'s «План» column. Sellers not sent keep theirs. */
export const POST = mutationHandler(ACCESS, sellerPlanBodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Rejani faqat administrator kiritadi.')
  const saved = await registrationService.saveSellerPlans(
    ctx.body.month,
    ctx.body.sellers.map((s) => ({ employeeId: s.employeeId, amountMinor: s.dayPlan ? BigInt(s.dayPlan) * 100n : null })),
    ctx.principal.userId,
  )
  if (!saved) throw ApiError.validation('Notanish sotuvchi.')
  return { data: { saved: true } }
})
