import { describe, expect, it } from 'vitest'

import { createSyncHandlers, SweepRefusedError, sweepLimit } from '@/server/integrations/crm/sync/handlers'

/*
  THE DAILY SWEEP DELETES WHAT THE WALK DID NOT RETURN — SO A SHORT WALK MUST
  NOT BE BELIEVED.

  Bitrix24 applies a role change silently: a webhook user who loses sight of a
  pipeline gets a complete, error-free walk without that pipeline's deals. The
  sweep refused only an EMPTY walk, so 184 580 Регистрация deals would have
  been deleted, their stage history with them, and never read again.
*/

/** A transaction that records statements; the count answers `stored` / `gone`. */
function db(stored: number, gone: number) {
  const statements: string[] = []
  let transactions = 0
  const tx = {
    $executeRawUnsafe: async (sql: string) => {
      statements.push(sql)
      return sql.startsWith('DELETE') ? gone : 0
    },
    $queryRawUnsafe: async (sql: string) => {
      statements.push(sql)
      return [{ stored: BigInt(stored), gone: BigInt(gone) }]
    },
  }
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      transactions += 1
      return fn(tx)
    },
  }
  const handlers = createSyncHandlers(prisma as never, 'BITRIX24')
  const sweep = (entity: string) => handlers.find((h) => h.entity === entity)!.deleteMissing!
  return { statements, sweep, transactions: () => transactions }
}

const live = (n: number) => new Set(Array.from({ length: n }, (_, i) => String(i + 1)))

describe('sweepLimit', () => {
  it('is 1% of the deals, never under 500', () => {
    expect(sweepLimit(10_000)).toBe(500)
    expect(sweepLimit(464_396)).toBe(4_644)
  })
})

describe('the daily deal sweep', () => {
  it('refuses a walk missing a pipeline, and deletes nothing', async () => {
    const { statements, sweep } = db(10_000, 3_000)

    const refused = await sweep('DEALS')(live(7_000)).catch((e: unknown) => e)

    expect(refused).toBeInstanceOf(SweepRefusedError)
    expect(refused).toMatchObject({ seen: 7_000, stored: 10_000, gone: 3_000, limit: 500 })
    expect((refused as Error).message).toMatch(/hech narsa oʻchirilmadi/)
    expect(statements.some((s) => s.startsWith('DELETE'))).toBe(false)
  })

  it('deletes what a healthy day deleted, exactly as before', async () => {
    const { statements, sweep } = db(10_000, 20)

    expect(await sweep('DEALS')(live(9_980))).toBe(20)

    const count = statements.find((s) => s.includes('AS gone'))!
    const remove = statements.find((s) => s.startsWith('DELETE'))!
    // The guard counted the very rows the DELETE removes.
    expect(count).toContain(remove.slice('DELETE '.length))
    expect(remove).toMatch(/^DELETE FROM "deal" AS t\s+WHERE t\."externalSource" = \$1::"ExternalSource"/)
    expect(remove).toContain('NOT EXISTS (SELECT 1 FROM "sync_live_ids" l')
  })

  it('still refuses an empty walk without opening a transaction', async () => {
    const { sweep, transactions } = db(10_000, 10_000)
    expect(await sweep('DEALS')(new Set())).toBe(0)
    expect(transactions()).toBe(0)
  })

  it('leaves the other sweepers as they were', async () => {
    const { statements, sweep } = db(10_000, 3_000)
    expect(await sweep('CUSTOMERS')(live(7_000))).toBe(3_000)
    expect(statements.some((s) => s.includes('AS gone'))).toBe(false)
  })
})
