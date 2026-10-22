import { describe, expect, it } from 'vitest'

import {
  type BitrixSide,
  type MoyskladSide,
  type SverkaLine,
  compareDeal,
  productRows,
  sverkaTotals,
} from '@/server/domain/sverka/sverka'
import { type BrandLine, dayOrders, sverkaDays } from '@/server/domain/sverka/sverkaDays'

const TZ = 'Asia/Tashkent'
const COLLAGEN = 'LEcGiRfph3h6SUjE5yxxF3'
const OMEGA = '-n3II3IBjoS45bviltfkN0'

const bitrix = (externalId: string, over: Partial<BitrixSide> = {}): BitrixSide => ({
  externalId,
  amountMinor: 160_000_000n,
  fakt1: true,
  delivered: false,
  logisticsRole: 'CARRIER',
  stageExternalId: 'C6:PREPAYMENT_INVOICE',
  stageName: 'CARAVAN',
  seller: 'Zarnigor Mirzayeva230',
  rop: 'Shohjaxon',
  ropSource: 'Shohjaxon',
  region: 'Хорезм',
  queuedAt: new Date('2026-10-05T13:00:00Z'),
  items: [
    { code: COLLAGEN, name: 'Collagen Marine Sinolife', quantity: 2, totalMinor: 160_000_000n },
    { code: OMEGA, name: 'Omega Sinolife 500', quantity: 1, totalMinor: 0n },
  ],
  ...over,
})

const moysklad = (orderName: string, over: Partial<MoyskladSide> = {}): MoyskladSide => ({
  orderId: `uuid-${orderName}`,
  orderName,
  moment: new Date('2026-10-05T16:04:00Z'),
  stateName: 'В пути',
  sumMinor: 160_000_000n,
  seller: 'Zarnigor Mirzayeva230',
  project: 'Shohjaxon(ROP)',
  region: 'Хорезм',
  logistics: 'CARAVAN',
  payedMinor: 0n,
  shippedMinor: 160_000_000n,
  items: [
    { code: COLLAGEN, name: 'Collagen Marine Sinolife', quantity: 2, totalMinor: 160_000_000n },
    { code: OMEGA, name: 'Omega Sinolife 500', quantity: 1, totalMinor: 0n },
  ],
  ...over,
})

const line = (bx: BitrixSide, ms: MoyskladSide | null): SverkaLine => compareDeal(bx, ms ? [ms] : [])

// 05.10 (Tashkent): one order that agrees to the piece.
const same = line(bitrix('1'), moysklad('bx1'))
// 20:00 UTC on 05.10 is 01:00 on 06.10 in Tashkent: a 06.10 order, MoySklad one Omega short.
const short = line(
  bitrix('2', { queuedAt: new Date('2026-10-05T20:00:00Z') }),
  moysklad('bx2', {
    items: [
      { code: COLLAGEN, name: 'Collagen Marine Sinolife', quantity: 2, totalMinor: 160_000_000n },
      { code: OMEGA, name: 'Omega Sinolife 500', quantity: 0, totalMinor: 0n },
    ],
  }),
)
// 06.10, Zextra: FAKT 1 with no MoySklad order yet.
const missing = line(
  bitrix('3', {
    queuedAt: new Date('2026-10-06T05:00:00Z'),
    items: [{ code: 'ZX', name: 'Zextra sure', quantity: 1, totalMinor: 600_000_00n }],
  }),
  null,
)
// 06.10: delivered in Bitrix24, MoySklad still has it on the road.
const deliveredOnlyInBitrix = line(
  bitrix('4', { queuedAt: new Date('2026-10-06T06:00:00Z'), delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' }),
  moysklad('bx4'),
)
// 06.10: not FAKT 1 nor delivered in Bitrix24, MoySklad calls it Успешно.
const deliveredOnlyInMoysklad = line(
  bitrix('5', { queuedAt: new Date('2026-10-06T07:00:00Z'), fakt1: false }),
  moysklad('bx5', { stateName: 'Успешно' }),
)
// Queued before MoySklad held orders, past the warehouse, no order: counted, never compared.
const beforeFloor = line(bitrix('6', { queuedAt: new Date('2026-06-01T07:00:00Z') }), null)

const all: BrandLine[] = [
  { brand: 'Collagen', line: same },
  { brand: 'Collagen', line: short },
  { brand: 'Zextra', line: missing },
  { brand: 'Collagen', line: deliveredOnlyInBitrix },
  { brand: 'Collagen', line: deliveredOnlyInMoysklad },
  { brand: 'Collagen', line: beforeFloor },
]

const sum = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0)

describe('sverkaDays — the KPI cards cut by queue day', () => {
  it('files each deal on its Tashkent queue day, newest first', () => {
    const { days } = sverkaDays(all, 'FAKT1', TZ)
    expect(days.map((d) => d.day)).toEqual(['2026-10-06', '2026-10-05', '2026-06-01'])
    // 01:00 Tashkent on 06.10 is 06.10, though it is 05.10 in UTC.
    expect(days[0]!.bitrix.orders).toBe(3)
    expect(days[1]!.bitrix.orders).toBe(1)
  })

  for (const basis of ['FAKT1', 'FAKT2'] as const) {
    it(`adds up to «Нутрицолог»'s orders and «Tovarlar»'s pieces and soʻm (${basis})`, () => {
      const lines = all.map((l) => l.line)
      const totals = sverkaTotals(lines)
      const pair = basis === 'FAKT1' ? totals.fakt1 : totals.fakt2
      const rows = productRows(lines, basis)
      const { days, total } = sverkaDays(all, basis, TZ)

      expect(total.bitrix.orders).toBe(pair.bitrix.orders)
      expect(total.moysklad.orders).toBe(pair.moysklad.orders)
      expect(total.bitrix.pieces).toBe(sum(rows.map((r) => r.bitrixQuantity)))
      expect(total.moysklad.pieces).toBe(sum(rows.map((r) => r.moyskladQuantity)))
      expect(total.bitrix.amountMinor).toBe(rows.reduce((n, r) => n + r.bitrixMinor, 0n))
      expect(total.moysklad.amountMinor).toBe(rows.reduce((n, r) => n + r.moyskladMinor, 0n))

      expect(sum(days.map((d) => d.bitrix.orders))).toBe(total.bitrix.orders)
      expect(sum(days.map((d) => d.moysklad.orders))).toBe(total.moysklad.orders)
      expect(sum(days.map((d) => d.bitrix.pieces))).toBe(total.bitrix.pieces)
      expect(sum(days.map((d) => d.moysklad.pieces))).toBe(total.moysklad.pieces)
      expect(days.reduce((n, d) => n + d.bitrix.amountMinor, 0n)).toBe(total.bitrix.amountMinor)
      expect(sum(days.map((d) => d.mismatched))).toBe(total.mismatched)
    })
  }

  it('counts a pre-MoySklad deal in Bitrix24\'s orders and leaves it out of the pieces', () => {
    const june = sverkaDays(all, 'FAKT1', TZ).days.find((d) => d.day === '2026-06-01')!
    expect(june.bitrix).toEqual({ orders: 1, pieces: 0, amountMinor: 0n })
    expect(june.mismatched).toBe(0)
  })
})

describe('dayOrders — one day\'s orders and their products', () => {
  it('names what is wrong with each order, the differences first', () => {
    const orders = dayOrders(all, 'FAKT1', TZ, '2026-10-06')
    expect(orders.map((o) => [o.line.dealId, o.verdict])).toEqual([
      ['3', 'noMoysklad'],
      ['2', 'products'],
      ['4', 'same'],
    ])
    expect(sverkaDays(all, 'FAKT1', TZ).days[0]!.mismatched).toBe(2)
  })

  it('lists each product on both sides, so the gap is read off the order itself', () => {
    const [, shortOrder] = dayOrders(all, 'FAKT1', TZ, '2026-10-06')
    expect(shortOrder!.items.find((i) => i.name === 'Omega Sinolife 500')).toMatchObject({ bitrixQuantity: 1, moyskladQuantity: 0 })
    expect(shortOrder!.items.find((i) => i.name === 'Collagen Marine Sinolife')).toMatchObject({ bitrixQuantity: 2, moyskladQuantity: 2 })
  })

  it('keeps the brand each order was counted under', () => {
    expect(dayOrders(all, 'FAKT1', TZ, '2026-10-06').find((o) => o.line.dealId === '3')!.brand).toBe('Zextra')
  })

  it('reads FAKT 2 by delivery on each side: Bitrix24 alone, MoySklad alone', () => {
    const orders = dayOrders(all, 'FAKT2', TZ, '2026-10-06')
    expect(orders.map((o) => [o.line.dealId, o.verdict])).toEqual([
      ['4', 'noMoysklad'],
      ['5', 'noBitrix'],
    ])
    // A side it is not counted on adds no products: the order's pieces are the day's.
    expect(orders[0]!.items.every((i) => i.moyskladQuantity === 0)).toBe(true)
    expect(orders[1]!.items.every((i) => i.bitrixQuantity === 0)).toBe(true)
  })

  it('lists nothing for a day without orders', () => {
    expect(dayOrders(all, 'FAKT1', TZ, '2026-10-07')).toEqual([])
  })
})
