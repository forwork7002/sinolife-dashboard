/**
 * Response-speed orchestration.
 *
 * Thin, like `InsightsService`: the joins live in `ResponseRepository` and
 * this layer crosses the result into transport DTOs — money via `toMoneyDto`,
 * rates rounded once at the edge, null kept null so the UI renders an em dash
 * rather than a confident zero.
 *
 * The revenue-per-talk-hour division happens HERE, in BigInt, because it is
 * money: soʻm per hour is still soʻm, and it crosses the boundary as a
 * MoneyDto like every other amount.
 */

import { ratePercent, roundPercent } from '@/server/domain/analytics/metrics'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import type { Period } from '@/server/domain/period/period'
import type { EmployeeTalkRow, ResponseRepository } from '@/server/repositories/responseRepository'

// ---------------------------------------------------------------------------
// DTOs — mirrored in src/lib/api.ts, which the client imports instead.
// ---------------------------------------------------------------------------

export interface ResponseFirstTouchDto {
  /** Creation → first outbound call, minutes, over deals that WERE called. */
  readonly p50Minutes: number | null
  readonly p90Minutes: number | null
  /** First-called within 15 / 60 minutes, as a share of ALL cohort deals. */
  readonly calledWithin15MinPercent: number | null
  readonly calledWithin60MinPercent: number | null
  /**
   * Deals with no outbound call at all. Excluded from the percentiles —
   * "never" is not a large number of minutes — and disclosed here instead.
   */
  readonly noCallSharePercent: number | null
  /** Revenue deals created in the period — the honest denominator. */
  readonly deals: number
}

export interface ResponseAttemptsDto {
  /** Dials up to and including the first connect; 1 = reached first try. */
  readonly medianAttemptsToConnect: number | null
  /** Dialling targets never connected after 5+ dials, share of all targets. */
  readonly neverConnectedAfter5Percent: number | null
  /** Dialling targets in the period: a deal, or customer+day without one. */
  readonly groups: number
}

/** Average call effort behind one closed deal, per outcome. */
export interface ResponseOutcomeDto {
  readonly deals: number
  readonly avgCalls: number | null
  /** Connected talk-seconds only — dialling is not conversation. */
  readonly avgTalkSeconds: number | null
}

export interface ResponseEmployeeDto {
  readonly employeeId: string
  readonly fullName: string
  readonly revenue: MoneyDto
  readonly talkHours: number
  readonly revenuePerTalkHour: MoneyDto
}

export interface ResponseEfficiencyDto {
  readonly won: ResponseOutcomeDto
  readonly lost: ResponseOutcomeDto
  /** Period revenue over period connected talk time. Null under the floor. */
  readonly revenuePerTalkHour: MoneyDto | null
  /** Best ratios, employees over the one-talk-hour floor only. */
  readonly topEmployees: readonly ResponseEmployeeDto[]
}

export interface ResponseDto {
  readonly firstTouch: ResponseFirstTouchDto
  readonly attempts: ResponseAttemptsDto
  readonly efficiency: ResponseEfficiencyDto
}

// ---------------------------------------------------------------------------

/**
 * No ratio below one connected talk-hour.
 *
 * Divide a month's revenue by four minutes of recorded talk and the result
 * is an absurdity with a currency sign — someone whose calls simply are not
 * in the log would top every leaderboard. An hour is enough conversation for
 * the ratio to mean something; below it the honest answer is an em dash.
 * The same floor guards the overall figure, which matters on short periods.
 */
export const TALK_HOUR_FLOOR_SECONDS = 3_600

/** The leaderboard stays a top list, not a roster. */
export const TOP_EMPLOYEE_COUNT = 10

const SECONDS_PER_HOUR = 3_600n

/** Soʻm per connected talk-hour, computed in BigInt: minor · 3600 / seconds. */
function perTalkHourMinor(revenueMinor: bigint, talkSeconds: number): bigint {
  return (revenueMinor * SECONDS_PER_HOUR) / BigInt(talkSeconds)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function roundedRate(part: number, total: number): number | null {
  const rate = ratePercent(part, total)
  return rate === null ? null : roundPercent(rate)
}

export class ResponseService {
  constructor(private readonly repo: ResponseRepository) {}

  async response(period: Period, currency: string): Promise<ResponseDto> {
    const [firstTouch, attempts, effort, talkRevenue] = await Promise.all([
      this.repo.firstTouch(period),
      this.repo.attempts(period),
      this.repo.effortByOutcome(period),
      this.repo.employeeTalkRevenue(period),
    ])

    const outcome = (status: 'WON' | 'LOST'): ResponseOutcomeDto => {
      const row = effort.find((r) => r.status === status)
      if (!row) return { deals: 0, avgCalls: null, avgTalkSeconds: null }
      return {
        deals: row.deals,
        avgCalls: row.avgCalls === null ? null : round1(row.avgCalls),
        avgTalkSeconds: row.avgTalkSeconds === null ? null : Math.round(row.avgTalkSeconds),
      }
    }

    // Overall ratio sums EVERY row — including calls never attributed to a
    // person — so it stays the company's number, not the leaderboard's sum.
    const totalRevenueMinor = talkRevenue.reduce((sum, r) => sum + r.revenueMinor, 0n)
    const totalTalkSeconds = talkRevenue.reduce((sum, r) => sum + r.talkSeconds, 0)

    const topEmployees = talkRevenue
      .filter(
        (r): r is EmployeeTalkRow & { employeeId: string; fullName: string } =>
          r.employeeId !== null &&
          r.fullName !== null &&
          r.talkSeconds >= TALK_HOUR_FLOOR_SECONDS,
      )
      .map((r) => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        revenue: toMoneyDto(money(r.revenueMinor, currency)),
        talkHours: round1(r.talkSeconds / 3600),
        perHourMinor: perTalkHourMinor(r.revenueMinor, r.talkSeconds),
      }))
      .sort((a, b) => (a.perHourMinor === b.perHourMinor ? 0 : a.perHourMinor > b.perHourMinor ? -1 : 1))
      .slice(0, TOP_EMPLOYEE_COUNT)
      .map<ResponseEmployeeDto>(({ perHourMinor, ...rest }) => ({
        ...rest,
        revenuePerTalkHour: toMoneyDto(money(perHourMinor, currency)),
      }))

    return {
      firstTouch: {
        p50Minutes: firstTouch.p50Minutes === null ? null : round1(firstTouch.p50Minutes),
        p90Minutes: firstTouch.p90Minutes === null ? null : round1(firstTouch.p90Minutes),
        calledWithin15MinPercent: roundedRate(firstTouch.within15, firstTouch.deals),
        calledWithin60MinPercent: roundedRate(firstTouch.within60, firstTouch.deals),
        noCallSharePercent: roundedRate(
          firstTouch.deals - firstTouch.called,
          firstTouch.deals,
        ),
        deals: firstTouch.deals,
      },
      attempts: {
        medianAttemptsToConnect:
          attempts.medianAttemptsToConnect === null
            ? null
            : round1(attempts.medianAttemptsToConnect),
        neverConnectedAfter5Percent: roundedRate(
          attempts.neverConnectedAfterMin,
          attempts.groups,
        ),
        groups: attempts.groups,
      },
      efficiency: {
        won: outcome('WON'),
        lost: outcome('LOST'),
        revenuePerTalkHour:
          totalTalkSeconds < TALK_HOUR_FLOOR_SECONDS
            ? null
            : toMoneyDto(money(perTalkHourMinor(totalRevenueMinor, totalTalkSeconds), currency)),
        topEmployees,
      },
    }
  }
}
