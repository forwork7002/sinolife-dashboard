/**
 * Reference data: employees, departments, products, sources, KPI targets.
 *
 * Small, slow-changing lookups that populate filter dropdowns and give
 * analytics results human-readable labels.
 */

import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import type { KpiDefinition } from '@/server/domain/analytics/performance'
import {
  type BranchGraph,
  type BranchSnapshot,
  BranchDirectory,
} from '@/server/domain/employees/branches'
import { type Period, asOfInstant } from '@/server/domain/period/period'

export interface EmployeeSummary {
  readonly id: string
  readonly fullName: string
  readonly position: string | null
  readonly departmentId: string | null
  readonly departmentName: string | null
  readonly isActive: boolean
  readonly avatarUrl: string | null
}

export interface NamedRef {
  readonly id: string
  readonly name: string
}

/**
 * Every department, stamped with the branch its subtree hangs from.
 *
 * WHY A RECURSIVE CTE AND NOT `parent.name`
 * The branch is the ancestor whose parent IS the root, and "ancestor" is the
 * whole point: the portal files most people two levels down (in a team) but
 * seven of them one level down (directly in Тошкент онлайн). A single-level
 * `parent` lookup labels those seven "NEWGEN" and quietly moves them out of
 * their own branch — the error the first measurement of this data made. Walking
 * the tree gets both depths right, and gets a fourth level right for free on
 * the day the portal grows one.
 *
 * The recursion seeds at the root (`parentId IS NULL`) and stamps each child:
 * `COALESCE(t.branch_id, c.id)` means "inherit my parent's branch, unless my
 * parent is the root, in which case I AM the branch". `depth < 32` is a
 * cycle guard — Postgres will happily recurse forever on a self-referencing
 * `parentId`, and a hung dashboard is a worse failure than a truncated tree.
 */
const BRANCH_TREE_CTE = Prisma.sql`
  WITH RECURSIVE tree AS (
    SELECT
      d."id",
      d."name",
      NULL::text AS branch_id,
      NULL::text AS branch_name,
      0          AS depth
    FROM "department" d
    WHERE d."parentId" IS NULL

    UNION ALL

    SELECT
      c."id",
      c."name",
      COALESCE(t.branch_id, c."id")     AS branch_id,
      COALESCE(t.branch_name, c."name") AS branch_name,
      t.depth + 1                       AS depth
    FROM "department" c
    JOIN tree t ON c."parentId" = t."id" AND t.depth < 32
  )
`

export class ReferenceRepository {
  /**
   * The branch resolver, cached.
   *
   * Held here rather than in the container because the cache must be shared by
   * everything that asks — and everything asks, on every request. The loader is
   * an arrow so it closes over `this` lazily; nothing runs until the first
   * `snapshot()`.
   */
  private readonly branches = new BranchDirectory(() => this.loadBranchGraph())

  constructor(private readonly prisma: PrismaClient) {}

  async findEmployees(options: { includeInactive?: boolean } = {}): Promise<EmployeeSummary[]> {
    const rows = await this.prisma.employee.findMany({
      // Inactive employees are included by default: their historical deals
      // still count toward past periods, so hiding them would make older
      // reports fail to add up.
      where: options.includeInactive === false ? { isActive: true } : undefined,
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        position: true,
        isActive: true,
        avatarUrl: true,
        departmentId: true,
        department: { select: { name: true } },
      },
    })

    return rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      position: row.position,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      isActive: row.isActive,
      avatarUrl: row.avatarUrl,
    }))
  }

  /**
   * The roster as a PICKER sees it: an id and a name, and nothing else.
   *
   * `findEmployees` returns position, department id, department name, active
   * flag and avatar because `kpiService` resolves a department selection
   * through it. `/meta/filters` needs none of that — every consumer maps to
   * `{ id, label }` — and it is the endpoint EVERY screen loads. Measured on
   * the real 289-row roster: the employee array is 67 126 of the response's
   * 82 263 bytes, and 45 727 of those are the five fields nobody reads.
   *
   * The department name also costs a whole extra statement: Prisma resolves
   * `department: { select: { name } }` as a second query. Dropping the
   * relation drops that too.
   */
  async findEmployeeChoices(): Promise<{ id: string; fullName: string }[]> {
    return this.prisma.employee.findMany({
      // Inactive people are included, for the same reason `findEmployees`
      // includes them: their historical deals still count toward past periods,
      // so a filter that could not name them could not reproduce an old
      // report.
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    })
  }

  async findDepartments(): Promise<NamedRef[]> {
    return this.prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
  }

  async findProducts(options: { includeInactive?: boolean } = {}): Promise<NamedRef[]> {
    return this.prisma.product.findMany({
      // A deleted product's NAME is still its name. Filter dropdowns pass
      // nothing and see only the active catalogue; the analytics name map
      // includes everything, because a revenue row for a product the portal
      // has since deleted was rendering its internal id — a cuid — as if it
      // were a product called "cmt8mor9z0…".
      where: options.includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
  }

  async findSources(): Promise<NamedRef[]> {
    return this.prisma.salesSource.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
  }

  async findStages(): Promise<(NamedRef & { sortOrder: number })[]> {
    return this.prisma.dealStage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, sortOrder: true },
    })
  }

  /**
   * Active KPI targets for the period being reported.
   *
   * Selection is by CONTAINMENT of the period's as-of instant, not by overlap.
   *
   * Overlap is the obvious rule and it is wrong. A "this month" report starts
   * at midnight Tashkent, which is 19:00 UTC the previous day; any KPI window
   * ending at UTC midnight therefore overlaps it by five hours. With an overlap
   * rule the dashboard silently loaded the previous month's targets as well and
   * scored this month's results against them — which is how a headline
   * attainment of 246% appeared.
   *
   * Containment picks exactly the window the report sits in: month-to-date
   * August matches August's targets and nothing else.
   */
  async findKpisForPeriod(
    period: Period,
    employeeIds?: readonly string[],
  ): Promise<KpiDefinition[]> {
    const asOf = asOfInstant(period)

    const rows = await this.prisma.kpi.findMany({
      where: {
        isActive: true,
        periodStart: { lte: asOf },
        periodEnd: { gt: asOf },
        ...(employeeIds?.length ? { employeeId: { in: [...employeeIds] } } : {}),
      },
      /*
        The plan's own dates travel with it.

        Without them every consumer scored the target against whatever window
        the reader had selected — see `kpiWindow` in domain/analytics/performance
        for the two wrong numbers that produced.
      */
      select: {
        id: true,
        employeeId: true,
        metric: true,
        targetValue: true,
        periodStart: true,
        periodEnd: true,
      },
    })

    return rows
  }

  // -------------------------------------------------------------------------
  // Filial (branch) scope
  // -------------------------------------------------------------------------

  /**
   * The two rows the resolver needs: departments and their people.
   *
   * Two queries rather than one join, because the department side must include
   * a unit with nobody in it (a team can be created before it is staffed) and
   * the employee side must include somebody with no department at all. An inner
   * join would drop both, and both are exactly the cases the partition has to
   * account for.
   *
   * 19 departments and 288 employees today; the caller runs this behind a
   * five-minute cache, so the cost per request is nothing.
   */
  private async loadBranchGraph(): Promise<BranchGraph> {
    const [departments, employees] = await Promise.all([
      this.prisma.$queryRaw<
        { id: string; name: string; branchId: string | null; branchName: string | null }[]
      >`
        ${BRANCH_TREE_CTE}
        SELECT t."id", t."name", t.branch_id AS "branchId", t.branch_name AS "branchName"
        FROM tree t
      `,
      this.prisma.$queryRaw<
        {
          id: string
          departmentId: string | null
          departmentName: string | null
          branchId: string | null
          branchName: string | null
          sitsInRoot: boolean
          isDepartmentHead: boolean
        }[]
      >`
        ${BRANCH_TREE_CTE}
        SELECT
          e."id",
          e."departmentId"                        AS "departmentId",
          d."name"                                AS "departmentName",
          t.branch_id                             AS "branchId",
          t.branch_name                           AS "branchName",
          (d."id" IS NOT NULL AND d."parentId" IS NULL)
                                                  AS "sitsInRoot",
          EXISTS (SELECT 1 FROM "department" h WHERE h."headId" = e."id")
                                                  AS "isDepartmentHead"
        FROM "employee" e
        LEFT JOIN "department" d ON d."id" = e."departmentId"
        LEFT JOIN tree t ON t."id" = e."departmentId"
      `,
    ])

    return { departments, employees }
  }

  /** The cached snapshot. Everything below reads through it. */
  branchSnapshot(): Promise<BranchSnapshot> {
    return this.branches.snapshot()
  }

  /**
   * When the data was last imported.
   *
   * Shown in the UI so a stale dashboard is visibly stale rather than silently
   * wrong.
   */
  async findLastSuccessfulSync(): Promise<Date | null> {
    const row = await this.prisma.syncLog.findFirst({
      where: { status: { in: ['SUCCESS', 'PARTIAL'] }, finishedAt: { not: null } },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    })
    return row?.finishedAt ?? null
  }
}
