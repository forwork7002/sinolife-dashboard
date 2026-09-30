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

/**
 * The entities whose arrival the freshness chip is actually promising.
 *
 * AN ALLOWLIST, AND IT IS SHORTER THAN THE ENTITY LIST ON PURPOSE. Every
 * figure in this product is built from deals, their stage history and the
 * customers on them; nothing else being read is evidence that the dashboard is
 * current. Two passes proved that on 2026-09-14, four hours into a portal-wide
 * `OVERLOAD_LIMIT` block:
 *
 *   `DEAL_ITEMS` makes no portal call at all — it reads what the DEALS pass
 *   left in memory — so with DEALS failing it finished SUCCESS once a minute
 *   and the header read «1 daqiqa oldin» over 45-minute-old data.
 *
 *   `DEPARTMENTS` then did the same thing more quietly: its own method was
 *   still being answered while every deal call was refused, so the chip said
 *   «2 daqiqa oldin» while the deals on screen were four hours old.
 *
 * Both readings were technically true and both were useless to the person
 * looking at the screen. A pass that reads zero rows because nothing changed
 * still counts — the portal answered for the data this chip is about.
 */
export const FRESHNESS_ENTITIES = Object.freeze([
  'DEALS',
  'STAGE_HISTORY',
  'CUSTOMERS',
] as const)

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

  async findSources(): Promise<NamedRef[]> {
    return this.prisma.salesSource.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
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

  /**
   * The failure that is still standing, if the sync is currently failing.
   *
   * ONLY WHEN IT IS NEWER THAN THE LAST SUCCESS. A FAILED row from last week
   * is history — reporting it beside a healthy clock would put a permanent
   * red mark on a working dashboard. The comparison is what makes this
   * "something is wrong NOW" rather than "something once went wrong".
   *
   * The message is the one the provider wrote, which since 2026-09-14 carries
   * the portal's own code — `OVERLOAD_LIMIT`, `expired_token` — rather than a
   * bare HTTP status. That string is what the freshness chip turns into a
   * sentence a reader can act on, so it is read raw and never re-worded here.
   */
  async findCurrentSyncFailure(lastSuccess?: Date | null): Promise<{
    readonly entity: string
    readonly at: Date
    /** When this outage STARTED — the oldest failure in the current run of them. */
    readonly since: Date
    readonly message: string | null
    /**
     * How many DISTINCT entities are failing right now, or null when there is
     * no last-success timestamp to bound the count against.
     *
     * ONE ENTITY IS A CLAIM ABOUT SCOPE, and until this existed the chip made
     * the wrong one. `entity` above is whichever pass happened to fail LAST,
     * so a portal refusing every REST call was reported as «stage_history» —
     * the narrowest, least consequential thing on the portal. A reader who
     * knows what that is concludes the deal numbers are fine. On 2026-09-15
     * every one of the twelve entities was down and the header named that one.
     */
    readonly entities: number | null
  } | null> {
    /*
      THE CALLER ALREADY KNOWS THE LAST SUCCESS — take it rather than ask again.

      This method needs that timestamp only to decide whether the failure it
      finds is still standing, and `alertsService` has just read it. Asking a
      second time doubled the most expensive query on the endpoint every screen
      polls once a minute; the parameter is optional so a caller that has not
      read it still gets a correct answer.
    */
    const [failure, success] = await Promise.all([
      this.prisma.syncLog.findFirst({
        where: { status: 'FAILED', finishedAt: { not: null } },
        orderBy: { finishedAt: 'desc' },
        select: { entity: true, finishedAt: true, errorMessage: true },
      }),
      lastSuccess === undefined ? this.findLastSuccessfulSync() : Promise.resolve(lastSuccess),
    ])

    if (!failure?.finishedAt) return null
    if (success && success.getTime() >= failure.finishedAt.getTime()) return null

    /*
      TWO QUESTIONS THE CHIP COULD NOT ANSWER, ASKED TOGETHER.

      HOW WIDE: `entity` above is whichever pass happened to fail LAST, so a
      portal refusing every REST call was reported as «stage_history» — the
      narrowest, least consequential thing on the portal, and a reader who
      knows what that is concludes the deal numbers are fine. Without a last
      success there is nothing to bound the count by, and an unbounded GROUP BY
      over 120 000 rows is precisely what that index was added to stop, so it
      stays null and the chip falls back to naming one entity.

      HOW LONG: `at` is the NEWEST failed row, always seconds old during an
      outage, so a four-hour block and a four-minute blip were indistinguishable
      on screen. The OLDEST failure standing after the last success is when this
      outage actually began.

      ASKED ONLY WHILE SOMETHING IS ACTUALLY WRONG. This runs on `/meta/alerts`,
      which every open tab polls once a minute, so a query here has to earn
      itself — and neither of these runs on a healthy dashboard, because the two
      returns above have already left. In parallel they cost ONE round trip, and
      both are the same `[status, finishedAt DESC]` index walk (a btree serves
      the ascending order from a DESC index) over the failures since the last
      success: fifty-odd rows an hour into an outage, not the log's history.
    */
    const [entities, firstFailure] = await Promise.all([
      success === null || success === undefined
        ? Promise.resolve(null)
        : this.prisma.syncLog
            .groupBy({
              by: ['entity'],
              where: { status: 'FAILED', finishedAt: { gt: success } },
            })
            .then((rows) => rows.length),
      this.prisma.syncLog.findFirst({
        where: {
          status: 'FAILED',
          finishedAt: success ? { gt: success } : { not: null },
        },
        orderBy: { finishedAt: 'asc' },
        select: { finishedAt: true },
      }),
    ])

    return {
      entity: failure.entity,
      at: failure.finishedAt,
      since: firstFailure?.finishedAt ?? failure.finishedAt,
      message: failure.errorMessage,
      entities,
    }
  }

  /**
   * When data last actually ARRIVED from the portal.
   *
   * `DEAL_ITEMS` IS EXCLUDED, AND WITHOUT THAT THIS CLOCK LIES. That pass
   * makes no portal call at all: it reads state the `DEALS` pass left in
   * memory (see its own comment in `handlers.ts`), so when Bitrix24 refuses
   * everything, DEALS fails, DEAL_ITEMS finds nothing to do and finishes
   * `SUCCESS` — once a minute, for as long as the outage lasts.
   *
   * Measured on 2026-09-14, 45 minutes into a portal-wide `OVERLOAD_LIMIT`
   * block: CUSTOMERS 11 failures, DEALS 11, STAGE_HISTORY 11, CALLS 9 — and
   * DEAL_ITEMS 11 successes. The header read «1 daqiqa oldin» in green over a
   * dashboard that had not been fed for three quarters of an hour, which is
   * precisely the state the client was reporting as «avtomatik
   * yangilanmayapti» while the screen insisted it was current.
   *
   * A pass that reads zero rows because nothing changed is still a success
   * here — the portal answered, and that is what the chip is promising. A
   * pass that cannot have talked to the portal is not.
   */
  async findLastSuccessfulSync(): Promise<Date | null> {
    const row = await this.prisma.syncLog.findFirst({
      where: {
        status: { in: ['SUCCESS', 'PARTIAL'] },
        finishedAt: { not: null },
        entity: { in: [...FRESHNESS_ENTITIES] },
      },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    })
    return row?.finishedAt ?? null
  }
}
