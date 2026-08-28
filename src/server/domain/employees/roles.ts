/**
 * Who counts as a SALESPERSON.
 *
 * WHY THIS FILE EXISTS AT ALL
 * The reyting (leaderboard) must rank sellers and nobody else. Until this rule
 * existed it ranked the whole roster, and the standings said so: first place
 * went to the HEAD of Операцион — an operations department — with 575.7 mln
 * over the last thirty days, and second to a ROP with 235.3 mln. Neither of
 * them sells; both simply have the team's closed deals attributed to them. The
 * best actual seller, 154 Marjona Xayrullayeva with 217.6 mln, came third on
 * her own leaderboard.
 *
 * WHY NOT `Employee.position`
 * Because it is NULL for all 288 employees on this portal. Bitrix24 never
 * filled the job-title field, so classifying by title would classify nobody.
 * The department tree is the only place the portal actually records who does
 * what — so that is what this reads.
 *
 * THE RULE
 * A seller is an employee whose department is a SALES TEAM — a department whose
 * name ends with "(ROP)", the portal's own naming convention for one, typed by
 * hand fifteen times (Lola(ROP), Azizbek(ROP), Baza(ROP), …) — and who is NOT a
 * department head. The head of a sales team is its ROP: a manager whose numbers
 * are the team's numbers, which is exactly why they crowd out the people who
 * earned them.
 *
 * Everyone else is:
 *   MANAGER — a department head, of a sales team or of anything else. Running a
 *             team is the disqualifying fact, not which team it is.
 *   OTHER   — staff outside the sales teams: NEWGEN, Регистрация, Операцион,
 *             Навоий, Тошкент онлайн. Registration and operations close deals
 *             in the portal; they do not sell them.
 *
 * ONE DEFINITION, TWO EVALUATORS
 * `classifyEmployeeRole` is the reference implementation and the tested one.
 * The leaderboard's roster query cannot call it — the filter has to run in
 * Postgres so ranking happens after it and no rank has a hole where a ROP was
 * removed — so `dealRepository.findLeaderboardRoster` re-states the same rule
 * in SQL, built from `SALES_TEAM_NAME_LIKE` below rather than from a literal.
 * If the suffix ever changes, it changes here and both evaluators follow.
 */

export const EMPLOYEE_ROLES = ['SELLER', 'MANAGER', 'OTHER'] as const

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number]

/**
 * The suffix that marks a department as a sales team.
 *
 * "ROP" is руководитель отдела продаж — head of sales department. The portal
 * names each sales team after its ROP and tags it with this suffix; there is no
 * flag, no type column and no other marker. Comparison is case-insensitive and
 * ignores surrounding whitespace because these names are typed by hand, and
 * "Charos(ROP) " with a trailing space is a data-entry slip, not a different
 * kind of department.
 */
export const SALES_TEAM_SUFFIX = '(ROP)'

/**
 * The same suffix as a Postgres `LIKE` pattern, for the roster query.
 *
 * Match it against `lower(btrim(<name>))` — lowercase for the case tolerance
 * and `btrim` for the whitespace tolerance, exactly what `isSalesTeamName`
 * does in TypeScript. Safe to interpolate as a pattern because the suffix
 * contains no `%` or `_`; a test below asserts that stays true.
 */
export const SALES_TEAM_NAME_LIKE = `%${SALES_TEAM_SUFFIX.toLowerCase()}`

/** Is this department one of the sales teams? */
export function isSalesTeamName(departmentName: string | null | undefined): boolean {
  if (!departmentName) return false
  return departmentName.trim().toLowerCase().endsWith(SALES_TEAM_SUFFIX.toLowerCase())
}

export interface EmployeeRoleInput {
  /** The employee's own department. Null when the portal filed them nowhere. */
  readonly departmentName: string | null | undefined
  /**
   * Does this person head a department?
   *
   * TRUE for the head of ANY department, not only of their own. The two
   * readings agree on today's data — every one of the 17 heads leads the team
   * they belong to — but "heads some other department" is still a manager, and
   * the broader reading is the one that cannot be gamed by moving a ROP's
   * membership row.
   */
  readonly isDepartmentHead: boolean
}

/**
 * Classify one employee.
 *
 * Order matters: heading a department wins over belonging to a sales team, so a
 * ROP is a MANAGER rather than the top seller of their own team.
 */
export function classifyEmployeeRole(input: EmployeeRoleInput): EmployeeRole {
  if (input.isDepartmentHead) return 'MANAGER'
  return isSalesTeamName(input.departmentName) ? 'SELLER' : 'OTHER'
}

/** Convenience for the callers that only ask the one question. */
export function isSeller(input: EmployeeRoleInput): boolean {
  return classifyEmployeeRole(input) === 'SELLER'
}
