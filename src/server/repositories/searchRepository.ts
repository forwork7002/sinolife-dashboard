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
 * ONLY THE ARMS THE TERM CAN BE IN. A term is a NUMBER or TEXT
 * (`classifySearchTerm`), and the two do not share columns: a phone number is
 * not in any title or name, a name is not in any phone column. Before this
 * split every term ran every arm — nine trigram lookups plus three reference
 * tables — and `pg_stat_statements` on production (2026-09-16) put the deals
 * statement at 1.2–1.5 s mean and 3.3 s worst, the customers statement the
 * same, five statements per keystroke on a pool of eight connections. A
 * number now costs two statements over four arms, text three statements over
 * four; the reference tables are one statement, read only for text.
 *
 * EACH ARM IS CAPPED BEFORE THE SORT. Searching a word the company sells —
 * "collagen" matches 146 431 deal titles — would otherwise sort a sixth of the
 * table to show eight rows. The cap means a term that broad returns an
 * arbitrary eight of them, which is the honest outcome for a query that
 * identifies nothing.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { classifySearchTerm, type SearchTerm } from '@/lib/searchTerm'

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
  /**
   * Whether the deal ever arrived in Тасдиклаш (C4:NEW) — the confirmation
   * queue's cohort is made of exactly those, so only such a deal can be found
   * there by its own id. A База twin or a Регистрация lead never arrives.
   */
  readonly queued: boolean
  /**
   * Whether ANY deal of the deal's customer ever arrived there — what a link
   * by the customer's phone can find. False for a customer whose every deal is
   * a lead that never reached the queue, and for a deal with no customer.
   */
  readonly customerQueued: boolean
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
  /**
   * The unit's id, for the employee arm only — null everywhere else.
   *
   * On the wire so the palette can send a reader to the person they searched
   * for. «Xodimlar» hits used to link to a bare `/structure`, and that screen
   * opens on the READER's own chain: typing an operator's name and pressing
   * enter drew the supervisor's own department, which is the one answer they
   * did not ask for.
   */
  readonly departmentId: string | null
}

export interface SearchResults {
  readonly deals: readonly SearchDealRow[]
  readonly customers: readonly SearchCustomerRow[]
  readonly employees: readonly SearchNamedRow[]
  readonly products: readonly SearchNamedRow[]
  readonly sources: readonly SearchNamedRow[]
}

const EMPTY: SearchResults = { deals: [], customers: [], employees: [], products: [], sources: [] }

/** How many of each kind come back. Eight fills the palette without a scroll. */
const PER_GROUP = 8
/** How many rows an arm may contribute before the combined set is ordered. */
const PER_ARM = 25

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
    const what = classifySearchTerm(term)
    if (what.status !== 'ok') return EMPTY

    const like = `%${escapeLike(what.needle)}%`
    // Joined to text rather than passed as an array so the two arms below can
    // stay a single `$n::text IS NULL` test — the same grammar every other
    // repository's scope clause uses.
    const mine = restrictToEmployeeIds?.length ? restrictToEmployeeIds.join(',') : null

    if (what.kind === 'number') {
      const [deals, customers] = await Promise.all([
        this.deals(what, like, mine),
        this.customers(what, like, mine),
      ])
      return { ...EMPTY, deals, customers }
    }

    const [deals, customers, named] = await Promise.all([
      this.deals(what, like, mine),
      this.customers(what, like, mine),
      this.named(like),
    ])
    return { deals, customers, ...named }
  }

  private async deals(what: SearchTerm, like: string, mine: string | null): Promise<SearchDealRow[]> {
    /*
      A NUMBER is a deal id, an order code or a phone. The id arm is exact:
      anything looser on an id is noise — 9258 is not a prefix of 925842 in any
      sense a person means when they type it. The `phones` arm is the second
      and third numbers: only 3 702 customers have any, and the partial index
      is what stops this reading all 326 859 to find them.

      THE NUMBER IS COMPARED AS DIGITS, and the stored column allows that:
      counted on production 2026-09-16, 222 969 of 224 313 phones are `+` and
      digits with nothing between, and 730 carry a space or a dash — those
      were unfindable by a typed «90 123» before too, unless typed exactly.

      A number skips the title arm on purpose. 2 542 titles carry a phone
      number and all but 7 of those deals also carry the customer, whose phone
      column finds them; 712 titles are the deal's own id, which the exact arm
      finds. What the title arm would add for a number is the cost of reading
      the 57 MB trigram index, not a row.

      TEXT is a name, a code or a title. `orderCode` sits in both lists because
      a code is letters and digits — `bx00790` — and people quote either half.
    */
    const arms =
      what.kind === 'number'
        ? `
        (SELECT "id" FROM "deal" WHERE "externalId" = $1 LIMIT 1)
        UNION
        (SELECT "id" FROM "deal" WHERE "orderCode" ILIKE $2 LIMIT ${PER_ARM})
        UNION
        (SELECT d."id" FROM "deal" d
           JOIN "customer" c ON c."id" = d."customerId"
          WHERE c."phone" ILIKE $2 LIMIT ${PER_ARM})
        UNION
        (SELECT d."id" FROM "deal" d
           JOIN "customer" c ON c."id" = d."customerId"
          WHERE array_length(c."phones", 1) > 0
            AND c."phones"::text ILIKE $2 LIMIT ${PER_ARM})`
        : `
        (SELECT "id" FROM "deal" WHERE "orderCode" ILIKE $1 LIMIT ${PER_ARM})
        UNION
        (SELECT "id" FROM "deal" WHERE "title" ILIKE $1 LIMIT ${PER_ARM})
        UNION
        (SELECT d."id" FROM "deal" d
           JOIN "customer" c ON c."id" = d."customerId"
          WHERE c."name" ILIKE $1 LIMIT ${PER_ARM})`

    const scope = what.kind === 'number' ? '$3' : '$2'
    const params = what.kind === 'number' ? [what.needle, like, mine] : [like, mine]

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
        queued: boolean
        customer_queued: boolean
      }[]
    >(
      `
      WITH hits AS (${arms}
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
        e."fullName" AS employee_name,
        /*
          An arrival in Тасдиклаш, as the queue's cohort reads one. At most a
          hundred hits, each probed on (dealId, enteredAt).
        */
        EXISTS (
          SELECT 1 FROM "deal_stage_history" sh
            JOIN "deal_stage" ss ON ss."id" = sh."stageId"
           WHERE sh."dealId" = d."id" AND ss."confirmationSignal" = 'CONFIRM_NEW'
        ) AS queued,
        /*
          The same arrival for any deal of the customer: what the queue can
          show for a link by phone. Probed on (customerId), then on
          (dealId, enteredAt), and it stops at the first arrival it meets.
        */
        EXISTS (
          SELECT 1 FROM "deal" cd
            JOIN "deal_stage_history" ch ON ch."dealId" = cd."id"
            JOIN "deal_stage" cs ON cs."id" = ch."stageId"
           WHERE cd."customerId" = d."customerId" AND cs."confirmationSignal" = 'CONFIRM_NEW'
        ) AS customer_queued
      FROM hits h
      JOIN "deal" d ON d."id" = h."id"
      JOIN "deal_stage" st ON st."id" = d."stageId"
      LEFT JOIN "customer" cust ON cust."id" = d."customerId"
      LEFT JOIN "employee" e ON e."id" = d."employeeId"
      WHERE ${scope}::text IS NULL OR d."employeeId" = ANY(string_to_array(${scope}, ','))
      ORDER BY d."createdAtSource" DESC
      LIMIT ${PER_GROUP}
      `,
      ...params,
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
      queued: r.queued,
      customerQueued: r.customer_queued,
    }))
  }

  private async customers(
    what: SearchTerm,
    like: string,
    mine: string | null,
  ): Promise<SearchCustomerRow[]> {
    const arms =
      what.kind === 'number'
        ? `
        (SELECT "id" FROM "customer" WHERE "phone" ILIKE $1 LIMIT ${PER_ARM})
        UNION
        (SELECT "id" FROM "customer"
          WHERE array_length("phones", 1) > 0
            AND "phones"::text ILIKE $1 LIMIT ${PER_ARM})`
        : `
        (SELECT "id" FROM "customer" WHERE "name" ILIKE $1 LIMIT ${PER_ARM})`

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
      WITH hits AS (${arms}
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
   * thousands, so they need no index to answer quickly. One statement for the
   * three: each used to be its own round trip and its own pooled connection,
   * and on eight connections shared with every screen that was the cost that
   * mattered, not the reads.
   *
   * The employee's `detail` is its PRIMARY unit — `employee."departmentId"` —
   * which is the one this dashboard credits the person to and therefore the
   * one to fly the chart to. Membership rows would give several and no way to
   * choose.
   */
  private async named(
    like: string,
  ): Promise<Pick<SearchResults, 'employees' | 'products' | 'sources'>> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        kind: 'employee' | 'product' | 'source'
        id: string
        name: string
        detail: string | null
        departmentId: string | null
      }[]
    >(
      `
      (SELECT 'employee' AS kind,
              t."id" AS id,
              t."fullName" AS name,
              (SELECT dep."name" FROM "department" dep WHERE dep."id" = t."departmentId") AS detail,
              t."departmentId" AS "departmentId"
         FROM "employee" t
        WHERE t."fullName" ILIKE $1
        ORDER BY t."fullName"
        LIMIT ${PER_GROUP})
      UNION ALL
      (SELECT 'product' AS kind, t."id", t."name", NULL::text, NULL::text
         FROM "product" t
        WHERE t."name" ILIKE $1
        ORDER BY t."name"
        LIMIT ${PER_GROUP})
      UNION ALL
      (SELECT 'source' AS kind, t."id", t."name", NULL::text, NULL::text
         FROM "sales_source" t
        WHERE t."name" ILIKE $1
        ORDER BY t."name"
        LIMIT ${PER_GROUP})
      `,
      like,
    )

    const pick = (kind: 'employee' | 'product' | 'source'): SearchNamedRow[] =>
      rows
        .filter((r) => r.kind === kind)
        .map((r) => ({ id: r.id, name: r.name, detail: r.detail, departmentId: r.departmentId }))

    return { employees: pick('employee'), products: pick('product'), sources: pick('source') }
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
