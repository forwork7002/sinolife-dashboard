/**
 * Authorisation policy.
 *
 * Every permission decision in the application resolves here. Nothing else
 * compares a role to a string — a check spelled `user.role === 'ADMIN'` inside
 * a component or a route handler is exactly how permissions drift apart, and
 * how a rule gets tightened in one place and forgotten in three others.
 *
 * THREE QUESTIONS, THREE FIELDS. They used to be two, and the missing one was
 * the bug: `role` answered both "what may this account change" and "how much
 * data does it see", so an administrator who created an account, ticked six
 * sections and handed over the password got an account that opened all six
 * screens and found every one of them blank or refused. There was no way to
 * say "read-only, but the whole company" — the only account that saw the
 * company was one that could also edit it.
 *
 *   ROLE      what this account may CHANGE. Administering users, running a
 *             sync, editing KPI plans. Nothing to do with reading.
 *   SECTIONS  which SCREENS it may open — and, since `getHandler` asserts it
 *             too, which endpoints it may call. The admin's ticks are the
 *             reach boundary, end to end.
 *   DATASCOPE how much of each granted screen it reads: the whole company, or
 *             one linked salesperson's own records.
 *
 * Reading is therefore granted to every active account and narrowed twice —
 * by section and by scope — instead of being withheld by role. That is what
 * makes "give this person Logistika and nothing else" expressible.
 *
 * Framework-free and pure, so the whole matrix is unit testable.
 */

import { effectiveSections, type SectionValue } from '@/lib/sections'
import type { DataScopeValue, RoleValue } from '@/server/domain/types'

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
 * What each role may CHANGE.
 *
 * Deliberately written out per role rather than derived by inheritance. A
 * MANAGER is not "an ADMIN minus some things" — the difference is a policy
 * decision, and spelling it out makes each grant visible to review rather than
 * implied by a chain.
 *
 * Only write-shaped capabilities live here. Read permissions are not a role
 * question any more; see READ_ANY and READ_SCOPED below.
 */
const ROLE_PERMISSIONS: Readonly<Record<RoleValue, readonly Permission[]>> = Object.freeze({
  ADMIN: ['users:manage', 'sync:run', 'kpi:manage', 'employees:read:detail'],

  // A manager owns the KPI plans and may look a colleague up by name. They
  // cannot create accounts or force a sync — those two are how the deployment
  // itself is administered.
  MANAGER: ['kpi:manage', 'employees:read:detail'],

  // Read-only. Which screens, and how much of each, is decided per account by
  // its sections and its data scope — not by this list being short.
  SALES: [],
})

/**
 * Reads any active account holds, whatever its scope.
 *
 * The `:own` variants are here rather than in the scoped list on purpose: they
 * are a LESSER capability, so withholding them from a company-wide account
 * creates a trap — an endpoint asking only for `analytics:read:own` would
 * reject an administrator. Holding the superset changes nothing about data
 * scoping, because `dealScopeFor` keys off `dataScope` and not off these.
 *
 * `employees:read` is in this list because every page's filter bar needs the
 * roster to render at all; `meta/filters` already narrows it to the one
 * employee an OWN-scoped account is allowed to name.
 */
const READ_ANY: readonly Permission[] = Object.freeze([
  'analytics:read:own',
  'deals:read:own',
  'kpi:read:own',
  'employees:read',
  'leaderboard:read',
  'sync:read',
])

/**
 * Reads that only a company-wide account holds.
 *
 * These gate the endpoints that CANNOT narrow their rows — the confirmation
 * queue, logistics, margin, the command centre. They aggregate across the
 * whole company by construction, so there is no honest way to serve them to
 * an account scoped to one salesperson: the answer would either be the
 * company's, which leaks, or silently blank, which lies. Refusing is the third
 * option and the correct one.
 */
const READ_SCOPED: readonly Permission[] = Object.freeze([
  'analytics:read:all',
  'deals:read:all',
  'kpi:read:all',
  'finance:read',
])

export interface Principal {
  readonly userId: string
  readonly role: RoleValue
  readonly isActive: boolean
  /** Set when the login is linked to a salesperson. Drives own-data scoping. */
  readonly employeeId: string | null
  /**
   * How much of each granted section this account reads.
   *
   * ALL is the company. OWN is the linked employee. TEAM is that employee's
   * unit and everything under it — resolved from the department tree per
   * request, which is why `rowScopeFor` below takes the resolved ids rather
   * than reading them itself: this module stays pure and unit testable.
   */
  readonly dataScope: DataScopeValue
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
 * The SECOND gate, and the one the administrator actually operates. `can()`
 * decides whether the account holds the capability at all; this decides
 * whether it was given this particular screen. Both the page and the endpoint
 * behind it ask, so a section that was never ticked cannot be reached by
 * typing the URL or by calling the API directly.
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

  if (ROLE_PERMISSIONS[principal.role].includes(permission)) return true
  if (READ_ANY.includes(permission)) return true
  return principal.dataScope === 'ALL' && READ_SCOPED.includes(permission)
}

/**
 * Every permission an account with this role and scope would hold.
 *
 * Takes both because neither alone decides it any more.
 */
export function permissionsFor(
  role: RoleValue,
  dataScope: DataScopeValue = 'ALL',
): readonly Permission[] {
  const probe: Principal = {
    userId: '',
    role,
    isActive: true,
    employeeId: null,
    dataScope,
    sections: [],
  }
  return PERMISSIONS.filter((permission) => can(probe, permission))
}

/**
 * The id that matches nobody.
 *
 * A scope that narrows to nothing must produce NOTHING. Every repository here
 * tests an id list with `ids?.length`, so an empty array reads as "no filter
 * given" and silently widens to the whole company — the exact inversion this
 * scope exists to prevent. Carrying one impossible id keeps the list non-empty
 * and the query honest. Mirrors `NO_EMPLOYEE_IN_SCOPE` in
 * `domain/employees/branches`, which solves the same problem for filials.
 */
export const NO_EMPLOYEE_LINKED = '__no_employee_linked__'

/**
 * Whose rows this principal may read.
 *
 * ONE FIELD, AND IT IS PLURAL. It used to be `restrictToEmployeeId`, a single
 * id, because a scope could only ever mean one person. TEAM means fifteen, and
 * a repository that honoured the singular while ignoring a new plural
 * companion would have served the whole company to a ROP without erroring —
 * so the singular was removed rather than kept beside it. Every consumer now
 * reads one field, and the compiler found them all.
 *
 * `null` means unrestricted. A non-null value is ALWAYS non-empty.
 */
export interface RowScope {
  readonly restrictToEmployeeIds: readonly string[] | null
}

/**
 * Does resolving this principal's scope require a look at the department tree?
 *
 * Asked by the handler so ALL and OWN — which are decided by the session row
 * alone — cost no query. Only TEAM does.
 */
export function scopeNeedsTeam(principal: Principal): boolean {
  return principal.isActive && principal.dataScope === 'TEAM'
}

/**
 * Which employees' rows this principal may see, or `null` for all of them.
 *
 * This is the single source of the data-scoping rule. The repository applies
 * the returned value as a WHERE clause, so scoping happens in SQL and cannot
 * be bypassed by calling the API directly.
 *
 * An OWN- or TEAM-scoped account with no linked employee record sees NOTHING
 * rather than everything — failing closed. It is a provisioning mistake the
 * admin screen refuses to create, and the safe reading of "we do not know
 * whose deals these are" is "none".
 *
 * @param teamEmployeeIds The department subtree already resolved, for a TEAM
 *   principal. Passed in rather than fetched so this module stays pure — and
 *   REQUIRED for TEAM: omitting it throws instead of quietly widening, because
 *   the failure mode of a forgotten resolver is a ROP reading the company.
 */
export function rowScopeFor(
  principal: Principal,
  teamEmployeeIds: readonly string[] | null = null,
): RowScope {
  // `isActive` is asked here as well as in `can()`. A deactivated caller never
  // reaches a handler — `requirePrincipal` refuses first — but a scoping rule
  // that WIDENS when the caller is disabled is the wrong shape to leave lying
  // around for the next person who calls it from somewhere new.
  if (principal.isActive && principal.dataScope === 'ALL') {
    return { restrictToEmployeeIds: null }
  }

  const own = principal.employeeId ?? NO_EMPLOYEE_LINKED

  if (scopeNeedsTeam(principal)) {
    if (teamEmployeeIds === null) {
      throw new Error(
        'rowScopeFor: a TEAM principal reached a handler with no resolved team. ' +
          'Resolve the department subtree first — widening here would serve the company.',
      )
    }
    /*
      The reader is always in their own scope, even when the tree says nothing
      about them. A ROP filed in no department, or one whose unit was renamed
      out from under them, still owns their own rows; an empty list would take
      those away too and read on screen as "you have never sold anything".
    */
    const ids = new Set<string>(teamEmployeeIds)
    ids.add(own)
    return { restrictToEmployeeIds: [...ids] }
  }

  return { restrictToEmployeeIds: [own] }
}

/**
 * True when the principal may view this specific employee's detail.
 *
 * The scope is the third answer, and it has to be, or a ROP given TEAM could
 * open the board their own team is on and then be refused every card in it.
 */
export function canViewEmployee(
  principal: Principal,
  employeeId: string,
  scope?: RowScope,
): boolean {
  if (can(principal, 'employees:read:detail')) return true
  if (principal.employeeId === employeeId) return true
  const ids = scope?.restrictToEmployeeIds
  return ids ? ids.includes(employeeId) : false
}
