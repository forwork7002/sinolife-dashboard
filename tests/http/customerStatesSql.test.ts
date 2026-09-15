import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WHAT THE CUSTOMER-STATE STATEMENT PROMISES.
 *
 * Two verdicts on the same people — the order dates against the portal's open
 * База stage — printed side by side and never reconciled. Everything that
 * could quietly turn that into one wrong number is pinned here.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
  'utf8',
)

function statesSql(): string {
  const at = SOURCE.indexOf('async customerStates(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

/** The statement with every comment stripped, so prose cannot satisfy a test. */
function code(): string {
  return statesSql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the customer state statement', () => {
  it('counts a customer once, in their BEST portal bucket', () => {
    // A customer on two open База deals is one customer. Summing the ladder
    // double-counts them — the error `retentionStages` already documents.
    expect(code()).toMatch(/min\(\s*bucket\s*\)/i)
  })

  it('reads only OPEN retention deals', () => {
    // «База · Успешно» holds 1 314 customers and 0 open deals: a closed deal
    // is a finished cadence, not a verdict about the customer today.
    expect(code()).toMatch(/"role"\s*=\s*'RETENTION'/i)
    expect(code()).toMatch(/"status"\s*=\s*'OPEN'/i)
  })

  it('takes the day thresholds as parameters, never as literals', () => {
    /*
      60 and 150 live in src/lib/customerStates.ts, which the screen reads
      too. A number typed into this statement is a second definition that
      agrees right up until somebody moves one.
    */
    expect(code()).toMatch(/make_interval\(days\s*=>\s*\$1::int\)/i)
    expect(code()).toMatch(/make_interval\(days\s*=>\s*\$2::int\)/i)
    expect(code()).not.toMatch(/\b150\b/)
  })

  it('keeps every Customer in the denominator, including those never in База', () => {
    // Without the LEFT JOIN the two columns have different denominators and
    // invite a reconciliation that cannot come out — 4 453 people today.
    expect(code()).toMatch(/LEFT JOIN/i)
  })

  it('cohorts on the ORDER date, not on the delivered date', () => {
    expect(code()).toMatch(/"createdAtSource"/)
    expect(code()).not.toMatch(/"closedAt"/)
  })

  it('names countsAsRevenue explicitly', () => {
    // A forgotten filter pulls 13 474 duplicate База deals in and the result
    // looks entirely plausible.
    expect(code()).toMatch(/"countsAsRevenue"/)
  })

  it('reports unrecognised stages rather than swallowing them', () => {
    // `code()` strips comments from the SQL source text, and the SQL never
    // spells the bucket as a literal digit — it interpolates the constant.
    // Reading the source text is the point: a `9` typed in place of the
    // import would satisfy a test that matched the digit but not this one.
    expect(code()).toMatch(/\$\{UNBUCKETED_BUCKET\}/)
    expect(statesSql()).toMatch(/UNION ALL/i)
  })
})
