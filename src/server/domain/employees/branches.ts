/**
 * Which FILIAL (branch) an employee belongs to.
 *
 * WHY THIS FILE EXISTS AT ALL
 * The product's default reality is one branch: "barcha malumotlar navoiy
 * filiali uchundir". That is a SCOPE, not an import filter — Тошкент stays in
 * Postgres and stays selectable — so every employee-attributable query needs a
 * list of employee ids to narrow by, and that list has to come from somewhere
 * exact. This is that somewhere.
 *
 * THE RULE, AND THE BUG THAT NAMES IT
 * The portal's department tree is three levels deep:
 *
 *     NEWGEN (root)
 *     ├── Навоий            ← branch      (6 sales teams, 109 people)
 *     │   └── Sevinch(ROP) · Gulzora(ROP) · Lola(ROP) · …
 *     ├── Тошкент онлайн    ← branch      (9 sales teams, 116 people)
 *     │   └── Asliddin(ROP) · Azizbek(ROP) · …
 *     ├── Операцион         ← not a branch (0 sales teams, 8 people)
 *     └── Регистрация       ← not a branch (0 sales teams, 21 people)
 *
 * An employee's branch is the ancestor department whose PARENT IS THE ROOT —
 * found by walking UP, at any depth, never by reading `department.parent.name`.
 * A one-level lookup answers "NEWGEN" for the seven people who sit directly in
 * "Тошкент онлайн" rather than in one of its teams, and that is exactly the
 * error the first measurement of this data made: it put them in the company
 * centre and undercounted the branch. The walk is a recursive CTE in
 * `ReferenceRepository.loadBranchGraph`; this module is where its rows become
 * answers.
 *
 * WHAT MAKES A TOP-LEVEL UNIT A BRANCH
 * Being under the root is not enough — Операцион and Регистрация sit there too
 * and are functions, not places. A branch is a top-level unit with at least one
 * SALES TEAM beneath it, using the very same "(ROP)" suffix rule the sellers
 * work already relies on (`./roles`). Today that separates 6 and 9 teams from 0
 * and 0, which is not a close call, and it keeps one definition of "sales team"
 * in the codebase instead of two.
 *
 * WHAT IS DELIBERATELY NOT A BRANCH
 * Операцион (8 people) closed 1.81 mlrd all-time and 12.6% of last month; the
 * 34 people filed directly in the NEWGEN root closed 0.14 mlrd. Under a branch
 * scope both disappear. That is correct — neither is Навоий — but it is also
 * 59% of last month's revenue leaving the totals, so `BranchScopeDto` carries
 * the excluded headcounts and every screen states them. A dashboard that
 * silently shows 41% of the revenue is worse than no dashboard.
 *
 * PURE ON PURPOSE
 * Everything here takes rows and returns answers, so `tests/domain/branches`
 * can prove the partition adds up without a database. The SQL that produces the
 * rows lives in the repository; the cache around it is `BranchDirectory` below.
 */

import type { Period } from '../period/period'
import { classifyEmployeeRole, isSalesTeamName } from './roles'

// ---------------------------------------------------------------------------
// The rows the repository must produce
// ---------------------------------------------------------------------------

/** One department, with the branch its subtree hangs from already resolved. */
export interface BranchDepartmentRow {
  readonly id: string
  readonly name: string
  /** The ancestor whose parent is the root. Null for a root department itself. */
  readonly branchId: string | null
  readonly branchName: string | null
}

/** One employee, tagged with the same resolution. */
export interface BranchEmployeeRow {
  readonly id: string
  readonly departmentId: string | null
  readonly departmentName: string | null
  readonly branchId: string | null
  readonly branchName: string | null
  /**
   * Sits in a root department itself rather than under a top-level unit.
   *
   * Carried separately from `branchId === null` so the company centre stays
   * distinguishable from a department orphaned by a broken `parentId`. Both are
   * out of every branch; only one of them is a fact about the org chart.
   */
  readonly sitsInRoot: boolean
  /** Heads SOME department — the input `classifyEmployeeRole` needs. */
  readonly isDepartmentHead: boolean
}

export interface BranchGraph {
  readonly departments: readonly BranchDepartmentRow[]
  readonly employees: readonly BranchEmployeeRow[]
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

export interface BranchSummary {
  readonly id: string
  readonly name: string
  /** Sales teams beneath it — departments whose name ends with "(ROP)". */
  readonly teamCount: number
  /** Everyone under it at any depth, active or not. */
  readonly headcount: number
  /** Of those, sellers by `classifyEmployeeRole` — ROPs excluded. */
  readonly sellerCount: number
}

/** A top-level unit that is not a branch: Операцион, Регистрация. */
export interface TopUnitSummary {
  readonly id: string
  readonly name: string
  readonly headcount: number
}

/**
 * One part of the partition: where a group of employees actually sits.
 *
 * The buckets are exhaustive and disjoint — every employee in the roster is in
 * exactly one — which is the property `scripts/verifyBranchScope.ts` checks
 * against the deal ledger. If the five buckets do not sum to the unscoped
 * total, the resolver is wrong and the whole scope is untrustworthy, so it is
 * worth being able to state the partition rather than infer it.
 */
export interface BranchBucket {
  /** Stable across renames: `branch:<id>`, `unit:<id>`, or the bare kind. */
  readonly key: string
  /** What to print: the unit's name, or "markaz" for the company centre. */
  readonly label: string
  readonly kind: 'branch' | 'unit' | 'centre' | 'unassigned' | 'orphan'
  readonly employeeIds: readonly string[]
}

export interface BranchSnapshot {
  readonly branches: readonly BranchSummary[]
  readonly units: readonly TopUnitSummary[]
  /** The whole roster, split. Empty buckets are kept so a report can show a zero. */
  readonly buckets: readonly BranchBucket[]
  /** People filed directly in the root — "markaz". */
  readonly centreHeadcount: number
  /** People with no department at all. Zero today; a partition must still name them. */
  readonly unassignedHeadcount: number
  /** People under a department whose parent id resolves to nothing. Zero today. */
  readonly orphanHeadcount: number
  /** Every employee in the roster. The buckets above sum to exactly this. */
  readonly totalHeadcount: number
  /** Branch name (normalised) -> the ids beneath it. Never empty for a listed branch. */
  readonly employeeIdsByBranch: ReadonlyMap<string, readonly string[]>
}

/**
 * Fold a hand-typed unit name to its lookup key.
 *
 * Same tolerance as `isSalesTeamName`, for the same reason: these names were
 * typed into Bitrix24 by a person, and "Навоий " with a trailing space is a
 * data-entry slip rather than a second branch.
 */
export function branchKey(name: string): string {
  return name.trim().toLowerCase()
}

/** The two top-level units that are functions rather than places. */
export const OPERATIONS_UNIT_NAME = 'Операцион'
export const REGISTRATION_UNIT_NAME = 'Регистрация'

/**
 * Turn one department/employee graph into every answer the scope needs.
 *
 * One pass, because the caller runs this behind a cache and a snapshot that
 * disagrees with itself between two reads would be worse than a slow one.
 */
export function buildBranchSnapshot(graph: BranchGraph): BranchSnapshot {
  // Top-level units are the departments that ARE their own branch: the CTE
  // stamps a department whose parent is the root with its own id.
  const topUnits = graph.departments.filter((d) => d.branchId === d.id)

  const salesTeamsByUnit = new Map<string, number>()
  for (const department of graph.departments) {
    if (!department.branchId) continue
    if (!isSalesTeamName(department.name)) continue
    salesTeamsByUnit.set(department.branchId, (salesTeamsByUnit.get(department.branchId) ?? 0) + 1)
  }

  const headcount = new Map<string, number>()
  const sellers = new Map<string, number>()
  const idsByUnit = new Map<string, string[]>()

  const centreIds: string[] = []
  const unassignedIds: string[] = []
  const orphanIds: string[] = []

  for (const employee of graph.employees) {
    if (employee.branchId) {
      headcount.set(employee.branchId, (headcount.get(employee.branchId) ?? 0) + 1)

      const ids = idsByUnit.get(employee.branchId) ?? []
      ids.push(employee.id)
      idsByUnit.set(employee.branchId, ids)

      const role = classifyEmployeeRole({
        departmentName: employee.departmentName,
        isDepartmentHead: employee.isDepartmentHead,
      })
      if (role === 'SELLER') {
        sellers.set(employee.branchId, (sellers.get(employee.branchId) ?? 0) + 1)
      }
      continue
    }

    if (employee.departmentId === null) unassignedIds.push(employee.id)
    else if (employee.sitsInRoot) centreIds.push(employee.id)
    else orphanIds.push(employee.id)
  }

  const branches: BranchSummary[] = []
  const units: TopUnitSummary[] = []

  for (const unit of topUnits) {
    const teamCount = salesTeamsByUnit.get(unit.id) ?? 0
    const people = headcount.get(unit.id) ?? 0

    // The line between a filial and a function: teams sell, departments do not.
    if (teamCount > 0) {
      branches.push({
        id: unit.id,
        name: unit.name,
        teamCount,
        headcount: people,
        sellerCount: sellers.get(unit.id) ?? 0,
      })
    } else {
      units.push({ id: unit.id, name: unit.name, headcount: people })
    }
  }

  branches.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  units.sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  const employeeIdsByBranch = new Map<string, readonly string[]>()
  for (const branch of branches) {
    employeeIdsByBranch.set(branchKey(branch.name), idsByUnit.get(branch.id) ?? [])
  }

  const buckets: BranchBucket[] = [
    ...branches.map(
      (b): BranchBucket => ({
        key: `branch:${b.id}`,
        label: b.name,
        kind: 'branch',
        employeeIds: idsByUnit.get(b.id) ?? [],
      }),
    ),
    ...units.map(
      (u): BranchBucket => ({
        key: `unit:${u.id}`,
        label: u.name,
        kind: 'unit',
        employeeIds: idsByUnit.get(u.id) ?? [],
      }),
    ),
    // "markaz" is what the business calls the people filed in NEWGEN itself:
    // 34 of them, 0.14 mlrd all-time. Not a branch, not nothing.
    { key: 'centre', label: 'markaz', kind: 'centre', employeeIds: centreIds },
    { key: 'unassigned', label: 'boʻlimsiz', kind: 'unassigned', employeeIds: unassignedIds },
    { key: 'orphan', label: 'yoʻqolgan boʻlim', kind: 'orphan', employeeIds: orphanIds },
  ]

  return {
    branches,
    units,
    buckets,
    centreHeadcount: centreIds.length,
    unassignedHeadcount: unassignedIds.length,
    orphanHeadcount: orphanIds.length,
    totalHeadcount: graph.employees.length,
    employeeIdsByBranch,
  }
}

// ---------------------------------------------------------------------------
// What the caller asked for
// ---------------------------------------------------------------------------

/** The literal that means "no branch restriction" in `?filial=`. */
export const BRANCH_ALL = 'all'

export type BranchRequest =
  | { readonly kind: 'all' }
  | { readonly kind: 'branch'; readonly name: string }

/**
 * Read `?filial=` into an intention.
 *
 * ABSENT IS NOT "ALL". A missing parameter means the default branch, because
 * the default view of this product is one branch and a dashboard that quietly
 * widens to the whole company when a link loses a query parameter would be
 * telling a different story from the one on screen.
 */
export function branchRequestFrom(
  filial: string | undefined,
  defaultBranch: string,
): BranchRequest {
  const raw = filial?.trim()
  if (!raw) return { kind: 'branch', name: defaultBranch }
  if (branchKey(raw) === BRANCH_ALL) return { kind: 'all' }
  return { kind: 'branch', name: raw }
}

/**
 * A branch name that is not in the tree.
 *
 * Thrown rather than swallowed: a typo in `?filial=` must be a 400, never a
 * silent full-company view wearing a branch label. The transport layer turns
 * this into `VALIDATION_ERROR` and lists what does exist.
 */
export class UnknownBranchError extends Error {
  constructor(
    readonly requested: string,
    readonly known: readonly string[],
  ) {
    super(`Unknown filial "${requested}". Known: ${known.join(', ') || '(none)'}`)
    this.name = 'UnknownBranchError'
  }
}

// ---------------------------------------------------------------------------
// The scope
// ---------------------------------------------------------------------------

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
 * What the response tells the reader about its own scope.
 *
 * `employees` and the five `excluded` buckets sum to the whole roster, by
 * construction and by test. That is the property that makes the block worth
 * printing: a reader can see where the other 179 people went.
 *
 * This describes the BRANCH partition only. A SALES caller additionally sees
 * just their own row; that is an authorisation fact, true on every screen
 * regardless of branch, and counting it here would make the buckets stop
 * adding up.
 */
export interface BranchScopeDto {
  /** The active branch, or null when the caller asked for every branch. */
  readonly branch: string | null
  /** People the branch scope admits. Equals the roster size when branch is null. */
  readonly employees: number
  readonly excluded: {
    /** The other filial(s) — Тошкент онлайн when Навоий is active. */
    readonly otherBranches: number
    readonly operations: number
    readonly registration: number
    /** Filed directly in the NEWGEN root — "markaz". */
    readonly centre: number
    /** Anything the four above do not name: another non-branch unit, or nobody's department. */
    readonly other: number
    /** The five buckets summed. `employees + excluded.total` is the roster. */
    readonly total: number
  }
}

/**
 * A period carrying its scope — the SCOPE-CONTRACT.
 *
 * WHY THE SCOPE RIDES ON THE PERIOD
 * Every method of `InsightsRepository` takes exactly one argument, the window,
 * and aggregates in SQL. A `GROUP BY` cannot be narrowed after the fact by the
 * service that receives its result, so the employee list has to reach the query
 * itself — and threading it as a second parameter would change eight signatures
 * at once. Widening the window type instead lets the service pass the scope
 * today and each query adopt it in one line:
 *
 *     WHERE …
 *       AND (${period.restrictToEmployeeIds}::text[] IS NULL
 *            OR d."employeeId" = ANY(${period.restrictToEmployeeIds}::text[]))
 *
 * THE CONTRACT, WHICH IS NOT OPTIONAL
 * A query that takes a `ScopedPeriod` and does not read
 * `restrictToEmployeeIds` returns whole-company numbers under a branch heading.
 * Any employee-attributable query must honour it or say in a comment why it is
 * branch-independent. There is no third option.
 */
export type ScopedPeriod = Period & EmployeeScopeFilter

/**
 * The same thing with the scope NOT optional.
 *
 * `ScopedPeriod` above states the contract; this one makes the compiler keep
 * it. Because `EmployeeScopeFilter`'s field is optional, a bare `Period` is
 * assignable to `ScopedPeriod` — so a repository method that asked for one
 * would still accept an unscoped window and answer for the whole company,
 * which is the exact failure the contract is written against. A REQUIRED field
 * cannot be satisfied by forgetting: every caller has to say, in as many
 * words, whose rows it is asking for. `null` is a legitimate answer and means
 * the company; it just has to be given.
 */
export type ScopedWindow = Period & {
  readonly restrictToEmployeeIds: readonly string[] | null
}

/** Attach a resolved scope to a window. */
export function scopedPeriod(period: Period, scope: EmployeeScopeFilter): ScopedWindow {
  return { ...period, restrictToEmployeeIds: scope.restrictToEmployeeIds ?? null }
}

export interface ResolvedBranchScope {
  /** Feed this to every employee-attributable query. Null = unrestricted. */
  readonly employeeIds: readonly string[] | null
  /** The branch's own department id, for screens that mark a subtree. */
  readonly branchDepartmentId: string | null
  /** Goes into `meta.branchScope`. */
  readonly meta: BranchScopeDto
}

const EMPTY_EXCLUSIONS = {
  otherBranches: 0,
  operations: 0,
  registration: 0,
  centre: 0,
  other: 0,
  total: 0,
} as const

/**
 * Branch ∩ authorisation. NEVER a union.
 *
 * Two restrictions must narrow. A SALES user scoped to themselves who opens a
 * branch view must see themselves inside that branch — not their whole branch,
 * which is what a union would hand them, and not the whole company, which is
 * what dropping either side would. When the two disagree (a Навоий scope, a
 * Тошкент salesperson) the honest answer is the empty set, and the sentinel is
 * how an empty set survives a repository's `ids?.length` check.
 *
 * BOTH SIDES ARE LISTS. The authorisation scope used to be a single id because
 * it could only ever mean one person; a TEAM-scoped ROP is fifteen, and a
 * branch view they open must show their team inside that branch and nobody
 * else's.
 */
export function intersectEmployeeScope(
  branchEmployeeIds: readonly string[] | null,
  restrictToEmployeeIds: readonly string[] | null | undefined,
): readonly string[] | null {
  if (!restrictToEmployeeIds?.length) return branchEmployeeIds
  if (branchEmployeeIds === null) return restrictToEmployeeIds
  const branch = new Set(branchEmployeeIds)
  const both = restrictToEmployeeIds.filter((id) => branch.has(id))
  // Never an empty array. See NO_EMPLOYEE_IN_SCOPE: a repository reads `[]` as
  // "no filter given" and hands back the company the intersection just refused.
  return both.length > 0 ? both : [NO_EMPLOYEE_IN_SCOPE]
}

/**
 * Narrow a caller's own `?employeeIds=` by the resolved scope.
 *
 * For the few queries that take the picked ids rather than the scope (the
 * leaderboard roster). Same rule: intersect, never widen, and never hand back
 * an empty array.
 */
export function narrowEmployeeIds(
  requested: readonly string[] | undefined,
  scope: readonly string[] | null,
): readonly string[] | undefined {
  if (scope === null) return requested
  if (!requested?.length) return scope
  const allowed = new Set(scope)
  const both = requested.filter((id) => allowed.has(id))
  return both.length > 0 ? both : [NO_EMPLOYEE_IN_SCOPE]
}

/**
 * Turn a request into ids to filter by and a block to print.
 *
 * @throws UnknownBranchError when the name is not in the tree.
 */
export function resolveBranchScope(
  snapshot: BranchSnapshot,
  request: BranchRequest,
  restrictToEmployeeIds?: readonly string[] | null,
): ResolvedBranchScope {
  if (request.kind === 'all') {
    return {
      employeeIds: intersectEmployeeScope(null, restrictToEmployeeIds),
      branchDepartmentId: null,
      meta: {
        branch: null,
        employees: snapshot.totalHeadcount,
        excluded: EMPTY_EXCLUSIONS,
      },
    }
  }

  const key = branchKey(request.name)
  const branch = snapshot.branches.find((b) => branchKey(b.name) === key)

  if (!branch) {
    throw new UnknownBranchError(
      request.name,
      snapshot.branches.map((b) => b.name),
    )
  }

  const ids = snapshot.employeeIdsByBranch.get(key) ?? []

  const otherBranches = snapshot.branches
    .filter((b) => b.id !== branch.id)
    .reduce((sum, b) => sum + b.headcount, 0)

  const unitHeadcount = (name: string) =>
    snapshot.units
      .filter((u) => branchKey(u.name) === branchKey(name))
      .reduce((sum, u) => sum + u.headcount, 0)

  const operations = unitHeadcount(OPERATIONS_UNIT_NAME)
  const registration = unitHeadcount(REGISTRATION_UNIT_NAME)

  // Whatever the named buckets did not claim. Zero today; it exists so the
  // block keeps adding up on the day someone adds a top-level department.
  const namedUnits = operations + registration
  const other =
    snapshot.units.reduce((sum, u) => sum + u.headcount, 0) -
    namedUnits +
    snapshot.unassignedHeadcount +
    snapshot.orphanHeadcount

  const total = otherBranches + operations + registration + snapshot.centreHeadcount + other

  return {
    // The branch's own list; the sentinel keeps an intersection of nothing from
    // reading as "no filter".
    employeeIds: intersectEmployeeScope(
      ids.length > 0 ? ids : [NO_EMPLOYEE_IN_SCOPE],
      restrictToEmployeeIds,
    ),
    branchDepartmentId: branch.id,
    meta: {
      branch: branch.name,
      employees: branch.headcount,
      excluded: {
        otherBranches,
        operations,
        registration,
        centre: snapshot.centreHeadcount,
        other,
        total,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/**
 * How long a snapshot is trusted.
 *
 * The department tree changes when somebody is hired or moved — a handful of
 * times a month — and this resolver runs on EVERY analytics request, so reading
 * 19 departments and 288 employees per request would be pure waste. Five
 * minutes is the compromise: a re-org is visible within one coffee break, and a
 * dashboard refresh costs nothing. `invalidate()` exists for the importer,
 * which knows exactly when the tree changed.
 */
export const BRANCH_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * A cached branch snapshot.
 *
 * Takes its loader as a parameter so the domain layer never learns what a
 * database is, and so the tests can drive it with a counter and a fake clock.
 */
export class BranchDirectory {
  private cached: { snapshot: BranchSnapshot; expiresAt: number } | null = null
  /** In-flight load, shared so a cold start does not fire N identical queries. */
  private pending: Promise<BranchSnapshot> | null = null

  constructor(
    private readonly load: () => Promise<BranchGraph>,
    private readonly ttlMs: number = BRANCH_CACHE_TTL_MS,
    private readonly clock: () => number = Date.now,
  ) {}

  async snapshot(): Promise<BranchSnapshot> {
    const now = this.clock()
    if (this.cached && this.cached.expiresAt > now) return this.cached.snapshot
    if (this.pending) return this.pending

    this.pending = this.load()
      .then((graph) => {
        const snapshot = buildBranchSnapshot(graph)
        this.cached = { snapshot, expiresAt: this.clock() + this.ttlMs }
        return snapshot
      })
      .finally(() => {
        // Cleared whether the load succeeded or threw: a failed load must not
        // pin a rejected promise in front of every later request.
        this.pending = null
      })

    return this.pending
  }

  /** Drop the cache. For the importer, after it rewrites the department tree. */
  invalidate(): void {
    this.cached = null
  }
}
