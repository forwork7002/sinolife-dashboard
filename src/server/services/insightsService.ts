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
  type ScopedWindow,
  scopedPeriod,
} from '@/server/domain/employees/branches'
import { type MoneyDto, currencyExponent, money, toMoneyDto } from '@/server/domain/money/money'
import type { RowScope } from '@/server/auth/rbac'
import type { Period } from '@/server/domain/period/period'
import { allTime, enumerateBuckets, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import { deliveryStageName } from '@/server/domain/analytics/stageNames'
import { LOGISTICS_BUCKETS, UNMAPPED_BUCKET } from '@/lib/logisticsBuckets'
import type {
  ConfirmationCohortFilter,
  ConfirmationOrderQuery,
  ConfirmationOrderRow,
  ConfirmationOutcomeMoneyMinor,
  ConfirmationOutcomeTotals,
  ConfirmationRopRow,
  DispatchRow,
  InsightsRepository,
  LogisticsCut,
  MarginSummary,
  StructureNode,
  ViewerDepartment,
} from '@/server/repositories/insightsRepository'
import { deliveryRateBp, moneyRateBp, rateBp } from '@/server/domain/analytics/rates'
import type { ConfirmationOutcomeValue, ConfirmationQueueMode } from '@/server/domain/types'
import { keyPart, ttlCache } from './ttlCache'

/**
 * One build of the confirmation board's ROP breakdown per cohort per minute.
 *
 * The reasoning is at `InsightsService.confirmationBreakdown`, which is the
 * only thing that may reach this. Module level rather than per instance for the
 * reason every memo here is: readers arriving together on one screen is the
 * case that breaks a small pool, and collapsing them needs one map.
 */
const confirmationRopCache = ttlCache<ConfirmationRopRow[]>(60_000)

/**
 * Test seam, and the hazard is real rather than theoretical.
 *
 * A module-level memo is shared between test FILES in one worker, and the last
 * time this codebase grew one without a reset it silently served
 * `sellerBoardTeams.test.ts` another case's board — four ranking assertions
 * failing against a different fixture's ROP names, with no error anywhere.
 * Anything that swaps the repository under this service must call it.
 */
export function resetConfirmationRopCache(): void {
  confirmationRopCache.clear()
}

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
  /**
   * Repeat money as a share of all money, 0-100. NULL when nothing was measured.
   *
   * Not a zero. `total === 0n` holds when no revenue-bearing win is linked to a
   * customer at all — the failure this screen's own empty state anticipates
   * («Yetkazilgan buyurtmalar mijozga bogʻlanmagan boʻlishi mumkin») — and it
   * also holds when every cell's revenue is 0n. A 0% ring under «Takroriy
   * tushum ulushi» claims "nobody buys twice"; the truth there is "nothing was
   * measured", and the matrix directly below already says so. Same rule as
   * `rateBp` and `deliveryRateBp`, pinned in tests/domain/rateHonesty.test.ts.
   */
  readonly repeatRevenueShare: number | null
  readonly repeatCustomers: number
  readonly totalCustomers: number
}

/**
 * One logistics role inside a column, kept separate from its neighbours.
 *
 * «Отказ» IS ONE COLUMN ON SCREEN AND TWO NUMBERS UNDERNEATH IT. `REFUSED` is
 * a parcel that shipped, travelled and came back; `CANCELLED_EARLY` is a
 * customer who changed their mind before dispatch and cost a phone call.
 * `schema.prisma` forbids merging them and the client asked for one column, so
 * the merge happens HERE, in the rendering, and never in the SQL — the
 * expensive half is one hover away instead of gone. The same mechanism carries
 * the three roles inside «Ожидание / нд» and the two inside «Успешно», so
 * nothing about Отказ is special-cased.
 */
export interface LogisticsPartDto {
  readonly role: string
  readonly orders: number
  readonly amount: MoneyDto
}

/** One column of the client's own logistics sheet. */
export interface LogisticsBucketDto {
  readonly key: string
  /** The client's own header, verbatim: ТАСТИКЛАНГАН, не собран, В пути… */
  readonly label: string
  readonly orders: number
  readonly amount: MoneyDto
  /** Share of ЗАКАЗ's MONEY — the basis the client's %покрытия is on. */
  readonly sharePercent: number | null
  /** Share of ЗАКАЗ's ORDER COUNT. Both, because their sheet does not say which. */
  readonly shareOfOrdersPercent: number | null
  /**
   * The column opened out by STAGE — which of its roles the orders stand in.
   *
   * Truthful about where an order is, and the same decomposition the
   * reconciliation table prints. It is NOT the right split for «Отказ»: see
   * `returnedOrders` below.
   */
  readonly parts: readonly LogisticsPartDto[]
  /**
   * «Отказ» OPENED OUT BY JOURNEY, WHICH IS THE SPLIT THAT MEANS ANYTHING.
   *
   * Measured on the client's own week: all 48 refusals stand in «Отказ
   * предварительно» AND all 48 had already reached a post office. Split by
   * stage the column reads "nothing came back, 48 were killed before
   * dispatch"; split by journey it reads "48 travelled and came back" — and
   * the second is the truth. Since June the portal writes every refusal to
   * that one stage, so the stage name has stopped carrying the distinction
   * and only the history still does.
   *
   * Carried on every column rather than special-cased on one, so the shape
   * stays uniform; it is zero everywhere except «Отказ».
   */
  readonly returnedOrders: number
  readonly returnedAmount: MoneyDto
  readonly cancelledOrders: number
  readonly cancelledAmount: MoneyDto
}

/** One Asia/Tashkent day of the sheet. The six columns sum to `amount`. */
export interface LogisticsDayDto {
  /** YYYY-MM-DD in Asia/Tashkent — the day the order reached Тасдиклаш. */
  readonly date: string
  readonly orders: number
  readonly amount: MoneyDto
  readonly coveragePercent: number | null
  readonly buckets: readonly LogisticsBucketDto[]
}

/**
 * A post office or a region, with what it delivered.
 *
 * `deliveryRate` divides by RESOLVED orders — delivered plus refused plus
 * cancelled — not by everything in the window. Half of any current month is
 * still moving, and dividing by the whole month reported 42% for an operation
 * that delivers 93% of what it dispatches. The orders still moving are
 * reported beside it as `inFlight`, where they belong. Null while nothing has
 * resolved: «no answer yet» and «delivers nothing» are different claims.
 *
 * `medianDays` is from the arrival in Тасдиклаш to «Доставлено». On the
 * post-office table that is NOT dwell time at that post office — there is no
 * honest in-network clock on this portal, because the route is written down
 * when the parcel is closed out, not when it is picked up.
 */
export interface LogisticsPointDto {
  readonly label: string
  readonly orders: number
  readonly amount: MoneyDto
  readonly delivered: number
  readonly deliveredAmount: MoneyDto
  readonly refused: number
  readonly cancelledEarly: number
  readonly inFlight: number
  readonly deliveryRate: number | null
  readonly medianDays: number | null
  /**
   * HOW LONG A PARCEL WAITS AT THIS POST OFFICE — a different quantity from
   * `medianDays`, and the screen must not let the two be added or compared.
   *
   * `medianDays` is the order's whole journey, from the arrival in Тасдиклаш
   * to «Доставлено». This is the leg that a floor manager can shorten: the
   * parcel reaching one post office, and the parcel leaving it.
   *
   * Passes under an hour are excluded and `waitedOrders` is the surviving
   * denominator. On this portal the LEAVE stamp is written at closeout — it
   * lands within five seconds of «Доставлено» in 88.8% of passes — so a pass
   * whose two stamps coincide carries no elapsed time at all. Those are 27.5%
   * of passes and are delivered by construction; counting them would
   * manufacture the gradient `waits` reports. Print `waitedOrders` beside
   * the median: BEK POCHTA's «two weeks» rests on 92 passes, not on 1 394.
   */
  readonly medianWaitDays: number | null
  readonly waitedOrders: number
  /**
   * STANDING THERE RIGHT NOW, and the part of it standing too long.
   *
   * Measured against now(), which makes these the only fields on a windowed
   * payload that are not on the window's clock. `aged*` is the part past
   * seven days — the band where delivery measured 62.5% against 95.1%
   * inside two days, which is what turns a statistic into a call list.
   */
  readonly waitingOrders: number
  readonly waitingAmount: MoneyDto
  readonly agedOrders: number
  readonly agedAmount: MoneyDto
  readonly medianWaitingDays: number | null
}

/**
 * One band of «how long did it wait», and whether it arrived.
 *
 * The one block on this screen that is a reason to act rather than a record
 * of what happened. Measured over 60 days of production: 95.1% delivered
 * when collected inside two days, 62.5% once past seven — and the gradient
 * holds inside every post office, so it is a fact about elapsed time and not
 * about a carrier.
 *
 * RESOLVED ORDERS ONLY. A parcel still standing is undelivered by
 * definition; including it would build the conclusion into the measurement.
 */
/**
 * The four wait bands, in the order a parcel passes through them.
 *
 * The boundaries are not round numbers chosen for tidiness: two days is
 * where the measured delivery rate is still 95.1%, seven is where it has
 * fallen to 62.5%, and four sits between them so the fall has a shape rather
 * than a cliff. The SQL bands on the same hours (48 / 96 / 168).
 */
const WAIT_BANDS = [
  { key: '1', label: '0–2 kun' },
  { key: '2', label: '2–4 kun' },
  { key: '3', label: '4–7 kun' },
  { key: '4', label: '7 kundan ortiq' },
] as const

export interface LogisticsWaitBandDto {
  readonly key: string
  /** «0–2 kun», «2–4 kun», «4–7 kun», «7 kundan ortiq». */
  readonly label: string
  readonly orders: number
  readonly delivered: number
  readonly deliveryRate: number | null
}

/**
 * One Доставка stage, named the way the portal names it.
 *
 * THE RECONCILIATION ROW. The whole value of this block is that the floor can
 * put it beside obey.bitrix24.kz and check that the six columns above really
 * are these eighteen stages grouped. `bucket` is decided on the SERVER for the
 * same reason: re-deriving the eighteen-into-six mapping in the browser would
 * be a second definition of a partition the client approved stage by stage.
 */
export interface LogisticsStageDto {
  readonly stage: string
  readonly bucket: string
  readonly orders: number
  readonly amount: MoneyDto
  /** Share of the funnel's own orders. Null when the funnel is empty. */
  readonly sharePercent: number | null
}

export interface LogisticsDto {
  readonly summary: {
    /** Every arrival in Тасдиклаш in the window — FAKT 1 and the rest. */
    readonly cohortOrders: number
    /** ЗАКАЗ = FAKT 1. The same expression `/analytics/sellers` reports as `ordered`. */
    readonly orderedOrders: number
    readonly ordered: MoneyDto
    /** FAKT 2 = Доставланди. The same expression that endpoint reports as `won`. */
    readonly wonOrders: number
    readonly won: MoneyDto
    /**
     * %покрытия — FAKT 2 over FAKT 1, on money. 78.18% on the client's own week.
     *
     * MAY EXCEED 100 AND IS NOT CLAMPED. FAKT 2 is not a subset of FAKT 1: an
     * order refused in the queue and revived afterwards is delivered money
     * that never counted as confirmed. Clamping it would hide the one case
     * the reader most needs explained, which is why the screen prints the
     * basis note beside it.
     */
    readonly coveragePercent: number | null
    /** The six, zero-filled, in the client's own order. They sum to ЗАКАЗ. */
    readonly buckets: readonly LogisticsBucketDto[]
    /**
     * FAKT 1 orders whose current stage is outside Доставка. Expected 0.
     *
     * Printed rather than dropped: the six columns claim to be the whole of
     * ЗАКАЗ, and an order that matches none of them is a real event the
     * reader should see.
     */
    readonly unbucketedOrders: number
    /** FAKT 1 orders that never reached a hub or a carrier. */
    readonly unroutedOrders: number
    /**
     * Refused, and then delivered anyway — how much «Отказ» overstates the
     * loss. Decided against the LAST refusal, so a parcel that was delivered,
     * bounced and then refused is not reported as a recovery.
     */
    readonly revivedOrders: number
    readonly revived: MoneyDto
    /**
     * Expected 0. Non-zero is a `countsAsRevenue` double-count announcing itself.
     * See `LogisticsCut.offRevenueOrders` for why it is counted, not filtered.
     */
    readonly offRevenueOrders: number
    readonly medianDays: number | null
  }
  /** How long orders waited at a post office, against whether they arrived. */
  readonly waits: readonly LogisticsWaitBandDto[]
  /**
   * What is standing at a post office RIGHT NOW, two ways.
   *
   * `cohort` counts only orders from the selected window — the page's own
   * clock, so it reconciles with everything above it, and it cannot see a
   * parcel ordered before the window and stuck ever since. `all` counts every
   * parcel standing at a post office whatever month it was ordered in, which
   * is the list somebody would actually work through. Measured: the oldest
   * ones — QASHQADARYO at a median of 45 days — exist only in `all`.
   *
   * Both are shipped and the screen switches between them, because neither
   * one is the honest answer on its own.
   */
  readonly standing: {
    readonly cohort: readonly LogisticsPointDto[]
    readonly all: readonly LogisticsPointDto[]
  }
  readonly days: readonly LogisticsDayDto[]
  /** The eight hub and carrier stages, empty ones included. */
  readonly posts: readonly LogisticsPointDto[]
  readonly regions: readonly LogisticsPointDto[]
  /** All eighteen Доставка stages, in the portal's Russian and the portal's order. */
  readonly reconciliation: readonly LogisticsStageDto[]
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

/**
 * What the endpoint hands this service — the repository's query, except that
 * the СУММА range arrives in whole soʻm.
 *
 * THE SCALE IS CONVERTED HERE AND NOWHERE ELSE. `amountMinMinor` is what
 * reaches SQL, and the number in the reader's box is the number printed in the
 * column; putting the multiplication in the route would have made it a
 * decision two callers could make differently, and putting it in the
 * repository would have given SQL a unit it does not otherwise speak. This
 * layer's stated job is turning minor units into DTOs — this is the same
 * trade, run backwards, and it is the only place the two scales meet.
 */
export type ConfirmationQueueQuery = Omit<
  ConfirmationOrderQuery,
  'amountMinMinor' | 'amountMaxMinor'
> & {
  readonly amountMin?: number
  readonly amountMax?: number
}

/** The РЕГИОН filter's options: every region in the window, busiest first. */
export interface ConfirmationRegionOptionsDto {
  readonly regions: readonly { readonly region: string; readonly orders: number }[]
}

/** The five states' money, in the app's own currency. */
export type ConfirmationOutcomeAmounts = Readonly<Record<ConfirmationOutcomeValue, MoneyDto>>

/**
 * The panel's row on the wire: every column of it, with the bigint money
 * CONVERTED rather than deleted.
 *
 * Still `Omit<…, 'money'> &` and not seven restated scalars, so the property
 * the DTO comment below claims survives: a column added to the panel tomorrow
 * reaches the wire on its own, and a bigint still cannot.
 */
export type ConfirmationRopPanelRow = Omit<ConfirmationRopRow, 'money'> & {
  /** Per state, keyed the way the tiles are — the panel indexes by `spec.key`. */
  readonly amounts: ConfirmationOutcomeAmounts
  /** ЖАМИ for this group: `amounts` added up, never a sixth reading. */
  readonly amountTotal: MoneyDto
}

export interface ConfirmationQueueDto {
  readonly items: readonly ConfirmationOrderDto[]
  readonly totalItems: number
  /** Every ROP group with orders in the window — the filter's options. */
  readonly rops: readonly string[]
  /**
   * The Статистика panel: one row per ROP group, WITH what each state in it
   * is worth.
   *
   * `ConfirmationRopRow.money` is bigint and `JSON.stringify` throws on one,
   * so the row is rebuilt with that key CONVERTED rather than deleted — the
   * client asked for the per-ROP sums on 2026-09-09: «har bir rop jami va
   * qaysi boʻlimda qancha pul borligi ham koʻrinsin jadvalda». The bigint
   * stops at that line; `amountTotal` is `amounts` added up, so a row's ЖАМИ
   * always equals the five columns beside it.
   */
  readonly byRop: readonly ConfirmationRopPanelRow[]
  readonly totals: {
    /** Orders that entered the queue in the window. The denominator. */
    readonly orders: number
    readonly byOutcome: ConfirmationOutcomeTotals
    /**
     * WHAT THE QUEUE IS WORTH — the ЖАМИ tile's money, and the five states'.
     *
     * The floor reads this band beside its own Bitrix24 kanban, where every
     * column prints a sum: a count alone cannot tell twenty small orders from
     * twenty large ones, which is the whole question a confirmation desk is
     * asked at the end of a day.
     *
     * `amount` IS THE FIVE ADDED UP, not a sixth reading of the cohort — the
     * same relationship `orders` has to `byOutcome`, so the band's total
     * always equals its parts.
     *
     * ONE CURRENCY, THE APP'S OWN. Each order carries its own (`items[].amount`
     * uses `r.currency`), but a SUM cannot: adding two currencies' minor units
     * gives a number in neither. Every deal in this database is UZS, which is
     * what makes the sum true today, and it is the same trade the sellers
     * board's FAKT 1 and FAKT 2 already make. The day a second currency
     * arrives, this is a per-currency breakdown, not a bigger number.
     */
    readonly amount: MoneyDto
    readonly byOutcomeAmount: ConfirmationOutcomeAmounts
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

/**
 * The unit's head, as the card prints them.
 *
 * NULL when the unit has no head AND when the portal's head is not one of its
 * members. Bitrix24's own company-structure screen draws no head row in either
 * case — «Навоий» names a head whose two units are «Kompaniya(ROP)» and
 * «Тошкент онлайн», and the portal declines to seat them in «Навоий». Printing
 * the name anyway would put a manager somewhere the source says they are not.
 */
export interface StructureHeadDto {
  readonly id: string
  readonly name: string
  readonly position: string | null
  /**
   * Active people in this unit's whole subtree, minus this head — the figure in
   * the pill beside their name on the portal's card. DISTINCT over the subtree,
   * so somebody who sits in two units of one branch is one person.
   */
  readonly managesCount: number
}

export interface StructureDto {
  readonly id: string
  readonly name: string
  readonly depth: number
  readonly headName: string | null
  /** The head as the CARD needs them — null where the portal shows no head row. */
  readonly head: StructureHeadDto | null
  /** People whose PRIMARY unit is this one. */
  readonly ownHeadcount: number
  /** This unit plus everything beneath it. Both headcounts roll up together. */
  readonly headcount: number
  /** Of those, marked active in Bitrix24. */
  readonly activeHeadcount: number
  /**
   * Active people the PORTAL lists in this unit, minus the head when the head
   * is one of them — «Подчинённые: N сотрудников» on the source screen, and the
   * figure a floor manager will hold this page up against.
   *
   * It is NOT `activeHeadcount`, and the difference is not a rounding error:
   * membership is many-to-many in Bitrix24 and nine of this portal's people sit
   * in two units, so five of its twenty cards differ. `activeHeadcount` counts
   * who is CREDITED to this unit by this dashboard; this counts who the PORTAL
   * lists here. Both are true and the screen prints both.
   */
  readonly subordinateCount: number
  /** Active members including the head. `subordinateCount` plus 0 or 1. */
  readonly memberCount: number
  /**
   * Their names, so the chart's search box can find a person and not only a
   * unit. Active only. See the CTE that builds it for why it rides the tree.
   */
  readonly memberNames: readonly string[]
  /** Direct child units. The card's footer prints it, or says there are none. */
  readonly childCount: number
  /** The portal's own left-to-right order for this unit among its siblings. */
  readonly sortOrder: number
  /** Does the reader's own account sit in this unit? Drives the «Siz» badge. */
  readonly isViewerDepartment: boolean
  /**
   * Is this the reader's PRIMARY unit — the one their numbers are credited to?
   *
   * At most one node carries it, and none does for a reader filed nowhere or
   * with no linked employee. The «SIZ» badge reads `isViewerDepartment` above
   * and still lands on both units of a person listed twice; the chain line,
   * «Rahbaringiz» and «Meni topish» read THIS, because each of them names one
   * unit and must not name an arbitrary one.
   */
  readonly isViewerPrimaryDepartment: boolean
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

/** One person on a unit's roster, for the panel beside the chart. */
export interface DepartmentMemberDto {
  readonly id: string
  readonly fullName: string
  readonly position: string | null
  readonly isActive: boolean
  /**
   * False when this unit is the person's SECOND one.
   *
   * Bitrix24 lists a person in every unit of their `UF_DEPARTMENT` and the
   * chart draws them on every one of those cards. A roster that did not say so
   * would present a borrowed operator as a member of this team, which is the
   * one thing this screen must not get wrong.
   */
  readonly isPrimary: boolean
  readonly isHead: boolean
}

/**
 * What the org chart needs that is not a department.
 *
 * `viewerDepartmentIds` is a LIST for the same reason membership is: the
 * account behind the reader can sit in two units, and badging only the first
 * would send «Meni topish» to the wrong side of the chart.
 */
export interface StructureOptions {
  /** The reader's own employee id, from Principal. Null when unlinked. */
  readonly viewerEmployeeId?: string | null
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
   * See `ScopedWindow`: this is the single door the employee restriction walks
   * through on its way into the insights SQL. A query that ignores it is a
   * whole-company answer with a branch label on it.
   */
  private window(period: Period, scope: EmployeeScopeFilter): ScopedWindow {
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

    const [matrix, base] = await Promise.all([
      this.repository.cohorts(options),
      this.repository.retentionStages(),
    ])

    const rows = matrix.rows

    /*
      THE HORIZON IS THE CLOCK, and it used to be the data.

      This read `newestCohort` — the newest month in which SOME customer made a
      first purchase — on the stated assumption that the repository returns one
      row per month up to the current one. It does not: a month with no
      first-time buyer emits no row at all, so as soon as one passes, every
      row's horizon fell short by the same amount and fully elapsed months
      dropped into the `offset > reachable` branch. They then rendered as
      «maʼlumot yoʻq» — not measured — when what had actually been measured was
      a zero. That is the precise inversion the comment below this exists to
      prevent, arriving by a different door; and it bites hardest on a narrowed
      employee scope, where a quiet month is ordinary rather than remarkable.

      `currentMonth` comes out of the same statement as the cells, so the grid
      cannot disagree with the calendar it is drawn against either.
    */
    const currentMonth = matrix.currentMonth

    /*
      The grid runs to the CALENDAR's widest span, not the data's.

      Taken from the cells, the last column was the newest month anybody
      happened to return in — so a cohort that has lived nine months but whose
      returns stopped at five was drawn five columns wide and its four silent
      months were not drawn at all.
    */
    const oldestCohort = rows.reduce(
      (oldest, row) => (oldest === '' || row.cohort < oldest ? row.cohort : oldest),
      '',
    )
    const maxOffset =
      oldestCohort === '' ? 0 : InsightsService.monthsApart(oldestCohort, currentMonth)

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
      const reachable = InsightsService.monthsApart(row.cohort, currentMonth)

      for (let offset = 0; offset <= maxOffset; offset++) {
        const cell = byOffset.get(offset)
        /*
          `&& !cell` WENT WITH THE DATA-DERIVED HORIZON, and it has to.

          It was the escape hatch that let a cell past the horizon print
          anyway — which, with a horizon that could fall behind the calendar,
          produced the one reading a matrix must never have: inside a single
          row, a later month drawn and an EARLIER month blank, the two being
          the same kind of fact. With the horizon on the clock nothing can sit
          past it, so a missing cell inside it is a measured zero and says so.
        */
        retention.push(
          offset > reachable
            ? null
            : row.size === 0
              ? 0
              : Math.round(((cell?.customers ?? 0) / row.size) * 1000) / 10,
        )
        revenue.push(toMoneyDto(money(cell?.revenueMinor ?? 0n, currency)))
      }

      return { cohort: row.cohort, size: row.size, retention, revenue, maxOffset: reachable }
    })

    /*
      THE FOUR TILES ARE «BUTUN TARIX», AND THEY NOW ACTUALLY ARE.

      All four used to be folded from `rows` — the WINDOWED cohorts. `months`
      bounds how far back the matrix starts, and it was silently bounding the
      headline with it: every customer whose first delivered order predated the
      cut vanished from «Jami mijozlar», from «Qaytgan mijozlar» and from both
      halves of «Takroriy tushum ulushi». The customers it deleted are the
      oldest loyal ones — exactly the repeat business those tiles exist to
      measure — and the figures would have moved on the first of a month for no
      reason but the calendar.

      `matrix.totals` is computed over every cohort there has ever been, in the
      same statement as the cells. See `InsightsRepository.cohorts`.

      Everyone who ever came back, not everyone who came back NEXT MONTH: a
      customer whose second order landed in month +2 is a returning customer.
      Summing the cells would be the other error — someone who returned in +1
      and again in +3 is in two of them. The repository counts each cohort's
      returners once, which is the only place that can.
    */
    const totalCustomers = matrix.totals.customers
    const repeatCustomers = matrix.totals.returned
    const firstRevenue = matrix.totals.firstRevenueMinor
    const laterRevenue = matrix.totals.laterRevenueMinor
    const total = firstRevenue + laterRevenue

    return {
      rows: dtos,
      stages: base.stages,
      workedCustomers: base.workedCustomers,
      repeatRevenueShare:
        total === 0n ? null : Math.round(Number((laterRevenue * 1000n) / total)) / 10,
      repeatCustomers,
      totalCustomers,
    }
  }

  /**
   * The client's own logistics sheet, on the cohort that matches it.
   *
   * ONE STATEMENT, ONE CLOCK. Every figure on this screen — ЗАКАЗ, the six
   * columns, the daily rows, the post offices, the regions, the eighteen
   * stages and the refusal reasons — comes from one pass over the Тасдиклаш
   * arrival cohort, which is the same cohort Savdo dinamikasi and Sotuvchilar
   * reytingi are on. ЗАКАЗ is FAKT 1 and Успешно is FAKT 2, measured with the
   * constants `ratingSql` groups by, so the three screens cannot disagree.
   * See `logisticsCohortSql` for the measurement that settled the cohort.
   *
   * `options.withReasons` is gone with the command centre that wanted it: the
   * reasons are a UNION arm now, not a second statement, so there is nothing
   * left to skip.
   */
  async logistics(
    period: Period,
    currency: string,
    scope: EmployeeScopeFilter = {},
  ): Promise<LogisticsDto> {
    /*
      TWO STATEMENTS, AND THE SECOND ONE IS NOT A WINDOW.

      `logisticsStanding` reads every parcel standing at a post office
      whatever month it was ordered in — the cohort cannot see the oldest
      ones, and those are the ones worth a phone call. It costs 48 ms and
      runs beside the cohort rather than after it.
    */
    const [cuts, standing] = await Promise.all([
      this.repository.logisticsCohort(this.window(period, scope)),
      this.repository.logisticsStanding(),
    ])

    const cash = (minor: bigint): MoneyDto => toMoneyDto(money(minor, currency))
    const days1 = (value: number | null): number | null =>
      value === null ? null : Math.round(value * 10) / 10

    /*
      Null over an empty denominator, never zero — the rule `rateBp` states in
      the repository, restated here for the two shares taken on counts. A
      column that is 0% of a real window and a column in a window with no
      orders at all are different claims, and the Meter draws a bar from this.
    */
    const countShare = (part: number, whole: number): number | null =>
      whole === 0 ? null : Math.round((part / whole) * 1000) / 10

    const ordered = cuts.total
    const orderedMinor = ordered.fakt1Minor
    const orderedOrders = ordered.fakt1Orders

    /*
      THE PARTS RIDE THE COLUMN THEY BELONG TO, so «Отказ» can print one figure
      and still say what it is made of. Ordered by money so the expensive half
      of a refusal is the first thing under the hover.
    */
    const partsOf = new Map<string, LogisticsPartDto[]>()
    for (const part of [...cuts.parts].sort((a, b) => Number(b.fakt1Minor - a.fakt1Minor))) {
      const list = partsOf.get(part.bucket) ?? []
      list.push({
        role: part.sub ?? 'NONE',
        orders: part.fakt1Orders,
        amount: cash(part.fakt1Minor),
      })
      partsOf.set(part.bucket, list)
    }

    /*
      ZERO-FILLED FROM THE CLIENT'S OWN TABLE, in the client's own order.

      A column with no orders returns no row, and their sheet prints «не собран
      0» routinely — «Подготовка товара» and «Заказ в мой склад» stood at
      nought for the whole of the week we measured. Six columns that appear and
      disappear are not a report anybody can read down.
    */
    const bucketsFrom = (
      rows: ReadonlyMap<string, LogisticsCut>,
      totalMinor: bigint,
      totalOrders: number,
      withParts: boolean,
    ): LogisticsBucketDto[] =>
      LOGISTICS_BUCKETS.map((spec) => {
        const row = rows.get(spec.key)
        const minor = row?.fakt1Minor ?? 0n
        const orders = row?.fakt1Orders ?? 0
        return {
          key: spec.key,
          label: spec.label,
          orders,
          amount: cash(minor),
          sharePercent: pct(moneyRateBp(minor, totalMinor)),
          shareOfOrdersPercent: countShare(orders, totalOrders),
          parts: withParts ? (partsOf.get(spec.key) ?? []) : [],
          returnedOrders: row?.refusedOrders ?? 0,
          returnedAmount: cash(row?.refusedMinor ?? 0n),
          cancelledOrders: row?.cancelledOrders ?? 0,
          cancelledAmount: cash(row?.cancelledMinor ?? 0n),
        }
      })

    const bucketRows = new Map(cuts.buckets.map((row) => [row.bucket, row]))
    const waitRows = new Map(cuts.waits.map((row) => [row.bucket, row]))

    /*
      The unbounded snapshot wears the same row shape as the windowed one, so
      the screen can switch between them without a second table. The fields
      that only a cohort can answer — what it was ordered for, how it
      resolved — are zero here and the screen does not draw them.
    */
    const standingAll: LogisticsPointDto[] = standing.map((row) => ({
      label: deliveryStageName(row.post),
      orders: row.orders,
      amount: cash(row.amountMinor),
      delivered: 0,
      deliveredAmount: cash(0n),
      refused: 0,
      cancelledEarly: 0,
      inFlight: row.orders,
      deliveryRate: null,
      medianDays: null,
      medianWaitDays: null,
      waitedOrders: 0,
      waitingOrders: row.orders,
      waitingAmount: cash(row.amountMinor),
      agedOrders: row.agedOrders,
      agedAmount: cash(row.agedMinor),
      medianWaitingDays: days1(row.medianDays),
    }))

    /*
      THE DAYS ARE MATCHED ON THE ZONED DATE STRING the query grouped by, never
      on the bucket's instants. Tashkent midnight is 19:00 UTC the previous
      day, so comparing instants works until a bucket boundary and a UTC offset
      disagree — and the failure is a day of money moved one column left, not
      an error. Same mechanism as `SellerBoardService.faktTrend`.

      Granularity is pinned to 'day' rather than taken from `chooseGranularity`:
      this table IS the client's daily sheet, and a weekly row is a different
      document. The guard below is for the pathological custom window only —
      `periodQuerySchema` admits ten years, and 3 650 padded rows would be a
      payload nobody asked for. Past a year the days that carry orders are
      returned unpadded, which is still every row the sheet would have.
    */
    const dayRows = new Map<string, Map<string, LogisticsCut>>()
    for (const row of cuts.days) {
      if (row.sub === null) continue
      const forDay = dayRows.get(row.sub) ?? new Map<string, LogisticsCut>()
      forDay.set(row.bucket, row)
      dayRows.set(row.sub, forDay)
    }
    const dayTotals = new Map(cuts.dayTotals.map((row) => [row.sub ?? '', row]))

    const PAD_LIMIT_DAYS = 400
    const padded = enumerateBuckets(period, 'day').map((bucket) =>
      zonedDateKey(bucket.start, period.timeZone),
    )
    const dayKeys =
      padded.length <= PAD_LIMIT_DAYS ? padded : [...dayTotals.keys()].sort()

    const days: LogisticsDayDto[] = dayKeys.map((date) => {
      const total = dayTotals.get(date)
      const rows = dayRows.get(date) ?? new Map<string, LogisticsCut>()
      const dayMinor = total?.fakt1Minor ?? 0n
      return {
        date,
        orders: total?.fakt1Orders ?? 0,
        amount: cash(dayMinor),
        coveragePercent: pct(moneyRateBp(rows.get('DONE')?.fakt1Minor ?? 0n, dayMinor)),
        buckets: bucketsFrom(rows, dayMinor, total?.fakt1Orders ?? 0, false),
      }
    })

    const toPoint = (row: LogisticsCut): LogisticsPointDto => ({
      label: deliveryStageName(row.bucket),
      orders: row.fakt1Orders,
      amount: cash(row.fakt1Minor),
      delivered: row.deliveredOrders,
      deliveredAmount: cash(row.deliveredMinor),
      refused: row.refusedOrders,
      cancelledEarly: row.cancelledOrders,
      inFlight: row.inFlightOrders,
      deliveryRate: pct(
        deliveryRateBp(row.deliveredOrders, row.refusedOrders, row.cancelledOrders),
      ),
      medianDays: days1(row.medianDays),
      medianWaitDays: days1(row.medianWaitHours === null ? null : row.medianWaitHours / 24),
      waitedOrders: row.waitedOrders,
      waitingOrders: row.waitingOrders,
      waitingAmount: cash(row.waitingMinor),
      agedOrders: row.agedOrders,
      agedAmount: cash(row.agedMinor),
      medianWaitingDays: days1(row.medianWaitingDays),
    })

    /*
      Every FAKT 1 order sits in exactly one of the eighteen stages or in none
      of them, so the reconciliation arm's own total is ЗАКАЗ minus the orders
      that left the funnel. Taking the difference here rather than adding a
      seventh column is what keeps the six exhaustive AND keeps the stray
      orders visible.
    */
    const unbucketedOrders = orderedOrders - cuts.stageTotal.fakt1Orders

    return {
      summary: {
        cohortOrders: cuts.fakt.orders,
        orderedOrders,
        ordered: cash(orderedMinor),
        wonOrders: cuts.fakt.deliveredOrders,
        won: cash(cuts.fakt.deliveredMinor),
        coveragePercent: pct(moneyRateBp(cuts.fakt.deliveredMinor, orderedMinor)),
        buckets: bucketsFrom(bucketRows, orderedMinor, orderedOrders, true),
        unbucketedOrders,
        unroutedOrders: orderedOrders - cuts.postTotal.fakt1Orders,
        revivedOrders: cuts.total.revivedOrders,
        revived: cash(cuts.total.revivedMinor),
        offRevenueOrders: cuts.fakt.offRevenueOrders,
        medianDays: days1(cuts.fakt.medianDays),
      },
      /*
        ZERO-FILLED AND ORDERED, like the six columns and for the same reason.
        A band with no resolved orders in it returns no row, and a gradient
        that silently loses its middle reads as a smaller drop than it is.
      */
      waits: WAIT_BANDS.map((band) => {
        const row = waitRows.get(band.key)
        const orders = row?.fakt1Orders ?? 0
        const delivered = row?.deliveredOrders ?? 0
        return {
          key: band.key,
          label: band.label,
          orders,
          delivered,
          deliveryRate: pct(rateBp(delivered, orders)),
        }
      }),
      standing: { cohort: cuts.posts.map(toPoint), all: standingAll },
      days,
      posts: cuts.posts.map(toPoint),
      regions: cuts.regions.map(toPoint),
      reconciliation: cuts.stages.map((row) => ({
        stage: deliveryStageName(row.bucket),
        bucket: row.sub ?? UNMAPPED_BUCKET,
        orders: row.fakt1Orders,
        amount: cash(row.fakt1Minor),
        sharePercent: countShare(row.fakt1Orders, cuts.stageTotal.fakt1Orders),
      })),
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
  /**
   * @param scope Whose orders the caller may read. REQUIRED, and typed
   *   `RowScope` rather than `EmployeeScopeFilter` — the difference is the
   *   whole guarantee. `EmployeeScopeFilter`'s field is OPTIONAL, so a
   *   required argument of that type still accepts `{}`, which reads as "no
   *   filter" and serves the company: exactly the literal that used to sit at
   *   this call site. `RowScope` makes the field required, so a caller has to
   *   write `null` to mean everybody, and writing it is the decision.
   */
  /**
   * The РЕГИОН column filter's options.
   *
   * ITS OWN ENDPOINT, ON PURPOSE. The board reloads every minute on a
   * screen the floor keeps open all day; this answer changes about as often as
   * the portal grows a region, so it is fetched when the popover first opens
   * and cached by the client from then on. Riding it on the board's response
   * would have run the query several hundred times a day to answer a question
   * nobody asked, and riding it on `confirmationByRop` would have put the cost
   * inside the one statement that already decides whether «Shu yil» returns.
   *
   * Region-labelled, count-carrying, and NOT narrowed by the column filters —
   * see the repository for why a list narrowed by its own selection cannot be
   * un-narrowed.
   */
  async confirmationRegionOptions(
    period: Period,
    filter: { q?: string },
    scope: RowScope,
    mode: ConfirmationQueueMode = 'window',
  ): Promise<ConfirmationRegionOptionsDto> {
    /*
      THE SAME TWO LINES `confirmationQueue` USES, and they have to stay the
      same two: the options describe the board's own cohort, so a window built
      differently here would offer a region the table cannot show.
    */
    const window =
      mode === 'backlog'
        ? this.window(allTime(period.timeZone), scope)
        : this.window(period, scope)
    const rows = await this.repository.confirmationRegions(window, filter, mode)

    return { regions: rows.map((r) => ({ region: r.region, orders: r.orders })) }
  }

  /**
   * The per-ROP breakdown, built once per cohort however many questions are
   * asked of it.
   *
   * WHAT THIS SAVES, AND WHY IT IS SAFE TO SAVE IT. The breakdown feeds three
   * things — the six tiles, the Статистика panel and the РОП filter's options —
   * and NONE of them reads the state selection, the ROP selection, the page,
   * the page size or the sort. `confirmationByRop` is handed four filters and a
   * window and that is the whole of what it looks at; the ROP cut that reaches
   * the tiles is done in TypeScript below, over these very rows.
   *
   * It nevertheless rode on the same request as the table, so every click of a
   * state tile, every sort, every page and every tick of a РОП checkbox re-ran
   * a second whole-cohort aggregation to arrive at figures that were already on
   * screen and could not have changed. On production that statement is about
   * two seconds (see the shape note below), so half the wait after most clicks
   * on this board was work whose answer was known before it started.
   *
   * THE KEY CARRIES THE SCOPE, and that is not decoration — see `ttlCache`'s
   * own note. This cohort is narrowed per account (a ROP reads their own floor,
   * a seller their own orders), so a key without `restrictToEmployeeIds` would
   * not serve a slightly stale answer, it would serve somebody else's. The
   * scope comes from `ctx.scope`, which the route spreads LAST over the
   * caller's query, so what lands in the key is the server's own resolution of
   * who is asking and never the reader's claim about it.
   *
   * SIXTY SECONDS, matching the board's own poll and the sync worker's tick.
   * A shorter TTL would buy no freshness — nothing behind it moves faster —
   * and would only make a lone reader miss on every interaction, which is the
   * one case this exists for. A longer one would let the tiles fall behind the
   * table beneath them.
   *
   * NOT REACHED BY THE LONG-WINDOW SHAPE, deliberately. Past 62 days the page
   * and the panel are one statement (`confirmationBoard`) because the pair of
   * them raced one database core into the statement timeout; that branch keeps
   * building its own breakdown, and the day it wants this it must be measured
   * first, not assumed.
   */
  private confirmationBreakdown(
    window: ScopedWindow,
    filter: ConfirmationCohortFilter,
    mode: ConfirmationQueueMode,
  ): Promise<ConfirmationRopRow[]> {
    const key = [
      mode,
      window.start.toISOString(),
      window.end.toISOString(),
      keyPart(window.restrictToEmployeeIds),
      keyPart(filter.q ?? null),
      keyPart(filter.regions),
      keyPart(filter.amountMinMinor?.toString() ?? null),
      keyPart(filter.amountMaxMinor?.toString() ?? null),
    ].join('|')

    return confirmationRopCache.get(key, () =>
      this.repository.confirmationByRop(window, filter, mode),
    )
  }

  async confirmationQueue(
    period: Period,
    query: ConfirmationQueueQuery,
    scope: RowScope,
    /*
      REQUIRED, and positioned before the optional `mode` for that reason.

      The tile band prints a sum, and a sum needs a currency to be named in.
      Defaulting it here would have hidden the choice inside the service; the
      handler already holds `ctx.currency`, and passing it is the decision —
      the same shape `channels`, `products` and the sellers board use.
    */
    currency: string,
    mode: ConfirmationQueueMode = 'window',
  ): Promise<ConfirmationQueueDto> {
    /*
      THE BACKLOG HAS NO WINDOW, and says so by asking for all of time.

      Every reading below binds $1 and $2, so the span still has to be a real
      one — the cohort predicate in backlog mode is `signal = CONFIRM_NEW` and
      the dates are left deliberately vacuous rather than removed, which keeps
      one set of parameter positions across both modes.
    */
    /*
      THE SPAN CHANGES WITH THE MODE; THE SCOPE NEVER DOES.

      Backlog mode drops the window — the bell counts what is waiting whenever
      it arrived — but it does not drop who is asking. Wrapping BOTH spans in
      `this.window` is what makes that structural: there is no branch here that
      produces a window without a scope on it, and `ScopedWindow` would not
      compile if there were.
    */
    const window =
      mode === 'backlog'
        ? this.window(allTime(period.timeZone), scope)
        : this.window(period, scope)

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
    /*
      WHOLE SOʻM IN, MINOR UNITS OUT — once, here.

      `Math.round` and not a truncation: the box takes a number and a reader
      who types «1000000.5» meant the soʻm either side of it, not a silently
      different bound. Undefined stays undefined, because an absent bound and a
      bound of zero are different questions — «everything» against «nothing
      below nothing», and the second one would quietly drop every refunded or
      zero-value order the moment the box was cleared to empty.
    */
    const minor = (amount: number | undefined): bigint | undefined =>
      amount === undefined
        ? undefined
        : BigInt(Math.round(amount * 10 ** currencyExponent(currency)))

    const cohortQuery: ConfirmationOrderQuery = {
      ...query,
      amountMinMinor: minor(query.amountMin),
      amountMaxMinor: minor(query.amountMax),
    }

    const LONG_WINDOW_DAYS = 62
    const { page, byRop } =
      periodLengthInDays(window) > LONG_WINDOW_DAYS
        ? await this.repository.confirmationBoard(window, cohortQuery, mode).then((board) => ({
            page: { rows: board.rows, totalItems: board.totalItems },
            byRop: board.byRop,
          }))
        : await Promise.all([
            this.repository.confirmationOrders(window, cohortQuery, mode),
            /*
              THE COHORT FILTER, NOT THE WHOLE QUERY. The panel is measured
              over what region and сумма leave standing, and never over what
              the ROP or the state selection leaves standing — see
              `ConfirmationCohortFilter`. Spelling the four fields out here,
              rather than spreading `query`, is what stops a filter added to
              the table tomorrow silently collapsing this breakdown.
            */
            this.confirmationBreakdown(
              window,
              {
                q: cohortQuery.q,
                regions: cohortQuery.regions,
                amountMinMinor: cohortQuery.amountMinMinor,
                amountMaxMinor: cohortQuery.amountMaxMinor,
              },
              mode,
            ),
          ]).then(([page, byRop]) => ({ page, byRop }))

    /*
      THE TILES FOLLOW THE ROP SELECTION, AND IT IS A LIST NOW.

      The panel above is handed every group; the band is cut to the ones the
      reader picked. Region and сумма are already applied in SQL — they narrow
      both readings — so the only thing left to do here is the group cut, and
      it is done in TypeScript for the reason it always was: one round trip,
      one population, no way for the two to disagree about what a window holds.
    */
    const picked = query.rops
    const scoped =
      picked && picked.length > 0 ? byRop.filter((r) => picked.includes(r.rop)) : byRop
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

    /*
      THE SAME `scoped` ROWS THE COUNTS COME FROM, added down a money column.

      Not a third query and not a second pass over the page: the tiles and
      their sums have to describe one population, and the only way to be sure
      of that is to derive both from the same rows.
    */
    const amountMinor = (pick: (m: ConfirmationOutcomeMoneyMinor) => bigint): bigint =>
      scoped.reduce((sum, r) => sum + pick(r.money), 0n)

    const byOutcomeMinor: Readonly<Record<ConfirmationOutcomeValue, bigint>> = {
      CONFIRM_NEW: amountMinor((m) => m.pending),
      CONFIRMED: amountMinor((m) => m.confirmed),
      NO_ANSWER: amountMinor((m) => m.noAnswer),
      REJECTED: amountMinor((m) => m.rejected),
      UNCONFIRMED_SHIPPED: amountMinor((m) => m.unconfirmedShipped),
    }

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
      /*
        THE MONEY GOES TO THE TILES **AND** ONTO THE WIRE NOW.

        It used to be dropped here (`({ money: _money, ...row }) => row`)
        because `JSON.stringify` throws on a bigint and the panel had no use
        for it. It has one since 2026-09-09: the panel prints every state's
        sum per ROP. So the bigint is CONVERTED at this line rather than
        deleted, and this is still the only place one can reach the wire from.

        Summed in bigint and turned into money ONCE. Never over `MoneyDto`'s
        `amount`, the lossy major-unit double it carries for charts.
      */
      byRop: byRop.map(({ money: minor, ...row }) => ({
        ...row,
        amounts: {
          CONFIRM_NEW: toMoneyDto(money(minor.pending, currency)),
          NO_ANSWER: toMoneyDto(money(minor.noAnswer, currency)),
          CONFIRMED: toMoneyDto(money(minor.confirmed, currency)),
          REJECTED: toMoneyDto(money(minor.rejected, currency)),
          UNCONFIRMED_SHIPPED: toMoneyDto(money(minor.unconfirmedShipped, currency)),
        },
        /*
          The five added up — the ЖАМИ tile's own rule, stated at
          `ConfirmationOutcomeMoneyMinor` in the repository: a sixth column
          summing `count(*)`'s population could differ from the five by a
          state nobody has named yet, and a row whose total does not equal its
          parts is unreadable.
        */
        amountTotal: toMoneyDto(
          money(
            minor.pending +
              minor.noAnswer +
              minor.confirmed +
              minor.rejected +
              minor.unconfirmedShipped,
            currency,
          ),
        ),
      })),
      totals: {
        orders,
        byOutcome,
        amount: toMoneyDto(
          money(
            Object.values(byOutcomeMinor).reduce((sum, minor) => sum + minor, 0n),
            currency,
          ),
        ),
        byOutcomeAmount: {
          CONFIRM_NEW: toMoneyDto(money(byOutcomeMinor.CONFIRM_NEW, currency)),
          CONFIRMED: toMoneyDto(money(byOutcomeMinor.CONFIRMED, currency)),
          NO_ANSWER: toMoneyDto(money(byOutcomeMinor.NO_ANSWER, currency)),
          REJECTED: toMoneyDto(money(byOutcomeMinor.REJECTED, currency)),
          UNCONFIRMED_SHIPPED: toMoneyDto(money(byOutcomeMinor.UNCONFIRMED_SHIPPED, currency)),
        },
        confirmedRate:
          orders === 0 ? null : Math.round((byOutcome.CONFIRMED / orders) * 1000) / 10,
      },
    }
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
   * Rollup happens here rather than in SQL because "a department's headcount"
   * means the unit plus everything under it, and that is a display decision —
   * the database should not have to guess whether the caller wants own or
   * inclusive figures.
   *
   * NO PERIOD AND NO CURRENCY. This screen answers "who works under whom",
   * which is a fact about today; every period-scoped figure it used to carry
   * moved to «Boshqaruv markazi», the one place this dashboard was to state
   * money. That screen was removed on 2026-09-10; the figures did not return.
   */
  async structure(
    scope: InsightsScope = {},
    options: StructureOptions = {},
  ) {
    // Deliberately UNSCOPED as data: the tree keeps every unit and every
    // number, and `inScope` marks which subtree the branch-scoped screens are
    // counting. Filtering the map would leave the reader unable to see that
    // Операцион exists at all.
    const [nodes, viewerDepartmentIds] = await Promise.all([
      this.repository.structure(),
      options.viewerEmployeeId
        ? this.repository.departmentsOfEmployee(options.viewerEmployeeId)
        : Promise.resolve([] as ViewerDepartment[]),
    ])
    const viewerIn = new Set(viewerDepartmentIds.map((d) => d.departmentId))
    /*
      The PRIMARY unit, kept apart from the other memberships.

      `isViewerDepartment` is true on every unit the reader is listed in, and
      that is right for the badge. It is wrong for the three statements the
      page makes ABOUT the reader — the «Siz A › B › C» chain, «Rahbaringiz»
      and «Meni topish» — because those name one unit, and the page used to
      choose it with `flat.find(...)` over the DFS-flattened tree: whichever of
      the reader's units came first in `sortOrder`/name order. For anybody
      filed in two units that is a coin toss, and it resolved against the unit
      this dashboard actually credits their numbers to.
    */
    const viewerPrimary =
      viewerDepartmentIds.find((d) => d.isPrimary)?.departmentId ?? null
    const children = new Map<string | null, StructureNode[]>()

    for (const node of nodes) {
      const siblings = children.get(node.parentId) ?? []
      siblings.push(node)
      children.set(node.parentId, siblings)
    }

    // No branch active -> the whole company is in scope, which is the truth
    // rather than a shrug: `filial=all` really does count every unit.
    const branchId = scope.branchDepartmentId ?? null

    /**
     * The rollup travels beside the DTO, not inside it.
     *
     * Read back off each child DTO instead, it would be summing whatever the
     * DTO happened to print rather than the repository's own integers — which
     * is how the withheld-money version of this used to add up nulls. The
     * totals are the repository's numbers all the way up; only the last step
     * decides what is printed.
     */
    interface Rolled {
      readonly headcount: number
      readonly activeHeadcount: number
    }

    const build = (
      node: StructureNode,
      depth: number,
      inherited: boolean,
    ): { dto: StructureDto; rolled: Rolled } => {
      const inScope = branchId === null || inherited || node.id === branchId
      const built = (children.get(node.id) ?? []).map((child) =>
        build(child, depth + 1, inScope),
      )
      const kids = built.map((b) => b.dto)

      /**
       * BOTH headcounts roll up together.
       *
       * `activeHeadcount` used to stay own-only while `headcount` was rolled,
       * so a branch showing 109 people was quietly comparing an inclusive
       * total against its own direct reports. The two agreed at the root by
       * coincidence and nowhere else.
       */
      const rolled: Rolled = built.reduce<Rolled>(
        (acc, kid) => ({
          headcount: acc.headcount + kid.rolled.headcount,
          activeHeadcount: acc.activeHeadcount + kid.rolled.activeHeadcount,
        }),
        {
          headcount: node.headcount,
          activeHeadcount: node.activeHeadcount,
        },
      )

      const dto: StructureDto = {
        id: node.id,
        name: node.name,
        depth,
        headName: node.headName,
        /*
          NOT ROLLED UP, and none of the four below are.

          The counts above answer "this unit plus everything under it", which is
          what a manager asking about a branch means. These four are facts about
          the unit itself as the portal draws its card — how many people it
          lists, how many units hang off it, where it sits among its siblings —
          and `managesCount` is already a subtree figure computed DISTINCT in
          SQL, so adding the children's would count the same person once per
          level they appear at.
        */
        head:
          node.headId && node.headName && node.headIsMember
            ? {
                id: node.headId,
                name: node.headName,
                position: node.headPosition,
                managesCount: node.headManagesCount,
              }
            : null,
        ownHeadcount: node.headcount,
        headcount: rolled.headcount,
        activeHeadcount: rolled.activeHeadcount,
        subordinateCount: node.subordinateCount,
        memberCount: node.memberCount,
        memberNames: node.memberNames,
        childCount: node.childCount,
        sortOrder: node.sortOrder,
        isViewerDepartment: viewerIn.has(node.id),
        isViewerPrimaryDepartment: viewerPrimary !== null && viewerPrimary === node.id,
        inScope,
        children: kids,
      }

      return { dto, rolled }
    }

    return (children.get(null) ?? []).map((root) => build(root, 0, false).dto)
  }

  /**
   * One unit's roster, for the panel the chart opens.
   *
   * A second request rather than a field on every node: the chart draws twenty
   * cards and a reader opens one panel, so shipping 289 people to render 13 of
   * them would put the whole roster on the wire on every period change. It is
   * also the only part of this screen that is per-selection, which is exactly
   * the split that keeps the chart's own answer cacheable.
   */
  async departmentRoster(departmentId: string): Promise<DepartmentMemberDto[]> {
    const rows = await this.repository.departmentRoster(departmentId)

    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      position: r.position,
      isActive: r.isActive,
      isPrimary: r.isPrimary,
      isHead: r.isHead,
    }))
  }
}
