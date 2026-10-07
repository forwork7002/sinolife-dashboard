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
 *   ROLE      what this account may CHANGE. Administering users, editing KPI
 *             plans. Nothing to do with reading.
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

import {
  effectiveSections,
  effectiveWideSections,
  isOpenToEveryoneSection,
  type SectionValue,
} from '@/lib/sections'
import type { DataScopeValue, RoleValue } from '@/server/domain/types'

export const PERMISSIONS = [
  /** Read analytics across the whole company. */
  'analytics:read:all',
  /** Read analytics limited to one's own deals. */
  'analytics:read:own',
  'employees:read',
  'leaderboard:read',
  'kpi:read:all',
  'kpi:read:own',
  'kpi:manage',
  'users:manage',
] as const
/*
  Six permissions went on 2026-10-07 because no endpoint asked for them —
  their endpoints (/deals, /deals/[id], /employees/[id], /finance/overview,
  the sync routes) were deleted on 2026-09-10: deals:read:all / :own,
  employees:read:detail, finance:read, sync:run, sync:read. A grant nothing
  checks is a rule a security review reasons about and nothing enforces.
  `tests/auth/rbac.test.ts` fails if one is listed here again without a
  route, page guard or viewer asking for it.
*/

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
  ADMIN: ['users:manage', 'kpi:manage'],

  // A manager owns the KPI plans. They cannot create accounts — that is how
  // the deployment itself is administered.
  MANAGER: ['kpi:manage'],

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
  'kpi:read:own',
  'employees:read',
  'leaderboard:read',
])

/**
 * Reads that only a company-wide account holds.
 *
 * These gate the endpoints that CANNOT narrow their rows — margin, dispatch,
 * the cohort screens, marketing, payroll. They aggregate across the
 * whole company by construction, so there is no honest way to serve them to
 * an account scoped to one salesperson: the answer would either be the
 * company's, which leaks, or silently blank, which lies. Refusing is the third
 * option and the correct one.
 */
const READ_SCOPED: readonly Permission[] = Object.freeze([
  'analytics:read:all',
  'kpi:read:all',
])

export interface Principal {
  readonly userId: string
  /**
   * The session this request arrived on. Only `updateUser` reads it, to keep
   * the editor signed in when they reset their own password on /users.
   */
  readonly sessionId?: string
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
  /**
   * The granted sections a narrowed account reads COMPANY-WIDE.
   *
   * Already resolved (`wideSectionsFor`): a subset of `sections`. Ignored on
   * an ALL account. Absent is empty — the narrow reading, so a principal built
   * without it fails closed. See `widenForSection`.
   */
  readonly wideSections?: readonly SectionValue[]
  /**
   * True on a principal `widenForSection` lifted to ALL for one read. It READS
   * the company there and must not be offered anything else the stored scope
   * withholds — the edit controls a company-wide account sees, above all.
   */
  readonly widened?: boolean
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

/** Resolve the stored wide ticks against the sections the account holds. */
export function wideSectionsFor(
  sections: readonly SectionValue[],
  stored: readonly string[] | null | undefined,
): readonly SectionValue[] {
  return effectiveWideSections(sections, stored)
}

/**
 * The principal an endpoint should answer, given the screens it feeds.
 *
 * PER-SECTION SCOPE. A narrowed account whose administrator chose «Butun
 * kompaniya» for a screen reads that screen as an ALL account would — the
 * permission check, `ctx.scope` and every memo keyed by it all see ALL — and
 * every other screen it holds stays narrowed. Asked BEFORE the permission, so
 * a company-only endpoint (`analytics:read:all`) admits the widened caller.
 *
 * AN ENDPOINT FEEDING SEVERAL SCREENS WIDENS ONLY IF EVERY ONE OF THEM THIS
 * ACCOUNT HOLDS IS WIDE. The request does not say which screen sent it, so
 * widening on ANY would let a screen granted for one team read the company's
 * rows through an endpoint it shares with a wide one.
 *
 * `null` (no screen: the filter payload, search, the header) never widens.
 *
 * READS ONLY. `mutationHandler` never calls this: the RNP plan / cost /
 * headcount and the lead split POSTs are gated on `analytics:read:all` plus
 * the role's `kpi:manage`, and a team-scoped MANAGER widened there would
 * overwrite every team's plans (security review, 2026-10-05).
 */
export function widenForSection(
  principal: Principal,
  section: SectionValue | readonly SectionValue[] | null,
): Principal {
  if (section === null || principal.dataScope === 'ALL' || !principal.isActive) return principal

  const wide = principal.wideSections ?? []
  if (wide.length === 0) return principal

  const wanted: readonly SectionValue[] = Array.isArray(section)
    ? section
    : [section as SectionValue]
  const held = wanted.filter((id) => canSeeSection(principal, id))
  // «Sotuvchilar reytingi» / «Kadrlar tuzilmasi» answer everybody the company
  // already, so they count as wide here and are never stored as a choice.
  const isWide = (id: SectionValue) => wide.includes(id) || isOpenToEveryoneSection(id)
  if (held.length === 0 || !held.every(isWide)) return principal

  return { ...principal, dataScope: 'ALL', widened: true }
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
 * ONE LIST, TWO COLUMNS IT IS COMPARED AGAINST, AND THAT IS ON PURPOSE. The
 * confirmation queue and the sellers board match it against the OPERATOR —
 * `COALESCE(d."operatorEmployeeId", d."employeeId")`, the portal's own
 * snapshot of who sold the order — because that is who those boards credit.
 * Every deal-shaped endpoint (`/deals`, Savdo dinamikasi, pulse, search)
 * matches it against `d."employeeId"`, the ASSIGNEE, because that is who those
 * screens have always counted. The two differ by design and by measurement:
 * this portal moves deals to back office while they are processed, which put
 * 556 July orders on the head of Операцион.
 *
 * The consequence to know before configuring an account: a TEAM scope anchored
 * to a back-office unit reads, on the deal-shaped screens, every order
 * currently ASSIGNED there — which includes work sold by other teams. That is
 * the answer those screens have always given about assignment; it is not the
 * answer the confirmation queue gives about selling. Give a scope to the unit
 * whose question the account is meant to ask.
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
