import { describe, expect, it } from 'vitest'

// The SQL-shape preamble every such test carries: `env` refuses to load without these.
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

const reach = InsightsRepository as unknown as {
  queueSql: (mode: string, scopeParam: string) => string
  sverkaCohortSql: () => string
}

const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

/**
 * «Sverka»'s FAKT 1 / FAKT 2 must be Savdo dinamikasi's to the soʻm, so its
 * cohort is the queue prelude itself and its flags the rating's constants.
 */
describe('sverkaCohortSql', () => {
  const TAIL = bare(reach.sverkaCohortSql())

  it('reads the scoped queue cohort, never re-deriving it', () => {
    expect(TAIL).toContain('FROM scoped c')
    expect(TAIL).not.toMatch(/deal_stage_history/)
  })

  it('flags FAKT 1 with the rating outcomes and FAKT 2 with the delivered role', () => {
    expect(TAIL).toContain(`c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')`)
    expect(TAIL).toContain(`ds."logisticsRole" = 'DELIVERED'`)
  })

  it('reads the CURRENT stage, as FAKT 2 does everywhere', () => {
    expect(TAIL).toMatch(/JOIN "deal_stage" ds ON ds\."id" = d\."stageId"/)
  })

  it('carries the deal id MoySklad stamps on its order', () => {
    expect(TAIL).toContain('d."externalId" AS external_id')
  })

  it('carries the deal\'s region and its team at the sale, which MoySklad copies', () => {
    expect(TAIL).toContain('d."region" AS region')
    expect(TAIL).toMatch(/d\."operatorTeamSource"[\s\S]*AS rop_source/)
  })

  it('binds the window and the scope as the other queue readers do', () => {
    expect(bare(reach.queueSql('window', '$3'))).toContain('$3')
  })
})
