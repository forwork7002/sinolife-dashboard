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
      The DISTINCT is the whole guarantee, and a window function may not take
      one, which is why this is a separate aggregate.
    */
    expect(code()).toMatch(/count\(DISTINCT customer_id\)/i)
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
})
