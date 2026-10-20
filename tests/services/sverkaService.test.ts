import { describe, expect, it, vi } from 'vitest'

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

  it('compares nothing for an order queued before MoySklad held any, and says how much that left out', async () => {
    const may = deal({
      dealId: 'd-may',
      externalId: '880001',
      queuedAt: new Date('2026-05-10T07:00:00Z'),
      delivered: true,
      logisticsRole: 'DELIVERED',
      stageExternalId: 'C6:WON',
      stageName: 'Доставлен',
    })
    // Refused at confirmation in May: no MoySklad order would ever exist, so it is not «before» MoySklad either.
    const refused = deal({
      dealId: 'd-may-refused',
      externalId: '880002',
      queuedAt: new Date('2026-05-11T07:00:00Z'),
      fakt1: false,
      outcome: 'REJECTED',
      logisticsRole: 'CANCELLED_EARLY',
      stageExternalId: 'C12:UC_1OM8B2',
      stageName: 'Тасдикланмаган',
    })
    const svc = service(
      [deal({}), may, refused],
      [order({ sumMinor: som(1_600_000), items: [collagen] })],
      new Map([['d1', [collagen]]]),
    )
    const year = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      now: new Date('2026-10-06T09:00:00+05:00'),
      customStart: new Date('2026-01-01T00:00:00+05:00'),
      customEnd: new Date('2026-12-31T00:00:00+05:00'),
    })
    const out = await svc.overview(year)

    expect(out.lines).toEqual([])
    expect(out.issueCounts.MISSING_IN_MS).toBe(0)
    expect(out.issueAmounts.MISSING_IN_MS).toBe(0)
    // FAKT 1 keeps the May order — the figure is Savdo dinamikasi's — and names it as uncompared.
    expect(out.totals.fakt1.bitrix).toEqual({ orders: 2, amount: 3_200_000 })
    expect(out.totals.fakt1.beforeFloor).toEqual({ orders: 1, amount: 1_600_000 })
    expect(out.totals.fakt2.beforeFloor).toEqual({ orders: 1, amount: 1_600_000 })
    // The refusal is in the cohort and out of the set-aside count the page says is «in the FAKT figures».
    expect(out.totals.cohortOrders).toBe(3)
    expect(out.totals.beforeFloor).toEqual({ orders: 1, amount: 1_600_000 })
    expect(out.totals.clean).toBe(1)
    expect(out.moysklad.since).toBe('2026-06-14T19:00:00.000Z')
  })
})

describe('SverkaService.nutritionist', () => {
  it('counts Collagen and Zextra FAKT 1 / FAKT 2 on both systems off one scan and prices each at 2 $ an order', async () => {
    const delivered = deal({
      dealId: 'd2',
      externalId: '1070001',
      delivered: true,
      logisticsRole: 'DELIVERED',
      stageExternalId: 'C6:WON',
      brand: 'Collagen',
    })
    // FAKT 1 with no MoySklad order yet, past the warehouse.
    const missing = deal({ dealId: 'd3', externalId: '1070002', brand: 'Collagen' })
    const zextra = deal({ dealId: 'd4', externalId: '1070003', brand: 'Zextra' })
    // «Brendsiz»: on neither line, and MoySklad is not asked about it.
    const brandless = deal({ dealId: 'd5', externalId: '1070004', brand: null })
    const asked: unknown[] = []
    const askedIds: string[][] = []
    const insights = {
      sverkaCohort: async (_window: unknown, brands: unknown) => {
        asked.push(brands)
        return [deal({ brand: 'Collagen' }), delivered, missing, zextra, brandless]
      },
    } as unknown as InsightsRepository
    const repository = {
      ordersForDeals: async (ids: string[]) => {
        askedIds.push(ids)
        return [
          order({}),
          order({ orderId: 'ms-2', bitrixDealId: '1070001', stateName: 'Касса' }),
          order({ orderId: 'ms-3', bitrixDealId: '1070003' }),
        ]
      },
      dealItems: async () => new Map(),
    } as unknown as SverkaRepository
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      now: new Date('2026-10-17T09:00:00+05:00'),
      customStart: new Date('2026-10-01T00:00:00+05:00'),
      customEnd: new Date('2026-10-16T00:00:00+05:00'),
    })

    const out = await new SverkaService(insights, repository).nutritionist(period)

    expect(asked).toHaveLength(1)
    expect(asked[0]).not.toHaveProperty('slice')
    expect(askedIds).toEqual([['1071484', '1070001', '1070002', '1070003']])
    expect(out.usdPerOrder).toBe(2)
    expect(out.brands.map((b) => b.brand)).toEqual(['Collagen', 'Zextra'])
    const [collagen, zextraPay] = out.brands
    expect(collagen.fakt1).toEqual({ bitrix: 3, moysklad: 2, bitrixUsd: 6, moyskladUsd: 4 })
    expect(collagen.fakt2).toEqual({ bitrix: 1, moysklad: 1, bitrixUsd: 2, moyskladUsd: 2 })
    expect(zextraPay.fakt1).toEqual({ bitrix: 1, moysklad: 1, bitrixUsd: 2, moyskladUsd: 2 })
    expect(zextraPay.fakt2).toEqual({ bitrix: 0, moysklad: 0, bitrixUsd: 0, moyskladUsd: 0 })
  })
})

describe('SverkaService.products', () => {
  it('lists each brand\'s pieces per product on both systems, FAKT 1 and FAKT 2, off the scan «Нутрицолог» shares', async () => {
    const delivered = deal({
      dealId: 'd2',
      externalId: '1070001',
      delivered: true,
      logisticsRole: 'DELIVERED',
      stageExternalId: 'C6:WON',
      brand: 'Collagen',
    })
    const zextraItem: SverkaItem = { code: 'zextra', name: 'Zextra sure', quantity: 3, totalMinor: som(900_000) }
    const zextra = deal({ dealId: 'd4', externalId: '1070003', brand: 'Zextra' })
    const brandless = deal({ dealId: 'd5', externalId: '1070004', brand: null })
    let scans = 0
    const askedDeals: string[][] = []
    const insights = {
      sverkaCohort: async () => {
        scans += 1
        return [deal({ brand: 'Collagen' }), delivered, zextra, brandless]
      },
    } as unknown as InsightsRepository
    const repository = {
      ordersForDeals: async () => [
        // 1071484: two Collagen in Bitrix24, MoySklad added a Sedana — on the way.
        order({}),
        order({ orderId: 'ms-2', bitrixDealId: '1070001', stateName: 'Касса', items: [collagen] }),
        order({ orderId: 'ms-3', bitrixDealId: '1070003', items: [{ ...zextraItem, quantity: 2 }] }),
      ],
      dealItems: async (ids: string[]) => {
        askedDeals.push(ids)
        return new Map([
          ['d1', [collagen]],
          ['d2', [collagen]],
          ['d4', [zextraItem]],
          ['d5', [sedana]],
        ])
      },
    } as unknown as SverkaRepository
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      now: new Date('2026-10-20T09:00:00+05:00'),
      customStart: new Date('2026-10-01T00:00:00+05:00'),
      customEnd: new Date('2026-10-19T00:00:00+05:00'),
    })
    const svc = new SverkaService(insights, repository)

    const [out, pay] = await Promise.all([svc.products(period), svc.nutritionist(period)])

    expect(scans).toBe(1)
    // «Brendsiz» deals are not asked about.
    expect(askedDeals).toEqual([['d1', 'd2', 'd4']])
    // The product rows (and the PRODUCTS difference on 1071484) leave the order counts as they were.
    expect(pay.brands[0].fakt1).toMatchObject({ bitrix: 2, moysklad: 2 })
    expect(pay.brands[0].fakt2).toMatchObject({ bitrix: 1, moysklad: 1 })
    expect(pay.brands[1].fakt1).toMatchObject({ bitrix: 1, moysklad: 1 })
    expect(out.brands.map((b) => b.brand)).toEqual(['Collagen', 'Zextra'])
    const [collagenBrand, zextraBrand] = out.brands
    const pieces = (rows: readonly { name: string; bitrixQuantity: number; moyskladQuantity: number }[]) =>
      rows.map((r) => [r.name, r.bitrixQuantity, r.moyskladQuantity])
    expect(pieces(collagenBrand.fakt1)).toEqual([
      ['Collagen Marine Sinolife', 4, 4],
      ['Sedana Sinolife', 0, 1],
    ])
    expect(pieces(collagenBrand.fakt2)).toEqual([['Collagen Marine Sinolife', 2, 2]])
    expect(collagenBrand.fakt2[0]).toMatchObject({ bitrixAmount: 1_600_000, moyskladAmount: 1_600_000 })
    expect(pieces(zextraBrand.fakt1)).toEqual([['Zextra sure', 3, 2]])
    expect(zextraBrand.fakt2).toEqual([])
  })
})

describe('SverkaService.summary', () => {
  it('is the overview less its deal and product rows', async () => {
    const service = new SverkaService({} as unknown as InsightsRepository, {} as unknown as SverkaRepository)
    const overview = { totals: { clean: 3 }, issueCounts: {}, lines: [{}], products: [{}], teams: [{ team: 'Lola' }] }
    vi.spyOn(service, 'overview').mockResolvedValue(overview as never)
    const period = resolvePeriod('today', { timeZone: 'Asia/Tashkent', now: new Date('2026-10-19T09:00:00+05:00') })

    const out = await service.summary(period)

    expect(out).toEqual({ totals: { clean: 3 }, issueCounts: {}, teams: [{ team: 'Lola' }] })
    expect(out).not.toHaveProperty('lines')
    expect(out).not.toHaveProperty('products')
  })
})
