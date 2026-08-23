import { describe, expect, it } from 'vitest'

import { DemoCrmProvider } from '@/server/integrations/crm/demo/DemoCrmProvider'
import { Rng } from '@/server/integrations/crm/demo/rng'
import { STAGES } from '@/server/integrations/crm/demo/catalogue'

const REFERENCE = new Date('2026-08-23T00:00:00.000Z')

function provider(overrides: Partial<{ seed: number; dealCount: number }> = {}) {
  return new DemoCrmProvider({
    seed: overrides.seed ?? 20260101,
    referenceDate: REFERENCE,
    dealCount: overrides.dealCount ?? 400,
  })
}

/** Drain every page so pagination is exercised on each read. */
async function drain<T>(
  fetch: (o?: { cursor?: string; pageSize?: number }) => Promise<{
    items: readonly T[]
    nextCursor?: string
  }>,
  pageSize = 100,
): Promise<T[]> {
  const all: T[] = []
  let cursor: string | undefined
  let guard = 0

  do {
    const page = await fetch({ cursor, pageSize })
    all.push(...page.items)
    cursor = page.nextCursor
    if (++guard > 1000) throw new Error('pagination did not terminate')
  } while (cursor)

  return all
}

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 20 }, (_, i) => new Rng(1).next() + i * 0)
    const b = Array.from({ length: 20 }, (_, i) => new Rng(2).next() + i * 0)
    expect(a[0]).not.toBe(b[0])
  })

  it('stays within [0, 1)', () => {
    const rng = new Rng(7)
    for (let i = 0; i < 5_000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('respects integer bounds inclusively', () => {
    const rng = new Rng(9)
    const seen = new Set<number>()
    for (let i = 0; i < 2_000; i++) seen.add(rng.int(1, 5))
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('clamps normalInt to its bounds', () => {
    const rng = new Rng(11)
    for (let i = 0; i < 2_000; i++) {
      const v = rng.normalInt(50, 40, 1, 90)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(90)
    }
  })

  it('rejects a non-integer seed', () => {
    expect(() => new Rng(1.5)).toThrow(TypeError)
  })

  it('leaves the input array untouched when shuffling', () => {
    const source = Object.freeze([1, 2, 3, 4, 5])
    const shuffled = new Rng(3).shuffle(source)
    expect(source).toEqual([1, 2, 3, 4, 5])
    expect(shuffled).toHaveLength(5)
    expect([...shuffled].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('honours weighting', () => {
    const rng = new Rng(5)
    let heavy = 0
    for (let i = 0; i < 10_000; i++) {
      if (rng.weighted([['heavy', 9], ['light', 1]] as const) === 'heavy') heavy++
    }
    expect(heavy).toBeGreaterThan(8_500)
    expect(heavy).toBeLessThan(9_500)
  })

  it('rejects weights that sum to zero', () => {
    expect(() => new Rng(1).weighted([['a', 0]] as const)).toThrow(RangeError)
  })
})

describe('determinism', () => {
  it('produces identical deals across separate instances with the same seed', async () => {
    const a = await drain((o) => provider().fetchDeals(o))
    const b = await drain((o) => provider().fetchDeals(o))

    expect(a).toHaveLength(b.length)
    expect(a.map((d) => `${d.externalId}:${d.amountMinor}:${d.status}`)).toEqual(
      b.map((d) => `${d.externalId}:${d.amountMinor}:${d.status}`),
    )
  })

  it('produces identical totals across separate instances', async () => {
    const total = async () => {
      const deals = await drain((o) => provider().fetchDeals(o))
      return deals.reduce((sum, d) => sum + d.amountMinor, 0n)
    }
    expect(await total()).toBe(await total())
  })

  it('produces a different dataset for a different seed', async () => {
    const a = await drain((o) => provider({ seed: 1 }).fetchDeals(o))
    const b = await drain((o) => provider({ seed: 2 }).fetchDeals(o))
    const sum = (ds: typeof a) => ds.reduce((s, d) => s + d.amountMinor, 0n)
    expect(sum(a)).not.toBe(sum(b))
  })

  it('returns stable results across repeated reads of one instance', async () => {
    const p = provider()
    const first = await p.fetchDeals({ pageSize: 50 })
    const second = await p.fetchDeals({ pageSize: 50 })
    expect(first.items).toEqual(second.items)
  })
})

describe('pagination', () => {
  it('walks every record exactly once', async () => {
    const deals = await drain((o) => provider().fetchDeals(o), 37)
    expect(deals).toHaveLength(400)
    expect(new Set(deals.map((d) => d.externalId)).size).toBe(400)
  })

  it('omits nextCursor on the final page', async () => {
    const page = await provider().fetchDeals({ pageSize: 10_000 })
    expect(page.nextCursor).toBeUndefined()
  })

  it('never returns more than the requested page size', async () => {
    const page = await provider().fetchDeals({ pageSize: 25 })
    expect(page.items.length).toBeLessThanOrEqual(25)
  })

  it('rejects a malformed cursor rather than silently restarting', async () => {
    await expect(provider().fetchDeals({ cursor: 'not-a-number' })).rejects.toThrow(
      RangeError,
    )
  })
})

describe('incremental filtering', () => {
  it('returns only records updated at or after the watermark', async () => {
    const p = provider()
    const all = await drain((o) => p.fetchDeals(o))
    const cutoff = all[Math.floor(all.length / 2)]!.updatedAtSource!

    const recent = await drain((o) => p.fetchDeals({ ...o, updatedSince: cutoff }))

    expect(recent.length).toBeGreaterThan(0)
    expect(recent.length).toBeLessThan(all.length)
    for (const deal of recent) {
      expect(deal.updatedAtSource!.getTime()).toBeGreaterThanOrEqual(cutoff.getTime())
    }
  })
})

describe('referential integrity', () => {
  it('points every deal at an employee, stage and source that exist', async () => {
    const p = provider()
    const [deals, employees, stages, sources, customers] = await Promise.all([
      drain((o) => p.fetchDeals(o)),
      drain((o) => p.fetchEmployees(o)),
      drain((o) => p.fetchStages(o)),
      drain((o) => p.fetchSources(o)),
      drain((o) => p.fetchCustomers(o)),
    ])

    const employeeIds = new Set(employees.map((e) => e.externalId))
    const stageIds = new Set(stages.map((s) => s.externalId))
    const sourceIds = new Set(sources.map((s) => s.externalId))
    const customerIds = new Set(customers.map((c) => c.externalId))

    for (const deal of deals) {
      expect(employeeIds.has(deal.employeeExternalId)).toBe(true)
      expect(stageIds.has(deal.stageExternalId)).toBe(true)
      if (deal.sourceExternalId) expect(sourceIds.has(deal.sourceExternalId)).toBe(true)
      if (deal.customerExternalId) expect(customerIds.has(deal.customerExternalId)).toBe(true)
    }
  })

  it('points every line item at a real deal and product', async () => {
    const p = provider()
    const [deals, items, products] = await Promise.all([
      drain((o) => p.fetchDeals(o)),
      drain((o) => p.fetchDealItems(o)),
      drain((o) => p.fetchProducts(o)),
    ])

    const dealIds = new Set(deals.map((d) => d.externalId))
    const productIds = new Set(products.map((p2) => p2.externalId))

    expect(items.length).toBeGreaterThan(deals.length)
    for (const item of items) {
      expect(dealIds.has(item.dealExternalId)).toBe(true)
      expect(productIds.has(item.productExternalId)).toBe(true)
    }
  })

  it('makes each deal amount equal the sum of its line items', async () => {
    // If these ever disagree, product analytics would contradict revenue
    // analytics and there would be no way to tell which was right.
    const p = provider()
    const [deals, items] = await Promise.all([
      drain((o) => p.fetchDeals(o)),
      drain((o) => p.fetchDealItems(o)),
    ])

    const totals = new Map<string, bigint>()
    for (const item of items) {
      totals.set(
        item.dealExternalId,
        (totals.get(item.dealExternalId) ?? 0n) + item.totalMinor,
      )
      expect(item.totalMinor).toBe(item.unitPriceMinor * BigInt(item.quantity))
    }

    for (const deal of deals) {
      expect(totals.get(deal.externalId)).toBe(deal.amountMinor)
    }
  })

  it('attaches payments only to won deals, never over-paying', async () => {
    const p = provider()
    const [deals, payments] = await Promise.all([
      drain((o) => p.fetchDeals(o)),
      drain((o) => p.fetchPayments(o)),
    ])

    const byId = new Map(deals.map((d) => [d.externalId, d]))
    const paidPerDeal = new Map<string, bigint>()

    for (const payment of payments) {
      const deal = byId.get(payment.dealExternalId)
      expect(deal).toBeDefined()
      expect(deal!.status).toBe('WON')
      paidPerDeal.set(
        payment.dealExternalId,
        (paidPerDeal.get(payment.dealExternalId) ?? 0n) + payment.amountMinor,
      )
    }

    for (const [dealId, paid] of paidPerDeal) {
      expect(paid).toBeLessThanOrEqual(byId.get(dealId)!.amountMinor)
      expect(paid).toBeGreaterThan(0n)
    }
  })
})

describe('business plausibility', () => {
  it('closes won and lost deals, and leaves open ones unclosed', async () => {
    const deals = await drain((o) => provider().fetchDeals(o))

    for (const deal of deals) {
      if (deal.status === 'OPEN') {
        expect(deal.closedAt).toBeUndefined()
      } else {
        expect(deal.closedAt).toBeDefined()
        expect(deal.closedAt!.getTime()).toBeGreaterThanOrEqual(
          deal.createdAtSource.getTime(),
        )
      }
    }
  })

  it('keeps every deal inside the generated history window', async () => {
    const deals = await drain((o) => provider().fetchDeals(o))
    for (const deal of deals) {
      expect(deal.createdAtSource.getTime()).toBeLessThanOrEqual(REFERENCE.getTime())
      expect(deal.closedAt?.getTime() ?? 0).toBeLessThanOrEqual(REFERENCE.getTime())
    }
  })

  it('produces a mix of open, won and lost deals', async () => {
    const deals = await drain((o) => provider().fetchDeals(o))
    const counts = { OPEN: 0, WON: 0, LOST: 0 }
    for (const deal of deals) counts[deal.status]++

    expect(counts.OPEN).toBeGreaterThan(0)
    expect(counts.WON).toBeGreaterThan(0)
    expect(counts.LOST).toBeGreaterThan(0)
    // A win rate outside this band would mean the generator is broken.
    const winRate = counts.WON / (counts.WON + counts.LOST)
    expect(winRate).toBeGreaterThan(0.2)
    expect(winRate).toBeLessThan(0.85)
  })

  it('spreads deals across employees with a genuine performance gap', async () => {
    const p = provider()
    const [deals, employees] = await Promise.all([
      drain((o) => p.fetchDeals(o)),
      drain((o) => p.fetchEmployees(o)),
    ])

    const revenue = new Map<string, bigint>()
    for (const deal of deals) {
      if (deal.status !== 'WON') continue
      revenue.set(
        deal.employeeExternalId,
        (revenue.get(deal.employeeExternalId) ?? 0n) + deal.amountMinor,
      )
    }

    // Every active employee should appear, and the leaderboard must not be flat.
    expect(revenue.size).toBeGreaterThan(employees.length / 2)
    const sorted = [...revenue.values()].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
    expect(sorted[0]!).toBeGreaterThan(sorted.at(-1)!)
  })

  it('classifies every stage into our own vocabulary', async () => {
    const stages = await drain((o) => provider().fetchStages(o))
    expect(stages).toHaveLength(STAGES.length)
    for (const stage of stages) {
      expect(['NEW', 'IN_PROGRESS', 'WON', 'LOST']).toContain(stage.category)
    }
  })

  it('marks deal status consistently with the stage category', async () => {
    const p = provider()
    const [deals, stages] = await Promise.all([
      drain((o) => p.fetchDeals(o)),
      drain((o) => p.fetchStages(o)),
    ])
    const categoryById = new Map(stages.map((s) => [s.externalId, s.category]))

    for (const deal of deals) {
      const category = categoryById.get(deal.stageExternalId)!
      if (category === 'WON') expect(deal.status).toBe('WON')
      else if (category === 'LOST') expect(deal.status).toBe('LOST')
      else expect(deal.status).toBe('OPEN')
    }
  })
})

describe('provider contract', () => {
  it('reports itself as the DEMO source', () => {
    expect(provider().source).toBe('DEMO')
  })

  it('advertises support for every entity, payments included', () => {
    const caps = provider().capabilities
    expect(caps.DEALS).toBe(true)
    expect(caps.PAYMENTS).toBe(true)
  })

  it('reports healthy without touching the network', async () => {
    const health = await provider().healthCheck()
    expect(health.ok).toBe(true)
    expect(health.detail).toContain('Demo provider ready')
  })
})
