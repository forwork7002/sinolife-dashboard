import { describe, expect, it } from 'vitest'

import type { DealItemsOptions, DealItemsPage, RawDeal, RawDealItem } from '@/server/integrations/crm/CrmProvider'
import { createSyncHandlers, surplusLineLimit } from '@/server/integrations/crm/sync/handlers'
import { SyncEngine, type SyncStore } from '@/server/integrations/crm/sync/SyncEngine'

/*
  A LINE THE PORTAL NO LONGER LISTS LEAVES THE TABLE.

  Bitrix24 gives product rows no id, so a line is keyed by its POSITION
  (`${dealId}-${index}`), and the upsert only ever wrote what came back. An
  order that went from [Collagen, Zextra] to [Zextra] kept a second Zextra at
  position 1 for good — its lines summed past its amount, and margin counted
  that revenue and cost twice.
*/

interface Line {
  readonly id: string
  readonly externalId: string
  readonly dealId: string
  readonly productId: string
}

const dealIdOf = (externalId: string) => `deal-${externalId}`
const externalOf = (dealId: string) => dealId.replace(/^deal-/, '')

/** An in-memory `deal_item`, driven by the statements' bound parameters. */
function database() {
  const lines = new Map<string, Line>()
  const statements: string[] = []

  const scoped = (dealIds: readonly string[]) =>
    [...lines.values()].filter((line) => dealIds.includes(externalOf(line.dealId)))

  const prisma = {
    dealItem: { findMany: async () => [...lines.values()].map((l) => ({ externalId: l.externalId })) },
    product: { upsert: async () => ({ id: 'p-revived' }) },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      statements.push(sql)
      if (sql.startsWith('INSERT INTO "deal_item"')) {
        const columns = /\(([^)]*)\)/.exec(sql)![1]!.split(', ').map((c) => c.replace(/"/g, ''))
        for (let i = 0; i < params.length; i += columns.length) {
          const row = Object.fromEntries(columns.map((c, k) => [c, params[i + k]])) as Record<string, string>
          const prior = lines.get(row.externalId!)
          lines.set(row.externalId!, {
            id: prior?.id ?? row.id!,
            externalId: row.externalId!,
            dealId: row.dealId!,
            productId: row.productId!,
          })
        }
        return params.length / columns.length
      }
      if (sql.startsWith('DELETE FROM "deal_item"')) {
        const [, dealIds, kept] = params as [string, string[], string[]]
        const doomed = scoped(dealIds).filter((l) => !kept.includes(l.externalId))
        for (const line of doomed) lines.delete(line.externalId)
        return doomed.length
      }
      throw new Error(`unexpected statement: ${sql.slice(0, 60)}`)
    },
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      statements.push(sql)
      const [, dealIds, kept] = params as [string, string[], string[]]
      const rows = scoped(dealIds)
      return [{ stored: BigInt(rows.length), surplus: BigInt(rows.filter((l) => !kept.includes(l.externalId)).length) }]
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }
  const resolver = {
    mapFor: async (_entity: string, ids: readonly (string | null | undefined)[]) =>
      new Map(ids.filter((id): id is string => !!id).map((id) => [id, dealIdOf(id)])),
    map: async () => new Map([['676', 'p-collagen'], ['677', 'p-zextra']]),
    invalidate: () => {},
    isCached: () => false,
  }
  return { prisma, resolver, lines, statements }
}

const line = (dealId: string, index: number, product: '676' | '677'): RawDealItem => ({
  externalId: `${dealId}-${index}`,
  dealExternalId: dealId,
  productExternalId: product,
  quantity: 1,
  unitPriceMinor: 15_000_000n,
  totalMinor: 15_000_000n,
})

const store: SyncStore = {
  beginRun: async ({ entity, mode }) => ({ id: 'run', entity, mode }),
  finishRun: async () => {},
  getCursor: async () => undefined,
  setCursor: async () => {},
}

/** One DEAL_ITEMS run through the real engine, answering `page` and recording what was asked. */
function runner(db: ReturnType<typeof database>) {
  const handlers = createSyncHandlers(db.prisma as never, 'BITRIX24', db.resolver as never)
  const asked: DealItemsOptions[] = []
  let next: DealItemsPage = { items: [] }
  const provider = {
    source: 'BITRIX24',
    capabilities: { DEAL_ITEMS: true },
    fetchDealItems: async (options: DealItemsOptions = {}) => {
      asked.push(options)
      return next
    },
  }
  const engine = new SyncEngine({ provider: provider as never, store, handlers })
  return {
    handlers,
    asked,
    run: (page: DealItemsPage) => {
      next = page
      return engine.runEntity('DEAL_ITEMS', 'INCREMENTAL')
    },
  }
}

const productsOf = (lines: Map<string, Line>) =>
  Object.fromEntries([...lines.values()].map((l) => [l.externalId, l.productId]).sort())

describe('line items follow the portal', () => {
  it('drops the line an order lost, rather than keeping two of the one it kept', async () => {
    const db = database()
    const { run } = runner(db)

    await run({ items: [line('1001', 0, '676'), line('1001', 1, '677')], dealsRead: ['1001'] })
    expect(productsOf(db.lines)).toEqual({ '1001-0': 'p-collagen', '1001-1': 'p-zextra' })

    // Collagen taken off the order: the portal now lists Zextra alone, at 0.
    const r = await run({ items: [line('1001', 0, '677')], dealsRead: ['1001'] })
    expect(productsOf(db.lines)).toEqual({ '1001-0': 'p-zextra' })
    expect(r.status).toBe('SUCCESS')
  })

  it('empties an order the portal answers with no lines at all', async () => {
    const db = database()
    const { run } = runner(db)
    await run({ items: [line('1001', 0, '676'), line('1001', 1, '677')], dealsRead: ['1001'] })

    await run({ items: [], dealsRead: ['1001'] })
    expect(db.lines.size).toBe(0)
  })

  it('touches no deal the provider did not read in full', async () => {
    const db = database()
    const { run } = runner(db)
    await run({ items: [line('1002', 0, '676'), line('1002', 1, '677')], dealsRead: ['1002'] })

    // A page that does not vouch for 1002 — and one that vouches for nothing.
    await run({ items: [line('1001', 0, '676')], dealsRead: ['1001'] })
    await run({ items: [line('1002', 0, '677')] })
    expect(Object.keys(productsOf(db.lines))).toEqual(['1001-0', '1002-0', '1002-1'])
  })

  it('refuses a reconciliation that would take most of the lines, and deletes nothing', async () => {
    const db = database()
    const { run } = runner(db)
    const many = Array.from({ length: 40 }, (_, i) => line('1003', i, '676'))
    await run({ items: many, dealsRead: ['1003'] })

    const r = await run({ items: [], dealsRead: ['1003'] })

    expect(db.lines.size).toBe(40)
    expect(db.statements.some((s) => s.startsWith('DELETE'))).toBe(false)
    // Written, then refused: the run reports it rather than calling it clean.
    expect(r.status).toBe('PARTIAL')
  })

  it('counts and deletes ONE population, keyed by the lines the portal listed', async () => {
    const db = database()
    const { run } = runner(db)
    await run({ items: [line('1001', 0, '676'), line('1001', 1, '677')], dealsRead: ['1001'] })
    await run({ items: [line('1001', 0, '677')], dealsRead: ['1001'] })

    const count = db.statements.find((s) => s.includes('AS surplus'))!
    const remove = db.statements.find((s) => s.startsWith('DELETE'))!
    // What the DELETE removes, verbatim, is what the guard counted.
    const doomed = remove.slice(remove.indexOf('SELECT t."id" ') + 'SELECT t."id" '.length, remove.lastIndexOf(')'))
    expect(count).toContain(doomed)
    expect(doomed).toContain('d."externalId" = ANY($2::text[])')
    expect(doomed).toContain('NOT EXISTS')
    expect(doomed).toContain('unnest($3::text[])')
  })

  it('is at least 25 lines, or a twentieth of what the deals hold', () => {
    expect(surplusLineLimit(0)).toBe(25)
    expect(surplusLineLimit(400)).toBe(25)
    expect(surplusLineLimit(60_000)).toBe(3_000)
  })
})

describe('an order that lost all its money', () => {
  function dealsPass(db: ReturnType<typeof database>, stored: { externalId: string; amountMinor: bigint }[]) {
    const prisma = {
      ...db.prisma,
      employee: { findMany: async () => [] },
      pipeline: { findMany: async () => [] },
      deal: {
        findMany: async () => stored.map((s) => ({ id: dealIdOf(s.externalId), employeeId: 'emp', ...s })),
      },
      dealOwnerChange: { createMany: async () => ({ count: 0 }) },
      // The deal rows themselves are not under test here.
      $executeRawUnsafe: async (sql: string, ...params: unknown[]) =>
        sql.startsWith('INSERT INTO "deal" (') ? 1 : db.prisma.$executeRawUnsafe(sql, ...params),
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    }
    const maps: Record<string, Map<string, string>> = {
      dealStage: new Map([['C6:NEW', 'stage']]),
      employee: new Map([['5', 'emp']]),
      salesSource: new Map(),
      pipeline: new Map([['6', 'delivery']]),
    }
    const resolver = { ...db.resolver, map: async (e: string) => maps[e] ?? new Map() }
    return { prisma, resolver }
  }

  const deal = (externalId: string, amountMinor: bigint): RawDeal => ({
    externalId,
    title: externalId,
    amountMinor,
    currency: 'UZS',
    stageExternalId: 'C6:NEW',
    status: 'OPEN',
    employeeExternalId: '5',
    pipelineExternalId: '6',
    countsAsRevenue: true,
    createdAtSource: new Date('2026-10-06T08:00:00Z'),
    updatedAtSource: new Date('2026-10-06T09:00:00Z'),
  })

  it('is read for line items once, although the provider reads only deals carrying money', async () => {
    const db = database()
    const { prisma, resolver } = dealsPass(db, [
      { externalId: '1001', amountMinor: 15_000_000n },
      { externalId: '1002', amountMinor: 0n },
    ])
    const handlers = createSyncHandlers(prisma as never, 'BITRIX24', resolver as never)
    const asked: DealItemsOptions[] = []
    const provider = {
      source: 'BITRIX24',
      capabilities: { DEAL_ITEMS: true },
      fetchDealItems: async (options: DealItemsOptions = {}) => {
        asked.push(options)
        return { items: [], dealsRead: options.dealExternalIds ?? [] }
      },
    }
    const engine = new SyncEngine({ provider: provider as never, store, handlers })

    // 1001 lost its money, 1002 never had any, 1003 is new.
    await handlers
      .find((h) => h.entity === 'DEALS')!
      .persist([deal('1001', 0n), deal('1002', 0n), deal('1003', 0n)])
    await engine.runEntity('DEAL_ITEMS', 'INCREMENTAL')
    await engine.runEntity('DEAL_ITEMS', 'INCREMENTAL')

    expect(asked[0]?.dealExternalIds).toEqual(['1001'])
    expect(asked[1]?.dealExternalIds).toBeUndefined()
  })
})
