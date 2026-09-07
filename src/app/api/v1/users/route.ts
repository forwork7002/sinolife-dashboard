import { z } from 'zod'

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy'
import { SECTION_IDS } from '@/lib/sections'
import { DATA_SCOPES, ROLES } from '@/server/domain/types'
import { getHandler, mutationHandler } from '@/server/http/handler'
import { auditContext } from '@/server/http/auditContext'
import { createUser, listDepartmentHeads, listUsers } from '@/server/services/userAdminService'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'users:manage', section: null } as const

const listSchema = z.object({
  /*
    Ask for the department heads as well — the ROP tab's own list.

    A QUERY PARAMETER RATHER THAN A SECOND ROUTE, and the reason is a test.
    `tests/http/routeAccess.test.ts` pins the exact set of endpoints that
    declare `section: null` and the exact set a narrowed caller may reach, both
    as literal arrays, so that adding one has to be said out loud in a diff.
    That is the right rule and this endpoint has nothing new to say under it:
    the heads are account administration, read by the same administrator, under
    the same permission, on the same screen.

    OPT-IN RATHER THAN ALWAYS, because it is not free: the team size beside each
    head is asked of the real scope resolver, one recursive query per head. The
    accounts table does not need any of it, and this screen refetches on the
    app's one-minute cadence.
  */
  include: z.enum(['heads']).optional(),
})

/**
 * The accounts on this deployment.
 *
 * `users:manage` only, which is ADMIN only — the list carries email addresses
 * and role assignments, and neither is a manager's business.
 */
export const GET = getHandler(ACCESS, listSchema, async (ctx) => {
  // Absent rather than empty when it was not asked for: an empty array would
  // read on the client as "this portal has no department heads".
  const heads = ctx.query.include === 'heads' ? await listDepartmentHeads() : undefined

  return {
    data: {
      items: await listUsers(),
      heads: heads?.heads,
      headlessUnits: heads?.headless,
    },
  }
})

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /*
    The login, not an email address.

    Same character set the username plugin validates with, restated here so a
    bad value is a 400 with a field message rather than a plugin error the
    form cannot attach to an input. '@' is excluded on purpose: the sign-in
    form accepts either a login or an email and tells them apart by '@'.
  */
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Faqat harf, raqam, nuqta, chiziqcha va pastki chiziq.'),
  /*
    Bounded here AND checked against the policy in the service.

    The bounds stop an absurd body from ever reaching the hasher; the policy
    check produces the field-level Uzbek messages the form shows. Neither
    replaces the other.
  */
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  role: z.enum(ROLES),
  dataScope: z.enum(DATA_SCOPES).optional(),
  sections: z.array(z.enum(SECTION_IDS as unknown as [string, ...string[]])).max(50).optional(),
  employeeId: z.string().trim().min(1).max(64).nullable().optional(),
})

export const POST = mutationHandler(ACCESS, createSchema, async (ctx) => ({
  data: await createUser(ctx.principal.userId, ctx.body, auditContext(ctx.request)),
}))
