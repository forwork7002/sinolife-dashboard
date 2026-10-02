import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { LeadSourcesRepository } = await import('@/server/repositories/leadSourcesRepository')

/*
  «Квал лидлар сони» on «Lidlar» — a Регистрация deal WON in the window, by
  the day it was won: the RNP sheet's kval and the portal's CLOSEDATE filter.
*/
describe('LeadSourcesRepository.qualifiedSources', () => {
  it('counts WON Регистрация deals by closedAt over the half-open window, by source', async () => {
    const seen: { sql: string; params: unknown[] }[] = []
    const client = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        seen.push({ sql, params })
        return [
          { source_id: 'REPEAT_SALE', ai_qualified: false, qualified: 200n },
          { source_id: null, ai_qualified: true, qualified: 40n },
        ]
      },
    }
    const start = new Date('2026-09-29T19:00:00Z')
    const end = new Date('2026-09-30T19:00:00Z')
    const rows = await new LeadSourcesRepository(client as never).qualifiedSources({ start, end } as never)

    expect(rows).toEqual([
      { sourceId: 'REPEAT_SALE', aiQualified: false, qualified: 200 },
      { sourceId: null, aiQualified: true, qualified: 40 },
    ])
    const { sql, params } = seen[0]!
    expect(sql).toMatch(/p\."role" = 'LEAD'/)
    expect(sql).toMatch(/d\."status" = 'WON'/)
    expect(sql).toMatch(/d\."closedAt" >= \$1 AND d\."closedAt" < \$2/)
    expect(sql).toMatch(/d\."aiQualifiedAt" IS NOT NULL/)
    expect(sql).not.toMatch(/createdAtSource/)
    expect(params).toEqual([start, end])
  })
})
