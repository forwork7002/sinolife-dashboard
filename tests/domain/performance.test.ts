import { describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type { AnalyticsDeal } from '@/server/domain/analytics/sales'
import { summarizeDeals } from '@/server/domain/analytics/sales'
import {
  type KpiDefinition,
  actualForMetric,
  buildLeaderboard,
  classifyKpi,
  employeePerformance,
  evaluateKpi,
  kpiWindow,
  overallAchievementPercent,
  periodElapsedFraction,
} from '@/server/domain/analytics/performance'

const TZ = 'Asia/Tashkent'
const UZS = 'UZS'
const NOW = new Date('2026-08-23T09:30:00.000Z')

const august = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
const julyEquivalent = previousEquivalent(august)

function won(
  id: string,
  amountMinor: bigint,
  closedIso: string,
  employeeId: string,
): AnalyticsDeal {
  return {
    id,
    amountMinor,
    currency: UZS,
    status: 'WON',
    stageId: 'stg-6',
    stageCategory: 'WON',
    employeeId,
    createdAtSource: new Date(new Date(closedIso).getTime() - 5 * 86_400_000),
    closedAt: new Date(closedIso),
  }
}

function lost(id: string, closedIso: string, employeeId: string): AnalyticsDeal {
  return {
    id,
    amountMinor: 10_000_00n,
    currency: UZS,
    status: 'LOST',
    stageId: 'stg-7',
    stageCategory: 'LOST',
    employeeId,
    createdAtSource: new Date(new Date(closedIso).getTime() - 5 * 86_400_000),
    closedAt: new Date(closedIso),
  }
}

describe('employeePerformance', () => {
  const deals = [
    // August
    won('a1', 300_000_00n, '2026-08-10T06:00:00.000Z', 'emp-1'),
    won('a2', 100_000_00n, '2026-08-12T06:00:00.000Z', 'emp-2'),
    // July equivalent window (1-23 July)
    won('j1', 200_000_00n, '2026-07-10T06:00:00.000Z', 'emp-1'),
    won('j2', 200_000_00n, '2026-07-12T06:00:00.000Z', 'emp-2'),
  ]

  const rows = employeePerformance(deals, ['emp-1', 'emp-2', 'emp-3'], august, julyEquivalent, UZS)

  it('returns a row per requested employee, including those with no deals', () => {
    expect(rows.map((r) => r.employeeId)).toEqual(['emp-1', 'emp-2', 'emp-3'])
  })

  it('computes current and previous revenue per employee', () => {
    const one = rows.find((r) => r.employeeId === 'emp-1')!
    expect(one.current.revenue.amountMinor).toBe(300_000_00n)
    expect(one.previous.revenue.amountMinor).toBe(200_000_00n)
  })

  it('computes growth against the equivalent previous window', () => {
    const one = rows.find((r) => r.employeeId === 'emp-1')!
    expect(one.revenueDelta).toEqual({ kind: 'change', percent: 50, direction: 'up' })

    const two = rows.find((r) => r.employeeId === 'emp-2')!
    expect(two.revenueDelta).toEqual({ kind: 'change', percent: -50, direction: 'down' })
  })

  it('reports no_data growth for an employee with nothing in either window', () => {
    const three = rows.find((r) => r.employeeId === 'emp-3')!
    // Both periods are a real, measured zero, so this is "unchanged".
    expect(three.revenueDelta).toEqual({ kind: 'unchanged' })
  })

  it('computes team share', () => {
    const one = rows.find((r) => r.employeeId === 'emp-1')!
    expect(one.teamSharePercent).toBe(75)
  })

  it('compares each employee against the team average', () => {
    // Team total 400 000 across 3 employees -> average 133 333.33
    const one = rows.find((r) => r.employeeId === 'emp-1')!
    expect(one.versusTeamAveragePercent).toBeCloseTo(225, 0)
  })

  it('returns null shares when the team earned nothing', () => {
    const none = employeePerformance([], ['emp-1'], august, julyEquivalent, UZS)
    expect(none[0]!.teamSharePercent).toBeNull()
    expect(none[0]!.versusTeamAveragePercent).toBeNull()
  })

  it('ignores deals belonging to employees outside the requested set', () => {
    const scoped = employeePerformance(deals, ['emp-1'], august, julyEquivalent, UZS)
    expect(scoped).toHaveLength(1)
    expect(scoped[0]!.teamSharePercent).toBe(100)
  })
})

describe('buildLeaderboard', () => {
  const deals = [
    won('a', 300_000_00n, '2026-08-10T06:00:00.000Z', 'emp-1'),
    won('b', 200_000_00n, '2026-08-11T06:00:00.000Z', 'emp-2'),
    won('c', 200_000_00n, '2026-08-12T06:00:00.000Z', 'emp-3'),
    lost('d', '2026-08-13T06:00:00.000Z', 'emp-2'),
  ]

  const perf = employeePerformance(
    deals,
    ['emp-1', 'emp-2', 'emp-3', 'emp-4'],
    august,
    julyEquivalent,
    UZS,
  )

  it('ranks by revenue, descending', () => {
    const board = buildLeaderboard(perf, 'revenue')
    expect(board.map((e) => e.employeeId)).toEqual(['emp-1', 'emp-2', 'emp-3', 'emp-4'])
    expect(board[0]!.rank).toBe(1)
  })

  it('gives tied entries the same rank and skips the next', () => {
    // emp-2 and emp-3 both on 200 000 -> ranks 1, 2, 2, 4.
    const board = buildLeaderboard(perf, 'revenue')
    expect(board.map((e) => e.rank)).toEqual([1, 2, 2, 4])
    expect(board[2]!.tied).toBe(true)
  })

  it('ranks by deals won', () => {
    const board = buildLeaderboard(perf, 'deals_won')
    expect(board[0]!.value).toBe(1)
  })

  it('sorts employees with no measurable value last', () => {
    // emp-1 and emp-3 have no lost deals -> 100% conversion.
    // emp-4 resolved nothing -> null conversion, and must not top the board.
    const board = buildLeaderboard(perf, 'conversion')
    expect(board.at(-1)!.employeeId).toBe('emp-4')
    expect(board.at(-1)!.value).toBeNull()
  })

  it('ranks by externally supplied KPI achievement', () => {
    const achievement = new Map<string, number | null>([
      ['emp-1', 42],
      ['emp-2', 91],
      ['emp-3', null],
      ['emp-4', 67],
    ])
    const board = buildLeaderboard(perf, 'kpi_achievement', achievement)
    expect(board.map((e) => e.employeeId)).toEqual(['emp-2', 'emp-4', 'emp-1', 'emp-3'])
  })

  it('is stable for equal values', () => {
    const first = buildLeaderboard(perf, 'revenue').map((e) => e.employeeId)
    const second = buildLeaderboard(perf, 'revenue').map((e) => e.employeeId)
    expect(first).toEqual(second)
  })

  it('handles an empty roster', () => {
    expect(buildLeaderboard([], 'revenue')).toEqual([])
  })
})

describe('periodElapsedFraction', () => {
  it('is zero at the start of the period', () => {
    expect(periodElapsedFraction(august, august.start)).toBe(0)
  })

  it('is one at the end of the period', () => {
    expect(periodElapsedFraction(august, august.end)).toBe(1)
  })

  it('clamps a time beyond the period', () => {
    expect(periodElapsedFraction(august, new Date('2027-01-01T00:00:00.000Z'))).toBe(1)
    expect(periodElapsedFraction(august, new Date('2020-01-01T00:00:00.000Z'))).toBe(0)
  })

  it('is roughly half way through the middle of the period', () => {
    const middle = new Date((august.start.getTime() + august.end.getTime()) / 2)
    expect(periodElapsedFraction(august, middle)).toBeCloseTo(0.5, 5)
  })
})

describe('classifyKpi', () => {
  it('reports ACHIEVED once the target is met, regardless of pace', () => {
    expect(classifyKpi(10_000, 0.1)).toBe('ACHIEVED')
    expect(classifyKpi(12_000, 1)).toBe('ACHIEVED')
  })

  it('reports ON_TRACK when attainment keeps up with elapsed time', () => {
    // 30% of the way through the month with 30% of the target done.
    expect(classifyKpi(3_000, 0.3)).toBe('ON_TRACK')
  })

  it('does not punish a target that is merely early in its period', () => {
    // 6% done on day 2 of a month is on pace, not "behind".
    expect(classifyKpi(600, 0.06)).toBe('ON_TRACK')
  })

  it('reports AT_RISK when slightly behind pace', () => {
    expect(classifyKpi(4_500, 0.5)).toBe('AT_RISK')
  })

  it('reports BEHIND when well off pace', () => {
    expect(classifyKpi(2_000, 0.8)).toBe('BEHIND')
  })

  it('treats an unmeasurable target as AT_RISK rather than achieved', () => {
    expect(classifyKpi(null, 0.5)).toBe('AT_RISK')
  })
})

describe('evaluateKpi', () => {
  const deals = [won('a', 300_000_00n, '2026-08-10T06:00:00.000Z', 'emp-1')]

  /*
    THE PLAN'S OWN WINDOW: the whole of August, not the report's month-to-date.

    A target is a contract for a stated span, so both the actual and the
    expected pace are read over the plan — which is why the definition carries
    its dates and `evaluateKpi` no longer accepts a period at all.
  */
  const PLAN_START = new Date('2026-07-31T19:00:00.000Z') // 1 Aug, Tashkent
  const PLAN_END = new Date('2026-08-31T19:00:00.000Z') // 1 Sep, Tashkent
  const plan = { periodStart: PLAN_START, periodEnd: PLAN_END }
  const summary = summarizeDeals(deals, kpiWindow({ ...plan } as KpiDefinition, TZ), UZS)

  it('measures a revenue target in minor units', () => {
    const definition: KpiDefinition = {
      id: 'kpi-1',
      employeeId: 'emp-1',
      metric: 'REVENUE',
      targetValue: 600_000_00n,
      ...plan,
    }
    const result = evaluateKpi(definition, summary, TZ, NOW)
    expect(result.actualValue).toBe(300_000_00n)
    expect(result.achievementBp).toBe(5_000) // 50.00%
  })

  it('measures a deal-count target', () => {
    const definition: KpiDefinition = {
      id: 'kpi-2',
      employeeId: 'emp-1',
      metric: 'DEALS_WON',
      targetValue: 4n,
      ...plan,
    }
    expect(evaluateKpi(definition, summary, TZ, NOW).achievementBp).toBe(2_500)
  })

  it('returns null attainment for a zero target rather than infinity', () => {
    const definition: KpiDefinition = {
      id: 'kpi-3',
      employeeId: 'emp-1',
      metric: 'REVENUE',
      targetValue: 0n,
      ...plan,
    }
    const result = evaluateKpi(definition, summary, TZ, NOW)
    expect(result.achievementBp).toBeNull()
    expect(result.status).toBe('AT_RISK')
  })

  it('reports ACHIEVED when the target is exceeded', () => {
    const definition: KpiDefinition = {
      id: 'kpi-4',
      employeeId: 'emp-1',
      metric: 'REVENUE',
      targetValue: 100_000_00n,
      ...plan,
    }
    expect(evaluateKpi(definition, summary, TZ, NOW).status).toBe('ACHIEVED')
  })

  it('grades pace against the PLAN, not against a to-date report window', () => {
    /*
      THE REGRESSION THIS LOCKS.

      A to-date window is ~100% elapsed by construction: on 23 August "Shu oy"
      runs 1–24 August and ends at midnight tonight, so 98% of it has passed
      while only 73% of August has. Pace was read off that window, so the page
      announced "davrning 98% qismi oʻtdi" on the 23rd — and on the 2nd, when
      6% of the month was gone, it announced 79%.

      At 70% attained the two answers differ in the grade, not just the words:
      70/73 is AT_RISK, 70/98 is BEHIND.
    */
    const reportWindow = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const reportElapsed = periodElapsedFraction(reportWindow, NOW)
    expect(reportElapsed).toBeGreaterThan(0.97)

    const definition: KpiDefinition = {
      id: 'kpi-5',
      employeeId: 'emp-1',
      metric: 'REVENUE',
      // 300k banked against this reads 69.99% — basis points are integers and
      // the division truncates, which is the contract, not a rounding slip.
      targetValue: 428_571_43n,
      ...plan,
    }

    const planElapsed = periodElapsedFraction(kpiWindow(definition, TZ), NOW)
    expect(planElapsed).toBeGreaterThan(0.72)
    expect(planElapsed).toBeLessThan(0.74)

    const evaluation = evaluateKpi(definition, summary, TZ, NOW)
    expect(evaluation.achievementBp).toBe(6_999)
    expect(evaluation.status).toBe('AT_RISK')

    // And the grade the old code produced, kept here so the difference is
    // visible rather than asserted only as an absence.
    expect(classifyKpi(evaluation.achievementBp, reportElapsed)).toBe('BEHIND')
  })
})

describe('actualForMetric', () => {
  const deals = [
    won('a', 300_000_00n, '2026-08-10T06:00:00.000Z', 'emp-1'),
    lost('b', '2026-08-11T06:00:00.000Z', 'emp-1'),
  ]
  const summary = summarizeDeals(deals, august, UZS)

  it('extracts revenue in minor units', () => {
    expect(actualForMetric(summary, 'REVENUE')).toBe(300_000_00n)
  })

  it('extracts conversion as basis points', () => {
    expect(actualForMetric(summary, 'CONVERSION_RATE')).toBe(5_000n)
  })

  it('reports a zero average deal when nothing was won', () => {
    const empty = summarizeDeals([], august, UZS)
    expect(actualForMetric(empty, 'AVERAGE_DEAL')).toBe(0n)
  })
})

describe('overallAchievementPercent', () => {
  it('averages measurable attainment', () => {
    const result = overallAchievementPercent([
      { kpiId: 'a', employeeId: null, metric: 'REVENUE', targetValue: 1n, actualValue: 1n, achievementBp: 8_000, status: 'ON_TRACK' },
      { kpiId: 'b', employeeId: null, metric: 'DEALS_WON', targetValue: 1n, actualValue: 1n, achievementBp: 12_000, status: 'ACHIEVED' },
    ])
    expect(result).toBe(100)
  })

  it('ignores unmeasurable KPIs instead of counting them as zero', () => {
    const result = overallAchievementPercent([
      { kpiId: 'a', employeeId: null, metric: 'REVENUE', targetValue: 1n, actualValue: 1n, achievementBp: 8_000, status: 'ON_TRACK' },
      { kpiId: 'b', employeeId: null, metric: 'REVENUE', targetValue: 0n, actualValue: 0n, achievementBp: null, status: 'AT_RISK' },
    ])
    expect(result).toBe(80)
  })

  it('returns null when nothing is measurable', () => {
    expect(overallAchievementPercent([])).toBeNull()
  })
})
