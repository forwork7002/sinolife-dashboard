import { z } from 'zod'

import { can } from '@/server/auth/rbac'
import { ApiError } from '@/server/http/errors'
import { getHandler, mutationHandler } from '@/server/http/handler'
import { timepayLinkService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * «Sotuvchilar oyligi → TimePay bogʻlash» (2026-11-05): who each TimePay
 * (FaceID) person is here, for the lateness fine. Read by whoever reads the
 * payroll — the same capability and screen as `/payroll/sellers`, since a
 * link decides whose pay a fine comes off.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'payroll' } as const

export const GET = getHandler(ACCESS, z.object({}), async () => ({
  data: await timepayLinkService.links(),
}))

const linkSchema = z.object({
  timepayId: z.number().int().positive(),
  /** The ISH employee; null — «this person is nobody here», kept so the name match never relinks them. */
  employeeId: z.string().min(1).max(64).nullable(),
})

/**
 * A link is set (or cleared) by an ADMINISTRATOR only (`users:manage`): it
 * moves a fine from one person's pay to another's.
 */
export const POST = mutationHandler(ACCESS, linkSchema, async (ctx) => {
  if (!can(ctx.principal, 'users:manage')) throw ApiError.forbidden('TimePay bogʻlanishini faqat administrator oʻzgartira oladi.')
  await timepayLinkService.link(ctx.body.timepayId, ctx.body.employeeId, ctx.principal.login ?? ctx.principal.userId)
  return { data: { saved: true } }
})
