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
 * The record wall's SQL, held to the board's own definitions.
 *
 * THE WALL AND THE BOARD ARE ONE SCREEN. A month's champion is printed in the
 * title line while the same month's rows can be read below it, so the two must
 * agree about who a seller is, what FAKT 1 counts and what FAKT 2 counts —
 * or the strip names one person and the podium under it names another.
 *
 * The wall does NOT reuse `confirmationSellerRating` month by month (a dozen
 * cohort constructions for a year of records, ~0.9 s each on production), so
 * that agreement is not free: it is bought by sharing the predicates
 * literally, and this file is what proves they are still shared. Every
 * assertion here has a matching one in `confirmationSellerRatingSql.test.ts`.
 */
const recordsSql = (
  InsightsRepository as unknown as { recordsSql: (filterClause: string) => string }
).recordsSql

const SQL = recordsSql('')
const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const BARE = bare(SQL)

describe('the record wall speaks the board’s language', () => {
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

  it('credits the operator the portal snapshotted, not whoever holds the row today', () => {
    expect(BARE).toContain(`COALESCE(d."operatorEmployeeId", d."employeeId")`)
  })

  it('cuts the wall by the arrival in C4:NEW, in the reporting timezone', () => {
    // `queued_at`, not `createdAtSource` and not anything on the deal: the
    // board is dated that way, so a record has to be too or a champion could
    // not be found in the month they are printed under.
    expect(BARE).toContain('date_trunc')
    expect(BARE).toContain('c.queued_at')
    expect(BARE).toContain("AT TIME ZONE 'UTC' AT TIME ZONE")
    expect(BARE).not.toContain('createdAtSource')
  })

  it('ranks by the podium’s rule — FAKT 2 first, FAKT 1 only when nobody delivered', () => {
    const order = BARE.slice(BARE.indexOf('ORDER BY'), BARE.indexOf(') AS place'))
    const fakt2 = order.indexOf(`FILTER (WHERE ds."logisticsRole" = 'DELIVERED') DESC`)
    const fakt1 = order.indexOf(`FILTER (WHERE c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')) DESC`)

    expect(fakt2).toBeGreaterThan(-1)
    expect(fakt1).toBeGreaterThan(-1)
    // If these ever swap, a running month whose orders are still on the road
    // outranks a closed month that actually delivered more.
    expect(fakt2).toBeLessThan(fakt1)
  })

  it('breaks a tie on the employee id, so the wall does not reorder between polls', () => {
    // A name would collate differently under 'uz' and 'ru' — see `branches.ts`.
    expect(BARE).toMatch(/DESC NULLS LAST,\s*e\."id"\s*\)\s*AS place/)
  })

  it('takes one row per month and returns the newest first', () => {
    expect(BARE).toContain('PARTITION BY')
    expect(BARE).toContain('WHERE m.place = 1')
    expect(BARE).toContain('ORDER BY m.month DESC')
  })

  it('refuses a month that sold nothing, unlike the board it is drawn from', () => {
    /*
      `ratingSql` keeps an operator whose every order was refused: that row is
      what a floor manager needs and its refusals belong in the conversion
      denominator. "The biggest month anyone has had" is a different question
      and cannot be answered with nothing sold, so the gate here is FAKT 1 or
      FAKT 2 above zero rather than `count(*) > 0`.
    */
    const having = BARE.slice(BARE.indexOf('HAVING'), BARE.indexOf(') m'))
    expect(having).toContain(`c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')`)
    expect(having).toContain(`ds."logisticsRole" = 'DELIVERED'`)
    expect(having).not.toMatch(/HAVING\s+count\(\*\)\s*>\s*0/)
  })

  it('threads the caller’s filters into the grouped select, where the scope is', () => {
    const filtered = bare(recordsSql(` AND e."id" = ANY(string_to_array($4, ','))`))
    expect(filtered).toContain(`AND e."id" = ANY(string_to_array($4, ','))`)
    // Inside the aggregate, not outside it: applied after the grouping, a
    // narrowed account would be handed the company's champion and then shown
    // an empty wall when that person failed the filter.
    expect(filtered.indexOf('string_to_array($4')).toBeLessThan(filtered.indexOf('GROUP BY'))
  })
})
