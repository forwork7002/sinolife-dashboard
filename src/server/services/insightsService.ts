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

import {
  type EmployeeScopeFilter,
  type ScopedPeriod,
  scopedPeriod,
} from '@/server/domain/employees/branches'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import type { Period } from '@/server/domain/period/period'
import { allTime, periodLengthInDays } from '@/server/domain/period/period'
import type {
  CallActivityRow,
  CallDirectionRow,
  ChannelRow,
  ConfirmationOrderQuery,
  ConfirmationOrderRow,
  ConfirmationOutcomeTotals,
  ConfirmationRopRow,
  ConfirmationRow,
  DispatchRow,
  InsightsRepository,
  LogisticsRouteRow,
  MarginSummary,
  StructureNode,
} from '@/server/repositories/insightsRepository'
import type { ConfirmationOutcomeValue, ConfirmationQueueMode } from '@/server/domain/types'

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
  /** Distinct customers on an open retention deal. Never the sum of `stages`. */
  readonly workedCustomers: number
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
  readonly deliveryRate: number | null
  readonly medianDays: number | null
  readonly p90Days: number | null
}

export interface LogisticsDto {
  readonly routes: readonly LogisticsRowDto[]
  readonly regions: readonly LogisticsRowDto[]
  /**
   * Losses, split by whether the goods had already been dispatched.
   *
   * `stage` is 'RETURNED' (travelled and came back) or 'CANCELLED' (killed
   * before anything shipped). They cost completely different amounts and used
   * to share one bar labelled "return reasons".
   */
  readonly reasons: readonly {
    stage: string
    reason: string
    orders: number
    /** Null where the rows are excluded from revenue and cannot be summed. */
    lost: MoneyDto | null
  }[]
  readonly totals: {
    readonly orders: number
    readonly delivered: number
    readonly refused: number
    readonly cancelledEarly: number
    /** Still moving. Excluded from the delivery rate rather than counted against it. */
    readonly inFlight: number
    readonly deliveryRate: number | null
    readonly medianDays: number | null
  }
}

export interface ConfirmationDto {
  readonly rows: readonly (Omit<ConfirmationRow, 'confirmRateBp'> & {
    readonly confirmRate: number | null
    /** Share of this operator's orders that went through the confirmation stage. */
    readonly coverage: number
    readonly stickRate: number
    /** Delivered as a share of this operator's RESOLVED orders. */
    readonly deliveryRate: number | null
  })[]
  readonly totals: {
    /** Every revenue order created in the window. */
    readonly orders: number
    /** Orders belonging to operators who appear in `rows`. */
    readonly coveredByRows: number
    /** Unconfirmed and still moving — not yet at the step, rather than skipped. */
    readonly unconfirmedOpen: number
    /** Unconfirmed and already resolved — genuinely skipped. */
    readonly unconfirmedClosed: number
    readonly confirmed: number
    readonly unreachable: number
    readonly undecided: number
    readonly coverage: number
    readonly stickRate: number
  }
}

/**
 * One visit to Тасдиклаш on an order's row: when it arrived, how it ended.
 *
 * The board keeps one row per order and dates it by the LAST arrival, so an
 * order that came back moves to the day it came back. This is what the day it
 * left still gets to show.
 */
export interface ConfirmationVisitDto {
  /** 1 for the first arrival in the order's life, counting up. */
  readonly no: number
  readonly queuedAt: string
  readonly outcome: ConfirmationOutcomeValue
  readonly decidedAt: string | null
}

/** One order in the Тасдиклаш queue, in the column order the floor reads. */
export interface ConfirmationOrderDto {
  readonly dealId: string
  /** РОП */
  readonly rop: string | null
  /** № — position in this ROP's day, restarting each morning. */
  readonly dailyNo: number
  /** Id сделки — the Bitrix24 id, the key both systems look an order up by. */
  readonly bitrixId: string | null
  readonly orderCode: string | null
  readonly title: string
  readonly customerName: string | null
  readonly customerPhones: readonly string[]
  readonly employeeName: string
  readonly products: readonly string[]
  readonly region: string | null
  readonly deliveryAddress: string | null
  /** Источник — the acquisition channel. */
  readonly sourceName: string | null
  readonly amount: MoneyDto
  readonly stageName: string
  readonly outcome: ConfirmationOutcomeValue
  /** Дата создания — when the order was placed. What the window selects on. */
  readonly createdAt: string
  /** The order's last confirmation move, which is where its status comes from. */
  readonly movedAt: string
  /** When it entered the queue. Null when it was refused without ever being in one. */
  readonly queuedAt: string | null
  readonly decidedAt: string | null
  readonly hoursToDecide: number | null
  /**
   * How many times the order has reached Тасдиклаш, over its whole life.
   *
   * Reported by the tooltip, and NOT what draws the mark: an order can enter
   * twice in a quarter of an hour because one person confirmed it, saw a
   * mistake and pulled it back.
   */
  readonly queueEntries: number
  /**
   * How many of those were real returns — six hours or more after the previous
   * arrival, which is the rule the bot's «🔁 ҚАЙТА ТУШДИ» already follows.
   * More than zero draws the mark.
   */
  readonly queueReturns: number
  /**
   * When the order was last in the queue before it came back. Null when it
   * never has.
   */
  readonly previousQueuedAt: string | null
  /**
   * Every visit the order has made to Тасдиклаш, NEWEST FIRST.
   *
   * `[0]` is the state this row is filed under everywhere else on the screen.
   * SHOWN, NEVER SUMMED — `totals`, `byRop` and the state filter all read
   * `outcome` alone, so an order confirmed in August and refused in September
   * still counts once, as refused.
   */
  readonly queueHistory: readonly ConfirmationVisitDto[]
}

export interface ConfirmationQueueDto {
  readonly items: readonly ConfirmationOrderDto[]
  readonly totalItems: number
  /** Every ROP group with orders in the window — the filter's options. */
  readonly rops: readonly string[]
  /** The Статистика panel: one row per ROP group. */
  readonly byRop: readonly ConfirmationRopRow[]
  readonly totals: {
    /** Orders that entered the queue in the window. The denominator. */
    readonly orders: number
    readonly byOutcome: ConfirmationOutcomeTotals
    /**
     * `Тасдиқланиш %` — confirmed over everything that entered the queue.
     *
     * The same definition the team's own РОП dashboards use, so the two
     * screens cannot quote different figures for one word. Null on an empty
     * window: no orders is not a zero percent confirmation rate.
     */
    readonly confirmedRate: number | null
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
  /** won / leads — of enquiries, how many paid. */
  readonly conversion: number | null
  /** won / deals — of orders that reached a money pipeline, how many closed. */
  readonly funnelRate: number | null
  readonly averageCheque: MoneyDto | null
  /** Return on ad spend as a multiple. Null when spend is not entered. */
  readonly roas: number | null
  readonly costPerOrder: MoneyDto | null
}

/**
 * Call activity, with the two directions kept apart.
 *
 * Blending them produces a single "connection rate" that answers neither
 * question: this log is 92% inbound, so a blended rate is mostly the share of
 * CUSTOMERS who got an answer, presented under a label about dialling.
 */
export interface CallsDto {
  readonly rows: readonly CallActivityRow[]
  readonly outbound: CallDirectionRow
  readonly inbound: CallDirectionRow
}

export interface MarginDto {
  readonly rows: readonly {
    readonly productId: string
    readonly productName: string
    readonly units: number
    readonly revenue: MoneyDto
    /** Given away — sold below list. Never negative. */
    readonly discount: MoneyDto
    /** Sold above list. Never negative. Kept apart so neither cancels the other. */
    readonly overList: MoneyDto
    readonly cost: MoneyDto | null
    readonly gross: MoneyDto | null
    readonly margin: number | null
  }[]
  readonly revenue: MoneyDto
  /** Revenue from products whose purchase price is known — the margin's base. */
  readonly costedRevenue: MoneyDto
  readonly gross: MoneyDto
  readonly discount: MoneyDto
  readonly overList: MoneyDto
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
  /** This unit plus everything beneath it. All three roll up together. */
  readonly headcount: number
  /** Of those, marked active in Bitrix24. */
  readonly activeHeadcount: number
  /** Of the active, those who made a call or won a deal this period. */
  readonly workingHeadcount: number
  readonly deals: number
  readonly revenue: MoneyDto
  /**
   * Is this unit inside the active filial?
   *
   * The org chart is the MAP of the company, so it keeps showing every unit
   * even when the rest of the dashboard shows one branch — a map with half the
   * country cut off is not a map. Marking the subtree instead is how the page
   * stays honest about which part of it the other screens are counting. True
   * everywhere when no branch is active.
   */
  readonly inScope: boolean
  readonly children: readonly StructureDto[]
}

/**
 * The FILIAL scope, as this service receives it.
 *
 * Resolved by `ReferenceRepository.resolveBranchScope` and already intersected
 * with the caller's authorisation scope, so one list carries both. The default
 * — an empty object — means unrestricted, which is what an endpoint that has
 * not been wired to the branch control yet still gets.
 */
export interface InsightsScope extends EmployeeScopeFilter {
  /** The branch's own department id, for the tree that marks its subtree. */
  readonly branchDepartmentId?: string | null
}

export class InsightsService {
  constructor(private readonly repository: InsightsRepository) {}

  /**
   * Fold the scope into the window every query already takes.
   *
   * See `ScopedPeriod`: this is the single door the employee restriction walks
   * through on its way into the insights SQL. A query that ignores it is a
   * whole-company answer with a branch label on it.
   */
  private window(period: Period, scope: EmployeeScopeFilter): ScopedPeriod {
    return scopedPeriod(period, scope)
  }

  /** Whole months between two `YYYY-MM-DD` cohort keys. */
  private static monthsApart(from: string, to: string): number {
    const [fy, fm] = from.split('-').map(Number)
    const [ty, tm] = to.split('-').map(Number)
    if (!fy || !fm || !ty || !tm) return 0
    return Math.max(0, (ty - fy) * 12 + (tm - fm))
  }

  /**
   * Cohort retention.
   *
   * Retention is expressed against the cohort's own size, so every row starts
   * at 100% by construction and the interesting number is how fast it falls.
   * A month with no repeat buyers reports 0, not null — the absence IS the
   * finding. Null is reserved for offsets that have not happened yet, which is
   * a different statement entirely.
   */
  async cohorts(
    currency: string,
    months = 18,
    scope: EmployeeScopeFilter = {},
  ): Promise<CohortSummaryDto> {
    // A cohort is a set of CUSTOMERS, but every purchase in it belongs to an
    // employee, so the branch narrows it like everything else.
    const options: { months: number } & EmployeeScopeFilter = {
      months,
      restrictToEmployeeIds: scope.restrictToEmployeeIds ?? null,
    }

    const [rows, base] = await Promise.all([
      this.repository.cohorts(options),
      this.repository.retentionStages(),
    ])

    const maxOffset = rows.reduce(
      (max, row) => Math.max(max, ...row.cells.map((c) => c.monthsSince)),
      0,
    )

    // The repository returns one row per month up to the current one, so the
    // latest key IS this month — no clock needed, and no chance of the grid
    // disagreeing with the rows it was built from.
    const newestCohort = rows.reduce((latest, row) => (row.cohort > latest ? row.cohort : latest), '')

    const dtos = rows.map((row) => {
      const retention: (number | null)[] = []
      const revenue: MoneyDto[] = []
      const byOffset = new Map(row.cells.map((c) => [c.monthsSince, c]))

      /*
        How many months this cohort has actually LIVED — from the calendar,
        not from where its own returns happen to stop.

        Taken from the cells, a cohort that never came back after its first
        month reported one reachable column and fourteen empty ones, so the
        June 2025 row rendered fourteen months of nobody returning as
        fourteen months of "not measured". That is the opposite of the
        finding, and it is the row a reader most needs to see. Null belongs
        only to months that have not happened yet.
      */
      const reachable = InsightsService.monthsApart(row.cohort, newestCohort)

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
    /*
      Everyone who ever came back, not everyone who came back NEXT MONTH.

      `.find` stopped at the first cell past offset zero, so a customer whose
      second order landed in month +2 was not a returning customer as far as
      this tile was concerned. On this database that is 320 against 751 — the
      tile understated its own headline by more than half, under a label
      reading «Qaytgan mijozlar».

      Summing the cells instead would have been the other error: a customer
      who returned in +1 and again in +3 is counted in both. The repository
      counts each cohort's returners once, which is the only place that can.
    */
    const repeatCustomers = rows.reduce((sum, row) => sum + row.returned, 0)
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
      stages: base.stages,
      workedCustomers: base.workedCustomers,
      repeatRevenueShare:
        total === 0n ? 0 : Math.round(Number((laterRevenue * 1000n) / total)) / 10,
      repeatCustomers,
      totalCustomers,
    }
  }

  /**
   * @param options.withReasons Fetch the refusal breakdown. The logistics
   *   SCREEN draws it; the command centre reads only the totals and the
   *   regions, and that third query is 0.7 s it would spend on a chart it
   *   never renders.
   */
  async logistics(
    period: Period,
    currency: string,
    scope: EmployeeScopeFilter = {},
    options: { withReasons?: boolean } = {},
  ): Promise<LogisticsDto> {
    const window = this.window(period, scope)

    /*
      ONE STATEMENT FOR BOTH CUTS. They used to be two, differing by a single
      projected column, each rebuilding three unbounded history CTEs — 2 212 ms
      and 1 361 ms measured side by side for one card, and the command centre
      pays the same pair. See `logisticsCuts`.
    */
    const [cuts, reasons] = await Promise.all([
      this.repository.logisticsCuts(window),
      options.withReasons === false
        ? Promise.resolve([] as Awaited<ReturnType<typeof this.repository.refusalReasons>>)
        : this.repository.refusalReasons(window),
    ])
    const { routes: routeCut, regions: regionCut } = cuts

    const toRow = (r: LogisticsRouteRow): LogisticsRowDto => ({
      label: r.route,
      orders: r.orders,
      delivered: r.delivered,
      refused: r.refused,
      cancelledEarly: r.cancelledEarly,
      inFlight: r.inFlight,
      revenue: toMoneyDto(money(r.revenueMinor, currency)),
      deliveryRate: pct(r.deliveryRateBp),
      medianDays: r.medianDays === null ? null : Math.round(r.medianDays * 10) / 10,
      p90Days: r.p90Days === null ? null : Math.round(r.p90Days * 10) / 10,
    })

    /*
      The totals come from the QUERY, not from adding the rows up here.

      Counts would survive a summation; the pace would not. The median used to
      be a weighted mean of each region's median, which is not a median of
      anything — and it was weighted by every order in the region while the
      median itself covered only the delivered ones, so a region that shipped
      nine of nine hundred pulled the company figure by nine hundred. Against
      the true median over August it read 197.5 where the answer was 87.4.
    */
    const { orders, delivered, refused, cancelledEarly: cancelled, inFlight } = regionCut.total

    /**
     * Resolved orders only — the same denominator the per-row rate uses.
     *
     * Dividing by every order in the window measures how much of the month has
     * finished, not how well delivery works: mid-month it reported 42% for an
     * operation that delivers 93% of what it dispatches.
     */
    const resolved = delivered + refused + cancelled

    const medianDays =
      regionCut.total.medianDays === null ? null : Math.round(regionCut.total.medianDays * 10) / 10

    return {
      routes: routeCut.rows.map(toRow),
      regions: regionCut.rows.map(toRow),
      reasons: reasons.map((r) => ({
        stage: r.stage,
        reason: r.reason,
        orders: r.orders,
        // Null for pre-sale losses: those rows are excluded from revenue
        // because the same order appears in several pipelines, so their
        // amounts cannot be summed without double-counting.
        lost: r.lostMinor === null ? null : toMoneyDto(money(r.lostMinor, currency)),
      })),
      totals: {
        orders,
        delivered,
        refused,
        cancelledEarly: cancelled,
        inFlight,
        /*
          Null, not zero, when nothing has resolved yet.

          A window whose orders are all still travelling — the first days of a
          month, "today", "this week" on a Monday — showed a critical-red 0.0%
          ring beside its own text saying no order had resolved. `rateBp` in
          the repository already returns null for exactly this; these two
          hand-written rates did not.
        */
        deliveryRate: resolved === 0 ? null : Math.round((delivered / resolved) * 1000) / 10,
        medianDays,
      },
    }
  }

  async confirmations(period: Period, scope: EmployeeScopeFilter = {}): Promise<ConfirmationDto> {
    const window = this.window(period, scope)

    const [rows, windowOrders] = await Promise.all([
      this.repository.confirmations(window),
      this.repository.confirmationWindowOrders(window),
    ])

    const mapped = rows.map((r: ConfirmationRow) => {
      const { confirmRateBp, ...rest } = r
      const resolved = r.delivered + r.failed

      return {
        ...rest,
        confirmRate: pct(confirmRateBp),
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
        deliveryRate: resolved === 0 ? null : Math.round((r.delivered / resolved) * 1000) / 10,
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
    const delivered = sum((r) => r.deliveredAfterConfirm)
    const refusedAfter = sum((r) => r.refusedAfterConfirm)

    /**
     * Every order in the window — NOT the sum of the rows.
     *
     * The row list is filtered to operators who used the confirmation stage,
     * so summing it drops the operators with no coverage at all. Coverage
     * divided by that sum answers "among the people who use the stage, how
     * much do they cover", which is a different and much flattering question.
     */
    const orders = windowOrders.orders
    const coveredByRows = sum((r) => r.orders)

    return {
      rows: mapped,
      totals: {
        orders,
        /** Orders belonging to operators who appear in `rows`. */
        coveredByRows,
        unconfirmedOpen: windowOrders.unconfirmedOpen,
        unconfirmedClosed: windowOrders.unconfirmedClosed,
        confirmed,
        unreachable,
        /*
          Derived from the window, not summed from the rows.
          
          `undecided` rode the same filtered row list as `orders` did, so it
          reported 1,227 where the window holds 1,289 — the 62 orders belonging
          to operators who never touched the stage are undecided by definition,
          and dropping them understated exactly the population the number is
          about.
        */
        undecided: windowOrders.unconfirmedOpen + windowOrders.unconfirmedClosed,
        /**
         * How much of the order flow the confirmation step actually covers.
         *
         * This is the headline, and it replaced a "confirmation rate" of
         * confirmed / (confirmed + unreachable). That ratio read 100.0% for
         * every operator and every period, because this portal records the
         * confirmed outcome and never the unreachable one — the denominator
         * could not differ from the numerator. A rate that cannot fall is not
         * a measurement, and it sat on the overview looking like a perfect
         * score.
         */
        coverage: orders === 0 ? 0 : Math.round((confirmed / orders) * 1000) / 10,
        stickRate:
          delivered + refusedAfter === 0
            ? 0
            : Math.round((delivered / (delivered + refusedAfter)) * 1000) / 10,
      },
    }
  }

  /**
   * The confirmation queue read as ORDERS rather than as operators.
   *
   * Two round trips on purpose. The five totals are a statement about the
   * whole window and must not move when someone filters the list to one
   * state — a band whose numbers change to match its own filter cannot be
   * used to compare states, which is the only reason to put five of them
   * side by side.
   */
  async confirmationQueue(
    period: Period,
    query: ConfirmationOrderQuery,
    scope: EmployeeScopeFilter = {},
    mode: ConfirmationQueueMode = 'window',
  ): Promise<ConfirmationQueueDto> {
    /*
      THE BACKLOG HAS NO WINDOW, and says so by asking for all of time.

      Every reading below binds $1 and $2, so the span still has to be a real
      one — the cohort predicate in backlog mode is `signal = CONFIRM_NEW` and
      the dates are left deliberately vacuous rather than removed, which keeps
      one set of parameter positions across both modes.
    */
    const window = mode === 'backlog' ? allTime(period.timeZone) : this.window(period, scope)

    /*
      TWO ROUND TRIPS, NOT THREE.

      Each one rebuilds the whole cohort CTE, and on the production database
      that is about two seconds of work — so a third query was two seconds
      spent re-deriving numbers the second one already had. The tiles are the
      ROP breakdown summed down its columns, so they are computed here instead.

      The tiles still follow the ROP filter and the search box but NOT the
      state filter: a band whose numbers changed to match its own selection
      could not be used to compare one state against another, which is the only
      reason to put five of them side by side.
    */
    /*
      TWO SHAPES, CHOSEN BY THE WINDOW'S LENGTH — measured, not preferred.

      Up to two months the page and the panel run as two statements side by
      side, each building the cohort itself; Postgres gives each its own
      parallel workers, and on production the pair returns a month in 2–3 s.
      Past that, the same pair ran the one core against itself and «Shu yil»
      died on the twenty-second statement timeout — in a fair trial the pair
      did not return a year inside ninety seconds. The single statement builds
      the cohort once and cannot use parallel workers across its materialised
      CTE, so it is slower for a month (a steady ~4.6 s) and the only thing
      that finishes for a year (~5 s). Same rows either way, checked row for
      row on production.
    */
    const LONG_WINDOW_DAYS = 62
    const { page, byRop } =
      periodLengthInDays(window) > LONG_WINDOW_DAYS
        ? await this.repository.confirmationBoard(window, query, mode).then((board) => ({
            page: { rows: board.rows, totalItems: board.totalItems },
            byRop: board.byRop,
          }))
        : await Promise.all([
            this.repository.confirmationOrders(window, query, mode),
            this.repository.confirmationByRop(window, { q: query.q }, mode),
          ]).then(([page, byRop]) => ({ page, byRop }))

    const scoped = query.rop ? byRop.filter((r) => r.rop === query.rop) : byRop
    const byOutcome: ConfirmationOutcomeTotals = {
      CONFIRM_NEW: scoped.reduce((n, r) => n + r.pending, 0),
      CONFIRMED: scoped.reduce((n, r) => n + r.confirmed, 0),
      NO_ANSWER: scoped.reduce((n, r) => n + r.noAnswer, 0),
      REJECTED: scoped.reduce((n, r) => n + r.rejected, 0),
      UNCONFIRMED_SHIPPED: scoped.reduce((n, r) => n + r.unconfirmedShipped, 0),
    }

    // The filter's options come from the breakdown rather than a third query:
    // the two would otherwise be able to disagree about which ROPs exist.
    const rops = byRop
      .map((r) => r.rop)
      /*
        The no-ROP group is OFFERED now, not hidden.

        It used to be dropped from the dropdown because the page's WHERE clause
        could not match it — `c.rop` is NULL for these rows — so the only way
        to select it was to type it into the address bar, and doing that showed
        a populated tile band over an empty table. The predicate understands
        the label now (`InsightsRepository.ropMatch`), which makes the group
        selectable, and the orders it holds are worth looking at: a seller
        outside every ROP department is a finding about the org chart.
      */
      .sort((a, b) => a.localeCompare(b))

    const orders = Object.values(byOutcome).reduce((sum, count) => sum + count, 0)

    return {
      items: page.rows.map((r: ConfirmationOrderRow) => ({
        dealId: r.dealId,
        rop: r.rop,
        dailyNo: r.dailyNo,
        bitrixId: r.bitrixId,
        orderCode: r.orderCode,
        title: r.title,
        customerName: r.customerName,
        customerPhones: r.customerPhones,
        employeeName: r.employeeName,
        products: r.products,
        region: r.region,
        deliveryAddress: r.deliveryAddress,
        sourceName: r.sourceName,
        // The deal's OWN currency, not the app default: an order is worth what
        // it was written in, and converting it here would invent a rate.
        amount: toMoneyDto(money(r.amountMinor, r.currency)),
        stageName: r.stageName,
        outcome: r.outcome,
        createdAt: r.createdAt.toISOString(),
        movedAt: r.movedAt.toISOString(),
        queuedAt: r.queuedAt?.toISOString() ?? null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        hoursToDecide: r.hoursToDecide,
        queueEntries: r.queueEntries,
        queueReturns: r.queueReturns,
        previousQueuedAt: r.previousQueuedAt?.toISOString() ?? null,
        queueHistory: r.queueHistory.map((v) => ({
          no: v.no,
          queuedAt: v.queuedAt.toISOString(),
          outcome: v.outcome,
          decidedAt: v.decidedAt?.toISOString() ?? null,
        })),
      })),
      totalItems: page.totalItems,
      rops,
      byRop,
      totals: {
        orders,
        byOutcome,
        confirmedRate:
          orders === 0 ? null : Math.round((byOutcome.CONFIRMED / orders) * 1000) / 10,
      },
    }
  }

  async channels(
    period: Period,
    currency: string,
    scope: EmployeeScopeFilter = {},
  ): Promise<ChannelDto[]> {
    const rows = await this.repository.channels(this.window(period, scope))

    return rows.map((r: ChannelRow) => ({
      sourceId: r.sourceId,
      sourceName: r.sourceName,
      leads: r.leads,
      deals: r.deals,
      won: r.won,
      revenue: toMoneyDto(money(r.revenueMinor, currency)),
      spend: r.spendMinor === null ? null : toMoneyDto(money(r.spendMinor, currency)),
      conversion: pct(r.conversionBp),
      funnelRate: pct(r.funnelRateBp),
      averageCheque:
        r.averageChequeMinor === null
          ? null
          : toMoneyDto(money(r.averageChequeMinor, currency)),
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

  async margin(
    period: Period,
    currency: string,
    scope: EmployeeScopeFilter = {},
  ): Promise<MarginDto> {
    const summary: MarginSummary = await this.repository.margin(this.window(period, scope))

    return {
      rows: summary.rows.map((r) => ({
        productId: r.productId,
        productName: r.productName,
        units: r.units,
        revenue: toMoneyDto(money(r.revenueMinor, currency)),
        discount: toMoneyDto(money(r.discountMinor, currency)),
        overList: toMoneyDto(money(r.overListMinor, currency)),
        cost: r.costMinor === null ? null : toMoneyDto(money(r.costMinor, currency)),
        gross: r.grossMinor === null ? null : toMoneyDto(money(r.grossMinor, currency)),
        margin: pct(r.marginBp),
      })),
      revenue: toMoneyDto(money(summary.revenueMinor, currency)),
      costedRevenue: toMoneyDto(money(summary.costedRevenueMinor, currency)),
      gross: toMoneyDto(money(summary.grossMinor, currency)),
      discount: toMoneyDto(money(summary.discountMinor, currency)),
      overList: toMoneyDto(money(summary.overListMinor, currency)),
      margin: pct(summary.marginBp) ?? 0,
      coverage: pct(summary.coverageBp) ?? 0,
    }
  }

  async callActivity(period: Period, scope: EmployeeScopeFilter = {}): Promise<CallsDto> {
    const window = this.window(period, scope)

    const [rows, directions] = await Promise.all([
      this.repository.callActivity(window),
      this.repository.callDirections(window),
    ])

    const of = (direction: string) =>
      directions.find((d) => d.direction === direction) ?? {
        direction,
        calls: 0,
        connected: 0,
        talkSeconds: 0,
      }

    return { rows, outbound: of('OUTBOUND'), inbound: of('INBOUND') }
  }

  async dispatch(period: Period, currency: string, scope: EmployeeScopeFilter = {}) {
    const rows = await this.repository.dispatchPoints(this.window(period, scope))
    return rows.map((r: DispatchRow) => ({
      point: r.point,
      orders: r.orders,
      delivered: r.delivered,
      refused: r.refused,
      // In the denominator of the rate above, so it has to be visible beside
      // it — a rate whose fraction the screen cannot show is unreadable.
      cancelledEarly: r.cancelledEarly,
      revenue: toMoneyDto(money(r.revenueMinor, currency)),
      deliveryRate: pct(r.deliveryRateBp),
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
  async structure(period: Period, currency: string, scope: InsightsScope = {}) {
    // Deliberately UNSCOPED as data: the tree keeps every unit and every
    // number, and `inScope` marks which subtree the branch-scoped screens are
    // counting. Filtering the map would leave the reader unable to see that
    // Операцион exists at all, let alone that it closed 12.6% of last month.
    const nodes = await this.repository.structure(period)
    const children = new Map<string | null, StructureNode[]>()

    for (const node of nodes) {
      const siblings = children.get(node.parentId) ?? []
      siblings.push(node)
      children.set(node.parentId, siblings)
    }

    // No branch active -> the whole company is in scope, which is the truth
    // rather than a shrug: `filial=all` really does count every unit.
    const branchId = scope.branchDepartmentId ?? null

    const build = (node: StructureNode, depth: number, inherited: boolean): StructureDto => {
      const inScope = branchId === null || inherited || node.id === branchId
      const kids = (children.get(node.id) ?? []).map((child) =>
        build(child, depth + 1, inScope),
      )

      /**
       * All three headcounts roll up together.
       *
       * `activeHeadcount` used to stay own-only while `headcount` was rolled,
       * so a branch showing 109 people was quietly comparing an inclusive
       * total against its own direct reports. The two agreed at the root by
       * coincidence and nowhere else.
       */
      const rolled = kids.reduce(
        (acc, kid) => ({
          headcount: acc.headcount + kid.headcount,
          activeHeadcount: acc.activeHeadcount + kid.activeHeadcount,
          workingHeadcount: acc.workingHeadcount + kid.workingHeadcount,
          deals: acc.deals + kid.deals,
          revenueMinor: acc.revenueMinor + BigInt(kid.revenue.amountMinor),
        }),
        {
          headcount: node.headcount,
          activeHeadcount: node.activeHeadcount,
          workingHeadcount: node.workingHeadcount,
          deals: node.deals,
          revenueMinor: node.revenueMinor,
        },
      )

      return {
        id: node.id,
        name: node.name,
        depth,
        headName: node.headName,
        ownHeadcount: node.headcount,
        headcount: rolled.headcount,
        activeHeadcount: rolled.activeHeadcount,
        workingHeadcount: rolled.workingHeadcount,
        deals: rolled.deals,
        revenue: toMoneyDto(money(rolled.revenueMinor, currency)),
        inScope,
        children: kids,
      }
    }

    return (children.get(null) ?? []).map((root) => build(root, 0, false))
  }
}
