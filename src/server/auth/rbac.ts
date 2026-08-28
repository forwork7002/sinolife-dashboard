/**
 * Authorisation policy.
 *
 * Every permission decision in the application resolves here. Nothing else
 * compares a role to a string — a check spelled `user.role === 'ADMIN'` inside
 * a component or a route handler is exactly how permissions drift apart, and
 * how a rule gets tightened in one place and forgotten in three others.
 *
 * Framework-free and pure, so the whole matrix is unit testable.
 */

import { effectiveSections, type SectionValue } from '@/lib/sections'
import type { RoleValue } from '@/server/domain/types'

export const PERMISSIONS = [
  /** Read analytics across the whole company. */
  'analytics:read:all',
  /** Read analytics limited to one's own deals. */
  'analytics:read:own',
  'deals:read:all',
  'deals:read:own',
  'employees:read',
  'employees:read:detail',
  'leaderboard:read',
  'kpi:read:all',
  'kpi:read:own',
  'kpi:manage',
  'finance:read',
  'sync:run',
  'sync:read',
  'users:manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * The matrix.
 *
 * Deliberately written out per role rather than derived by inheritance. A
 * MANAGER is not "an ADMIN minus some things" — the difference is a policy
 * decision, and spelling it out makes each grant visible to review rather than
 * implied by a chain.
 */
const ROLE_PERMISSIONS: Readonly<Record<RoleValue, readonly Permission[]>> = Object.freeze({
  // The `:own` variants are granted alongside the `:all` ones on purpose.
  // They are a LESSER capability, so withholding them from a superior role
  // creates a trap: an endpoint that asks only for `analytics:read:own` would
  // reject an administrator. Holding the superset removes that whole class of
  // bug, and changes nothing about data scoping — `dealScopeFor` keys off the
  // `:all` permission, so an ADMIN is still unrestricted.
  ADMIN: [
    'analytics:read:all',
    'analytics:read:own',
    'deals:read:all',
    'deals:read:own',
    'employees:read',
    'employees:read:detail',
    'leaderboard:read',
    'kpi:read:all',
    'kpi:read:own',
    'kpi:manage',
    'finance:read',
    'sync:run',
    'sync:read',
    'users:manage',
  ],

  MANAGER: [
    'analytics:read:all',
    'analytics:read:own',
    'deals:read:all',
    'deals:read:own',
    'employees:read',
    'employees:read:detail',
    'leaderboard:read',
    'kpi:read:all',
    'kpi:read:own',
    'finance:read',
    'sync:read',
  ],

  // A salesperson sees their own numbers, plus the leaderboard — that one is
  // company-wide by design, since a ranking nobody can see is not a ranking.
  SALES: [
    'analytics:read:own',
    'deals:read:own',
    'employees:read',
    'leaderboard:read',
    'kpi:read:own',
  ],
})

export interface Principal {
  readonly userId: string
  readonly role: RoleValue
  readonly isActive: boolean
  /** Set when the login is linked to a salesperson. Drives own-data scoping. */
  readonly employeeId: string | null
  /**
   * The sections this account may open, already resolved.
   *
   * Resolved rather than raw: `effectiveSections` has already applied the
   * "empty means role default" rule and dropped unknown ids, so every consumer
   * reads one list and none of them can implement the fallback differently.
   */
  readonly sections: readonly SectionValue[]
}

/**
 * Whether this account may open a section.
 *
 * The SECOND gate. `can()` decides whether the role is allowed the capability
 * at all; this decides whether this particular account was given that screen.
 * A request has to pass both, so granting someone the Moliya section cannot
 * hand a salesperson finance data their role never permitted.
 *
 * A deactivated account sees nothing, for the same reason it holds no
 * permissions: disabling someone must take effect without deleting them.
 */
export function canSeeSection(principal: Principal, section: SectionValue): boolean {
  if (!principal.isActive) return false
  return principal.sections.includes(section)
}

/** Resolve a role and a stored list into the sections an account really has. */
export function sectionsFor(
  role: RoleValue,
  stored: readonly string[] | null | undefined,
): readonly SectionValue[] {
  return effectiveSections(role, stored)
}

export function can(principal: Principal, permission: Permission): boolean {
  // A deactivated account keeps its role but loses every permission, so
  // disabling a user takes effect without deleting anything.
  if (!principal.isActive) return false
  return ROLE_PERMISSIONS[principal.role].includes(permission)
}

export function permissionsFor(role: RoleValue): readonly Permission[] {
  return ROLE_PERMISSIONS[role]
}

/**
 * Which employee's deals this principal may see, or `null` for all of them.
 *
 * This is the single source of the data-scoping rule. The repository applies
 * the returned value as a WHERE clause, so scoping happens in SQL and cannot
 * be bypassed by calling the API directly.
 *
 * A SALES user with no linked employee record sees NOTHING rather than
 * everything — failing closed. An unlinked account is a provisioning mistake,
 * and the safe reading of "we do not know whose deals these are" is "none".
 */
export function dealScopeFor(principal: Principal): { restrictToEmployeeId?: string } {
  if (can(principal, 'deals:read:all')) return {}

  return {
    restrictToEmployeeId: principal.employeeId ?? '__no_employee_linked__',
  }
}

/** True when the principal may view this specific employee's detail. */
export function canViewEmployee(principal: Principal, employeeId: string): boolean {
  if (can(principal, 'employees:read:detail')) return true
  return principal.employeeId === employeeId
}
