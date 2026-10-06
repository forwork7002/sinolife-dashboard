import { describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import type { SverkaItem } from '@/server/domain/sverka/sverka'
import type { InsightsRepository, SverkaDealRow } from '@/server/repositories/insightsRepository'
import type { MoyskladOrderRow, SverkaRepository } from '@/server/repositories/sverkaRepository'

// The SQL-shape preamble: `env` refuses to load without these, and the service reaches it through the repository.
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { SverkaService } = await import('@/server/services/sverkaService')

/**
 * The shaping «Sverka» does over the two systems' rows: what each chip puts at
 * stake, the gap per line, the products a basket differs by, a duplicate's
 * other orders. The comparisons themselves are pinned in
 * `tests/domain/sverka.test.ts`; the SQL in `tests/http/sverkaSql.test.ts`.
 */

const som = (n: number) => BigInt(n) * 100n
const COLLAGEN = 'LEcGiRfph3h6SUjE5yxxF3'

const deal = (over: Partial<SverkaDealRow>): SverkaDealRow => ({
  dealId: 'd1',
  externalId: '1071484',
  amountMinor: som(1_600_000),
  queuedAt: new Date('2026-10-05T08:00:00Z'),
  fakt1: true,
  delivered: false,
  outcome: 'CONFIRMED',
  logisticsRole: 'CARRIER',
  stageExternalId: 'C6:PREPAYMENT_INVOICE',
  stageName: 'CARAVAN',
  sellerSource: 'Zarnigor Mirzayeva230',
  rop: 'Shohjaxon',
  ropSource: 'Shohjaxon',
  region: 'Хорезм',
  ...over,
})

const collagen: SverkaItem = { code: COLLAGEN, name: 'Collagen Marine Sinolife', quantity: 2, totalMinor: som(1_600_000) }
const sedana: SverkaItem = { code: 'sedana', name: 'Sedana Sinolife', quantity: 1, totalMinor: som(200_000) }

const order = (over: Partial<MoyskladOrderRow>): MoyskladOrderRow => ({
  orderId: 'ms-1',
  orderName: 'bx1071484',
  bitrixDealId: '1071484',
  moment: new Date('2026-10-05T10:00:00Z'),
  stateName: 'В пути',
  sumMinor: som(1_800_000),
  seller: 'Zarnigor Mirzayeva230',
  project: 'Shohjaxon(ROP)',
  region: 'Хорезм',
  logistics: 'CARAVAN',
  payedMinor: 0n,
  shippedMinor: som(1_800_000),
  items: [collagen, sedana],
  ...over,
})

function service(deals: SverkaDealRow[], orders: MoyskladOrderRow[], items: Map<string, SverkaItem[]>) {
  const insights = { sverkaCohort: async () => deals } as unknown as InsightsRepository
  const repository = {
    ordersForDeals: async () => orders,
    ordersInWindow: async () => [],
    dealItems: async () => items,
    dealsByExternalId: async () => [],
    freshness: async () => ({ orders: orders.length, lastSuccessAt: null, lastError: null, lastErrorAt: null }),
  } as unknown as SverkaRepository
  return new SverkaService(insights, repository)
}

describe('SverkaService.overview', () => {
  it('prints the gap, the extra product, the stakes per issue and a duplicate\'s other order (deal 1071484)', async () => {
    const svc = service(
      [deal({}), deal({ dealId: 'd2', externalId: '1070001', amountMinor: som(900_000), logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' })],
      [order({}), order({ orderId: 'ms-0', orderName: 'bx1071484-old', moment: new Date('2026-10-04T10:00:00Z'), sumMinor: som(1_600_000), stateName: 'Новый' })],
      new Map([['d1', [collagen]], ['d2', [collagen]]]),
    )
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      now: new Date('2026-10-06T09:00:00+05:00'),
      customStart: new Date('2026-10-05T00:00:00+05:00'),
      customEnd: new Date('2026-10-05T00:00:00+05:00'),
    })
    const out = await svc.overview(period)

    const line = out.lines.find((l) => l.dealId === '1071484')!
    expect([...line.issues].sort()).toEqual(['DUPLICATE', 'PRODUCTS', 'SUM'])
    expect(line.diffAmount).toBe(200_000)
    expect(line.productDiff).toEqual([{ key: 'code:sedana', name: 'Sedana Sinolife', bitrixQuantity: 0, moyskladQuantity: 1 }])
    expect(line.regionMatch).toBe('same')
    expect(line.ropMatch).toBe('same')
    expect(line.otherOrders.map((o) => o.orderName)).toEqual(['bx1071484-old'])
    expect(line.moysklad?.shipped).toBe(1_800_000)

    // SUM stakes the gap; every other issue the deal's own money.
    expect(out.issueAmounts.SUM).toBe(200_000)
    expect(out.issueAmounts.PRODUCTS).toBe(1_600_000)
    expect(out.issueAmounts.MISSING_IN_MS).toBe(900_000)
    expect(out.issueCounts.MISSING_IN_MS).toBe(1)

    const missing = out.lines.find((l) => l.dealId === '1070001')!
    expect(missing.diffAmount).toBeNull()
    expect(missing.productDiff).toEqual([])
  })
})
