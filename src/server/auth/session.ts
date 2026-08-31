/**
 * Session resolution for route handlers.
 *
 * Turns an incoming request into a `Principal`, or throws the right ApiError.
 * Route handlers never inspect cookies or roles themselves.
 */

import { prisma } from '@/server/db/prisma'
import { DATA_SCOPES, ROLES, type DataScopeValue, type RoleValue } from '@/server/domain/types'
import { ApiError } from '@/server/http/errors'
import { auth } from './auth'
import { type Permission, type Principal, can, sectionsFor } from './rbac'

/**
 * Resolve the caller, or throw UNAUTHENTICATED.
 *
 * The role stored on the user row is a plain string as far as better-auth is
 * concerned, so it is validated against the known set here rather than trusted.
 * An unrecognised value degrades to the least-privileged role instead of
 * throwing: a corrupted role must not lock an admin out of the whole app, but
 * it must never grant more than the minimum either.
 */
export async function requirePrincipal(request: Request): Promise<Principal> {
  const session = await auth.api.getSession({ headers: request.headers })

  if (!session?.user) {
    throw ApiError.unauthenticated()
  }

  const user = session.user as typeof session.user & {
    role?: string
    isActive?: boolean
    employeeId?: string | null
  }

  /*
    THE AUTHORITATIVE ROW, not the session's copy of it.

    better-auth caches role and isActive into the session, so an administrator
    who revokes someone's access would not be obeyed until that session next
    refreshed — the revoked user keeps working for as long as their cookie
    lives. For a screen whose whole purpose is "the admin decides who sees
    what", that lag is the feature failing. One primary-key lookup per request
    makes every change take effect on the caller's very next action.

    A MISSING ROW IS A REFUSAL, not a fallback. Deleting an account has to end
    its sessions, and the cookie alone cannot be trusted to say otherwise —
    falling back to the values cached in the session let a deleted user keep
    working until their cookie happened to expire, which is the whole point of
    deletion failing to happen. Caught by the deletion test: the account was
    gone, sign-in returned 401, and the old tab carried on regardless.
  */
  const live = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      role: true,
      isActive: true,
      employeeId: true,
      dataScope: true,
      sections: true,
    },
  })

  if (!live) {
    throw ApiError.unauthenticated()
  }

  const role: RoleValue = ROLES.includes(live.role as RoleValue)
    ? (live.role as RoleValue)
    : 'SALES'

  // Same reasoning as the role above, pointed the other way: an unrecognised
  // scope degrades to the NARROWER of the two, so a corrupted column can only
  // ever show less than it should, never more.
  const dataScope: DataScopeValue = DATA_SCOPES.includes(live.dataScope as DataScopeValue)
    ? (live.dataScope as DataScopeValue)
    : 'OWN'

  const principal: Principal = {
    userId: user.id,
    role,
    isActive: live.isActive,
    employeeId: live.employeeId,
    dataScope,
    sections: sectionsFor(role, live.sections),
  }

  if (!principal.isActive) {
    throw ApiError.forbidden('Hisobingiz faolsizlantirilgan.')
  }

  return principal
}

/**
 * Resolve the caller and assert a permission, or throw.
 *
 * An array means ANY-OF. Analytics endpoints are reachable with either
 * `analytics:read:all` or `analytics:read:own` — access is the same question
 * for both, and how much data comes back is decided separately by
 * `dealScopeFor`. Collapsing the two into one permission would lose that
 * distinction; requiring both would lock salespeople out of their own numbers.
 */
export async function requirePermission(
  request: Request,
  permission: Permission | readonly Permission[],
): Promise<Principal> {
  const principal = await requirePrincipal(request)
  const required = Array.isArray(permission) ? permission : [permission as Permission]

  if (!required.some((p) => can(principal, p))) {
    throw ApiError.forbidden()
  }

  return principal
}

/** Non-throwing variant, for pages that render differently when signed out. */
export async function optionalPrincipal(request: Request): Promise<Principal | null> {
  try {
    return await requirePrincipal(request)
  } catch {
    return null
  }
}
