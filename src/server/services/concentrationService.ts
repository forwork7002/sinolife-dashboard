/**
 * Concentration orchestration.
 *
 * Thin, like `InsightsService`: the grouping lives in
 * `ConcentrationRepository`, the arithmetic that turns groups into claims
 * lives in `src/server/domain/analytics/concentration.ts`, and this layer
 * crosses the result into transport DTOs — rates rounded once at the edge,
 * null kept null so the UI renders an em dash rather than a confident zero.
 *
 * Nothing here crosses money: every figure the concentration screens show is
 * a share, a count or a day-interval. The moment an amount needs to travel,
 * it goes through `toMoneyDto` like everywhere else.
 */

import {
  type HhiBand,
  hhiBand,
  hhiBp,
  pareto,
} from '@/server/domain/analytics/concentration'
import { ratePercent, roundPercent } from '@/server/domain/analytics/metrics'
import type { Period } from '@/server/domain/period/period'
import type {
  ConcentrationRepository,
  GroupRevenueRow,
} from '@/server/repositories/concentrationRepository'

// ---------------------------------------------------------------------------
// DTOs — mirrored in src/lib/api.ts, which the client imports instead.
// ---------------------------------------------------------------------------

export interface ConcentrationParetoDto {
  /** Share of period revenue held by the 5 / 10 largest customers, 0-100. */
  readonly top5SharePercent: number | null
  readonly top10SharePercent: number | null
  /** How few customers cover 80% of the period's revenue. */
  readonly customersFor80Percent: number | null
  /** Customers with a won revenue deal in the period. */
  readonly totalCustomers: number
  /**
   * Share of period revenue booked with NO customer attached. The shares
   * above are computed over identified customers only, so this is the
   * disclosed blind spot — sparse-field rule, same as region and grade.
   */
  readonly nullCustomerSharePercent: number | null
}

export interface HhiCutDto {
  /** Herfindahl–Hirschman index, 0-10000. Null when the cut has no revenue. */
  readonly hhi: number | null
  /** Plain-language band: >=2500 concentrated, >=1500 moderate, else diversified. */
  readonly band: HhiBand | null
  /** Groups with revenue that entered the index. */
  readonly groups: number
  /** Revenue share of the null (unset) group, excluded from the index. */
  readonly nullSharePercent: number | null
}

export interface ConcentrationHhiDto {
  readonly bySource: HhiCutDto
  readonly byRegion: HhiCutDto
}

export interface ConcentrationRepeatDto {
  /** First → second purchase interval, days, over pairs completed in the period. */
  readonly medianDaysBetweenFirstAndSecond: number | null
  readonly p90Days: number | null
  /** How many second purchases the interval percentiles rest on. */
  readonly pairsMeasured: number
  /**
   * Of first-time buyers with a COMPLETE 90-day horizon (first purchase in
   * the period shifted back 90 days), the share who bought again in time.
   */
  readonly repurchaseWithin90Percent: number | null
  readonly cohortSize: number
  /** Share of period revenue from deals that are not the customer's first win. */
  readonly repeatRevenueSharePercent: number | null
  /**
   * The same claim from Bitrix24's own `isReturnCustomer` flag. Divergence
   * from the row above is a data-quality signal — expose both, reconcile
   * neither.
   */
  readonly bitrixFlagSharePercent: number | null
}

export interface ConcentrationDto {
  readonly pareto: ConcentrationParetoDto
  readonly hhi: ConcentrationHhiDto
  readonly repeat: ConcentrationRepeatDto
}

// ---------------------------------------------------------------------------

/**
 * One decimal for display, same policy as `roundPercent` but named for what
 * some of the figures here are — day intervals, not percentages.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function roundedRate(part: bigint | number, total: bigint | number): number | null {
  const rate = ratePercent(part, total)
  return rate === null ? null : roundPercent(rate)
}

export class ConcentrationService {
  constructor(private readonly repo: ConcentrationRepository) {}

  async concentration(period: Period): Promise<ConcentrationDto> {
    const [customers, bySource, byRegion, repeat] = await Promise.all([
      this.repo.customerRevenue(period),
      this.repo.revenueBySource(period),
      this.repo.revenueByRegion(period),
      this.repo.repeatStats(period),
    ])

    const p = pareto(customers.revenuesMinor)

    /**
     * The null group is excluded from the index and reported beside it.
     *
     * An index treats every group as one actor; "source not set" is not an
     * actor, it is missing data, and folding it in would let a sloppy month
     * of data entry read as a big diversified channel.
     */
    const cut = (rows: readonly GroupRevenueRow[]): HhiCutDto => {
      const known = rows.filter((r) => r.label !== null).map((r) => r.revenueMinor)
      const nullMinor = rows
        .filter((r) => r.label === null)
        .reduce((sum, r) => sum + r.revenueMinor, 0n)
      const totalMinor = rows.reduce((sum, r) => sum + r.revenueMinor, 0n)
      const index = hhiBp(known)

      return {
        hhi: index,
        band: index === null ? null : hhiBand(index),
        groups: known.filter((value) => value > 0n).length,
        nullSharePercent: roundedRate(nullMinor, totalMinor),
      }
    }

    return {
      pareto: {
        top5SharePercent:
          p.top5SharePercent === null ? null : roundPercent(p.top5SharePercent),
        top10SharePercent:
          p.top10SharePercent === null ? null : roundPercent(p.top10SharePercent),
        customersFor80Percent: p.customersFor80Percent,
        totalCustomers: p.totalCustomers,
        nullCustomerSharePercent: roundedRate(customers.nullCustomerMinor, customers.totalMinor),
      },
      hhi: {
        bySource: cut(bySource),
        byRegion: cut(byRegion),
      },
      repeat: {
        medianDaysBetweenFirstAndSecond:
          repeat.medianDays === null ? null : round1(repeat.medianDays),
        p90Days: repeat.p90Days === null ? null : round1(repeat.p90Days),
        pairsMeasured: repeat.pairsMeasured,
        repurchaseWithin90Percent: roundedRate(repeat.repurchasedWithin, repeat.cohortSize),
        cohortSize: repeat.cohortSize,
        repeatRevenueSharePercent: roundedRate(
          repeat.repeatRevenueMinor,
          repeat.totalRevenueMinor,
        ),
        bitrixFlagSharePercent: roundedRate(
          repeat.flaggedRevenueMinor,
          repeat.totalRevenueMinor,
        ),
      },
    }
  }
}
