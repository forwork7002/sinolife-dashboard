import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WHAT THE CUSTOMER-STATE STATEMENT PROMISES.
 *
 * How long a customer has been silent, on the order clock — nothing about
 * which База stage they sit on. That verdict is already drawn on this
 * screen, by `retentionGroupCaseSql` / `StateBars.tsx`; this statement must
 * not compete with it.
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

  it('cohorts on the ORDER date, not on the delivered date', () => {
    expect(code()).toMatch(/"createdAtSource"/)
    expect(code()).not.toMatch(/"closedAt"/)
  })

  it('names countsAsRevenue explicitly', () => {
    // A forgotten filter pulls 13 474 duplicate База deals in and the result
    // looks entirely plausible.
    expect(code()).toMatch(/"countsAsRevenue"/)
  })

  it('no longer reads the retention funnel at all', () => {
    // Upstream's retentionStages query owns that reading; this one is about
    // order dates. Two statements answering the same question is how they
    // start disagreeing.
    expect(code()).not.toMatch(/'RETENTION'/)
    expect(code()).not.toMatch(/deal_stage/)
  })
})
