/**
 * The employee scope an employee-attributable query is narrowed by.
 *
 * Once this module also resolved a FILIAL (branch) from the department tree
 * («barcha malumotlar navoiy filiali uchundir»). Nothing selected a branch
 * after 2026-09-11, and that machinery was removed as dead code on
 * 2026-09-30; what is left is the scope contract every repository reads —
 * today filled from the caller's authorisation scope alone.
 */

import type { Period } from '../period/period'

/**
 * The id that matches nobody.
 *
 * A restriction that narrows to nothing must produce NOTHING. Every repository
 * in this codebase tests an id list with `ids?.length`, so an empty array reads
 * as "no filter given" and silently widens to the whole company — the exact
 * inversion this scope exists to prevent. Carrying one impossible id keeps the
 * list non-empty and the query honest. Mirrors `__no_employee_linked__` in
 * `server/auth/rbac`, which solves the same problem for authorisation.
 */
export const NO_EMPLOYEE_IN_SCOPE = '__no_employee_in_scope__'

/**
 * The resolved employee scope, as repositories consume it.
 *
 * `null` means unrestricted. A non-null value is ALWAYS non-empty — see above.
 */
export interface EmployeeScopeFilter {
  readonly restrictToEmployeeIds?: readonly string[] | null
}

/**
 * A window carrying its scope, with the scope NOT optional.
 *
 * Because `EmployeeScopeFilter`'s field is optional, a bare `Period` would
 * satisfy it — so a repository method that asked for one would still accept
 * an unscoped window and answer for the whole company. A REQUIRED field cannot
 * be satisfied by forgetting: every caller has to say whose rows it is asking
 * for. `null` is a legitimate answer and means the company; it just has to be
 * given.
 */
export type ScopedWindow = Period & {
  readonly restrictToEmployeeIds: readonly string[] | null
}

/** Attach a resolved scope to a window. */
export function scopedPeriod(period: Period, scope: EmployeeScopeFilter): ScopedWindow {
  return { ...period, restrictToEmployeeIds: scope.restrictToEmployeeIds ?? null }
}
