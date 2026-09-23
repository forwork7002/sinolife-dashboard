import { describe, expect, it } from 'vitest'

// `env` is read at module scope for APP_TIMEZONE — see
// `confirmationFaktTrendSql.test.ts`. A unit test about SQL shape has no database.
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * «Manbalar boʻyicha» held to the board's own definitions.
 *
 * The table sits under the hero on Savdo dinamikasi and its rows must add up
 * to the hero's FAKT 1 / FAKT 2. That holds only while this statement reads
 * the same predicates `ratingSql` does and drops no row — which is what every
 * case here pins.
 */
const sourceRatingSql = (
  InsightsRepository as unknown as { sourceRatingSql: (filterClause: string) => string }
).sourceRatingSql

const SQL = sourceRatingSql('')
const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const BARE = bare(SQL)

describe('the sources table speaks the board’s language', () => {
  it('counts FAKT 1 as the two outcomes that left the queue as an order', () => {
    expect(BARE).toContain("c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')")
  })

  it('counts FAKT 2 as the deal’s CURRENT stage carrying the delivery role', () => {
    expect(BARE).toContain(`ds."logisticsRole" = 'DELIVERED'`)
    expect(BARE).not.toContain(`d."status" = 'WON'`)
    expect(BARE).toContain(`LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"`)
  })

  it('reads the queue cohort, not the creation date', () => {
    expect(BARE).toContain('FROM scoped c')
    expect(BARE).not.toContain('createdAtSource')
  })

  it('groups by the deal’s source and names it from sales_source', () => {
    expect(BARE).toContain(`LEFT JOIN "sales_source" src ON src."id" = d."sourceId"`)
    expect(BARE).toContain(`GROUP BY d."sourceId", src."name"`)
  })

  it('joins the snapshotted operator, so the employee and department filters can narrow it', () => {
    expect(BARE).toContain(
      `JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")`,
    )
    const filtered = bare(sourceRatingSql(` AND e."id" = ANY(string_to_array($4, ','))`))
    expect(filtered).toContain(`AND e."id" = ANY(string_to_array($4, ','))`)
  })

  it('drops no source — not the unnamed one, not one whose every order was refused', () => {
    // An INNER join to sales_source would lose the deals with no source, and a
    // HAVING would lose the all-refused source; either way the rows would stop
    // adding up to the hero.
    expect(BARE).not.toMatch(/(?<!LEFT )JOIN "sales_source"/)
    expect(BARE).not.toContain('HAVING')
  })

  it('balances its parentheses', () => {
    expect((SQL.match(/\(/g) ?? []).length).toBe((SQL.match(/\)/g) ?? []).length)
  })
})
