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
import type { Period } from '@/server/domain/period/period'
import { commandCentreCacheKey } from './commandCentreCacheKey'
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
 * One build per period, however many people are looking at it.
 *
 * This screen is where every login lands, so its readers arrive together —
 * a morning stand-up opens it on six machines inside a minute. Each build is
 * sixteen queries against a pool of eight on a one-core database, and six of
 * those at once is ninety-six queries deep in a queue eight wide: the tail
 * waits past the connect timeout and the page 500s. That is what it was doing.
 *
 * Two readers within the window now share one build. The window is 45
 * seconds against a sync that runs every 60, so a cached answer is never
 * older than the data behind it would have been anyway — the alternative is
 * not fresher numbers, it is no numbers.
 *
 * A FAILED BUILD IS NOT CACHED. Caching a rejection would turn one timeout
 * into 45 seconds of them, which is the opposite of the point.
 */
const CACHE_TTL_MS = 45_000
const cache = new Map<string, { at: number; value: Promise<CommandCentreDto> }>()

export class CommandCentreService {
  constructor(private readonly repository: InsightsRepository) {}

  async load(period: Period, currency: string): Promise<CommandCentreDto> {
    const key = commandCentreCacheKey(period, currency)
    const now = Date.now()

    const hit = cache.get(key)
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.value

    // Evicted by age rather than by count: the keys are periods, and the
    // handful in play at once age out on their own. Sweeping here keeps a
    // month of custom ranges from accumulating in a long-lived process.
    for (const [k, entry] of cache) {
      if (now - entry.at >= CACHE_TTL_MS) cache.delete(k)
    }

    const build = this.build(period, currency)
    cache.set(key, { at: now, value: build })
    build.catch(() => cache.delete(key))

    return build
  }

  private async build(period: Period, currency: string): Promise<CommandCentreDto> {
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
      customerPair,
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
      /*
        Both windows in one query. `first_order` inside it has no date bound —
        "was this their FIRST order" is a question about a customer's whole
        history — so it walks every revenue deal, and asking twice for two
        numbers printed side by side paid for that walk twice.
      */
      this.repository.commandCustomersPair(period, comparison),
      /*
        The five counts, and not the queue behind them.

        This used to call `confirmationQueue`, which builds the whole cohort
        THREE times — once for the page, once for the per-ROP panel, once for
        the tiles — and then decorated three thousand rows to hand back a page
        of one. Measured at 6.0 s, half the endpoint's database time, for four
        numbers. `confirmationOutcomes` is the third of those queries on its
        own.
      */
      this.repository.confirmationOutcomes(period),
      this.repository.commandRejectionBand(period),
      insightsService.logistics(period, currency, {}, { withReasons: false }),
      this.repository.commandProducts(period),
      this.repository.commandFunnel(period),
      this.repository.commandHeadcount(period),
      concentrationService.concentration(period),
    ])

    const customers = customerPair.now
    const customersPrev = customerPair.previous

    // The five states sum to the window's orders: every order the board holds
    // is in exactly one of them, so there is nothing to fetch separately.
    const confirmationOrders = Object.values(confirmation).reduce((a, n) => a + n, 0)

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
        orders: confirmationOrders,
        confirmedRate:
          confirmationOrders === 0
            ? null
            : Math.round((confirmation.CONFIRMED / confirmationOrders) * 1000) / 10,
        confirmed: confirmation.CONFIRMED,
        rejected: confirmation.REJECTED,
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
      team: structure,
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
