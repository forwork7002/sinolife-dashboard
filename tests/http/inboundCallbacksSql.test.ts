import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InboundCallsRepository } = await import('@/server/repositories/inboundCallsRepository')

/** The callbacks of «javobsiz qoldi»: what the statement is handed, and its shape on a month's numbers. */
describe('InboundCallsRepository.outboundTo', () => {
  function recording() {
    const seen: { sql: string; params: unknown[] }[] = []
    const prisma = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        seen.push({ sql, params })
        return []
      },
    } as unknown as PrismaClient
    return { repo: new InboundCallsRepository(prisma), seen }
  }

  it('asks each number after its own call, bounded below by the earliest, as a join', async () => {
    const { repo, seen } = recording()
    const a = new Date('2026-10-06T05:00:00Z')
    const b = new Date('2026-10-06T07:00:00Z')
    await repo.outboundTo([
      { key: '901110002', after: b },
      { key: '901110001', after: a },
    ])
    const [{ sql, params }] = seen as [{ sql: string; params: unknown[] }]
    expect(params).toEqual([a, ['901110002', '901110001'], [b, a]])
    // Every bound parameter is used and typed.
    expect(sql).toContain('$1')
    expect(sql).toContain('unnest($2::text[], $3::timestamptz[])')
    // A hash join on the key, never a per-row ANY over thousands of numbers.
    expect(sql).not.toMatch(/=\s*ANY/)
    expect(sql).toContain(`right(regexp_replace(r."phoneNumber", '[^0-9]', '', 'g'), 9)`)
    expect(sql).toContain(`r."direction" = 'OUTBOUND'`)
  })

  it('asks nothing for nobody', async () => {
    const { repo, seen } = recording()
    expect(await repo.outboundTo([])).toEqual([])
    expect(seen).toEqual([])
  })
})
