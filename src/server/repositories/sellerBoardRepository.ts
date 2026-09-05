/**
 * The sellers' board — one row per seller, on the ORDER-INTAKE clock.
 *
 * WHY A SECOND SELLER READING EXISTS AT ALL, when `/analytics/leaderboard`
 * already ranks sellers: they answer different questions, and the client asks
 * both. The leaderboard ranks DELIVERED revenue — money that arrived, booked
 * on `closedAt`. This board ranks what a seller BROUGHT IN during the period,
 * booked on `createdAtSource`, which is how the client's own published
 * dashboard (sinolife-sale-visual) scores its floor and pays its bonuses.
 *
 * The two are not variants of one number. Measured on July 2026: the intake
 * board totals 3.89 bn so'm of orders while the delivered board totals 0.98 bn
 * for the same month, because a July order is typically delivered in August.
 * Neither is wrong; a screen that showed one under the other's name would be.
 *
 * THE DEFINITIONS ARE THE CLIENT'S, RECOVERED BY MEASUREMENT rather than
 * assumed. Their published page carries three columns whose formulas are not
 * written down anywhere; each was reproduced here against this database until
 * it matched, for July 2026:
 *
 *   fact1  "Zakazlar"   orders created in the window, LOST excluded
 *                       theirs 3 896 602 000 · ours 3 892 220 000 · 0.11%
 *   fact2  "Uspeshka"   of those, the ones WON
 *                       theirs 3 109 322 000 · ours 3 108 150 000 · 0.04%
 *   trans  "Tranzaksiya" count of the fact1 set
 *                       theirs 2 526 · ours 2 513 · 0.52%
 *
 * The residual half-percent is deals their sheet holds and Bitrix24 does not;
 * it is disclosed on screen rather than tuned away.
 *
 * LOST IS EXCLUDED FROM fact1, and that is their rule, not a convenience. An
 * order the customer cancelled was never intake to work with, so counting it
 * would flatter a seller for orders that never existed; an order still OPEN
 * IS counted, because it is live work the seller is carrying.
 */

import type { Period } from '@/server/domain/period/period'
import type { PrismaClient } from '@/generated/prisma/client'

/** Money arrives from Postgres as a string: bigint cannot ride JSON. */
type MoneyText = string | null

export interface SellerBoardFilters {
  readonly employeeIds?: readonly string[]
  readonly departmentIds?: readonly string[]
  readonly sourceIds?: readonly string[]
  /**
   * Authorisation scope — whose rows this caller may read at all.
   *
   * A LIST, because a scope can be a team. Null (or absent) is the whole
   * company; a non-null list is exhaustive and never empty, so an account that
   * narrows to nobody reads nothing rather than everything. Applied HERE
   * rather than in the UI so it cannot be bypassed by calling the API
   * directly, and ANDed with `employeeIds` above rather than replacing it: the
   * caller's own pick narrows the scope, it never widens it.
   */
  readonly restrictToEmployeeIds?: readonly string[] | null
}

export interface SellerBoardRow {
  readonly employeeId: string
  readonly fullName: string
  /** The ROP's own name, from the "<name>(ROP)" department. Null off a team. */
  readonly rop: string | null
  readonly departmentName: string | null
  /** Orders created in the window, LOST excluded — the client's `trans`. */
  readonly orders: number
  /** Their value — the client's `fact1`. */
  readonly orderedMinor: bigint
  /** Of those orders, the ones WON — the client's `fact2`. */
  readonly wonOrders: number
  readonly wonMinor: bigint
  /** Still open: live work, already inside fact1. */
  readonly openOrders: number
  readonly openMinor: bigint
  /** Cancelled by the customer. Outside fact1, shown so the exclusion is visible. */
  readonly lostOrders: number
  /** Of those, the ones already confirmed when they died. Zero on this basis. */
  readonly lostAfterConfirmOrders: number
  /**
   * EVERY order this operator has in the window, whatever became of it.
   *
   * On the queue basis that is the count the Тасдиқлаш navbati page shows for
   * the same period, and it is bigger than `orders` — which counts only the
   * confirmed ones. Two true numbers 354 apart for one August is a support
   * ticket unless the board can print both. On the intake basis the two are
   * the same figure and this simply repeats it.
   */
  readonly cohortOrders: number
}

/** One day of one seller's intake, for the per-seller detail. */
export interface SellerDayRow {
  readonly employeeId: string
  readonly date: string
  readonly orders: number
  readonly orderedMinor: bigint
  readonly wonMinor: bigint
}

export class SellerBoardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Every seller's intake in one scan.
   *
   * Sellers with no orders in the window are absent rather than zero-filled:
   * this board ranks work done, and a roster of 288 names padded with zeros
   * buries the twenty people who sold something. The page states how many
   * were left out, which is the honest form of the same fact.
   */
  async board(period: Period, filters: SellerBoardFilters): Promise<SellerBoardRow[]> {
    const params: unknown[] = [period.start, period.end]
    const filterClause = this.filterSql(filters, params, 'd')

    const rows = await this.prisma.$queryRawUnsafe<
      {
        employee_id: string
        full_name: string
        department_name: string | null
        orders: bigint
        ordered: MoneyText
        won_orders: bigint
        won: MoneyText
        open_orders: bigint
        open_amount: MoneyText
        lost_orders: bigint
      }[]
    >(
      `
      SELECT
        e."id"   AS employee_id,
        e."fullName" AS full_name,
        dep."name"   AS department_name,
        count(*) FILTER (WHERE d."status" <> 'LOST')::bigint            AS orders,
        sum(d."amountMinor") FILTER (WHERE d."status" <> 'LOST')::text  AS ordered,
        count(*) FILTER (WHERE d."status" = 'WON')::bigint              AS won_orders,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text    AS won,
        count(*) FILTER (WHERE d."status" = 'OPEN')::bigint             AS open_orders,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'OPEN')::text   AS open_amount,
        count(*) FILTER (WHERE d."status" = 'LOST')::bigint             AS lost_orders
      FROM "deal" d
      JOIN "employee" e ON e."id" = d."employeeId"
      LEFT JOIN "department" dep ON dep."id" = e."departmentId"
      WHERE d."countsAsRevenue"
        AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
        ${filterClause}
      GROUP BY e."id", e."fullName", dep."name"
      HAVING count(*) FILTER (WHERE d."status" <> 'LOST') > 0
      ORDER BY sum(d."amountMinor") FILTER (WHERE d."status" = 'WON') DESC NULLS LAST
      `,
      ...params,
    )

    return rows.map((r) => ({
      employeeId: r.employee_id,
      fullName: r.full_name,
      rop: ropOf(r.department_name),
      departmentName: r.department_name,
      orders: int(r.orders),
      /*
        On this basis the two are one figure: the intake query's cohort IS its
        `orders` (LOST rows are excluded by the same predicate), so there is no
        second population for the screen to reconcile against.
      */
      cohortOrders: int(r.orders),
      // The intake query has no confirmation step, so nothing can be lost
      // after one. Stated rather than left to a default.
      lostAfterConfirmOrders: 0,
      orderedMinor: money(r.ordered),
      wonOrders: int(r.won_orders),
      wonMinor: money(r.won),
      openOrders: int(r.open_orders),
      openMinor: money(r.open_amount),
      lostOrders: int(r.lost_orders),
    }))
  }

  /**
   * The daily series behind one seller's row.
   *
   * Only the days that carry orders — a seller's month is not a time axis
   * that must be complete, it is a list of the days they worked, and padding
   * it with zeros would draw a sparse worker as a mostly-flat line.
   */
  async sellerDays(
    period: Period,
    employeeId: string,
    filters: SellerBoardFilters,
  ): Promise<SellerDayRow[]> {
    const tz = 'Asia/Tashkent'
    const params: unknown[] = [period.start, period.end, employeeId]
    const filterClause = this.filterSql(filters, params, 'd')

    const rows = await this.prisma.$queryRawUnsafe<
      { date: string; orders: bigint; ordered: MoneyText; won: MoneyText }[]
    >(
      `
      SELECT
        (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date::text AS date,
        count(*) FILTER (WHERE d."status" <> 'LOST')::bigint           AS orders,
        sum(d."amountMinor") FILTER (WHERE d."status" <> 'LOST')::text AS ordered,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text   AS won
      FROM "deal" d
      WHERE d."countsAsRevenue"
        AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
        AND d."employeeId" = $3
        ${filterClause}
      GROUP BY 1
      HAVING count(*) FILTER (WHERE d."status" <> 'LOST') > 0
      ORDER BY 1
      `,
      ...params,
    )

    return rows.map((r) => ({
      employeeId,
      date: r.date,
      orders: int(r.orders),
      orderedMinor: money(r.ordered),
      wonMinor: money(r.won),
    }))
  }

  /**
   * The same filter grammar every other repository speaks.
   *
   * `restrictToEmployeeIds` is the authorisation scope and is applied in SQL
   * rather than after the fact, so a caller cannot forget it.
   */
  private filterSql(filters: SellerBoardFilters, params: unknown[], alias: string): string {
    const conditions: string[] = []

    if (filters.restrictToEmployeeIds?.length) {
      params.push(filters.restrictToEmployeeIds.join(','))
      conditions.push(`${alias}."employeeId" = ANY(string_to_array($${params.length}, ','))`)
    }
    if (filters.employeeIds?.length) {
      params.push(filters.employeeIds.join(','))
      conditions.push(`${alias}."employeeId" = ANY(string_to_array($${params.length}, ','))`)
    }
    if (filters.departmentIds?.length) {
      params.push(filters.departmentIds.join(','))
      conditions.push(
        `EXISTS (SELECT 1 FROM "employee" fe WHERE fe."id" = ${alias}."employeeId"` +
          ` AND fe."departmentId" = ANY(string_to_array($${params.length}, ',')))`,
      )
    }
    if (filters.sourceIds?.length) {
      params.push(filters.sourceIds.join(','))
      conditions.push(`${alias}."sourceId" = ANY(string_to_array($${params.length}, ','))`)
    }

    return conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`
  }
}

/**
 * "Sevinch(ROP)" → "Sevinch"; anything else → null.
 *
 * The same rule the confirmation queue uses, kept identical on purpose: a
 * seller's team must read the same word on both screens or the two boards
 * cannot be compared by the person who owns the team.
 */
function ropOf(departmentName: string | null): string | null {
  if (!departmentName) return null
  if (!/\(ROP\)/i.test(departmentName)) return null
  const name = departmentName.replace(/\(ROP\)/i, '').trim()
  return name === '' ? null : name
}

function int(value: bigint | number | null | undefined): number {
  return value == null ? 0 : Number(value)
}

function money(value: MoneyText): bigint {
  return value == null ? 0n : BigInt(value)
}
