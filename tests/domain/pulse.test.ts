import { describe, expect, it } from 'vitest'

import {
  PROJECTION_ELAPSED_FLOOR,
  STUCK_DWELL_MULTIPLIER,
  aggregateAging,
  conversionFromPrevious,
  fullUnitWindow,
  isStuck,
  projectRevenueMinor,
  projectionElapsedFraction,
  salesVelocityPerDayMinor,
  stuckThresholdHours,
} from '@/server/domain/analytics/pulse'
import { resolvePeriod } from '@/server/domain/period/period'

const TZ = 'Asia/Tashkent' // UTC+5, no daylight saving

/** 23 August 2026, 14:30 Tashkent == 09:30 UTC. */
const NOW = new Date('2026-08-23T09:30:00.000Z')

// ---------------------------------------------------------------------------
// Sales velocity
// ---------------------------------------------------------------------------

describe('salesVelocityPerDayMinor', () => {
  it('composes the four components exactly', () => {
    // 100 open x 40% x 1,000,000 minor / 10 days = 4,000,000 minor per day.
    const velocity = salesVelocityPerDayMinor({
      openDeals: 100,
      winRatePercent: 40,
      avgWonAmountMinor: 1_000_000n,
      medianCycleDays: 10,
    })
    expect(velocity).toBe(4_000_000n)
  })

  it('stays exact where a float pipeline would drift', () => {
    // A UZS-scale amount: 1.58 mln soʻm in minor units, over a 12.5-day cycle.
    const velocity = salesVelocityPerDayMinor({
      openDeals: 4_223,
      winRatePercent: 37.5,
      avgWonAmountMinor: 158_000_000n,
      medianCycleDays: 12.5,
    })
    // 4223 x 3750bp x 158e6 x 1000 / (10000 x 12500), computed by hand.
    expect(velocity).toBe(20_017_020_000n)
  })

  it('returns null when any component is missing, not a silent zero', () => {
    const base = {
      openDeals: 100,
      winRatePercent: 40,
      avgWonAmountMinor: 1_000_000n,
      medianCycleDays: 10,
    }
    expect(salesVelocityPerDayMinor({ ...base, winRatePercent: null })).toBeNull()
    expect(salesVelocityPerDayMinor({ ...base, avgWonAmountMinor: null })).toBeNull()
    expect(salesVelocityPerDayMinor({ ...base, medianCycleDays: null })).toBeNull()
  })

  it('rejects a zero or negative cycle rather than dividing by it', () => {
    const base = {
      openDeals: 100,
      winRatePercent: 40,
      avgWonAmountMinor: 1_000_000n,
    }
    expect(salesVelocityPerDayMinor({ ...base, medianCycleDays: 0 })).toBeNull()
    expect(salesVelocityPerDayMinor({ ...base, medianCycleDays: -3 })).toBeNull()
  })

  it('reports a real zero for an empty pipeline — a claim, not a gap', () => {
    const velocity = salesVelocityPerDayMinor({
      openDeals: 0,
      winRatePercent: 40,
      avgWonAmountMinor: 1_000_000n,
      medianCycleDays: 10,
    })
    expect(velocity).toBe(0n)
  })
})

// ---------------------------------------------------------------------------
// Run-rate forecast
// ---------------------------------------------------------------------------

describe('fullUnitWindow', () => {
  it('expands this_month to the whole calendar month', () => {
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const full = fullUnitWindow(period)
    // The to-date period ends tomorrow-midnight; the full unit ends 1 Sept.
    expect(full.start.toISOString()).toBe(period.start.toISOString())
    expect(full.end.toISOString()).toBe('2026-08-31T19:00:00.000Z') // 1 Sept 00:00 Tashkent
  })

  it('expands this_week to its full seven days', () => {
    const period = resolvePeriod('this_week', { timeZone: TZ, now: NOW })
    const full = fullUnitWindow(period)
    // Week of Mon 17 Aug — full unit ends Mon 24 Aug local midnight.
    expect(full.end.toISOString()).toBe('2026-08-23T19:00:00.000Z')
  })

  it('leaves already-complete presets untouched', () => {
    for (const preset of ['yesterday', 'previous_month'] as const) {
      const period = resolvePeriod(preset, { timeZone: TZ, now: NOW })
      expect(fullUnitWindow(period)).toBe(period)
    }
  })

  it('leaves today untouched — the day IS its own full unit', () => {
    const period = resolvePeriod('today', { timeZone: TZ, now: NOW })
    expect(fullUnitWindow(period)).toBe(period)
  })
})

describe('projectionElapsedFraction', () => {
  it('measures against the full month, not the to-date window', () => {
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const fraction = projectionElapsedFraction(period, NOW)
    // 22 days + 14.5 hours of 31 days ≈ 72.9%. Against the TO-DATE window it
    // would read ~98% and the projection would forecast nothing.
    expect(fraction).toBeGreaterThan(0.72)
    expect(fraction).toBeLessThan(0.74)
  })

  it('reads 1 for a period that is fully in the past', () => {
    const period = resolvePeriod('previous_month', { timeZone: TZ, now: NOW })
    expect(projectionElapsedFraction(period, NOW)).toBe(1)
  })
})

describe('projectRevenueMinor', () => {
  it('projects period-to-date over the elapsed fraction', () => {
    // 500 at 50% elapsed -> 1000.
    expect(projectRevenueMinor(500n, 0.5)).toBe(1_000n)
  })

  it('returns the actual, exactly, once the period is complete', () => {
    // Not re-derived through fixed-point division: a finished month must never
    // show a projection off by a rounding step from its own total.
    expect(projectRevenueMinor(123_456_789n, 1)).toBe(123_456_789n)
  })

  it('declines to project below the elapsed floor', () => {
    // Half an hour into the month: whatever the night shift closed x1400 is
    // not a forecast. Null renders as an em dash.
    expect(projectRevenueMinor(9_000_000n, PROJECTION_ELAPSED_FLOOR / 2)).toBeNull()
    expect(projectRevenueMinor(9_000_000n, PROJECTION_ELAPSED_FLOOR)).not.toBeNull()
  })

  it('handles a non-finite fraction as no data', () => {
    expect(projectRevenueMinor(1_000n, Number.NaN)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Stage conversion
// ---------------------------------------------------------------------------

describe('conversionFromPrevious', () => {
  const stage = (pipelineId: string, sortOrder: number, dealCount: number) => ({
    pipelineId,
    sortOrder,
    dealCount,
  })

  it('computes each stage against its predecessor, per pipeline', () => {
    const rows = conversionFromPrevious([
      stage('p1', 1, 200),
      stage('p1', 2, 150),
      stage('p1', 3, 120),
      stage('p2', 1, 50),
      stage('p2', 2, 25),
    ])

    expect(rows.map((r) => r.conversionFromPreviousPercent)).toEqual([
      null, // first stage of p1 — no predecessor
      75,
      80,
      null, // pipeline boundary: p2's first stage must NOT convert from p1's last
      50,
    ])
  })

  it('reports null, not 0% or 100%, after an empty predecessor', () => {
    const rows = conversionFromPrevious([
      stage('p1', 1, 0),
      stage('p1', 2, 3),
    ])
    // "100% of nothing" is not a conversion.
    expect(rows[1]!.conversionFromPreviousPercent).toBeNull()
  })

  it('lets a stage exceed 100% — that is how skipped stages become visible', () => {
    const rows = conversionFromPrevious([
      stage('p1', 1, 10),
      stage('p1', 2, 14), // deals entered the pipeline mid-way
    ])
    expect(rows[1]!.conversionFromPreviousPercent).toBeCloseTo(140)
  })
})

// ---------------------------------------------------------------------------
// Stuck deals
// ---------------------------------------------------------------------------

describe('stuck thresholds', () => {
  it('doubles the stage historical median', () => {
    expect(STUCK_DWELL_MULTIPLIER).toBe(2)
    expect(stuckThresholdHours(24)).toBe(48)
  })

  it('has no threshold without a baseline — and nothing is stuck against none', () => {
    expect(stuckThresholdHours(null)).toBeNull()
    expect(stuckThresholdHours(0)).toBeNull()
    // A stage nothing ever completed cannot call anything stuck.
    expect(isStuck(10_000, null)).toBe(false)
  })

  it('is strictly greater-than, so exactly 2x the median is not yet stuck', () => {
    expect(isStuck(48, 24)).toBe(false)
    expect(isStuck(48.1, 24)).toBe(true)
  })
})

describe('aggregateAging', () => {
  it('sums stage rows into headline totals, BigInt money intact', () => {
    const totals = aggregateAging([
      { openCount: 10, openValueMinor: 1_000n, stuckCount: 2, stuckValueMinor: 300n },
      { openCount: 5, openValueMinor: 2_500n, stuckCount: 1, stuckValueMinor: 700n },
    ])
    expect(totals).toEqual({
      openCount: 15,
      openValueMinor: 3_500n,
      stuckCount: 3,
      stuckValueMinor: 1_000n,
    })
  })

  it('returns zeros for no stages — an empty pipeline, not missing data', () => {
    expect(aggregateAging([])).toEqual({
      openCount: 0,
      openValueMinor: 0n,
      stuckCount: 0,
      stuckValueMinor: 0n,
    })
  })
})
