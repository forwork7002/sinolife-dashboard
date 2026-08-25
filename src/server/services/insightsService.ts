/**
 * Superdashboard module orchestration.
 *
 * Thin by design: the aggregation lives in SQL (see `InsightsRepository`) and
 * this layer's whole job is to turn minor units into money DTOs, basis points
 * into percentages, and repository shapes into what the screens render.
 *
 * Anything here that starts looking like a business rule belongs in the
 * repository's SQL or in `src/server/domain`, where it can be tested.
 */

import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import type { Period } from '@/server/domain/period/period'
import type {
  CallActivityRow,
  ChannelRow,
  ConfirmationRow,
  DispatchRow,
  InsightsRepository,
  LogisticsRouteRow,
  MarginSummary,
  StructureNode,
} from '@/server/repositories/insightsRepository'

/** Basis points as a percentage, to one decimal. */
function pct(bp: number | null): number | null {
  return bp === null ? null : Math.round(bp / 10) / 10
}

export interface CohortDto {
  readonly cohort: string
  readonly size: number
  /** Retention percentage per month offset. Index 0 is the cohort month. */
  readonly retention: readonly (number | null)[]
  readonly revenue: readonly MoneyDto[]
  readonly maxOffset: number
}

export interface CohortSummaryDto {
  readonly rows: readonly CohortDto[]
  readonly stages: readonly { stage: string; customers: number }[]
  /** Share of revenue that came from customers buying a second time or later. */
  readonly repeatRevenueShare: number
  readonly repeatCustomers: number
  readonly totalCustomers: number
}

export interface LogisticsRowDto {
  readonly label: string
  readonly orders: number
  readonly delivered: number
  readonly refused: number
  readonly cancelledEarly: number
  readonly inFlight: number
  readonly revenue: MoneyDto
  readonly deliveryRate: number
  readonly medianHours: number | null
  readonly p90Hours: number | null
}

export interface LogisticsDto {
  readonly routes: readonly LogisticsRowDto[]
  readonly regions: readonly LogisticsRowDto[]
  readonly reasons: readonly { reason: string; orders: number; lost: MoneyDto }[]
  readonly totals: {
    readonly orders: number
    readonly delivered: number
    readonly refused: number
    readonly cancelledEarly: number
    /** Still moving. Excluded from the delivery rate rather than counted against it. */
    readonly inFlight: number
    readonly deliveryRate: number
    readonly medianHours: number | null
  }
}

export interface ConfirmationDto {
  readonly rows: readonly (Omit<ConfirmationRow, 'confirmRateBp'> & {
    readonly confirmRate: number
    /** Share of this operator's orders that went through the confirmation stage. */
    readonly coverage: number
    readonly stickRate: number
    /** Delivered as a share of this operator's RESOLVED orders. */
    readonly deliveryRate: number
  })[]
  readonly totals: {
    readonly orders: number
    readonly confirmed: number
    readonly unreachable: number
    readonly undecided: number
    readonly confirmRate: number
    readonly coverage: number
    readonly stickRate: number
  }
}

export interface ChannelDto {
  readonly sourceId: string
  readonly sourceName: string
  readonly leads: number
  readonly deals: number
  readonly won: number
  readonly revenue: MoneyDto
  readonly spend: MoneyDto | null
  readonly conversion: number
  readonly averageCheque: MoneyDto
  /** Return on ad spend as a multiple. Null when spend is not entered. */
  readonly roas: number | null
  readonly costPerOrder: MoneyDto | null
}

export interface MarginDto {
  readonly rows: readonly {
    readonly productId: string
    readonly productName: string
    readonly units: number
    readonly revenue: MoneyDto
    readonly discount: MoneyDto
    readonly cost: MoneyDto | null
    readonly gross: MoneyDto | null
    readonly margin: number | null
  }[]
  readonly revenue: MoneyDto
  readonly gross: MoneyDto
  readonly margin: number
  /** Percentage of revenue whose product has a known purchase price. */
  readonly coverage: number
}

export interface StructureDto {
  readonly id: string
  readonly name: string
  readonly depth: number
  readonly headName: string | null
  /** People attached directly to this unit. */
  readonly ownHeadcount: number
  readonly activeHeadcount: number
  /** This unit plus everything beneath it. */
  readonly headcount: number
  readonly deals: number
  readonly revenue: MoneyDto
  readonly children: readonly StructureDto[]
}

export class InsightsService {
  constructor(private readonly repository: InsightsRepository) {}

  /**
   * Cohort retention.
   *
   * Retention is expressed against the cohort's own size, so every row starts
   * at 100% by construction and the interesting number is how fast it falls.
   * A month with no repeat buyers reports 0, not null — the absence IS the
   * finding. Null is reserved for offsets that have not happened yet, which is
   * a different statement entirely.
   */
  async cohorts(currency: string, months = 18): Promise<CohortSummaryDto> {
    const [rows, stages] = await Promise.all([
      this.repository.cohorts({ months }),
      this.repository.retentionStages(),
    ])

    const maxOffset = rows.reduce(
      (max, row) => Math.max(max, ...row.cells.map((c) => c.monthsSince)),
      0,
    )

    const dtos = rows.map((row) => {
      const retention: (number | null)[] = []
      const revenue: MoneyDto[] = []
      const byOffset = new Map(row.cells.map((c) => [c.monthsSince, c]))

      // A cohort from three months ago cannot have a twelve-month column.
      const reachable = Math.max(0, ...row.cells.map((c) => c.monthsSince))

      for (let offset = 0; offset <= maxOffset; offset++) {
        const cell = byOffset.get(offset)
        retention.push(
          offset > reachable && !cell
            ? null
            : row.size === 0
              ? 0
              : Math.round(((cell?.customers ?? 0) / row.size) * 1000) / 10,
        )
        revenue.push(toMoneyDto(money(cell?.revenueMinor ?? 0n, currency)))
      }

      return { cohort: row.cohort, size: row.size, retention, revenue, maxOffset: reachable }
    })

    const totalCustomers = dtos.reduce((sum, r) => sum + r.size, 0)
    const repeatCustomers = rows.reduce(
      (sum, row) => sum + (row.cells.find((c) => c.monthsSince > 0)?.customers ?? 0),
      0,
    )
    const firstRevenue = rows.reduce(
      (sum, row) => sum + (row.cells.find((c) => c.monthsSince === 0)?.revenueMinor ?? 0n),
      0n,
    )
    const laterRevenue = rows.reduce(
      (sum, row) =>
        sum + row.cells.filter((c) => c.monthsSince > 0).reduce((s, c) => s + c.revenueMinor, 0n),
      0n,
    )
    const total = firstRevenue + laterRevenue

    return {
      rows: dtos,
      stages,
      repeatRevenueShare:
        total === 0n ? 0 : Math.round(Number((laterRevenue * 1000n) / total)) / 10,
      repeatCustomers,
      totalCustomers,
    }
  }

  async logistics(period: Period, currency: string): Promise<LogisticsDto> {
    const [routes, regions, reasons] = await Promise.all([
      this.repository.logisticsRoutes(period),
      this.repository.logisticsRegions(period),
      this.repository.refusalReasons(period),
    ])

    const toRow = (r: LogisticsRouteRow): LogisticsRowDto => ({
      label: r.route,
      orders: r.orders,
      delivered: r.delivered,
      refused: r.refused,
      cancelledEarly: r.cancelledEarly,
      inFlight: r.inFlight,
      revenue: toMoneyDto(money(r.revenueMinor, currency)),
      deliveryRate: pct(r.deliveryRateBp) ?? 0,
      medianHours: r.medianHours === null ? null : Math.round(r.medianHours * 10) / 10,
      p90Hours: r.p90Hours === null ? null : Math.round(r.p90Hours * 10) / 10,
    })

    const orders = regions.reduce((sum, r) => sum + r.orders, 0)
    const delivered = regions.reduce((sum, r) => sum + r.delivered, 0)
    const refused = regions.reduce((sum, r) => sum + r.refused, 0)
    const cancelled = regions.reduce((sum, r) => sum + r.cancelledEarly, 0)
    const inFlight = regions.reduce((sum, r) => sum + r.inFlight, 0)

    /**
     * Resolved orders only — the same denominator the per-row rate uses.
     *
     * Dividing by every order in the window measures how much of the month has
     * finished, not how well delivery works: mid-month it reported 42% for an
     * operation that delivers 93% of what it dispatches.
     */
    const resolved = delivered + refused + cancelled

    // Weighted by order count, because a region with nine orders should not
    // move the company median as far as one with nine hundred.
    const timed = regions.filter((r) => r.medianHours !== null)
    const weight = timed.reduce((sum, r) => sum + r.orders, 0)
    const medianHours =
      weight === 0
        ? null
        : Math.round(
            (timed.reduce((sum, r) => sum + (r.medianHours ?? 0) * r.orders, 0) / weight) * 10,
          ) / 10

    return {
      routes: routes.map(toRow),
      regions: regions.map(toRow),
      reasons: reasons.map((r) => ({
        reason: r.reason,
        orders: r.orders,
        lost: toMoneyDto(money(r.lostMinor, currency)),
      })),
      totals: {
        orders,
        delivered,
        refused,
        cancelledEarly: cancelled,
        inFlight,
        deliveryRate: resolved === 0 ? 0 : Math.round((delivered / resolved) * 1000) / 10,
        medianHours,
      },
    }
  }

  async confirmations(period: Period): Promise<ConfirmationDto> {
    const rows = await this.repository.confirmations(period)

    const mapped = rows.map((r: ConfirmationRow) => {
      const { confirmRateBp, ...rest } = r
      const resolved = r.delivered + r.failed

      return {
        ...rest,
        confirmRate: pct(confirmRateBp) ?? 0,
        /**
         * The rate that actually varies.
         *
         * Confirmation on this portal is optional, and almost nobody records a
         * failed attempt — so `confirmRate` comes out at 100% for every
         * operator every month and says nothing. How much of their book they
         * put through the step ranges from 20% to 60% and is a real
         * difference in how people work.
         */
        coverage: r.orders === 0 ? 0 : Math.round((r.confirmed / r.orders) * 1000) / 10,
        deliveryRate: resolved === 0 ? 0 : Math.round((r.delivered / resolved) * 1000) / 10,
        /**
         * How many confirmations survived to delivery.
         *
         * This is the column that catches an operator clearing their queue by
         * marking everything confirmed: their confirmation rate looks superb
         * and this one collapses.
         */
        stickRate:
          r.deliveredAfterConfirm + r.refusedAfterConfirm === 0
            ? 0
            : Math.round(
                (r.deliveredAfterConfirm / (r.deliveredAfterConfirm + r.refusedAfterConfirm)) *
                  1000,
              ) / 10,
      }
    })

    const sum = (pick: (r: ConfirmationRow) => number) => rows.reduce((s, r) => s + pick(r), 0)
    const confirmed = sum((r) => r.confirmed)
    const unreachable = sum((r) => r.unreachable)
    const orders = sum((r) => r.orders)
    const delivered = sum((r) => r.deliveredAfterConfirm)
    const refusedAfter = sum((r) => r.refusedAfterConfirm)

    return {
      rows: mapped,
      totals: {
        orders,
        confirmed,
        unreachable,
        undecided: sum((r) => r.undecided),
        /**
         * Of the orders that needed a confirmation call, how many got one.
         *
         * Orders that went straight to delivery are excluded from both sides:
         * the confirmation stage is optional on this portal — about a quarter
         * of orders pass through it — so counting the other three quarters as
         * failed confirmations would describe a process nobody runs.
         */
        confirmRate:
          confirmed + unreachable === 0
            ? 0
            : Math.round((confirmed / (confirmed + unreachable)) * 1000) / 10,
        /** How much of the order flow the confirmation step actually covers. */
        coverage: orders === 0 ? 0 : Math.round((confirmed / orders) * 1000) / 10,
        stickRate:
          delivered + refusedAfter === 0
            ? 0
            : Math.round((delivered / (delivered + refusedAfter)) * 1000) / 10,
      },
    }
  }

  async channels(period: Period, currency: string): Promise<ChannelDto[]> {
    const rows = await this.repository.channels(period)

    return rows.map((r: ChannelRow) => ({
      sourceId: r.sourceId,
      sourceName: r.sourceName,
      leads: r.leads,
      deals: r.deals,
      won: r.won,
      revenue: toMoneyDto(money(r.revenueMinor, currency)),
      spend: r.spendMinor === null ? null : toMoneyDto(money(r.spendMinor, currency)),
      conversion: pct(r.conversionBp) ?? 0,
      averageCheque: toMoneyDto(money(r.averageChequeMinor, currency)),
      // Null, never Infinity: a channel with no spend recorded has unknown
      // return, and a dash says that where "∞×" would look like a triumph.
      roas:
        r.spendMinor === null || r.spendMinor === 0n
          ? null
          : Math.round(Number((r.revenueMinor * 100n) / r.spendMinor)) / 100,
      costPerOrder:
        r.spendMinor === null || r.won === 0
          ? null
          : toMoneyDto(money(r.spendMinor / BigInt(r.won), currency)),
    }))
  }

  async margin(period: Period, currency: string): Promise<MarginDto> {
    const summary: MarginSummary = await this.repository.margin(period)

    return {
      rows: summary.rows.map((r) => ({
        productId: r.productId,
        productName: r.productName,
        units: r.units,
        revenue: toMoneyDto(money(r.revenueMinor, currency)),
        discount: toMoneyDto(money(r.discountMinor, currency)),
        cost: r.costMinor === null ? null : toMoneyDto(money(r.costMinor, currency)),
        gross: r.grossMinor === null ? null : toMoneyDto(money(r.grossMinor, currency)),
        margin: pct(r.marginBp),
      })),
      revenue: toMoneyDto(money(summary.revenueMinor, currency)),
      gross: toMoneyDto(money(summary.grossMinor, currency)),
      margin: pct(summary.marginBp) ?? 0,
      coverage: pct(summary.coverageBp) ?? 0,
    }
  }

  async callActivity(period: Period): Promise<CallActivityRow[]> {
    return this.repository.callActivity(period)
  }

  async dispatch(period: Period, currency: string) {
    const rows = await this.repository.dispatchPoints(period)
    return rows.map((r: DispatchRow) => ({
      point: r.point,
      orders: r.orders,
      delivered: r.delivered,
      refused: r.refused,
      revenue: toMoneyDto(money(r.revenueMinor, currency)),
      deliveryRate: pct(r.deliveryRateBp) ?? 0,
    }))
  }

  /**
   * The org chart, rolled up.
   *
   * Rollup happens here rather than in SQL because "a department's revenue"
   * means the unit plus everything under it, and that is a display decision —
   * the database should not have to guess whether the caller wants own or
   * inclusive figures.
   */
  async structure(period: Period, currency: string) {
    const nodes = await this.repository.structure(period)
    const children = new Map<string | null, StructureNode[]>()

    for (const node of nodes) {
      const siblings = children.get(node.parentId) ?? []
      siblings.push(node)
      children.set(node.parentId, siblings)
    }

    const build = (node: StructureNode, depth: number): StructureDto => {
      const kids = (children.get(node.id) ?? []).map((child) => build(child, depth + 1))

      const rolled = kids.reduce(
        (acc, kid) => ({
          headcount: acc.headcount + kid.headcount,
          deals: acc.deals + kid.deals,
          revenueMinor: acc.revenueMinor + BigInt(kid.revenue.amountMinor),
        }),
        { headcount: node.headcount, deals: node.deals, revenueMinor: node.revenueMinor },
      )

      return {
        id: node.id,
        name: node.name,
        depth,
        headName: node.headName,
        ownHeadcount: node.headcount,
        activeHeadcount: node.activeHeadcount,
        headcount: rolled.headcount,
        deals: rolled.deals,
        revenue: toMoneyDto(money(rolled.revenueMinor, currency)),
        children: kids,
      }
    }

    return (children.get(null) ?? []).map((root) => build(root, 0))
  }
}
