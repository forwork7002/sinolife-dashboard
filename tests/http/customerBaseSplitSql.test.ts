import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WHAT THE БАЗА SPLIT PROMISES.
 *
 * A two-way partition of BUYERS by whether they have any deal in the retention
 * funnel. Its own statement, and not a CTE on `customerStates`, because that
 * statement's test records a decision (commit 35aca08) that it no longer reads
 * the funnel at all — `retentionStages` owns that reading.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
  'utf8',
)

function splitSql(): string {
  const at = SOURCE.indexOf('async customerBaseSplit(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

function code(): string {
  return splitSql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the база split statement', () => {
  it('carries no backtick inside the SQL', () => {
    expect(splitSql()).not.toContain('`')
  })

  it('asks for the retention pipeline by ROLE, never by a category id', () => {
    expect(code()).toMatch(/p\."role"\s*=\s*'RETENTION'/i)
    expect(code()).not.toMatch(/CATEGORY_ID|"categoryId"/i)
  })

  it('names countsAsRevenue on the buyers and NOT on the base', () => {
    /*
      RETENTION is precisely the role that does not count toward revenue, so
      filtering the base on it would empty the CTE and print every buyer as
      «Bazada yoʻq».
    */
    const sql = code()
    const cust = sql.slice(sql.indexOf('cust AS ('), sql.indexOf('based AS ('))
    const based = sql.slice(sql.indexOf('based AS ('), sql.lastIndexOf('SELECT'))
    expect(cust).toMatch(/"countsAsRevenue"/)
    expect(based).not.toMatch(/"countsAsRevenue"/)
  })

  it('partitions in one pass, so the halves sum to the buyer total', () => {
    const sql = code()
    expect(sql).toMatch(/FROM cust c\s+LEFT JOIN based b/i)
    expect(sql).toMatch(/FILTER \(WHERE b\.cid IS NOT NULL\)/i)
    expect(sql).toMatch(/FILTER \(WHERE b\.cid IS NULL\)/i)
  })

  it('reads membership, never the stage partition', () => {
    expect(code()).not.toMatch(/deal_stage/i)
  })
})

describe('customerStates is left exactly as 35aca08 decided', () => {
  it('still does not read the retention funnel', () => {
    const at = SOURCE.indexOf('async customerStates(')
    const open = SOURCE.indexOf('`\n', at)
    const close = SOURCE.indexOf('\n      `,', open)
    const states = SOURCE.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(states).not.toMatch(/'RETENTION'/)
  })
})
