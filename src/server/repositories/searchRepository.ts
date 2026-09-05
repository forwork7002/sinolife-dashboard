/**
 * The one search box, over everything a person might type.
 *
 * WHAT PEOPLE ACTUALLY TYPE, and why each is here: a phone number, because
 * that is how the floor identifies a customer; a Bitrix deal id or a `bx…`
 * order code, because that is what the CRM and the couriers quote; a name,
 * because that is what the customer says. Products and sources are here for
 * the manager who wants "everything Zextra" rather than one order.
 *
 * ONE ARM PER INDEX, unioned — not one WHERE with five ORs. An OR across two
 * tables makes Postgres give up on the indexes and read both, which is how
 * this cost six seconds before. Each arm below is a single indexed lookup, and
 * the trigram indexes that make them so are in
 * prisma/migrations/20260831150000_global_search_indexes.
 *
 * EACH ARM IS CAPPED BEFORE THE SORT. Searching a word the company sells —
 * "collagen" matches 146 431 deal titles — would otherwise sort a sixth of the
 * table to show eight rows. The cap means a term that broad returns an
 * arbitrary eight of them, which is the honest outcome for a query that
 * identifies nothing.
 */

import type { PrismaClient } from '@/generated/prisma/client'

/** Money arrives from Postgres as a string: bigint cannot ride JSON. */
type MoneyText = string | null

export interface SearchDealRow {
  readonly dealId: string
  readonly bitrixId: string | null
  readonly orderCode: string | null
  readonly title: string
  readonly customerName: string | null
  readonly customerPhone: string | null
  readonly amountMinor: bigint
  readonly currency: string
  readonly createdAt: Date
  readonly stageName: string
  readonly employeeName: string | null
}

export interface SearchCustomerRow {
  readonly customerId: string
  readonly name: string
  readonly phone: string | null
  readonly orders: number
  readonly lastOrderAt: Date | null
}

export interface SearchNamedRow {
  readonly id: string
  readonly name: string
  readonly detail: string | null
}

export interface SearchResults {
  readonly deals: readonly SearchDealRow[]
  readonly customers: readonly SearchCustomerRow[]
  readonly employees: readonly SearchNamedRow[]
  readonly products: readonly SearchNamedRow[]
  readonly sources: readonly SearchNamedRow[]
}

/** How many of each kind come back. Eight fills the palette without a scroll. */
const PER_GROUP = 8
/** How many rows an arm may contribute before the combined set is ordered. */
const PER_ARM = 25

/** Below this a trigram index cannot help, and the answer is too broad to read. */
export const MIN_SEARCH_LENGTH = 3

export class SearchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @param restrictToEmployeeIds The caller's authorisation scope, applied in
   *   SQL. An account that may only read its own team's deals must not be able
   *   to confirm somebody else's customer exists by typing their number.
   */
  async search(
    term: string,
    restrictToEmployeeIds?: readonly string[] | null,
  ): Promise<SearchResults> {
    const q = term.trim()

    if (q.length < MIN_SEARCH_LENGTH) {
      return { deals: [], customers: [], employees: [], products: [], sources: [] }
    }

    const like = `%${escapeLike(q)}%`
    // Joined to text rather than passed as an array so the two arms below can
    // stay a single `$n::text IS NULL` test — the same grammar every other
    // repository's scope clause uses.
    const mine = restrictToEmployeeIds?.length ? restrictToEmployeeIds.join(',') : null

    const [deals, customers, employees, products, sources] = await Promise.all([
      this.deals(q, like, mine),
      this.customers(like, mine),
      this.named('employee', 'fullName', like, true),
      this.named('product', 'name', like, false),
      this.named('sales_source', 'name', like, false),
    ])

    return { deals, customers, employees, products, sources }
  }

  private async deals(q: string, like: string, mine: string | null): Promise<SearchDealRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        deal_id: string
        bitrix_id: string | null
        order_code: string | null
        title: string
        customer_name: string | null
        customer_phone: string | null
        amount_minor: MoneyText
        currency: string
        created_at: Date
        stage_name: string
        employee_name: string | null
      }[]
    >(
      `
      WITH hits AS (
        -- The deal id, exact. Anything looser on an id is noise: 9258 is not a
        -- prefix of 925842 in any sense a person means when they type it.
        (SELECT "id" FROM "deal" WHERE "externalId" = $1 LIMIT 1)
        UNION
        (SELECT "id" FROM "deal" WHERE "orderCode" ILIKE $2 LIMIT ${PER_ARM})
        UNION
        (SELECT "id" FROM "deal" WHERE "title" ILIKE $2 LIMIT ${PER_ARM})
        UNION
        (SELECT d."id" FROM "deal" d
           JOIN "customer" c ON c."id" = d."customerId"
          WHERE c."phone" ILIKE $2 LIMIT ${PER_ARM})
        UNION
        (SELECT d."id" FROM "deal" d
           JOIN "customer" c ON c."id" = d."customerId"
          WHERE c."name" ILIKE $2 LIMIT ${PER_ARM})
        UNION
        -- Second and third numbers. Only 3 702 customers have any, and the
        -- partial index is what stops this reading all 326 859 to find them.
        (SELECT d."id" FROM "deal" d
           JOIN "customer" c ON c."id" = d."customerId"
          WHERE array_length(c."phones", 1) > 0
            AND c."phones"::text ILIKE $2 LIMIT ${PER_ARM})
      )
      SELECT
        d."id" AS deal_id,
        d."externalId" AS bitrix_id,
        d."orderCode" AS order_code,
        d."title" AS title,
        cust."name" AS customer_name,
        COALESCE(cust."phone", cust."phones"[1]) AS customer_phone,
        d."amountMinor"::text AS amount_minor,
        d."currency" AS currency,
        d."createdAtSource" AS created_at,
        st."name" AS stage_name,
        e."fullName" AS employee_name
      FROM hits h
      JOIN "deal" d ON d."id" = h."id"
      JOIN "deal_stage" st ON st."id" = d."stageId"
      LEFT JOIN "customer" cust ON cust."id" = d."customerId"
      LEFT JOIN "employee" e ON e."id" = d."employeeId"
      WHERE $3::text IS NULL OR d."employeeId" = ANY(string_to_array($3, ','))
      ORDER BY d."createdAtSource" DESC
      LIMIT ${PER_GROUP}
      `,
      // Only a term that is ALL digits can be a deal id. A space can never be
      // one, so it is what a non-numeric term is compared against — the arm
      // then matches nothing instead of matching the wrong order.
      /^[0-9]+$/.test(q) ? q : ' ',
      like,
      mine,
    )

    return rows.map((r) => ({
      dealId: r.deal_id,
      bitrixId: r.bitrix_id,
      orderCode: r.order_code,
      title: r.title,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      amountMinor: r.amount_minor === null ? 0n : BigInt(r.amount_minor),
      currency: r.currency,
      createdAt: r.created_at,
      stageName: r.stage_name,
      employeeName: r.employee_name,
    }))
  }

  private async customers(like: string, mine: string | null): Promise<SearchCustomerRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        customer_id: string
        name: string
        phone: string | null
        orders: bigint
        last_order_at: Date | null
      }[]
    >(
      `
      WITH hits AS (
        (SELECT "id" FROM "customer" WHERE "phone" ILIKE $1 LIMIT ${PER_ARM})
        UNION
        (SELECT "id" FROM "customer" WHERE "name" ILIKE $1 LIMIT ${PER_ARM})
        UNION
        (SELECT "id" FROM "customer"
          WHERE array_length("phones", 1) > 0
            AND "phones"::text ILIKE $1 LIMIT ${PER_ARM})
      )
      SELECT
        c."id" AS customer_id,
        c."name" AS name,
        COALESCE(c."phone", c."phones"[1]) AS phone,
        count(d."id")::bigint AS orders,
        max(d."createdAtSource") AS last_order_at
      FROM hits h
      JOIN "customer" c ON c."id" = h."id"
      /*
        THE COUNT IS SCOPED TOO, NOT JUST THE ROW.

        The EXISTS below decides WHICH customers a narrowed caller is shown.
        These two figures describe them, and joined unscoped they described the
        customer's dealings with the WHOLE company: «14 ta buyurtma, oxirgisi
        4-sen» to an account that may see two of the fourteen. That is the same
        disclosure this file already refuses to make as a hit — saying "3 you
        may not see" still says they exist — restated as a count and a date.
      */
      LEFT JOIN "deal" d
        ON d."customerId" = c."id"
       AND ($2::text IS NULL OR d."employeeId" = ANY(string_to_array($2, ',')))
      WHERE $2::text IS NULL
         OR EXISTS (SELECT 1 FROM "deal" md
                     WHERE md."customerId" = c."id"
                       AND md."employeeId" = ANY(string_to_array($2, ',')))
      GROUP BY c."id", c."name", c."phone", c."phones"
      -- Whoever ordered most recently is who is being asked about.
      ORDER BY max(d."createdAtSource") DESC NULLS LAST
      LIMIT ${PER_GROUP}
      `,
      like,
      mine,
    )

    return rows.map((r) => ({
      customerId: r.customer_id,
      name: r.name,
      phone: r.phone,
      orders: Number(r.orders),
      lastOrderAt: r.last_order_at,
    }))
  }

  /**
   * The small reference tables — hundreds of rows rather than hundreds of
   * thousands, so they need no index to answer quickly.
   *
   * The table and column names are chosen from the union types above, never
   * from a request, which is what keeps them out of reach of the caller.
   */
  private async named(
    table: 'employee' | 'product' | 'sales_source',
    column: 'fullName' | 'name',
    like: string,
    withDepartment: boolean,
  ): Promise<SearchNamedRow[]> {
    const detail = withDepartment
      ? '(SELECT dep."name" FROM "department" dep WHERE dep."id" = t."departmentId")'
      : 'NULL::text'

    return this.prisma.$queryRawUnsafe<{ id: string; name: string; detail: string | null }[]>(
      `
      SELECT t."id" AS id, t."${column}" AS name, ${detail} AS detail
        FROM "${table}" t
       WHERE t."${column}" ILIKE $1
       ORDER BY t."${column}"
       LIMIT ${PER_GROUP}
      `,
      like,
    )
  }
}

/**
 * `%`, `_` and the escape itself are wildcards to ILIKE and characters to a
 * person.
 *
 * A customer named "100%" would otherwise match everybody, and a search for
 * "bx_1" would quietly match "bx-1" as well.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`)
}
