import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WHAT THE CUSTOMER-FLOW STATEMENT PROMISES.
 *
 * Three arms over one pair of CTEs — the window's totals, its series, and
 * where its new customers came from — so no two blocks on the band can
 * disagree about the same window.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
  'utf8',
)

function flowSql(): string {
  const at = SOURCE.indexOf('async customerFlow(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

function code(): string {
  return flowSql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the customer flow statement', () => {
  it('cohorts on the order date and never on the delivered date', () => {
    /*
      The client chose «buyurtma bergan sana» over the delivered date. The
      cohort matrix on the same screen legitimately uses the other clock and
      prints a different customer total; each states its own in its heading.
    */
    expect(code()).toMatch(/"createdAtSource"/)
    expect(code()).not.toMatch(/"closedAt"/)
  })

  it('counts customers, never rows', () => {
    // A customer with two orders in a month is one customer.
    expect(code()).not.toMatch(/count\(\*\)\s+AS\s+(new|returning|active)_customers/i)
    expect([...code().matchAll(/count\(DISTINCT\s+cid\)/gi)].length).toBeGreaterThanOrEqual(4)
  })

  it('decides new against the customer’s FIRST EVER order, not the window’s', () => {
    /*
      `first_ts` is a min() over the whole history with no date bound. Bounded
      to the window, every customer in it would look new and the returning
      count would be zero — the exact inversion this band exists to prevent.
    */
    const cte = code().slice(code().indexOf('ranked AS ('), code().indexOf('win AS ('))
    expect(cte).toMatch(/min\(ts\)\s+OVER\s*\(\s*PARTITION BY cid\s*\)/i)
    expect(cte).not.toMatch(/\$1|\$2/)
  })

  it('breaks the rn = 1 tie deterministically, on the deal id', () => {
    /*
      Two orders at the same instant with the same (possibly NULL) source
      otherwise leave rn = 1 to whichever row the planner happens to produce
      first, which decides both the credited source and the first/repeat
      revenue split from a replan to the next.
    */
    const cte = code().slice(code().indexOf('ranked AS ('), code().indexOf('win AS ('))
    expect(cte).toMatch(/ORDER BY ts, sid NULLS LAST, deal_id/i)
  })

  it('classifies new and returning per BUCKET, AND against the window start — both, never either alone', () => {
    /*
      The bucket comparison alone is sufficient only when the window starts
      on a grain boundary, which a custom range need not: $1 = 2026-01-15,
      month grain, a customer whose first order EVER was 2026-01-10 (before
      the window) who orders again on 2026-01-20 (inside it) truncates both
      timestamps to 2026-01-01, so first_bucket = bucket alone would call
      them new although the summary arm correctly calls them returning. The
      window bound the summary arm uses ($1) is not a redundant conjunct
      here — dropping it as "the series arm handles buckets now" reopens
      exactly this mismatch between the tile and the chart under it.
    */
    const firstUnion = code().indexOf('UNION ALL')
    const secondUnion = code().indexOf('UNION ALL', firstUnion + 1)
    const series = code().slice(firstUnion, secondUnion)
    expect(series).toMatch(/FILTER \(WHERE first_ts >= \$1 AND first_bucket = bucket\)/i)
    expect(series).toMatch(/FILTER \(WHERE first_ts < \$1 OR first_bucket < bucket\)/i)
  })

  it('bounds the window half-open, the way every other period query does', () => {
    expect(code()).toMatch(/ts\s*>=\s*\$1/i)
    expect(code()).toMatch(/ts\s*<\s*\$2/i)
  })

  it('filters status ONLY for money', () => {
    /*
      A refused order is an arrival, not a soʻm. Every headcount counts it;
      every revenue figure does not. 26% of revenue-pipeline orders never
      reach WON, so a status filter in the wrong place moves 26% of the band.
    */
    for (const m of code().matchAll(/'WON'/g)) {
      const i = m.index ?? 0
      const around = code().slice(Math.max(0, i - 120), i + 40)
      expect(around).toMatch(/sum\(|count\(DISTINCT cid\) FILTER \(WHERE first_ts/i)
    }
  })

  it('splits first-order money from later money in ONE pass', () => {
    // Two FILTERs over the same CTE, not two scans — the shape `cohorts`
    // settled on for exactly this split.
    expect(code()).toMatch(/FILTER \(WHERE rn = 1\b/i)
    expect(code()).toMatch(/FILTER \(WHERE rn > 1\b/i)
  })

  it('takes the series grain as a parameter, not by string surgery', () => {
    // date_trunc accepts the unit as a text parameter. Interpolating it would
    // put a caller's string into the statement for no gain.
    expect(code()).toMatch(/date_trunc\(\$3/i)
  })

  it('buckets in Asia/Tashkent, like every other window in the product', () => {
    expect(code()).toMatch(/AT TIME ZONE 'UTC' AT TIME ZONE \$4/i)
  })

  it('attributes a new customer to their FIRST order’s source', () => {
    /*
      Marketing attribution is about where the customer came from, not where
      their third order was logged — «База клиент» is a source that only ever
      appears on repeat orders.
    */
    const sources = code().slice(code().lastIndexOf('UNION ALL'))
    expect(sources).toMatch(/rn = 1/i)
  })

  it('never drops the sourceless row', () => {
    // 1.7% of orders carry no source. Dropped, the source rows stop summing
    // to the new-customer total and the block silently lies about its own
    // denominator.
    expect(code()).toMatch(/LEFT JOIN "sales_source"/i)
  })

  it('names countsAsRevenue explicitly', () => {
    expect(code()).toMatch(/"countsAsRevenue"/)
  })

  it('walks the deal table once', () => {
    // 18 392 revenue deals — small enough that the window-function sort that
    // was too expensive for `cohorts` (180 000 rows against 2 MB work_mem) is
    // the cheaper shape here. A second walk would be a regression.
    expect([...code().matchAll(/FROM\s+"deal"/gi)].length).toBe(1)
  })
})

function ratesSql(): string {
  const at = SOURCE.indexOf('async sourceRepeatRates(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the source repeat-rate statement', () => {
  it('gives every customer a complete 90-day horizon', () => {
    /*
      THE HORIZON IS NOT COSMETIC. Measured without it over the last 365 days
      the same sources read 8.0 / 10.2 / 14.0 against 12.4 / 16.9 / 15.6 with
      it, and «База клиент» reads 19.6 against 40.3 — every source understated,
      because a customer acquired last month is counted as having failed to
      return. The concentration card on the same screen already uses this rule.
    */
    expect(ratesSql()).toMatch(/interval '90 days'/i)
  })

  it('takes no period', () => {
    // A source's repeat rate is a property of the source, not of the window
    // the reader picked. It must not move with the period control.
    expect(ratesSql()).not.toMatch(/\$1|\$2/)
  })

  it('attributes on the FIRST order and counts customers once', () => {
    expect(ratesSql()).toMatch(/rn = 1/i)
    expect(ratesSql()).toMatch(/orders\s*>\s*1/i)
  })

  it('keeps the sourceless row', () => {
    expect(ratesSql()).toMatch(/LEFT JOIN "sales_source"/i)
  })

  it('names countsAsRevenue explicitly', () => {
    expect(ratesSql()).toMatch(/"countsAsRevenue"/)
  })

  it('breaks the rn = 1 tie deterministically, on the deal id', () => {
    /*
      Two orders at the same instant with the same (possibly NULL) source
      otherwise leave rn = 1 to whichever row the planner happens to produce
      first — and here that decides which source is credited with acquiring
      the customer, which is the entire output of this method.
    */
    expect(ratesSql()).toMatch(/ORDER BY ts, sid NULLS LAST, deal_id/i)
  })
})
