import { describe, expect, it } from 'vitest'

import {
  PROJECTION_ELAPSED_FLOOR,
  fullUnitWindow,
  projectRevenueMinor,
  projectionElapsedFraction,
} from '@/server/domain/analytics/pulse'
import { resolvePeriod } from '@/server/domain/period/period'

const TZ = 'Asia/Tashkent' // UTC+5, no daylight saving

/** 23 August 2026, 14:30 Tashkent == 09:30 UTC. */
const NOW = new Date('2026-08-23T09:30:00.000Z')

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
    // 22 working days + 6 h of the 23rd (08:30 → 14:30), of 31 days of 9.5 h
    // ≈ 73.0%. Against the TO-DATE window it would read ~98% and the
    // projection would forecast nothing.
    expect(fraction).toBeGreaterThan(0.72)
    expect(fraction).toBeLessThan(0.74)
  })

  it('counts only the working day, 08:30–18:00, on «Bugun»', () => {
    const at = (utc: string) => {
      const now = new Date(utc)
      return projectionElapsedFraction(resolvePeriod('today', { timeZone: TZ, now }), now)
    }
    // Tashkent is UTC+5: 08:30 local is 03:30Z, 18:00 local is 13:00Z.
    expect(at('2026-08-23T02:00:00.000Z')).toBe(0) // 07:00 — not open yet
    expect(at('2026-08-23T03:30:00.000Z')).toBe(0) // 08:30 — opening
    expect(at('2026-08-23T08:15:00.000Z')).toBeCloseTo(0.5, 6) // 13:15 — half
    expect(at('2026-08-23T13:00:00.000Z')).toBe(1) // 18:00 — closed
    expect(at('2026-08-23T17:00:00.000Z')).toBe(1) // 22:00 — still the result
  })

  it('does not move overnight: 18:00 and next morning 08:30 read the same', () => {
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const evening = projectionElapsedFraction(period, new Date('2026-08-23T13:00:00.000Z'))
    const morning = projectionElapsedFraction(period, new Date('2026-08-24T03:30:00.000Z'))
    expect(evening).toBeCloseTo(23 / 31, 9)
    expect(morning).toBe(evening)
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
