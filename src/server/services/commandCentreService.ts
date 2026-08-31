/**
 * The executive command centre.
 *
 * ONE screen above the nine modules: what is happening, whether it is healthy,
 * and which module answers "why". It composes what those modules already
 * compute rather than re-deriving anything — every number here has exactly one
 * definition in this codebase, and this file is not allowed to invent a second.
 *
 * WHY THE HEADLINE IS ORDER INTAKE AND NOT REVENUE. Revenue is bucketed by
 * `closedAt`, and the median order on this portal takes 20.5 days to close
 * (p90 61.5). A month-over-month revenue comparison therefore reads August's
 * closed deals against July's, most of which are still open — measured, that
 * produced a headline of "+478% growth" in a month whose intake actually FELL
 * 8.5%. Revenue is still shown, because it is what the company earned; it is
 * shown WITHOUT a growth arrow, and the lag is stated beside it.
 *
 * WHAT IS DELIBERATELY ABSENT, each confirmed against the database rather than
 * assumed: paid and debt (the payment table holds 0 rows — Bitrix24 does not
 * record settlement), KPI attainment (kpi and kpi_result hold 0 rows — nobody
 * has set targets), ROAS and CAC (ad_spend holds 0 rows), stock (stock_level
 * holds 0 rows; quantities live in MoySklad), and a company-level margin
 * percentage (cost is present on 22 of 186 products, and the single product
 * that is 68.5% of revenue is not one of them). Each is reported as
 * unavailable with what it would take to connect it, never as a zero.
 */

import { concentrationService, insightsService } from './container'
import type { StructureDto } from './insightsService'
import type { Period } from '@/server/domain/period/period'
import { periodLengthInDays, previousEquivalent } from '@/server/domain/period/period'
import { money, toMajorNumber, toMoneyDto } from '@/server/domain/money/money'
import { growth, ratePercent, roundPercent, toDeltaDto } from '@/server/domain/analytics/metrics'
import type { CommandCentreDto, TrendedDto, UnavailableDto } from '@/lib/api'

export type { CommandCentreDto, TrendedDto, UnavailableDto }
import type { InsightsRepository } from '@/server/repositories/insightsRepository'

function trended(value: number, previous: number | null): TrendedDto {
  return { value, previous, delta: toDeltaDto(growth(value, previous)) }
}

/**
 * The org chart, added up.
 *
 * `structure` returns the tree rather than totals, and each node's headcount
 * already includes its subtree — so this sums the ROOTS and counts nodes for
 * departments. Summing every node would count each person once per level of
 * management above them.
 */
function rollUp(
  roots: readonly StructureDto[],
): { employees: number; active: number; working: number; departments: number } {
  let departments = 0
  const walk = (node: StructureDto): void => {
    departments += 1
    node.children.forEach(walk)
  }
  roots.forEach(walk)

  return {
    employees: roots.reduce((a, n) => a + n.headcount, 0),
    active: roots.reduce((a, n) => a + n.activeHeadcount, 0),
    working: roots.reduce((a, n) => a + n.workingHeadcount, 0),
    departments,
  }
}

export class CommandCentreService {
  constructor(private readonly repository: InsightsRepository) {}

  async load(period: Period, currency: string): Promise<CommandCentreDto> {
    const comparison = previousEquivalent(period)

    /*
      Everything at once.

      Each call is sub-second on its own and they share no state, so running
      them in sequence would spend the page's whole budget waiting. The
      comparison window is fetched alongside rather than as a second round
      trip for the same reason.
    */
    const [
      intake,
      intakePrev,
      intakeDaily,
      revenue,
      customers,
      customersPrev,
      confirmation,
      band,
      logistics,
      products,
      funnel,
      structure,
      concentration,
    ] = await Promise.all([
      this.repository.commandIntake(period),
      this.repository.commandIntake(comparison),
      this.repository.commandIntakeDaily(period),
      this.repository.commandRevenue(period),
      this.repository.commandCustomers(period),
      this.repository.commandCustomers(comparison),
      insightsService.confirmationQueue(period, {
        page: 1,
        pageSize: 1,
        sort: 'movedAt',
        order: 'desc',
      }),
      this.repository.commandRejectionBand(period),
      insightsService.logistics(period, currency),
      this.repository.commandProducts(period),
      this.repository.commandFunnel(period),
      insightsService.structure(period, currency),
      concentrationService.concentration(period),
    ])

    const averageMinor =
      intake.orders === 0 ? 0n : intake.bookedMinor / BigInt(intake.orders)
    const averagePrevMinor =
      intakePrev.orders === 0 ? 0n : intakePrev.bookedMinor / BigInt(intakePrev.orders)

    const created = funnel[0]?.orders ?? 0

    /*
      The comparison window's intake as a per-day rate, for the chart's
      reference line. Calendar days, not working days: the daily series it
      sits against is drawn on calendar days too, and mixing the two clocks
      would shift the line ~15% up for no reason a reader could see.
    */
    const comparisonDays = Math.max(1, periodLengthInDays(comparison))

    return {
      intake: {
        orders: trended(intake.orders, intakePrev.orders),
        booked: toMoneyDto(money(intake.bookedMinor, currency)),
        bookedPrevious: toMoneyDto(money(intakePrev.bookedMinor, currency)),
        bookedDelta: toDeltaDto(growth(Number(intake.bookedMinor), Number(intakePrev.bookedMinor))),
        averageOrder: toMoneyDto(money(averageMinor, currency)),
        averageOrderDelta: toDeltaDto(growth(Number(averageMinor), Number(averagePrevMinor))),
        open: intake.open,
        daily: intakeDaily.map((d) => ({
          date: d.day,
          orders: d.orders,
          booked: toMajorNumber(money(d.bookedMinor, currency)),
        })),
        previousDailyOrders:
          intakePrev.orders === 0
            ? null
            : Math.round((intakePrev.orders / comparisonDays) * 10) / 10,
      },
      revenue: {
        delivered: toMoneyDto(money(revenue.deliveredMinor, currency)),
        openPipeline: toMoneyDto(money(revenue.openMinor, currency)),
        closeLagDays: revenue.closeLagDays,
      },
      customers: {
        ordering: trended(customers.ordering, customersPrev.ordering),
        fresh: trended(customers.fresh, customersPrev.fresh),
        returning: customers.ordering - customers.fresh,
        returningSharePercent: roundPercent(
          ratePercent(customers.ordering - customers.fresh, customers.ordering) ?? 0,
        ),
      },
      confirmation: {
        orders: confirmation.totals.orders,
        confirmedRate: confirmation.totals.confirmedRate,
        confirmed: confirmation.totals.byOutcome.CONFIRMED,
        rejected: confirmation.totals.byOutcome.REJECTED,
        rejectionToday: band.today === null ? null : Math.round(band.today * 10) / 10,
        rejectionMean: band.mean,
        rejectionLimit: band.limit,
        rejectionDays: band.days,
        days: band.series.map((d) => ({
          date: d.day,
          sharePercent: d.share === null ? null : Math.round(d.share * 10) / 10,
          rejected: d.rejected,
          orders: d.orders,
          sunday: d.dow === 0,
        })),
      },
      logistics: {
        orders: logistics.totals.orders,
        delivered: logistics.totals.delivered,
        resolved:
          logistics.totals.delivered +
          logistics.totals.refused +
          logistics.totals.cancelledEarly,
        deliveryRate: logistics.totals.deliveryRate,
        inFlight: logistics.totals.inFlight,
        cancelledEarly: logistics.totals.cancelledEarly,
        regions: logistics.regions
          .slice(0, 6)
          .map((r) => ({ label: r.label, orders: r.orders, deliveryRate: r.deliveryRate })),
      },
      funnel: funnel.map((step) => ({
        ...step,
        sharePercent: created === 0 ? 0 : Math.round((step.orders / created) * 1000) / 10,
      })),
      products: {
        rows: products.rows.map((r) => ({
          label: r.label,
          revenue: toMoneyDto(money(r.revenueMinor, currency)),
          sharePercent: r.sharePercent,
        })),
        topSharePercent: products.topSharePercent,
        coveragePercent: products.coveragePercent,
      },
      team: rollUp(structure),
      concentration: {
        sourceHhi: concentration.hhi.bySource.hhi,
        sourceBand: concentration.hhi.bySource.band,
        repeatMedianDays: concentration.repeat.medianDaysBetweenFirstAndSecond,
      },
      unavailable: UNAVAILABLE,
    }
  }
}

/**
 * What this screen cannot show, and why.
 *
 * Written out rather than computed: every one was confirmed against the
 * database, and a director reading "not connected" deserves to know what would
 * connect it. The alternative — omitting the card — leaves someone wondering
 * whether the dashboard forgot warehouse or the warehouse is empty.
 */
const UNAVAILABLE: readonly UnavailableDto[] = [
  {
    key: 'stock',
    label: 'Ombor qoldigʻi',
    reason: 'Bitrix24 da qoldiq yozilmaydi — jadval boʻsh (4 ta ombor, 0 ta qoldiq).',
    needed: 'МойСклад integratsiyasi',
  },
  {
    key: 'kpi',
    label: 'KPI bajarilishi',
    reason: 'Reja qoʻyilmagan — KPI jadvallari boʻsh.',
    needed: 'Baholash metodikasi va rejalar',
  },
  {
    key: 'payments',
    label: 'Toʻlangan va qarz',
    reason: 'Bitrix24 toʻlovni umuman saqlamaydi.',
    needed: 'Buxgalteriya tizimi bilan bogʻlash',
  },
  {
    key: 'roas',
    label: 'ROAS va CAC',
    reason: 'Reklama xarajati CRM da yoʻq; Roistat da xarajat bilan daromad bir qatorda uchramaydi.',
    needed: 'Xarajat va daromadni bitta kalit boʻyicha bogʻlash',
  },
]
