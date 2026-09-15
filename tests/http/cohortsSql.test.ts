import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WHAT THE COHORT STATEMENT PROMISES, AND ONE THING IT DELIBERATELY DOES NOT.
 *
 * `/insights/cohorts` is the slowest endpoint in the product — 1587ms p50,
 * measured on production on 2026-09-11 — and it reads `deal` TWICE: once
 * grouped by customer to find each cohort, then again joined back to place
 * every purchase against it.
 *
 * THAT SECOND WALK WAS REMOVED AND PUT BACK THE SAME DAY, which is why this
 * file exists at all. `min(month) OVER (PARTITION BY customer_id)` does it in
 * one pass, the arithmetic is sound (`date_trunc` to month is monotonic, so
 * `min(date_trunc(x)) = date_trunc(min(x))`), and on the 1 600-row dev seed it
 * halved the buffers — 268 → 128 — with all 148 rows byte-identical. In
 * production it was 48% SLOWER: ~2350ms against 1587ms, measured the same way
 * on the same day with every other endpoint back at its baseline. The window
 * function has to sort ~180 000 rows by customer_id, and against `work_mem` on
 * a db-s-1vcpu-1gb that sort spills to disk; an external merge sort on one
 * vCPU costs more than the heap scan it saved.
 *
 * So the tests below pin the things that are TRUE of this statement regardless
 * of which shape it takes, and none of them asserts a scan count. The lever on
 * this endpoint is the scan itself — a covering index — not the join.
 */

const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
  'utf8',
)

/** The template literal `cohorts()` hands to `$queryRawUnsafe`. */
function cohortsSql(): string {
  const at = SOURCE.indexOf('async cohorts(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

/** The statement with every comment stripped, so prose cannot satisfy a test. */
function code(): string {
  return cohortsSql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the cohort statement', () => {
  it('counts each cohort\u2019s returners once, whatever shape the query takes', () => {
    /*
      A customer who returned in +1 AND +3 is ONE returner. Summing the matrix
      cells double-counts them and taking the first cell counts only the ones
      who came back immediately — measured on this database, 320 against 751.
      The guarantee moved from a `count(DISTINCT customer_id)` aggregate to a
      `GROUP BY (cohort, customer_id)` in `first_return` — same one-pass
      grouping, and now it also carries each customer's FIRST offset.
    */
    expect(code()).toMatch(/GROUP BY cohort, customer_id/i)
    expect(code()).toMatch(/WHERE months_since > 0/i)
  })

  it('walks the deal table no more than twice', () => {
    /*
      Two is the measured shape. This is a CEILING, not a target: a third pass
      would be a regression nobody intended, while dropping to one has been
      tried and was slower in production — see the note at the top of this file
      before trying it again.
    */
    const from = [...code().matchAll(/FROM\s+"deal"/gi)]
    expect(from.length).toBeLessThanOrEqual(2)
  })

  it('splits first-month from later money in ONE pass, not two subqueries', () => {
    // These were two scalar subqueries over the same materialised CTE. The two
    // arms partition it, so one aggregate with FILTER answers both.
    const totals = code().slice(code().indexOf('revenue_totals AS ('))
    expect(totals).toMatch(/FILTER \(WHERE months_since = 0\)/i)
    expect(totals).toMatch(/FILTER \(WHERE months_since > 0\)/i)
  })

  it('bounds the matrix rows and NOT the whole-history totals', () => {
    /*
      `months` says how far back the grid starts. The four tiles above it say
      «butun tarix» and must not inherit that bound — a customer whose first
      order predates the cut is a real customer with real repeat revenue.
      One `make_interval` in the statement, on the row arm only.
    */
    const sql = code()
    expect([...sql.matchAll(/make_interval\(months =>/g)]).toHaveLength(1)
    const totalsArm = sql.slice(sql.indexOf('1 AS is_total'))
    expect(totalsArm).not.toContain('make_interval')
  })

  it('reads the horizon from the clock, never from the newest row', () => {
    // A month with no first-time buyer emits no cohort row, so the newest key
    // in the data is not "now" — the service read it as one and elapsed months
    // rendered as «maʼlumot yoʻq» instead of the measured zero they were.
    expect(code()).toMatch(/date_trunc\('month', \(now\(\) AT TIME ZONE \$1\)\) AS current_month/i)
  })

  it('finds each returning customer’s FIRST return, once', () => {
    /*
      The cumulative curve is a running sum of first returns. Summing the
      monthly cells instead counts a monthly buyer once a month and sends the
      curve past 100%; `min(months_since)` per customer is what walks each
      returning customer in exactly once.
    */
    const sql = code()
    expect(sql).toMatch(/first_return AS \(/i)
    expect(sql).toMatch(/min\(months_since\) AS first_offset/i)
  })

  it('derives the returner headcount from first_return, not from a second DISTINCT', () => {
    /*
      `first_return` already holds one row per returning customer per cohort,
      so counting it is the same answer as `count(DISTINCT customer_id)` over
      `purchases` — and it is the answer this statement has already paid for.
      Doing both would group ~180 000 rows twice to learn one number.
    */
    const returners = code().slice(code().indexOf('returners AS ('))
    expect(returners).toMatch(/FROM first_return/i)
  })

  it('counts orders and customers with DIFFERENT aggregates', () => {
    /*
      A cell says «15 mijoz · 23 ta buyurtma». `count(*)` counts
      revenue-bearing deals, `count(DISTINCT customer_id)` counts people, and
      a cell that blurred them would report a repeat buyer as two customers.
    */
    const rowArm = code().slice(code().indexOf('0 AS is_total'))
    expect(rowArm).toMatch(/count\(\*\)::bigint AS orders/i)
    expect(rowArm).toMatch(/count\(DISTINCT p\.customer_id\)::bigint AS customers/i)
  })

  it('carries the same column list in both UNION arms, in the same order', () => {
    /*
      A UNION ALL matches columns BY POSITION. `ORDER BY 1, 2, 4` is positional
      too. Inserting a column into one arm only would silently transpose the
      whole read rather than fail.
    */
    const sql = code()
    const rowArm = sql.slice(sql.indexOf('0 AS is_total'), sql.indexOf('UNION ALL'))
    const totalsArm = sql.slice(sql.indexOf('1 AS is_total'))
    const aliases = (arm: string) =>
      [...arm.matchAll(/ AS ([a-z_]+),?\n/g)].map((m) => m[1])
    expect(aliases(totalsArm)).toEqual(aliases(rowArm))
  })

  it('narrows by nothing but the month bound — a cohort is a company-wide fact', () => {
    /*
      `InsightsService.cohorts()` used to build an `EmployeeScopeFilter` and
      hand it to a method whose SQL has no employee predicate at all;
      TypeScript missed it because the argument was a variable rather than an
      object literal. It leaked nothing — the route passes no scope — but a
      filter that appears to apply and does not is the one defect this screen
      cannot carry. Deleted rather than implemented: one customer's purchases
      are spread across sellers, so narrowing a retention curve by employee
      produces a figure with no business meaning.
    */
    expect(code()).not.toMatch(/assignee|ownerId|restrictTo|employee/i)
  })
})
