import { describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import {
  type AnalyticsDeal,
  closedIn,
  createdIn,
  openAsOf,
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
