import { z } from 'zod'

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy'
import { SECTION_IDS } from '@/lib/sections'
import { ROLES } from '@/server/domain/types'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { auditContext } from '@/server/http/auditContext'
import { updateUser } from '@/server/services/userAdminService'

export const dynamic = 'force-dynamic'

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
    sections: z.array(z.enum(SECTION_IDS as unknown as [string, ...string[]])).max(50).optional(),
    employeeId: z.string().trim().min(1).max(64).nullable().optional(),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH).optional(),
  })
  // An empty body would write an audit entry describing no change, which is
  // noise in the one log that has to stay readable.
  .refine((body) => Object.keys(body).length > 0, 'Oʻzgartirish uchun maydon yoʻq.')

/**
 * The id comes from the path, not the body.
 *
 * `mutationHandler` hands the raw Request through precisely so a dynamic
 * segment can be read here without giving every write handler a params
 * argument it does not use.
 */
function targetIdFrom(request: Request): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean)
  const id = segments[segments.length - 1]
  if (!id) throw ApiError.notFound('Hisob koʻrsatilmagan.')
  return id
}

export const PATCH = mutationHandler('users:manage', updateSchema, async (ctx) => ({
  data: await updateUser(
    ctx.principal.userId,
    targetIdFrom(ctx.request),
    ctx.body,
    auditContext(ctx.request),
  ),
}))
