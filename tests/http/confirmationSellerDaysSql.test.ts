import { describe, expect, it } from 'vitest'

/* `env` is read at module scope for APP_TIMEZONE — see `confirmationFaktTrendSql.test.ts`. */
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * «Maosh jadvali»'s day columns, held to the payroll's own FAKT 2.
 *
 * A seller's days must add up to the FAKT 2 the payroll pays them on, which
 * is the rating's (`ratingSql`): the same cohort, the same operator, the same
 * delivery test. This file is what proves they are still shared.
 */
const repo = InsightsRepository as unknown as { sellerDaysSql: () => string; ratingSql: (filter: string) => string }
const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const DAYS = bare(repo.sellerDaysSql())
const RATING = bare(repo.ratingSql(''))

describe('the payroll day columns speak the rating’s language', () => {
  it('reads the rating’s cohort and pays the rating’s operator', () => {
    for (const join of [
      'FROM scoped c',
      'JOIN "deal" d ON d."id" = c.deal_id',
      'JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")',
      'LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"',
    ]) {
      expect(DAYS).toContain(join)
      expect(RATING).toContain(join)
    }
  })

  it('counts FAKT 2 as the deal’s current stage carrying the delivery role, as the rating does', () => {
    expect(DAYS).toContain(`ds."logisticsRole" = 'DELIVERED'`)
    expect(DAYS).not.toContain(`d."status" = 'WON'`)
  })

  it('cuts by the arrival in the queue, in the reporting timezone, per operator and team', () => {
    expect(DAYS).toContain('c.queued_at')
    expect(DAYS).toContain(`AT TIME ZONE 'UTC' AT TIME ZONE`)
    expect(DAYS).toContain('c.rop AS rop')
    expect(DAYS).toMatch(/GROUP BY 1, 2, 3/)
  })
})
