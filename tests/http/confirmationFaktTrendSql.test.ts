import { describe, expect, it } from 'vitest'

/*
  Same reason `confirmationSellerRatingSql.test.ts` supplies these first: `env`
  is read at module scope for APP_TIMEZONE and refuses to load without a
  complete configuration. A unit test about SQL shape has no database.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * The FAKT 1 / FAKT 2 line on the hero chart, held to the board's own
 * definitions.
 *
 * THE LINES AND THE TILES ARE ONE SCREEN. Savdo dinamikasi draws these two
 * series over the revenue area and prints the same two figures as totals in
 * `ConfirmationFaktSection` further down — so the chart's daily sums must add
 * up to the tiles' period totals, or a reader summing the line by eye finds a
 * third number for a month.
 *
 * It does NOT reuse `ratingDaysSql`: that one narrows to a single operator at
 * a fixed `$3` and groups nothing else, while this is the whole floor under
 * the reader's own filters. The agreement is bought the way the record wall
 * buys it — by sharing the predicates literally — and this file is what proves
 * they are still shared. Every assertion here has a matching one in
 * `confirmationSellerRatingSql.test.ts`.
 */
const faktTrendSql = (
  InsightsRepository as unknown as { faktTrendSql: (filterClause: string) => string }
).faktTrendSql

const SQL = faktTrendSql('')
const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const BARE = bare(SQL)

describe('the FAKT trend speaks the board’s language', () => {
  it('counts FAKT 1 as the two outcomes that left the queue as an order', () => {
    // Тасдиқланди AND Тасдиқланмай чиқди. Never «Успешно заказ» — see
    // `mapping.ts`, where it is documented as a settlement stamp.
    expect(BARE).toContain("c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')")
    expect(BARE).not.toContain('UC_YUKVF1')
  })

  it('counts FAKT 2 as the deal’s CURRENT stage carrying the delivery role', () => {
    expect(BARE).toContain(`ds."logisticsRole" = 'DELIVERED'`)
    // A plain WON admits «База · Успешно» and the «Регистрация» hand-off stamp.
    expect(BARE).not.toContain(`d."status" = 'WON'`)
  })

  it('cuts the days by the arrival in C4:NEW, in the reporting timezone', () => {
    // `queued_at`, not `createdAtSource`: the tiles below the chart are dated
    // that way, so a point on the line has to be too.
    expect(BARE).toContain('FROM scoped c')
    expect(BARE).toContain('c.queued_at')
    // The reporting timezone comes from `env`, so the shape is pinned rather
    // than the literal: a UTC instant read into the configured zone as a date.
    expect(BARE).toContain(`AT TIME ZONE 'UTC' AT TIME ZONE`)
    expect(BARE).toContain('::date::text AS date')
    expect(BARE).not.toContain('createdAtSource')
  })

  it('joins the employee the portal snapshotted, so the filters can narrow it', () => {
    // `ratingFilterSql` writes `e."id"` and `e."departmentId"`; without this
    // join an employee or department filter is a syntax error rather than a
    // silently unfiltered chart.
    expect(BARE).toContain(`JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")`)
  })

  it('is the whole floor, not one operator — no fixed employee placeholder', () => {
    // `ratingDaysSql` pins `= $3` to one seller. This series is every seller
    // the reader can see, so the only narrowing is the filter clause.
    expect(BARE).not.toContain('$3')
  })

  it('takes the caller’s filters where the rating takes them', () => {
    const filtered = bare(faktTrendSql(` AND e."id" = ANY(string_to_array($4, ','))`))
    expect(filtered).toContain(`AND e."id" = ANY(string_to_array($4, ','))`)
  })

  it('keeps a day whose only money was delivered without a confirmation', () => {
    // FAKT 2 is not a subset of FAKT 1 — an order refused in the queue and
    // revived afterwards delivers on a day that confirmed nothing. Dropping
    // that day would break the line where the two series cross.
    expect(BARE).toContain('HAVING count(*) FILTER')
    expect(BARE).toContain(
      `OR count(*) FILTER (WHERE ds."logisticsRole" = 'DELIVERED') > 0`,
    )
  })

  it('joins the stage the delivery role is read from', () => {
    expect(BARE).toContain(`LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"`)
  })

  it('balances its parentheses', () => {
    expect((SQL.match(/\(/g) ?? []).length).toBe((SQL.match(/\)/g) ?? []).length)
  })

  it('returns the days in order, so the client never sorts a time axis', () => {
    expect(BARE).toContain('ORDER BY 1')
  })
})
