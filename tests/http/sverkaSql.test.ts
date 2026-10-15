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

const { SverkaRepository } = await import('@/server/repositories/sverkaRepository')

/**
 * The worker's product re-read: each deal's NEWEST MoySklad order — the one
 * `compareDeal` reads — beside the rows stored for it, and only for a deal
 * whose rows were last read before the cutoff.
 */
describe('productCheckRows', () => {
  const OMEGA = '-n3II3IBjoS45bviltfkN0'
  const line = (productCode: string, quantity: number) => ({
    productCode,
    productName: 'Omega Sinolife 500',
    quantity,
    totalMinor: 0n,
  })

  it('pairs a deal\'s newest order in reach with its rows, asking only for rows read before the cutoff', async () => {
    const calls: { sql: string; params: unknown[] }[] = []
    let query: unknown
    const prisma = {
      moyskladOrder: {
        findMany: async (args: unknown) => {
          query = args
          return [
            { bitrixDealId: '1052240', moment: new Date('2026-10-02T09:00:00Z'), items: [] },
            { bitrixDealId: '1050902', moment: new Date('2026-10-01T09:00:00Z'), items: [line(OMEGA, 1)] },
            // An older order of 1052240: not the one compared.
            { bitrixDealId: '1052240', moment: new Date('2026-10-01T08:00:00Z'), items: [line(OMEGA, 1)] },
          ]
        },
      },
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params })
        if (sql.includes('HAVING')) return [{ id: 'd2', external_id: '1052240' }]
        return [{ deal_id: 'd2', code: OMEGA, name: 'Omega Sinolife 500', quantity: 1, total: '0' }]
      },
    }
    const since = new Date('2026-06-17T13:00:00Z')
    const cutoff = new Date('2026-10-14T13:00:00Z')

    const rows = await new SverkaRepository(prisma as never).productCheckRows(since, cutoff)

    expect(query).toMatchObject({
      where: { bitrixDealId: { not: null }, moment: { gte: since } },
      orderBy: [{ moment: 'desc' }, { updatedAtSource: 'desc' }],
    })
    expect(calls[0]!.params).toEqual([['1052240', '1050902'], cutoff])
    expect(bare(calls[0]!.sql)).toMatch(/HAVING max\(i\."updatedAt"\) < \$2::timestamp/)
    expect(calls[1]!.params).toEqual([['d2']])
    expect(rows).toEqual([
      {
        dealId: '1052240',
        moment: new Date('2026-10-02T09:00:00Z'),
        bitrix: [{ code: OMEGA, name: 'Omega Sinolife 500', quantity: 1, totalMinor: 0n }],
        moysklad: [],
      },
    ])
  })
})
