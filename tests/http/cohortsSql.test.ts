import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * THE COHORT STATEMENT READS `deal` ONCE, and that is the whole test.
 *
 * `/insights/cohorts` was measured at 1587ms p50 on production on 2026-09-11 —
 * the slowest endpoint in the product — and it was spending it on reading the
 * same table twice: once grouped by customer to find each cohort, then again
 * joined back to place every purchase against it. On that portal `deal` is
 * ~655 bytes a row and ~448 000 rows, so each pass is ~280 MB of heap against
 * a database with one vCPU and ~256 MB of shared buffers.
 *
 * A window function does it in one pass, and the equivalence that licenses
 * that is arithmetic rather than luck: `date_trunc` to month is monotonic, so
 * `min(date_trunc(x)) = date_trunc(min(x))` — the cohort is the same whether
 * you truncate then take the minimum or take the minimum then truncate.
 *
 * Measured on the dev seed before and after: 148 rows out both times, one raw
 * column differing (`returned` NULL vs 0, which `int()` maps to the same 0),
 * and `Buffers: shared hit` falling 268 → 128.
 *
 * This is pinned as a SHAPE rather than a timing because a timing test on a
 * 1 600-row seed would pass whatever the query did. The failure it exists to
 * catch is somebody re-introducing the join — which reads correctly, returns
 * the right answer, and doubles the cost of the slowest thing on the dashboard.
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
  it('reads the deal table exactly once', () => {
    const from = [...code().matchAll(/FROM\s+"deal"/gi)]
    expect(from).toHaveLength(1)
  })

  it('joins nothing back to a per-customer aggregate', () => {
    // The shape that cost the second walk: `JOIN first_win f ON f.customer_id
    // = d."customerId"`. Any join onto the deal table by customer is the same
    // mistake wearing a different name.
    expect(code()).not.toMatch(/JOIN\s+\w+\s+\w+\s+ON\s+\w+\.customer_id\s*=\s*d\."customerId"/i)
  })

  it('takes the cohort from a window function over the truncated month', () => {
    expect(code()).toMatch(/min\(month\)\s+OVER\s+\(PARTITION BY customer_id\)/i)
  })

  it('counts the size and the returners in one grouping', () => {
    /*
      `sized` and `returners` were two aggregates over the same CTE, so the
      planner sorted it twice. They are one `per_cohort` now — and the DISTINCT
      is what keeps them honest: a customer who returned in +1 and again in +3
      is one returner, not two, and a window function may not take DISTINCT.
    */
    const perCohort = code().slice(code().indexOf('per_cohort AS ('))
    expect(perCohort).toMatch(/count\(DISTINCT customer_id\)::bigint AS size/i)
    expect(perCohort).toMatch(/count\(DISTINCT customer_id\) FILTER \(WHERE months_since > 0\)/i)
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
