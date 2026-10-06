import { describe, expect, it } from 'vitest'

import type { RoistatCountersDto } from '@/features/roistat/roistatApi'
import { deltaPercent, deriveMetrics, fromUsd, fromUzs, roasOf, toDelta } from '@/features/roistat/roistatMetrics'

const RATE = 12_000

// Every counter named, so the type checker refuses this fixture the day the DTO gains one.
const ZERO: RoistatCountersDto = {
  spendUsd: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  metaLeads: 0,
  leads: 0,
  clean: 0,
  kval: 0,
  orders: 0,
  orderedUzs: 0,
  sold: 0,
  soldUzs: 0,
  newCustomers: 0,
  dealDaysSum: 0,
  dealCount: 0,
}

function counters(over: Partial<RoistatCountersDto>): RoistatCountersDto {
  return { ...ZERO, ...over }
}

const SAMPLE = counters({
  spendUsd: 1_000,
  impressions: 200_000,
  reach: 80_000,
  clicks: 4_000,
  metaLeads: 450,
  leads: 500,
  clean: 400,
  kval: 150,
  orders: 60,
  orderedUzs: 60_000_000,
  sold: 45,
  soldUzs: 48_000_000,
  newCustomers: 40,
  dealDaysSum: 135,
  dealCount: 45,
})

describe('deriveMetrics', () => {
  const m = deriveMetrics(SAMPLE, RATE)

  it('reads the reference met() ratios', () => {
    expect(m.qual).toBe(80) // clean / leads
    expect(m.cpl).toBe(2) // spend / leads, $
    expect(m.ql).toBe(30) // kval / leads
    expect(m.cpql).toBeCloseTo(1000 / 150) // spend / kval
    expect(m.buy).toBe(80) // sold so'm / ordered so'm — by money, not counts
    expect(m.cpo).toBeCloseTo(1000 / 45)
    expect(m.cac).toBe(25) // spend / new customers
    expect(m.avg).toBeCloseTo(48_000_000 / 45)
    expect(m.arpl).toBe(96_000) // sold so'm / leads
    expect(m.dealDays).toBe(3)
    expect(m.conv).toBe(9) // sold / leads
    expect(m.ctr).toBe(2) // clicks / impressions
    expect(m.cpm).toBe(5) // spend per 1 000 impressions
    expect(m.cpc).toBe(0.25)
    expect(m.freq).toBe(2.5) // impressions / reach
    expect(m.roas).toBe(4) // (48 mln / 12 000) / 1 000 $
  })

  it('answers null — never zero — when a divisor is zero', () => {
    const empty = deriveMetrics(ZERO, RATE)
    for (const value of Object.values(empty)) expect(value).toBeNull()
  })

  it('keeps a real zero when only the numerator is zero', () => {
    const z = deriveMetrics(counters({ leads: 10, spendUsd: 50 }), RATE)
    expect(z.ql).toBe(0)
    expect(z.conv).toBe(0)
    expect(z.roas).toBe(0)
    expect(z.cpo).toBeNull()
  })

  it('has no ROAS without a usable rate', () => {
    expect(deriveMetrics(SAMPLE, null).roas).toBeNull()
    expect(deriveMetrics(SAMPLE, 0).roas).toBeNull()
    // …and every other ratio is unit-native, so it does not need one.
    expect(deriveMetrics(SAMPLE, null).cpl).toBe(2)
  })

  it('prices nothing on a row no dollar reached, rather than «CPL 0»', () => {
    const unpaid = deriveMetrics({ ...SAMPLE, spendUsd: 0 }, 12_000)
    expect([unpaid.cpl, unpaid.cpql, unpaid.cpo, unpaid.cac, unpaid.cpc, unpaid.cpm]).toEqual([null, null, null, null, null, null])
    expect(unpaid.ql).not.toBeNull()
  })
})

describe('roasOf', () => {
  it('is null without spend', () => {
    expect(roasOf(1_000_000, 0, RATE)).toBeNull()
  })

  it('converts revenue to dollars at the rate', () => {
    expect(roasOf(24_000_000, 500, RATE)).toBe(4)
  })
})

describe('currency', () => {
  it('turns dollars into soʻm at the rate, and passes dollars through', () => {
    expect(fromUsd(2, 'uzs', RATE)).toBe(24_000)
    expect(fromUsd(2, 'usd', RATE)).toBe(2)
    expect(fromUsd(2, 'uzs', null)).toBeNull()
    expect(fromUsd(null, 'usd', RATE)).toBeNull()
  })

  it('turns soʻm into dollars at the rate, and passes soʻm through', () => {
    expect(fromUzs(24_000, 'usd', RATE)).toBe(2)
    expect(fromUzs(24_000, 'uzs', RATE)).toBe(24_000)
    expect(fromUzs(24_000, 'usd', null)).toBeNull()
    expect(fromUzs(null, 'uzs', RATE)).toBeNull()
  })
})

describe('deltaPercent', () => {
  it('is the signed change against the previous value', () => {
    expect(deltaPercent(120, 100)).toBe(20)
    expect(deltaPercent(80, 100)).toBe(-20)
    expect(deltaPercent(-50, -100)).toBe(50)
  })

  it('is null without a baseline', () => {
    expect(deltaPercent(5, 0)).toBeNull()
    expect(deltaPercent(5, null)).toBeNull()
    expect(deltaPercent(null, 5)).toBeNull()
  })
})

describe('toDelta', () => {
  it('reports a change with its direction', () => {
    expect(toDelta(150, 100)).toEqual({ kind: 'change', percent: 50, direction: 'up' })
    expect(toDelta(50, 100)).toEqual({ kind: 'change', percent: -50, direction: 'down' })
  })

  it('treats under half a percent as unchanged, as the reference does', () => {
    expect(toDelta(100.4, 100)).toEqual({ kind: 'unchanged' })
    expect(toDelta(0, 0)).toEqual({ kind: 'unchanged' })
  })

  it('separates no data from no baseline', () => {
    expect(toDelta(null, 100)).toEqual({ kind: 'no_data' })
    expect(toDelta(10, null)).toEqual({ kind: 'no_baseline' })
    expect(toDelta(10, 0)).toEqual({ kind: 'no_baseline' })
  })
})
