import { describe, expect, it } from 'vitest'

/*
  Same preamble as the other SQL-shape tests: the repository reads `env` at
  module scope for APP_TIMEZONE and `env` refuses to load without a complete
  configuration, deliberately, so a misconfigured deployment fails at boot
  rather than at midnight. A test about SQL shape has no database and no
  secrets, so it supplies the four required names first and imports afterwards.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

const reach = InsightsRepository as unknown as {
  logisticsSql: () => string
  refusalReasonsSql: () => string
}

const CUTS = reach.logisticsSql()
const REASONS = reach.refusalReasonsSql()

/*
  Negative assertions run against the SQL with its prose stripped. Both
  builders carry long comments explaining why each figure is what it is, and
  those comments name the very tokens the `not.toContain` checks forbid.
*/
const bare = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

const bareCuts = bare(CUTS)
const bareReasons = bare(REASONS)

/**
 * The delivery cuts: three groupings of ONE pass.
 *
 * The route and region cuts were once two statements differing by a single
 * projected column, each rebuilding three unbounded history CTEs — 2 212 ms
 * and 1 361 ms for one card. The Доставка funnel is the third grouping and it
 * joins them rather than opening a fourth query, because `scoped` already
 * holds exactly the rows it needs.
 */
describe('logistics cuts SQL', () => {
  it('builds one statement whose CTEs each earn their place', () => {
    const chain = [...CUTS.matchAll(/(\w+) AS(?: MATERIALIZED)? \(/g)].map((m) => m[1])
    expect(chain).toEqual([
      'routed',
      'dispatched',
      'delivered',
      'scoped',
      'by_route',
      'by_region',
      'by_stage',
    ])
  })

  /**
   * `scoped` is read three times now, so materialising it is what keeps the
   * expensive half — three unbounded passes over the stage history — running
   * once. Postgres would materialise a CTE with three references anyway;
   * saying so keeps it true if a later edit leaves one.
   */
  it('materialises the shared scan', () => {
    expect(CUTS).toContain('scoped AS MATERIALIZED (')
  })

  /**
   * ONE aggregate list, read by all three cuts.
   *
   * Written out per cut, the three halves of this card could drift into
   * counting different things under the same column names — which is the
   * fault the module header records, arriving by another door. The median is
   * the cheapest witness that the list is shared: three groupings, three
   * copies, no fourth.
   */
  it('computes the same aggregates for every cut', () => {
    expect(bareCuts.match(/percentile_cont\(0\.5\)/g)).toHaveLength(3)
  })

  /**
   * NO p90. It was a tenth column on two tables nobody asked for it on, and
   * a second percentile over the same ordered set for a figure the median
   * already carries.
   */
  it('states the pace once, as a median', () => {
    expect(bareCuts).not.toContain('percentile_cont(0.9)')
    expect(bareCuts).not.toContain('p90')
  })

  /**
   * THE FUNNEL IS THE Доставка FUNNEL, AND NOTHING ELSE.
   *
   * `scoped` is filtered on `countsAsRevenue`, which is TWO pipelines —
   * Доставка (#6) and Ecommerce (#14). A funnel table that read both would
   * print «Новая заявка» and «Оплаченно с click» among the hubs, under a
   * heading naming a funnel neither belongs to, and the shares underneath
   * would divide by a population the portal's own kanban never shows.
   *
   * The filter is the portal's own id namespace rather than a join to the
   * pipeline name, because `deal_stage."externalId"` IS `STATUS_ID` — the
   * same key `DELIVERY_STAGE_ROLES` is written in — and a renamed funnel
   * cannot break it.
   */
  it('draws the funnel from the Доставка stages alone', () => {
    expect(bareCuts).toContain(`st."externalId" LIKE 'C6:%'`)
  })

  /**
   * AN EMPTY COLUMN IS STILL A COLUMN.
   *
   * «Подготовка товара» and «Заказ в мой склад» stand at nought for days on
   * this portal. Grouped over deals they do not come back as zero, they come
   * back not at all — and the board silently renumbers itself against the
   * kanban it is copied from. The funnel therefore reads FROM the stage list
   * and joins the deals on, with the funnel filter on `deal_stage` where it
   * cannot turn the outer join back into an inner one.
   */
  it('keeps a stage nothing is standing in', () => {
    expect(bareCuts).toContain('FROM "deal_stage" st')
    expect(bareCuts).toContain('LEFT JOIN scoped ON scoped.stage_id = st."id"')
  })

  /**
   * `count(*)` would count the LEFT JOIN's one all-null row and print an
   * empty column as holding one order. `amountMinor` is NOT NULL on every
   * real deal, so `count(amount_minor)` is identical for the two cuts that
   * group deals directly and is the only form right for all three.
   */
  it('counts deals, not join rows', () => {
    expect(bareCuts).toContain('count(amount_minor)::bigint AS orders')
    expect(bareCuts).not.toContain('count(*)::bigint AS orders')
  })

  /**
   * The funnel is ordered by the PORTAL'S order, not by size.
   *
   * The whole point of the table is that it reads the way the kanban reads:
   * Подготовка товара, then the warehouse, then the hubs, then the carriers,
   * then Доставлено. Sorted by order count it would still be correct and
   * would no longer be a funnel.
   */
  it('keeps the funnel in the portal’s own stage order', () => {
    expect(bareCuts).toContain(`min(st."sortOrder")::int AS sort`)
    expect(bareCuts.slice(bareCuts.lastIndexOf('ORDER BY'))).toContain('sort')
  })

  /**
   * The funnel needs its OWN total, not the card's.
   *
   * Share of orders is divided by a denominator, and the only honest one for
   * a C6-only table is the C6-only count. Dividing by the region cut's total
   * — which includes Ecommerce — makes eighteen shares that do not add to a
   * hundred and no line on screen saying why.
   */
  it('gives the funnel its own grand total', () => {
    expect(bareCuts).toContain(`GROUPING SETS ((st."name"), ())`)
  })

  /**
   * The funnel's money is EVERY deal in the stage, the way the kanban states
   * it. `revenue` — won deals only — is the right figure for the delivery
   * tables and the wrong one here: «В пути» has won nothing and is not worth
   * nothing.
   */
  it('carries the kanban’s own sum beside the won-only revenue', () => {
    expect(bareCuts).toContain("sum(amount_minor) FILTER (WHERE status = 'WON')::text AS revenue")
    expect(bareCuts).toContain('sum(amount_minor)::text AS amount')
  })
})

/**
 * Loss reasons, and the two arms this query no longer has.
 *
 * It used to answer for the qualification funnel as well — deals the revenue
 * flag excludes — because the delivery pipeline records no reason at all and
 * the only recorded ones live there. That card was the one block on a
 * Доставка screen reading another funnel, and it went with the rework.
 */
describe('refusal reasons SQL', () => {
  /**
   * A PRE_SALE arm coming back means the screen is reporting the
   * qualification funnel under a delivery heading again — and it arrives
   * with the `countsAsRevenue` filter removed from the WHERE, which is what
   * makes it a scan of every lost deal on the portal rather than of the
   * delivery pipeline's own.
   */
  it('reads the revenue pipelines only', () => {
    expect(bareReasons).not.toContain('PRE_SALE')
    expect(bareReasons).toContain('d."countsAsRevenue"')
  })

  /**
   * Both refusal roles, filtered in the WHERE rather than bucketed and
   * dropped. The `OTHER` bucket had no consumer: the page renders RETURNED
   * and CANCELLED and nothing else, so every row that fell through the CASE
   * was fetched, decoded, mapped and discarded.
   */
  it('fetches only the rows the page draws', () => {
    expect(bareReasons).toContain(`cur."logisticsRole" IN ('REFUSED', 'CANCELLED_EARLY')`)
    expect(bareReasons).not.toContain("'OTHER'")
  })

  /**
   * RETURNED vs CANCELLED is decided by whether the parcel ever reached a hub,
   * a carrier or «В пути» — NOT by which of the two refusal stages the portal
   * parked it in. Since June this portal writes every refusal to «Отказ
   * предварительно»; read from the stage alone the screen said nothing came
   * back and 150 orders never left the warehouse, both the opposite of the
   * truth.
   */
  it('splits on whether the parcel travelled, not on the stage', () => {
    expect(bareReasons).toContain(
      `ss."logisticsRole" IN ('REGIONAL_HUB', 'CARRIER', 'IN_TRANSIT')`,
    )
  })

  /**
   * Money is never null here any more. With the pre-sale rows gone every
   * remaining row counts toward revenue, so the DTO's `lost` stopped being
   * nullable — and the em dash and its "we do not count money here" tooltip
   * went with it.
   */
  it('always states a sum', () => {
    expect(bareReasons).toContain('COALESCE(sum(d."amountMinor"), 0)::text AS lost')
    expect(bareReasons).not.toContain('FILTER (WHERE d."countsAsRevenue")')
  })
})
