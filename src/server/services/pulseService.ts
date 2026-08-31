/**
 * Pulse & flow orchestration.
 *
 * Thin, like `InsightsService`: the aggregation lives in `PulseRepository`,
 * the arithmetic that combines aggregates lives in
 * `src/server/domain/analytics/pulse.ts`, and this layer crosses the result
 * into transport DTOs — money via `toMoneyDto`, rates rounded once at the
 * edge, deltas through the `growth()` union so no screen ever invents an
 * "+Infinity%".
 *
 * Both endpoints take `AnalyticsContext` rather than a bare period because
 * they respect the dashboard filters and the caller's authorisation scope —
 * see the note on `PulseDealFilters` for exactly which filters apply
 * (employees, departments, sources, scope; NOT products/stages/free text).
 */

import {
  aggregateAging,
  conversionFromPrevious,
  projectRevenueMinor,
  projectionElapsedFraction,
  fullUnitWindow,
  salesVelocityPerDayMinor,
} from '@/server/domain/analytics/pulse'
import {
  type DeltaDto,
  conversionRate,
  growth,
  ratePercent,
  roundPercent,
  toDeltaDto,
} from '@/server/domain/analytics/metrics'
import { type MoneyDto, divideMoney, money, toMoneyDto } from '@/server/domain/money/money'
import { previousEquivalent } from '@/server/domain/period/period'
import type { PulseDealFilters, PulseRepository } from '@/server/repositories/pulseRepository'
import type { AnalyticsContext } from './analyticsService'

// ---------------------------------------------------------------------------
// DTOs — mirrored in src/lib/api.ts, which the client imports instead.
// ---------------------------------------------------------------------------

export interface PulseVelocityDto {
  /** Open revenue deals right now — point-in-time, not period-bound. */
  readonly openDeals: number
  readonly openValue: MoneyDto
  /** Count-based win rate over deals closed in the period, 0-100. */
  readonly winRatePercent: number | null
  readonly avgWonAmount: MoneyDto | null
  readonly medianCycleDays: number | null
  /**
   * The composite, soʻm per day. Null whenever ANY component above is null —
   * the components still travel so the UI can show which leg is missing.
   */
  readonly salesVelocityPerDay: MoneyDto | null
}

export interface PulseForecastDto {
  /** Revenue won so far in the period ("davr boshidan"). */
  readonly periodToDate: MoneyDto
  /** How much of the FULL calendar unit has elapsed, 0-100. */
  readonly elapsedPercent: number
  /** Straight-line projection to the unit's end. Null under the 2% floor. */
  readonly projected: MoneyDto | null
  /** The previous FULL unit's revenue — the reference the projection is read against. */
  readonly previousFull: MoneyDto
  /** projected vs previousFull. */
  readonly delta: DeltaDto
}

/**
 * What the period's revenue is made of, and what it is still owed.
 *
 * The single most misread thing on a revenue screen: money is booked on the
 * CLOSE date, so a month's revenue is mostly earlier months' orders arriving.
 * Measured on August 2026 — 5.68 bn closed, of which only 1.68 bn (29%) came
 * from orders August itself took in. A reader without this split sees revenue
 * quintuple against a flat intake and reads it as growth.
 */
export interface PulseCompositionDto {
  /** Closed in the period AND created in it — the period's own work. */
  readonly own: MoneyDto
  readonly ownDeals: number
  /** Closed in the period but created before it — carried in from earlier. */
  readonly carried: MoneyDto
  readonly carriedDeals: number
  /** own / (own + carried), 0-100. Null when nothing closed. */
  readonly ownSharePercent: number | null
  /** Taken in this period and still open — lands in a LATER period's revenue. */
  readonly openFromPeriod: MoneyDto
  readonly openFromPeriodDeals: number
}

export interface PulseCycleDto {
  readonly p50Days: number | null
  readonly p75Days: number | null
  readonly p90Days: number | null
  /**
   * How many won deals the percentiles were computed from.
   *
   * Smaller than the window's won count by however many deals Bitrix24 closed
   * before it created them; those are excluded from the percentiles, so
   * naming the won count here credited the median to deals it never saw.
   */
  readonly wonCount: number
}

export interface PulseWinRateDto {
  /** won / (won + lost), by deal count. Null when nothing closed. */
  readonly countPercent: number | null
  /** won / (won + lost), weighted by deal value. */
  readonly valuePercent: number | null
  readonly wonCount: number
  readonly lostCount: number
  /** vs the comparison window, growth() union — never a bare division. */
  readonly countDelta: DeltaDto
  readonly valueDelta: DeltaDto
}

export interface PulseDto {
  readonly velocity: PulseVelocityDto
  readonly forecast: PulseForecastDto
  readonly composition: PulseCompositionDto
  readonly cycle: PulseCycleDto
  readonly winRate: PulseWinRateDto
}

export interface StageConversionRowDto {
  readonly stageId: string
  readonly stageName: string
  readonly pipelineName: string
  readonly category: string
  readonly logisticsRole: string | null
  readonly sortOrder: number
  /** Distinct deals from the cohort that EVER entered this stage. */
  readonly dealCount: number
  /**
   * dealCount over the PIPELINE'S WHOLE COHORT — one shared denominator for
   * every stage, so the figures compose and none can exceed 100%.
   *
   * This replaced consecutive-stage conversion on the reading side, and the
   * reason is in the data rather than in taste: the Доставка pipeline's
   * middle is not a sequence. Stages 6040–6080 are REGIONAL_HUB (TOSHKENT-1,
   * NAVOIY, VODIY, QASHQADARYO, SURXONDARYO) and 6090–6110 are CARRIER — a
   * deal enters ONE of each, not all of them in order. Dividing a stage by
   * its `sortOrder` predecessor therefore compared two parallel branches and
   * printed VODIY/NAVOIY = 671.8%, CARAVAN/SURXONDARYO = 672.0% and
   * Доставлено/Отказ-предварительно = 961.1% — arithmetic, not conversion.
   *
   * The share is null only when the pipeline's cohort is empty.
   */
  readonly cohortSharePercent: number | null
  /** How many deals the share is OF — the denominator, stated. */
  readonly cohortDeals: number
  /**
   * vs the previous stage of the same pipeline. Null for the first stage.
   *
   * Kept in the payload because it is meaningful for a genuinely linear
   * pipeline (Ecommerce is one), but no longer the reading the screen leads
   * with — see `cohortSharePercent`.
   */
  readonly conversionFromPreviousPercent: number | null
}

export interface FlowConversionDto {
  /**
   * The denominator, stated honestly: deals CREATED in the period, in revenue
   * pipelines. Not "deals closed", not "all deals" — the caption on the chart
   * must say "davrda yaratilgan bitimlar boʻyicha".
   */
  readonly basis: 'created_in_period'
  readonly stages: readonly StageConversionRowDto[]
}

export interface StageAgingRowDto {
  readonly stageId: string
  readonly stageName: string
  readonly pipelineName: string
  readonly category: string
  readonly logisticsRole: string | null
  readonly sortOrder: number
  readonly openCount: number
  readonly openValue: MoneyDto
  /** Current dwell of the open deals in this stage, hours. */
  readonly dwellP50Hours: number | null
  readonly dwellP90Hours: number | null
  /** All-time median over completed visits — the stuck baseline. Null = none. */
  readonly historicalP50Hours: number | null
  /** Deals dwelling longer than 2x the historical median. */
  readonly stuckCount: number
  readonly stuckValue: MoneyDto
}

export interface FlowAgingDto {
  readonly stages: readonly StageAgingRowDto[]
  readonly totals: {
    readonly openCount: number
    readonly openValue: MoneyDto
    readonly stuckCount: number
    readonly stuckValue: MoneyDto
  }
}

export interface FlowDto {
  readonly stageConversion: FlowConversionDto
  readonly aging: FlowAgingDto
}

// ---------------------------------------------------------------------------

/**
 * One decimal for display, same policy as `roundPercent` but named for what
 * the durations here actually are — days and hours, not percentages.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Keep only the filters the pulse SQL can honestly honour. */
function pulseFilters(ctx: AnalyticsContext): PulseDealFilters {
  return {
    employeeIds: ctx.filters.employeeIds,
    departmentIds: ctx.filters.departmentIds,
    sourceIds: ctx.filters.sourceIds,
    restrictToEmployeeId: ctx.filters.restrictToEmployeeId,
  }
}

export class PulseService {
  constructor(private readonly repo: PulseRepository) {}

  async pulse(ctx: AnalyticsContext): Promise<PulseDto> {
    const filters = pulseFilters(ctx)

    // The projection's reference is the previous FULL calendar unit, not the
    // truncated to-date comparison: a projection for all of August must be
    // read against all of July, or every mid-month glance shows fake growth.
    const previousFull = previousEquivalent(fullUnitWindow(ctx.period))

    const [closed, open, composition, periodToDateMinor, previousFullMinor] = await Promise.all([
      this.repo.closedDealStats(ctx.period, ctx.comparison, filters),
      this.repo.openSnapshot(filters),
      this.repo.revenueComposition(ctx.period, filters),
      this.repo.wonRevenueInWindow(ctx.period, filters),
      this.repo.wonRevenueInWindow(previousFull, filters),
    ])

    const { current, previous } = closed

    // --- velocity -----------------------------------------------------------
    const winRatePercent = conversionRate(current.wonCount, current.lostCount)
    const avgWonAmount =
      current.wonCount === 0
        ? null
        : divideMoney(money(current.wonAmountMinor, ctx.currency), current.wonCount)

    const velocityMinor = salesVelocityPerDayMinor({
      openDeals: open.openDeals,
      winRatePercent,
      avgWonAmountMinor: avgWonAmount?.amountMinor ?? null,
      medianCycleDays: current.cycleP50Days,
    })

    // --- forecast -----------------------------------------------------------
    const elapsedFraction = projectionElapsedFraction(ctx.period, ctx.now)
    const projectedMinor = projectRevenueMinor(periodToDateMinor, elapsedFraction)

    // --- win rate -----------------------------------------------------------
    const previousWinRatePercent = conversionRate(previous.wonCount, previous.lostCount)
    const valuePercent = ratePercent(
      current.wonAmountMinor,
      current.wonAmountMinor + current.lostAmountMinor,
    )
    const previousValuePercent = ratePercent(
      previous.wonAmountMinor,
      previous.wonAmountMinor + previous.lostAmountMinor,
    )

    return {
      velocity: {
        openDeals: open.openDeals,
        openValue: toMoneyDto(money(open.openValueMinor, ctx.currency)),
        winRatePercent: winRatePercent === null ? null : roundPercent(winRatePercent),
        avgWonAmount: avgWonAmount === null ? null : toMoneyDto(avgWonAmount),
        medianCycleDays: current.cycleP50Days === null ? null : round1(current.cycleP50Days),
        salesVelocityPerDay:
          velocityMinor === null ? null : toMoneyDto(money(velocityMinor, ctx.currency)),
      },
      forecast: {
        periodToDate: toMoneyDto(money(periodToDateMinor, ctx.currency)),
        elapsedPercent: roundPercent(elapsedFraction * 100),
        projected:
          projectedMinor === null ? null : toMoneyDto(money(projectedMinor, ctx.currency)),
        previousFull: toMoneyDto(money(previousFullMinor, ctx.currency)),
        delta: toDeltaDto(growth(projectedMinor, previousFullMinor)),
      },
      composition: {
        own: toMoneyDto(money(composition.ownAmountMinor, ctx.currency)),
        ownDeals: composition.ownDeals,
        carried: toMoneyDto(money(composition.carriedAmountMinor, ctx.currency)),
        carriedDeals: composition.carriedDeals,
        ownSharePercent: (() => {
          const total = composition.ownAmountMinor + composition.carriedAmountMinor
          const share = ratePercent(composition.ownAmountMinor, total)
          return share === null ? null : roundPercent(share)
        })(),
        openFromPeriod: toMoneyDto(money(composition.openFromPeriodMinor, ctx.currency)),
        openFromPeriodDeals: composition.openFromPeriodDeals,
      },
      cycle: {
        p50Days: current.cycleP50Days === null ? null : round1(current.cycleP50Days),
        p75Days: current.cycleP75Days === null ? null : round1(current.cycleP75Days),
        p90Days: current.cycleP90Days === null ? null : round1(current.cycleP90Days),
        wonCount: current.cycleCount,
      },
      winRate: {
        countPercent: winRatePercent === null ? null : roundPercent(winRatePercent),
        valuePercent: valuePercent === null ? null : roundPercent(valuePercent),
        wonCount: current.wonCount,
        lostCount: current.lostCount,
        countDelta: toDeltaDto(growth(winRatePercent, previousWinRatePercent)),
        valueDelta: toDeltaDto(growth(valuePercent, previousValuePercent)),
      },
    }
  }

  async flow(ctx: AnalyticsContext): Promise<FlowDto> {
    const filters = pulseFilters(ctx)

    const [reach, aging] = await Promise.all([
      this.repo.stageReach(ctx.period, filters),
      this.repo.stageAging(filters, ctx.now),
    ])

    const stages = conversionFromPrevious(reach).map<StageConversionRowDto>((row) => ({
      stageId: row.stageId,
      stageName: row.stageName,
      pipelineName: row.pipelineName,
      category: row.category,
      logisticsRole: row.logisticsRole,
      sortOrder: row.sortOrder,
      dealCount: row.dealCount,
      cohortDeals: row.cohortDeals,
      cohortSharePercent: (() => {
        const share = ratePercent(row.dealCount, row.cohortDeals)
        return share === null ? null : roundPercent(share)
      })(),
      conversionFromPreviousPercent:
        row.conversionFromPreviousPercent === null
          ? null
          : roundPercent(row.conversionFromPreviousPercent),
    }))

    const agingRows = aging.map<StageAgingRowDto>((row) => ({
      stageId: row.stageId,
      stageName: row.stageName,
      pipelineName: row.pipelineName,
      category: row.category,
      logisticsRole: row.logisticsRole,
      sortOrder: row.sortOrder,
      openCount: row.openCount,
      openValue: toMoneyDto(money(row.openValueMinor, ctx.currency)),
      dwellP50Hours: row.dwellP50Hours === null ? null : round1(row.dwellP50Hours),
      dwellP90Hours: row.dwellP90Hours === null ? null : round1(row.dwellP90Hours),
      historicalP50Hours:
        row.historicalP50Hours === null ? null : round1(row.historicalP50Hours),
      stuckCount: row.stuckCount,
      stuckValue: toMoneyDto(money(row.stuckValueMinor, ctx.currency)),
    }))

    const totals = aggregateAging(aging)

    return {
      stageConversion: { basis: 'created_in_period', stages },
      aging: {
        stages: agingRows,
        totals: {
          openCount: totals.openCount,
          openValue: toMoneyDto(money(totals.openValueMinor, ctx.currency)),
          stuckCount: totals.stuckCount,
          stuckValue: toMoneyDto(money(totals.stuckValueMinor, ctx.currency)),
        },
      },
    }
  }
}
