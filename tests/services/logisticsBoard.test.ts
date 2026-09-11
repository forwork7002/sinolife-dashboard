import { describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import type {
  InsightsRepository,
  LogisticsCohort,
  LogisticsCut,
} from '@/server/repositories/insightsRepository'
import { InsightsService } from '@/server/services/insightsService'

/**
 * THE CLIENT'S SHEET, AND THE FOUR PROPERTIES THAT MAKE IT READABLE.
 *
 * Logistika prints six columns the client approved by name and claims they are
 * the whole of ЗАКАЗ. Everything below is a way that claim fails silently —
 * a column that vanishes on a quiet day, a share that reads 0% over an empty
 * window, a coverage clamped at 100 when FAKT 2 legitimately exceeds FAKT 1,
 * an «Отказ» split the wrong way. None of them throws, and none of them looks
 * wrong on screen.
 *
 * The repository is faked because the SQL is pinned separately
 * (`tests/http/logisticsSql.test.ts`) and what this file measures is the
 * shaping: zero-fill, order, shares, and the three diagnostics.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-07T09:00:00+05:00')

/** Minor units, the way the whole application carries money. 1 soʻm = 100. */
const som = (n: number) => BigInt(n) * 100n

const ZERO: LogisticsCut = {
  bucket: '',
  sub: null,
  sort: null,
  orders: 0,
  amountMinor: 0n,
  fakt1Orders: 0,
  fakt1Minor: 0n,
  deliveredOrders: 0,
  deliveredMinor: 0n,
  refusedOrders: 0,
  refusedMinor: 0n,
  cancelledOrders: 0,
  cancelledMinor: 0n,
  inFlightOrders: 0,
  offRevenueOrders: 0,
  medianDays: null,
  medianWaitHours: null,
  waitedOrders: 0,
  waitingOrders: 0,
  waitingMinor: 0n,
  agedOrders: 0,
  agedMinor: 0n,
  medianWaitingDays: null,
  revivedOrders: 0,
  revivedMinor: 0n,
}

const cut = (over: Partial<LogisticsCut>): LogisticsCut => ({ ...ZERO, ...over })

/**
 * A cohort shaped like the client's own week, cut down to three columns.
 *
 * ЗАКАЗ 100 orders / 200 mln, of which 80 delivered, 12 refused and 8 still
 * waiting at a post office. «не собран», «ТАСТИКЛАНГАН» and «В пути» carry
 * nothing — which is the normal case on their sheet and the reason the
 * zero-fill exists.
 */
function cohort(over: Partial<LogisticsCohort> = {}): LogisticsCohort {
  return {
    fakt: cut({
      orders: 130,
      fakt1Orders: 100,
      fakt1Minor: som(200_000_000),
      deliveredOrders: 80,
      deliveredMinor: som(160_000_000),
      medianDays: 3.04,
    }),
    total: cut({ fakt1Orders: 100, fakt1Minor: som(200_000_000) }),
    buckets: [
      cut({ bucket: 'DONE', fakt1Orders: 80, fakt1Minor: som(160_000_000) }),
      cut({
        bucket: 'REFUSED',
        fakt1Orders: 12,
        fakt1Minor: som(24_000_000),
        // Journey, not stage: every one of them had already reached a hub.
        refusedOrders: 12,
        refusedMinor: som(24_000_000),
      }),
      cut({ bucket: 'WAITING', fakt1Orders: 8, fakt1Minor: som(16_000_000) }),
    ],
    parts: [
      cut({ bucket: 'WAITING', sub: 'CARRIER', fakt1Orders: 5, fakt1Minor: som(11_000_000) }),
      cut({ bucket: 'WAITING', sub: 'REGIONAL_HUB', fakt1Orders: 3, fakt1Minor: som(5_000_000) }),
      cut({
        bucket: 'REFUSED',
        sub: 'CANCELLED_EARLY',
        fakt1Orders: 12,
        fakt1Minor: som(24_000_000),
      }),
    ],
    days: [
      cut({ bucket: 'DONE', sub: '2026-09-05', fakt1Orders: 40, fakt1Minor: som(80_000_000) }),
      cut({ bucket: 'REFUSED', sub: '2026-09-05', fakt1Orders: 10, fakt1Minor: som(20_000_000) }),
      cut({ bucket: 'DONE', sub: '2026-09-07', fakt1Orders: 40, fakt1Minor: som(80_000_000) }),
    ],
    dayTotals: [
      cut({ sub: '2026-09-05', fakt1Orders: 50, fakt1Minor: som(100_000_000) }),
      cut({ sub: '2026-09-07', fakt1Orders: 40, fakt1Minor: som(80_000_000) }),
    ],
    posts: [
      cut({
        bucket: 'Доставка · CARAVAN',
        fakt1Orders: 60,
        fakt1Minor: som(120_000_000),
        deliveredOrders: 48,
        refusedOrders: 6,
        cancelledOrders: 0,
        inFlightOrders: 6,
        medianDays: 3.11,
      }),
      // Nothing moved through it, and it is still a row.
      cut({ bucket: 'Доставка · OSON POCHTA' }),
    ],
    postTotal: cut({ fakt1Orders: 92 }),
    regions: [cut({ bucket: 'Тошкент', fakt1Orders: 30, fakt1Minor: som(60_000_000) })],
    regionTotal: cut({ fakt1Orders: 100 }),
    stages: [
      cut({
        bucket: 'Доставка · Доставлено',
        sub: 'DONE',
        sort: 6170,
        fakt1Orders: 80,
        fakt1Minor: som(160_000_000),
      }),
      cut({ bucket: 'Доставка · Отказ предварительно', sub: 'REFUSED', sort: 6160, fakt1Orders: 12 }),
    ],
    stageTotal: cut({ fakt1Orders: 100 }),
    waits: [
      cut({ bucket: '1', fakt1Orders: 60, deliveredOrders: 57 }),
      cut({ bucket: '4', fakt1Orders: 32, deliveredOrders: 20 }),
    ],
    ...over,
  }
}

function serviceOver(cuts: LogisticsCohort) {
  const repository = {
    logisticsCohort: async () => cuts,
    // The unbounded snapshot is a second statement; this file measures the
    // shaping of the windowed one, so it answers empty.
    logisticsStanding: async () => [],
    logisticsStandingOrders: async () => [],
  } as unknown as InsightsRepository

  const service = new InsightsService(repository)
  return (preset: 'this_week' | 'this_month' = 'this_week') =>
    service.logistics(resolvePeriod(preset, { timeZone: TZ, now: NOW }), 'UZS')
}

describe('the six columns are the whole of ЗАКАЗ', () => {
  it('prints all six in the client’s order, zeros included', async () => {
    const dto = await serviceOver(cohort())()

    expect(dto.summary.buckets.map((b) => b.key)).toEqual([
      'PREPARING',
      'WAREHOUSE',
      'IN_TRANSIT',
      'WAITING',
      'REFUSED',
      'DONE',
    ])
    expect(dto.summary.buckets.map((b) => b.label)).toEqual([
      'ТАСТИКЛАНГАН',
      'не собран',
      'В пути',
      'Ожидание / нд',
      'Отказ',
      'Успешно',
    ])
    // The three the repository never returned still print, as zero.
    expect(dto.summary.buckets[0]).toMatchObject({ orders: 0, sharePercent: 0 })
  })

  it('sums to ЗАКАЗ, in money and in orders', async () => {
    const dto = await serviceOver(cohort())()

    const orders = dto.summary.buckets.reduce((sum, b) => sum + b.orders, 0)
    const money = dto.summary.buckets.reduce((sum, b) => sum + BigInt(b.amount.amountMinor), 0n)

    expect(orders).toBe(dto.summary.orderedOrders)
    expect(money.toString()).toBe(dto.summary.ordered.amountMinor)
  })

  it('reports the orders that left the funnel instead of losing them', async () => {
    // 100 in the cohort, 88 still standing in a Доставка stage.
    const dto = await serviceOver(cohort({ stageTotal: cut({ fakt1Orders: 88 }) }))()
    expect(dto.summary.unbucketedOrders).toBe(12)
  })

  it('carries the revenue tripwire to the payload', async () => {
    const dto = await serviceOver(
      cohort({ fakt: cut({ fakt1Orders: 100, fakt1Minor: som(1), offRevenueOrders: 3 }) }),
    )()
    expect(dto.summary.offRevenueOrders).toBe(3)
  })
})

describe('ЗАКАЗ is FAKT 1 and Успешно is FAKT 2', () => {
  it('names both, and takes coverage from the pair', async () => {
    const dto = await serviceOver(cohort())()

    expect(dto.summary.ordered.amountMinor).toBe(som(200_000_000).toString())
    expect(dto.summary.won.amountMinor).toBe(som(160_000_000).toString())
    expect(dto.summary.coveragePercent).toBe(80)
    expect(dto.summary.cohortOrders).toBe(130)
  })

  /*
    FAKT 2 IS NOT A SUBSET OF FAKT 1, so coverage may exceed 100 and must not
    be clamped: an order refused in the queue and revived afterwards is
    delivered money that never counted as confirmed. Clamping hides exactly the
    case the reader needs explained.
  */
  it('lets coverage pass 100 rather than clamping it', async () => {
    const dto = await serviceOver(
      cohort({
        fakt: cut({
          orders: 130,
          fakt1Orders: 100,
          fakt1Minor: som(100_000_000),
          deliveredOrders: 82,
          deliveredMinor: som(104_000_000),
        }),
        total: cut({ fakt1Orders: 100, fakt1Minor: som(100_000_000) }),
      }),
    )()

    expect(dto.summary.coveragePercent).toBe(104)
  })

  /*
    A rate with no denominator is null, never 0. An empty window and a window
    where a column happens to hold nothing are different claims, and the Meter
    draws a bar from this.
  */
  it('gives an empty window null shares, not zeroes', async () => {
    const empty = cohort({
      fakt: ZERO,
      total: ZERO,
      buckets: [],
      parts: [],
      days: [],
      dayTotals: [],
      stageTotal: ZERO,
      postTotal: ZERO,
    })
    const dto = await serviceOver(empty)()

    expect(dto.summary.coveragePercent).toBeNull()
    for (const bucket of dto.summary.buckets) {
      expect(bucket.sharePercent).toBeNull()
      expect(bucket.shareOfOrdersPercent).toBeNull()
    }
  })
})

describe('«Отказ» keeps its two halves apart', () => {
  it('splits by journey, not by stage name', async () => {
    const dto = await serviceOver(cohort())()
    const refused = dto.summary.buckets.find((b) => b.key === 'REFUSED')!

    // Every one of the twelve stands in «Отказ предварительно» — and every one
    // had already reached a hub. Read from the stage the column would say
    // nothing came back.
    expect(refused.parts.map((p) => p.role)).toEqual(['CANCELLED_EARLY'])
    expect(refused.returnedOrders).toBe(12)
    expect(refused.cancelledOrders).toBe(0)
    expect(refused.returnedOrders + refused.cancelledOrders).toBe(refused.orders)
  })

  it('carries the roles under «Ожидание / нд» too', async () => {
    const dto = await serviceOver(cohort())()
    const waiting = dto.summary.buckets.find((b) => b.key === 'WAITING')!

    // Sorted by money, so the expensive half is first under the hover.
    expect(waiting.parts.map((p) => p.role)).toEqual(['CARRIER', 'REGIONAL_HUB'])
    expect(waiting.parts.reduce((sum, p) => sum + p.orders, 0)).toBe(waiting.orders)
  })
})

describe('the daily sheet', () => {
  it('zero-fills every day of the window, in order', async () => {
    const dto = await serviceOver(cohort())()

    // this_week at 2026-09-07 (a Monday-started week) runs 07.09 to date.
    expect(dto.days.length).toBeGreaterThan(0)
    expect(dto.days.map((d) => d.date)).toEqual([...dto.days.map((d) => d.date)].sort())
    for (const day of dto.days) {
      expect(day.buckets).toHaveLength(6)
    }
  })

  it('gives a day with orders its own coverage, and an empty day null', async () => {
    const dto = await serviceOver(cohort())('this_month')
    const withOrders = dto.days.find((d) => d.date === '2026-09-05')
    const empty = dto.days.find((d) => d.orders === 0)

    if (withOrders) expect(withOrders.coveragePercent).toBe(80)
    if (empty) expect(empty.coveragePercent).toBeNull()
  })
})

describe('the post offices and the reconciliation', () => {
  it('strips the funnel prefix the importer wrote', async () => {
    const dto = await serviceOver(cohort())()

    expect(dto.posts.map((p) => p.label)).toEqual(['CARAVAN', 'OSON POCHTA'])
    expect(dto.reconciliation.map((r) => r.stage)).toEqual([
      'Доставлено',
      'Отказ предварительно',
    ])
  })

  it('keeps a post office that moved nothing, and gives it no rate', async () => {
    const dto = await serviceOver(cohort())()
    const idle = dto.posts.find((p) => p.label === 'OSON POCHTA')!

    expect(idle.orders).toBe(0)
    expect(idle.deliveryRate).toBeNull()
    expect(idle.medianDays).toBeNull()
  })

  it('rates a post office over resolved orders, excluding what is still moving', async () => {
    const dto = await serviceOver(cohort())()
    const caravan = dto.posts.find((p) => p.label === 'CARAVAN')!

    // 48 delivered of 54 resolved — the six still in flight are reported
    // beside it, never counted against it.
    expect(caravan.inFlight).toBe(6)
    expect(caravan.deliveryRate).toBeCloseTo(88.9, 1)
  })

  it('takes each stage’s column from the server, not from the browser', async () => {
    const dto = await serviceOver(cohort())()
    expect(dto.reconciliation.map((r) => r.bucket)).toEqual(['DONE', 'REFUSED'])
  })

})

describe('nothing bigint reaches the wire', () => {
  /*
    `JSON.stringify` THROWS on a BigInt, so one left anywhere under this DTO is
    a 500 that no typecheck and no other assertion here would name — the money
    domain carries minor units as BigInt right up to `toMoneyDto`.
  */
  it('serialises', async () => {
    const dto = await serviceOver(cohort())()
    expect(() => JSON.stringify(dto)).not.toThrow()
  })
})
