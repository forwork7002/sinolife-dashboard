import { z } from 'zod'

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy'
import { SECTION_IDS } from '@/lib/sections'
import { ROLES } from '@/server/domain/types'
import { getHandler, mutationHandler } from '@/server/http/handler'
import { auditContext } from '@/server/http/auditContext'
import { createUser, listUsers } from '@/server/services/userAdminService'

export const dynamic = 'force-dynamic'

/**
 * The accounts on this deployment.
 *
 * `users:manage` only, which is ADMIN only — the list carries email addresses
 * and role assignments, and neither is a manager's business.
 */
export const GET = getHandler('users:manage', z.object({}), async () => ({
  data: { items: await listUsers() },
}))

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  /*
    Bounded here AND checked against the policy in the service.

    The bounds stop an absurd body from ever reaching the hasher; the policy
    check produces the field-level Uzbek messages the form shows. Neither
    replaces the other.
  */
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  role: z.enum(ROLES),
  sections: z.array(z.enum(SECTION_IDS as unknown as [string, ...string[]])).max(50).optional(),
  employeeId: z.string().trim().min(1).max(64).nullable().optional(),
})

export const POST = mutationHandler('users:manage', createSchema, async (ctx) => ({
  data: await createUser(ctx.principal.userId, ctx.body, auditContext(ctx.request)),
}))
