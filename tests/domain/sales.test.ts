import { describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import {
  type AnalyticsDeal,
  type AnalyticsDealItem,
  type FunnelStageDefinition,
  closedIn,
  createdIn,
  groupRevenue,
  openAsOf,
  productRevenue,
  revenueTrend,
  stageFunnel,
  summarizeDeals,
} from '@/server/domain/analytics/sales'

const TZ = 'Asia/Tashkent'
const UZS = 'UZS'
const NOW = new Date('2026-08-23T09:30:00.000Z')

const august = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
const july = resolvePeriod('previous_month', { timeZone: TZ, now: NOW })

/** Build a deal with sane defaults; override only what a test cares about. */
function deal(overrides: Partial<AnalyticsDeal> & { id: string }): AnalyticsDeal {
  return {
    amountMinor: 100_000_00n,
    currency: UZS,
    status: 'OPEN',
    stageId: 'stg-1',
    stageCategory: 'NEW',
    employeeId: 'emp-1',
    createdAtSource: new Date('2026-08-05T06:00:00.000Z'),
    ...overrides,
  }
}

/** A won deal closed on the given local date. */
function won(id: string, amountMinor: bigint, closedIso: string, employeeId = 'emp-1') {
  return deal({
    id,
    amountMinor,
    status: 'WON',
    stageId: 'stg-6',
    stageCategory: 'WON',
    employeeId,
    createdAtSource: new Date('2026-07-20T06:00:00.000Z'),
    closedAt: new Date(closedIso),
  })
}

function lost(id: string, closedIso: string, employeeId = 'emp-1') {
  return deal({
    id,
    status: 'LOST',
    stageId: 'stg-7',
    stageCategory: 'LOST',
    employeeId,
    createdAtSource: new Date('2026-07-20T06:00:00.000Z'),
    closedAt: new Date(closedIso),
  })
}

describe('period filters', () => {
  const deals = [
    deal({ id: 'created-in-august', createdAtSource: new Date('2026-08-05T06:00:00.000Z') }),
    deal({ id: 'created-in-july', createdAtSource: new Date('2026-07-05T06:00:00.000Z') }),
    won('won-in-august', 50_000_00n, '2026-08-10T06:00:00.000Z'),
    won('won-in-july', 70_000_00n, '2026-07-10T06:00:00.000Z'),
  ]

  it('selects by created date', () => {
    expect(createdIn(deals, august).map((d) => d.id)).toEqual(['created-in-august'])
  })

  it('selects by closed date, independent of creation date', () => {
    // 'won-in-august' was created in July but closed in August.
    expect(closedIn(deals, august).map((d) => d.id)).toEqual(['won-in-august'])
    expect(closedIn(deals, july).map((d) => d.id)).toEqual(['won-in-july'])
  })

  it('reports the pipeline as it stood at the end of a past period', () => {
    // At the end of July, 'won-in-august' had not closed yet, so it was open.
    const openEndOfJuly = openAsOf(deals, july).map((d) => d.id)
    expect(openEndOfJuly).toContain('created-in-july')
    expect(openEndOfJuly).toContain('won-in-august')
    // ...but a deal created in August did not exist yet.
    expect(openEndOfJuly).not.toContain('created-in-august')
  })
})

describe('summarizeDeals', () => {
  const deals = [
    won('w1', 100_000_00n, '2026-08-05T06:00:00.000Z'),
    won('w2', 200_000_00n, '2026-08-12T06:00:00.000Z'),
    won('w3', 300_000_00n, '2026-08-20T06:00:00.000Z'),
    lost('l1', '2026-08-08T06:00:00.000Z'),
    deal({ id: 'o1', createdAtSource: new Date('2026-08-02T06:00:00.000Z') }),
    deal({ id: 'o2', createdAtSource: new Date('2026-08-18T06:00:00.000Z') }),
    // Noise from an adjacent period that must not leak in.
    won('july', 999_000_00n, '2026-07-15T06:00:00.000Z'),
  ]

  const summary = summarizeDeals(deals, august, UZS)

  it('counts revenue from deals won in the period only', () => {
    expect(summary.revenue.amountMinor).toBe(600_000_00n)
  })

  it('counts won and lost deals', () => {
    expect(summary.dealsWon).toBe(3)
    expect(summary.dealsLost).toBe(1)
  })

  it('counts deals created in the period', () => {
    expect(summary.dealsCreated).toBe(2)
  })

  it('counts deals open at period end', () => {
    expect(summary.dealsOpen).toBe(2)
  })

  it('averages only the won deals', () => {
    expect(summary.averageDeal?.amountMinor).toBe(200_000_00n)
  })

  it('computes conversion from resolved deals', () => {
    expect(summary.conversionRatePercent).toBe(75)
  })

  it('values the open pipeline separately from revenue', () => {
    expect(summary.pipelineValue.amountMinor).toBe(200_000_00n)
  })
})

describe('summarizeDeals on empty input', () => {
  const summary = summarizeDeals([], august, UZS)

  it('reports zero revenue rather than throwing', () => {
    expect(summary.revenue.amountMinor).toBe(0n)
    expect(summary.revenue.currency).toBe(UZS)
  })

  it('reports a null average, not zero', () => {
    // "No deals won" must stay distinguishable from "average deal is 0 so'm".
    expect(summary.averageDeal).toBeNull()
  })

  it('reports a null conversion rate, not 0%', () => {
    expect(summary.conversionRatePercent).toBeNull()
  })

  it('reports zero counts', () => {
    expect(summary.dealsCreated).toBe(0)
    expect(summary.dealsWon).toBe(0)
    expect(summary.dealsOpen).toBe(0)
  })
})

describe('revenueTrend', () => {
  const deals = [
    won('a', 10_000_00n, '2026-08-01T06:00:00.000Z'),
    won('b', 20_000_00n, '2026-08-01T10:00:00.000Z'),
    won('c', 30_000_00n, '2026-08-03T06:00:00.000Z'),
  ]

  const trend = revenueTrend(deals, august, UZS, 'day')

  it('produces one point per day of the period', () => {
    expect(trend).toHaveLength(23)
  })

  it('keeps empty buckets rather than dropping them', () => {
    // 2 August had no activity; the point must still exist, at zero.
    const secondOfAugust = trend[1]!
    expect(secondOfAugust.revenue.amountMinor).toBe(0n)
    expect(secondOfAugust.dealsWon).toBe(0)
  })

  it('sums deals falling in the same bucket', () => {
    expect(trend[0]!.revenue.amountMinor).toBe(30_000_00n)
    expect(trend[0]!.dealsWon).toBe(2)
  })

  it('reconciles exactly with the period total', () => {
    const total = trend.reduce((sum, point) => sum + point.revenue.amountMinor, 0n)
    expect(total).toBe(summarizeDeals(deals, august, UZS).revenue.amountMinor)
  })
})

describe('groupRevenue', () => {
  const deals = [
    won('a', 100_000_00n, '2026-08-05T06:00:00.000Z', 'emp-1'),
    won('b', 300_000_00n, '2026-08-06T06:00:00.000Z', 'emp-2'),
    lost('c', '2026-08-07T06:00:00.000Z', 'emp-1'),
  ]

  const groups = groupRevenue(deals, august, UZS, (d) => d.employeeId)

  it('sorts by revenue, descending', () => {
    expect(groups.map((g) => g.key)).toEqual(['emp-2', 'emp-1'])
  })

  it('computes each group share', () => {
    expect(groups[0]!.sharePercent).toBe(75)
    expect(groups[1]!.sharePercent).toBe(25)
  })

  it('counts lost deals in the total but not in revenue', () => {
    const empOne = groups.find((g) => g.key === 'emp-1')!
    expect(empOne.dealsTotal).toBe(2)
    expect(empOne.dealsWon).toBe(1)
  })

  it('collects unkeyed deals under an explicit unknown bucket', () => {
    // Dropping them would stop the groups adding up to headline revenue.
    const withMissing = [...deals, won('d', 50_000_00n, '2026-08-09T06:00:00.000Z')]
    const bySource = groupRevenue(withMissing, august, UZS, (d) => d.sourceId)
    expect(bySource.map((g) => g.key)).toContain('unknown')
    const total = bySource.reduce((sum, g) => sum + g.revenue.amountMinor, 0n)
    expect(total).toBe(450_000_00n)
  })

  it('returns null shares when nothing was won', () => {
    const onlyLost = groupRevenue([lost('x', '2026-08-05T06:00:00.000Z')], august, UZS, (d) => d.employeeId)
    expect(onlyLost[0]!.sharePercent).toBeNull()
  })
})

describe('productRevenue', () => {
  const deals = [
    won('d1', 150_000_00n, '2026-08-05T06:00:00.000Z'),
    won('d2', 50_000_00n, '2026-08-06T06:00:00.000Z'),
    lost('d3', '2026-08-07T06:00:00.000Z'),
  ]

  const items: AnalyticsDealItem[] = [
    { dealId: 'd1', productId: 'prd-1', quantity: 2, totalMinor: 100_000_00n },
    { dealId: 'd1', productId: 'prd-2', quantity: 1, totalMinor: 50_000_00n },
    { dealId: 'd2', productId: 'prd-1', quantity: 1, totalMinor: 50_000_00n },
    // Belongs to a lost deal, so it must not count.
    { dealId: 'd3', productId: 'prd-3', quantity: 9, totalMinor: 900_000_00n },
  ]

  const rows = productRevenue(deals, items, august, UZS)

  it('counts only items from deals won in the period', () => {
    expect(rows.map((r) => r.key)).toEqual(['prd-1', 'prd-2'])
  })

  it('aggregates a product across deals', () => {
    expect(rows[0]!.revenue.amountMinor).toBe(150_000_00n)
    expect(rows[0]!.dealsWon).toBe(2)
  })

  it('reconciles with headline revenue', () => {
    const total = rows.reduce((sum, r) => sum + r.revenue.amountMinor, 0n)
    expect(total).toBe(summarizeDeals(deals, august, UZS).revenue.amountMinor)
  })

  it('returns an empty list when nothing was won', () => {
    expect(productRevenue([lost('x', '2026-08-05T06:00:00.000Z')], items, august, UZS)).toEqual([])
  })
})

describe('stageFunnel', () => {
  const stages: FunnelStageDefinition[] = [
    { id: 'stg-1', name: 'Yangi', sortOrder: 1, category: 'NEW' },
    { id: 'stg-2', name: 'Aloqada', sortOrder: 2, category: 'IN_PROGRESS' },
    { id: 'stg-6', name: 'Muvaffaqiyatli', sortOrder: 6, category: 'WON' },
  ]

  const deals = [
    deal({ id: 'a', createdAtSource: new Date('2026-08-02T06:00:00.000Z'), stageId: 'stg-1' }),
    deal({ id: 'b', createdAtSource: new Date('2026-08-03T06:00:00.000Z'), stageId: 'stg-1' }),
    deal({ id: 'c', createdAtSource: new Date('2026-08-04T06:00:00.000Z'), stageId: 'stg-2' }),
    deal({
      id: 'd',
      createdAtSource: new Date('2026-08-05T06:00:00.000Z'),
      stageId: 'stg-6',
      status: 'WON',
      stageCategory: 'WON',
      closedAt: new Date('2026-08-10T06:00:00.000Z'),
    }),
  ]

  const funnel = stageFunnel(deals, stages, august, UZS)

  it('returns steps in funnel order', () => {
    expect(funnel.map((s) => s.stageId)).toEqual(['stg-1', 'stg-2', 'stg-6'])
  })

  it('counts the cohort in each stage', () => {
    expect(funnel.map((s) => s.dealCount)).toEqual([2, 1, 1])
  })

  it('expresses each step as a share of the cohort', () => {
    expect(funnel[0]!.reachedPercent).toBe(50)
    expect(funnel[1]!.reachedPercent).toBe(25)
  })

  it('includes stages with no deals at zero rather than omitting them', () => {
    const withEmpty = stageFunnel(
      [deals[0]!],
      stages,
      august,
      UZS,
    )
    expect(withEmpty).toHaveLength(3)
    expect(withEmpty[1]!.dealCount).toBe(0)
    expect(withEmpty[1]!.value.amountMinor).toBe(0n)
  })

  it('returns null shares for an empty cohort', () => {
    const empty = stageFunnel([], stages, august, UZS)
    expect(empty.every((s) => s.reachedPercent === null)).toBe(true)
  })
})
