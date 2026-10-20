import { describe, expect, it } from 'vitest'

/*
  Same preamble as the other SQL-shape tests: the repository reads `env` at
  module scope, and `env` refuses to load without a complete configuration.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * Payroll's blocks walk each ROP team's unit up to the root
 * (`ropAncestorNames` → `payrollBranchOf`). A wrong walk prints teams under
 * «Boshqa» rather than failing, so its shape is pinned here.
 */
const SQL = InsightsRepository.ropAncestorsSql()

describe('ropAncestorsSql', () => {
  it('labels each team as the queue does — «(ROP)» stripped by ropNameSql', () => {
    expect(SQL).toContain(InsightsRepository.ropNameSql('d."name"'))
    // The built string carries the escaped parentheses, not a bare capture group.
    expect(SQL).toContain(String.raw`'\(ROP\)'`)
  })

  it('walks parent by parent, bounded by depth so a parentId cycle ends', () => {
    expect(SQL).toMatch(/WITH RECURSIVE up AS/)
    expect(SQL).toMatch(/JOIN "department" p ON p\."id" = up\.node_id/)
    expect(SQL).toMatch(/up\.depth < 12/)
  })

  it('walks inactive units too, and lists the active unit\'s ancestors first, nearest first', () => {
    // `isActive` is read only as a sort key, never as a filter.
    expect(SQL.match(/"isActive"/g)).toHaveLength(1)
    expect(SQL).toMatch(/d\."isActive" AS active/)
    // The starting unit breaks a tie between two active units under one label.
    expect(SQL).toMatch(/ORDER BY up\.rop, up\.active DESC, up\.start_id, up\.depth/)
  })
})
