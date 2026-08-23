/**
 * Session resolution for route handlers.
 *
 * Turns an incoming request into a `Principal`, or throws the right ApiError.
 * Route handlers never inspect cookies or roles themselves.
 */

import { ROLES, type RoleValue } from '@/server/domain/types'
import { ApiError } from '@/server/http/errors'
import { auth } from './auth'
import { type Permission, type Principal, can } from './rbac'

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

  const role: RoleValue = ROLES.includes(user.role as RoleValue)
    ? (user.role as RoleValue)
    : 'SALES'

  const principal: Principal = {
    userId: user.id,
    role,
    isActive: user.isActive !== false,
    employeeId: user.employeeId ?? null,
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
