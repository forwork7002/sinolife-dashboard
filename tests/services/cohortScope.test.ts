import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The scope parameter that was passed and never read.
 *
 * `cohorts()` built `{ months, restrictToEmployeeIds }` and handed it to a
 * repository method typed `{ months: number }`, whose statement contains no
 * employee predicate. Excess-property checking does not fire on a variable, so
 * this compiled and was silently discarded for as long as it existed.
 *
 * This test pins the DELETION, because the natural repair is to add the
 * parameter back. A cohort is a company-wide fact about a customer: their
 * purchases are spread across sellers and months, so «did this seller's
 * customers come back» is a question about customers that seller no longer
 * owns.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/services/insightsService.ts'),
  'utf8',
)

/** The body of `InsightsService.cohorts`, up to the next method. */
function cohortsMethod(): string {
  const at = SOURCE.indexOf('  async cohorts(')
  expect(at).toBeGreaterThan(-1)
  const next = SOURCE.indexOf('\n  /**', at)
  expect(next).toBeGreaterThan(at)
  return SOURCE.slice(at, next)
}

describe('the cohort service', () => {
  it('takes no employee scope', () => {
    expect(cohortsMethod()).not.toMatch(/EmployeeScopeFilter|restrictToEmployeeIds/)
  })

  it('says why it is unscoped, so it is not re-added as an oversight', () => {
    expect(cohortsMethod()).toMatch(/company-wide|unscoped/i)
  })
})
