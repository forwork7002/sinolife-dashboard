import { describe, expect, it } from 'vitest'

import {
  HHI_CONCENTRATED_BP,
  HHI_MODERATE_BP,
  REPURCHASE_HORIZON_DAYS,
  countForCoverage,
  hhiBand,
  hhiBp,
  pareto,
  topShareOfTotalPercent,
} from '@/server/domain/analytics/concentration'

// ---------------------------------------------------------------------------
// Pareto
// ---------------------------------------------------------------------------

describe('topShareOfTotalPercent', () => {
  it('reports the top-N share of an unequal distribution', () => {
    // 80 of 100 sits in one customer.
    expect(topShareOfTotalPercent([80n, 10n, 5n, 5n], 1)).toBe(80)
    expect(topShareOfTotalPercent([80n, 10n, 5n, 5n], 2)).toBe(90)
  })

  it('does not require the input to be sorted', () => {
    expect(topShareOfTotalPercent([5n, 80n, 5n, 10n], 1)).toBe(80)
  })

  it('answers 100 when fewer groups exist than N — a fact, not an edge case', () => {
    // Five customers hold "the top ten's" share by holding everything.
    expect(topShareOfTotalPercent([3n, 2n, 1n], 10)).toBe(100)
  })

  it('returns null over a zero total — a share of nothing is unmeasured', () => {
    expect(topShareOfTotalPercent([], 5)).toBeNull()
    expect(topShareOfTotalPercent([0n, 0n], 5)).toBeNull()
  })

  it('stays exact where float division would drift', () => {
    // A ninety-billion-soʻm month in minor units: beyond 2^53, where
    // Number(total) would already have lost precision.
    const nineBillion = 9_000_000_000_000_000n
    const share = topShareOfTotalPercent([nineBillion, nineBillion * 3n], 1)
    expect(share).toBe(75)
  })
})

describe('countForCoverage', () => {
  it('finds how few customers cover 80% of revenue', () => {
    // 10 equal customers: 8 of them are needed for exactly 80%.
    expect(countForCoverage(Array.from({ length: 10 }, () => 10n))).toBe(8)
  })

  it('reports 1 for a single dominant customer', () => {
    expect(countForCoverage([80n, 10n, 5n, 5n])).toBe(1)
  })

  it('treats the exact boundary as covered — BigInt, no float epsilon', () => {
    // First customer holds exactly 80%.
    expect(countForCoverage([8n, 1n, 1n])).toBe(1)
  })

  it('returns null over a zero total', () => {
    expect(countForCoverage([])).toBeNull()
    expect(countForCoverage([0n])).toBeNull()
  })
})

describe('pareto', () => {
  it('assembles the whole card', () => {
    const summary = pareto(Array.from({ length: 20 }, (_, i) => (i === 0 ? 810n : 10n)))
    // 810 + 19x10 = 1000: top-1 is 81%, so one customer already covers 80%.
    expect(summary.top5SharePercent).toBe(85)
    expect(summary.top10SharePercent).toBe(90)
    expect(summary.customersFor80Percent).toBe(1)
    expect(summary.totalCustomers).toBe(20)
  })

  it('counts zero-revenue customers without letting them move the shares', () => {
    const summary = pareto([50n, 50n, 0n, 0n])
    // The giveaways are customers the period served — they belong in the
    // count — but hold no share and cannot dilute the top-N sums.
    expect(summary.totalCustomers).toBe(4)
    expect(summary.top5SharePercent).toBe(100)
    expect(summary.customersFor80Percent).toBe(2)
  })

  it('reports an empty period as unmeasured, not as perfectly spread', () => {
    expect(pareto([])).toEqual({
      top5SharePercent: null,
      top10SharePercent: null,
      customersFor80Percent: null,
      totalCustomers: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// HHI
// ---------------------------------------------------------------------------

describe('hhiBp', () => {
  it('scores a monopoly at 10000', () => {
    expect(hhiBp([123_456_789n])).toBe(10_000)
  })

  it('scores ten equal channels at 1000', () => {
    expect(hhiBp(Array.from({ length: 10 }, () => 7n))).toBe(1_000)
  })

  it('scores four equal channels at exactly the concentrated threshold', () => {
    expect(hhiBp([25n, 25n, 25n, 25n])).toBe(HHI_CONCENTRATED_BP)
  })

  it('squares exact shares, not per-group rounded ones', () => {
    // Shares 2/3 and 1/3: HHI = (66.67² + 33.33²) ≈ 5555. Rounding each share
    // to whole bp before squaring would land elsewhere.
    expect(hhiBp([2n, 1n])).toBe(5_555)
  })

  it('ignores non-positive groups — no money means no share', () => {
    expect(hhiBp([50n, 50n, 0n])).toBe(5_000)
  })

  it('returns null over no revenue — unmeasured, not "diversified"', () => {
    expect(hhiBp([])).toBeNull()
    expect(hhiBp([0n, 0n])).toBeNull()
  })
})

describe('hhiBand', () => {
  it('maps the DOJ thresholds, boundaries reading as the more alarming band', () => {
    expect(hhiBand(10_000)).toBe('concentrated')
    expect(hhiBand(HHI_CONCENTRATED_BP)).toBe('concentrated')
    expect(hhiBand(HHI_CONCENTRATED_BP - 1)).toBe('moderate')
    expect(hhiBand(HHI_MODERATE_BP)).toBe('moderate')
    expect(hhiBand(HHI_MODERATE_BP - 1)).toBe('diversified')
    expect(hhiBand(0)).toBe('diversified')
  })
})

// ---------------------------------------------------------------------------
// Repeat purchase
// ---------------------------------------------------------------------------

describe('REPURCHASE_HORIZON_DAYS', () => {
  it('is the one constant both the cohort shift and the window read', () => {
    // The SQL shifts the cohort back by exactly this horizon so every member
    // has had the full window to come back; a drift between the two numbers
    // would silently censor the rate.
    expect(REPURCHASE_HORIZON_DAYS).toBe(90)
  })
})
