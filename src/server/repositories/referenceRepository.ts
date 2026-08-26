/**
 * Reference data: employees, departments, products, sources, KPI targets.
 *
 * Small, slow-changing lookups that populate filter dropdowns and give
 * analytics results human-readable labels.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import type { KpiDefinition } from '@/server/domain/analytics/performance'
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

export class ReferenceRepository {
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

  async findEmployeeById(id: string): Promise<EmployeeSummary | null> {
    const row = await this.prisma.employee.findUnique({
      where: { id },
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

    if (!row) return null

    return {
      id: row.id,
      fullName: row.fullName,
      position: row.position,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      isActive: row.isActive,
      avatarUrl: row.avatarUrl,
    }
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
      select: { id: true, employeeId: true, metric: true, targetValue: true },
    })

    return rows
  }

  /** Most recent sync runs, for the admin screen. */
  async findRecentSyncLogs(limit = 25) {
    return this.prisma.syncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    })
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
