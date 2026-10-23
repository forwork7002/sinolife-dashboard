import { describe, expect, it } from 'vitest'

import { type KpiSheetLine, kpiSheet, sheetMonthDays } from '@/server/domain/sverka/kpiSheet'
import { nutritionistPay } from '@/server/domain/sverka/nutritionist'
import {
  type BitrixSide,
  type MoyskladSide,
  type SverkaLine,
  compareDeal,
  productRows,
  sverkaTotals,
} from '@/server/domain/sverka/sverka'
import { type BrandLine, sverkaDays } from '@/server/domain/sverka/sverkaDays'

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

// 05.10: one order that agrees to the piece.
const same = line(bitrix('1'), moysklad('bx1'))
// 01:00 on 06.10 in Tashkent: MoySklad one Omega short.
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
    items: [{ code: 'ZX', name: 'Zextra sure', quantity: 1, totalMinor: 60_000_000n }],
  }),
  null,
)
// 06.10: delivered in Bitrix24, MoySklad still has it on the road.
const deliveredOnlyInBitrix = line(
  bitrix('4', { queuedAt: new Date('2026-10-06T06:00:00Z'), delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' }),
  moysklad('bx4'),
)
// 06.10: neither FAKT 1 nor delivered in Bitrix24, MoySklad calls it Успешно.
const deliveredOnlyInMoysklad = line(
  bitrix('5', { queuedAt: new Date('2026-10-06T07:00:00Z'), fakt1: false }),
  moysklad('bx5', { stateName: 'Успешно' }),
)

const october: BrandLine[] = [
  { brand: 'Collagen', line: same },
  { brand: 'Collagen', line: short },
  { brand: 'Zextra', line: missing },
  { brand: 'Collagen', line: deliveredOnlyInBitrix },
  { brand: 'Collagen', line: deliveredOnlyInMoysklad },
]

const DAYS = sheetMonthDays('2026-10')
const TODAY = '2026-10-23'
const sheet = kpiSheet({ lines: october, days: DAYS, today: TODAY, timeZone: TZ })

type Value = Extract<KpiSheetLine, { kind: 'value' }>

function row(key: string): Value {
  const found = sheet.find((l) => l.key === key)
  if (!found || found.kind !== 'value') throw new Error(`no row ${key}`)
  return found
}

const at = (r: Value, day: string) => r.days[DAYS.indexOf(day)]

describe('sheetMonthDays', () => {
  it('lists every day of the month, leap years included', () => {
    expect(DAYS).toHaveLength(31)
    expect(DAYS[0]).toBe('2026-10-01')
    expect(DAYS.at(-1)).toBe('2026-10-31')
    expect(sheetMonthDays('2028-02')).toHaveLength(29)
  })
})

describe('kpiSheet — the KPI cards as a month, a column per day', () => {
  for (const scope of ['all', 'Collagen', 'Zextra'] as const) {
    for (const basis of ['FAKT1', 'FAKT2'] as const) {
      it(`a day column is «Kunlar boʻyicha»'s row for that day (${scope}, ${basis})`, () => {
        const lines = scope === 'all' ? october : october.filter((l) => l.brand === scope)
        for (const d of sverkaDays(lines, basis, TZ).days) {
          const day = d.day!
          expect(at(row(`${scope}:orders:${basis}:bitrix`), day)).toBe(d.bitrix.orders)
          expect(at(row(`${scope}:orders:${basis}:moysklad`), day)).toBe(d.moysklad.orders)
          expect(at(row(`${scope}:pieces:${basis}:bitrix`), day)).toBe(d.bitrix.pieces)
          expect(at(row(`${scope}:pieces:${basis}:moysklad`), day)).toBe(d.moysklad.pieces)
          expect(at(row(`${scope}:amount:${basis}:bitrix`), day)).toBe(Number(d.bitrix.amountMinor) / 100)
          expect(at(row(`${scope}:amount:${basis}:moysklad`), day)).toBe(Number(d.moysklad.amountMinor) / 100)
          expect(at(row(`${scope}:mismatch:${basis}`), day)).toBe(d.mismatched)
        }
      })

      it(`the «Jami» column is the cards over the month (${scope}, ${basis})`, () => {
        const lines = (scope === 'all' ? october : october.filter((l) => l.brand === scope)).map((l) => l.line)
        const totals = sverkaTotals(lines)
        const pair = basis === 'FAKT1' ? totals.fakt1 : totals.fakt2
        const rows = productRows(lines, basis)
        expect(row(`${scope}:orders:${basis}:bitrix`).total).toBe(pair.bitrix.orders)
        expect(row(`${scope}:orders:${basis}:moysklad`).total).toBe(pair.moysklad.orders)
        expect(row(`${scope}:pieces:${basis}:bitrix`).total).toBe(rows.reduce((n, r) => n + r.bitrixQuantity, 0))
        expect(row(`${scope}:amount:${basis}:moysklad`).total).toBe(Number(rows.reduce((n, r) => n + r.moyskladMinor, 0n)) / 100)
        expect(row(`${scope}:mismatch:${basis}`).total).toBe(sverkaDays(scope === 'all' ? october : october.filter((l) => l.brand === scope), basis, TZ).total.mismatched)
      })
    }
  }

  it('prices «Нутрицолог» as the card does — each count × 2 $', () => {
    const pay = nutritionistPay({
      Collagen: sverkaTotals(october.filter((l) => l.brand === 'Collagen').map((l) => l.line)),
      Zextra: sverkaTotals(october.filter((l) => l.brand === 'Zextra').map((l) => l.line)),
    })
    const collagen = pay.brands.find((b) => b.brand === 'Collagen')!
    expect(row('Collagen:nutritionist:FAKT1:bitrix').total).toBe(collagen.fakt1.bitrixUsd)
    expect(row('Collagen:nutritionist:FAKT2:moysklad').total).toBe(collagen.fakt2.moyskladUsd)
    expect(at(row('all:nutritionist:FAKT1:bitrix'), '2026-10-06')).toBe(at(row('all:orders:FAKT1:bitrix'), '2026-10-06')! * 2)
    // The dollars have no «Farq» row: the orders above them carry it.
    expect(sheet.some((l) => l.key === 'all:nutritionist:FAKT1:diff')).toBe(false)
  })

  it('writes the difference as MoySklad less Bitrix24, the month as the sum of its days', () => {
    const diff = row('all:orders:FAKT1:diff')
    // 06.10: Bitrix24 FAKT 1 = short, missing, deliveredOnlyInBitrix; MoySklad holds two of them.
    expect(at(row('all:orders:FAKT1:bitrix'), '2026-10-06')).toBe(3)
    expect(at(diff, '2026-10-06')).toBe(-1)
    expect(at(diff, '2026-10-05')).toBe(0)
    expect(diff.total).toBe(diff.days.reduce<number>((n, v) => n + (v ?? 0), 0))
  })

  it('reads each product per brand, the piece MoySklad is short on its day', () => {
    const omega = (side: string) => row(`Collagen:product:code:${OMEGA}:FAKT1:${side}`)
    expect(at(omega('bitrix'), '2026-10-06')).toBe(2)
    expect(at(omega('moysklad'), '2026-10-06')).toBe(1)
    expect(at(omega('diff'), '2026-10-06')).toBe(-1)
    // «Collagen + Zextra» lists no products: the two brands share Omega and Sedana.
    expect(sheet.some((l) => l.key.startsWith('all:product:'))).toBe(false)
  })

  it('leaves the days after today empty, and writes zero for a day lived without orders', () => {
    const orders = row('all:orders:FAKT1:bitrix')
    expect(at(orders, '2026-10-24')).toBeNull()
    expect(at(orders, '2026-10-07')).toBe(0)
    expect(at(row('all:orders:FAKT1:diff'), '2026-10-07')).toBe(0)
  })

  it('names each figure once, on its Bitrix24 row', () => {
    expect(row('all:orders:FAKT1:bitrix')).toMatchObject({ label: 'Buyurtmalar · FAKT 1', opens: true })
    expect(row('all:orders:FAKT1:moysklad')).toMatchObject({ label: '', opens: false })
    expect(row('all:orders:FAKT1:diff')).toMatchObject({ label: '', opens: false })
  })
})

describe('kpiSheet — before MoySklad held orders', () => {
  // 01.06 and 20.06 in June 2026; MoySklad's first day is 15.06.
  const early = line(bitrix('7', { queuedAt: new Date('2026-06-01T07:00:00Z') }), null)
  const later = line(bitrix('8', { queuedAt: new Date('2026-06-20T07:00:00Z') }), moysklad('bx8'))
  const juneDays = sheetMonthDays('2026-06')
  const june = kpiSheet({
    lines: [
      { brand: 'Collagen', line: early },
      { brand: 'Collagen', line: later },
    ],
    days: juneDays,
    today: TODAY,
    timeZone: TZ,
  })
  const get = (key: string) => june.find((l) => l.key === key) as Value

  it('counts Bitrix24 on every day and leaves MoySklad and the difference empty before its floor', () => {
    const i = juneDays.indexOf('2026-06-01')
    expect(get('all:orders:FAKT1:bitrix').days[i]).toBe(1)
    expect(get('all:orders:FAKT1:moysklad').days[i]).toBeNull()
    expect(get('all:orders:FAKT1:diff').days[i]).toBeNull()
    expect(get('all:orders:FAKT1:moysklad').days[juneDays.indexOf('2026-06-20')]).toBe(1)
  })

  it('does not count the orders MoySklad could not hold as a difference', () => {
    expect(get('all:orders:FAKT1:bitrix').total).toBe(2)
    expect(get('all:orders:FAKT1:moysklad').total).toBe(1)
    expect(get('all:orders:FAKT1:diff').total).toBe(0)
  })
})
