/**
 * Analytics for the superdashboard modules.
 *
 * WHY THIS IS SQL AND THE OLDER ANALYTICS IS NOT
 * `DealRepository` loads a period's deals and aggregates them in the pure
 * domain functions. That is the right trade at a few thousand rows: every rule
 * lives in one tested place. It stops being the right trade here. The portal
 * holds 415 591 deals, 317 674 contacts and over a million call records, and
 * the questions these modules ask — a cohort matrix across two years, a median
 * delivery time per region, margin over every line item — touch the whole
 * table rather than one window of it.
 *
 * So the aggregation runs in Postgres, on the indexes built for it, and this
 * file is deliberately the only place that knows the SQL.
 *
 * THREE RULES EVERY QUERY HERE FOLLOWS
 *
 * 1. `countsAsRevenue` is named explicitly in anything that touches money.
 *    The portal records the same order twice — Доставка, then База a median of
 *    ten days later with the same code and amount, 97% of the time. A revenue
 *    figure that forgets this is roughly double the truth and looks fine.
 *
 * 2. Money is summed as BIGINT and returned as text, then parsed to BigInt.
 *    Postgres widens `sum(bigint)` to `numeric`, which the driver hands back as
 *    a string; letting that become a JS number would silently lose precision
 *    above 2^53, and UZS totals pass that at ninety billion so'm.
 *
 * 3. Dates are bucketed in `Asia/Tashkent`, not UTC. Columns are naive UTC, so
 *    every truncation reads `("closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $tz)`.
 *    Without it a sale made at 2am Tashkent lands in the previous day and the
 *    daily numbers never quite match what the team saw.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { LOGISTICS_BUCKETS, UNMAPPED_BUCKET } from '@/lib/logisticsBuckets'
import { env } from '@/server/config/env'
import {
  NO_EMPLOYEE_IN_SCOPE,
  type ScopedWindow,
} from '@/server/domain/employees/branches'
import { deliveryRateBp } from '@/server/domain/analytics/rates'
import type { Period } from '@/server/domain/period/period'
import {
  CONFIRMATION_OUTCOMES,
  type ConfirmationOrderSortValue,
  type ConfirmationOutcomeValue,
  type ConfirmationQueueMode,
  type LogisticsRoleValue,
} from '@/server/domain/types'
/** A money column as Postgres returns it: text, to survive the driver. */
type MoneyText = string | null

function money(value: MoneyText): bigint {
  return value === null || value === undefined ? 0n : BigInt(value)
}

function int(value: unknown): number {
  return Number(value ?? 0)
}

/**
 * A timestamp that travelled inside JSON.
 *
 * `json_build_object` renders a `timestamp` as ISO text with NO zone, and
 * `new Date()` reads a zoneless string as LOCAL time — which on a Tashkent
 * laptop moved every queue visit five hours. Every column in this file is
 * stored UTC, so the Z is what the text was always missing.
 */
function utcText(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  return new Date(value.endsWith('Z') ? value : `${value}Z`)
}

/** The queue-history JSON as `json_build_object` shapes it. */
type VisitJson = {
  no: number
  queuedAt: string
  outcome: ConfirmationOutcomeValue
  decidedAt: string | null
}

/**
 * The visit list, newest first — the order SQL already put it in.
 *
 * Null when a row somehow reached the page with no arrival at all. The cohort
 * cannot admit one, and an empty list is what the table already renders for
 * the single-visit majority, so this stays a fallback rather than a branch.
 */
function visits(rows: VisitJson[] | null | undefined): ConfirmationVisit[] {
  return (rows ?? []).map((v) => ({
    no: int(v.no),
    queuedAt: utcText(v.queuedAt)!,
    outcome: v.outcome,
    decidedAt: utcText(v.decidedAt),
  }))
}

/**
 * One row of `logisticsCohortSql` — seven groupings arriving down one pipe.
 *
 * `cut` says which arm produced the row and therefore how to read the two
 * dimension columns:
 *
 *   fakt    — one row, the whole queue cohort. FAKT 1 and FAKT 2 together.
 *   bucket  — `bucket` is a column key; `sub` is the logistics role inside it,
 *             or null for the column's own total. `is_total` marks ЗАКАЗ.
 *   day     — `sub` is the Asia/Tashkent day; `bucket` is a column key, or
 *             null for the day's own total (`is_total` = 1).
 *   post    — `bucket` is a post office's stage name; `sort` its funnel order.
 *   region  — `bucket` is the region.
 *   stage   — `bucket` is a Доставка stage name VERBATIM; `sub` is the column
 *             it belongs to, decided server-side so the browser never
 *             re-derives the partition.
 *   reason  — `bucket` is the refusal reason; `sub` is RETURNED or CANCELLED.
 */
interface LogisticsCutRow {
  readonly cut: string
  readonly bucket: string | null
  readonly sub: string | null
  readonly sort: number | null
  readonly is_total: number
  readonly orders: bigint
  readonly amount: MoneyText
  readonly fakt1_orders: bigint
  readonly fakt1_amount: MoneyText
  readonly delivered_orders: bigint
  readonly delivered_amount: MoneyText
  readonly refused_orders: bigint
  readonly refused_amount: MoneyText
  readonly cancelled_orders: bigint
  readonly cancelled_amount: MoneyText
  readonly in_flight_orders: bigint
  readonly off_revenue_orders: bigint
  readonly median_days: number | null
}

export interface CohortCell {
  readonly monthsSince: number
  readonly customers: number
  readonly revenueMinor: bigint
}

/**
 * The cohort read: the matrix, the whole-history headline, and the calendar.
 *
 * `rows` honour the caller's `months` bound; `totals` never do — see the note
 * on `InsightsRepository.cohorts`. `currentMonth` is the first day of the
 * month it is NOW in Asia/Tashkent, so the service measures each row's horizon
 * against the clock instead of against the newest row it happens to have.
 */
export interface CohortMatrix {
  readonly rows: readonly CohortRow[]
  readonly totals: CohortTotals
  /** `YYYY-MM-DD`, first day of the current month in APP_TIMEZONE. */
  readonly currentMonth: string
}

/** Folded over EVERY cohort, whatever window the matrix was cut to. */
export interface CohortTotals {
  /** Every customer with at least one delivered order, ever. */
  readonly customers: number
  /** How many of them ever came back, counted once each. */
  readonly returned: number
  /** Money from each customer's FIRST month. */
  readonly firstRevenueMinor: bigint
  /** Money from every month after it. */
  readonly laterRevenueMinor: bigint
}

export interface CohortRow {
  /** First day of the cohort month, in Asia/Tashkent. */
  readonly cohort: string
  readonly size: number
  readonly cells: readonly CohortCell[]
  /**
   * How many of this cohort ever came back, counted once each.
   *
   * Not derivable from `cells`: a customer who returned twice is in two of
   * them, and the first cell alone is only the ones who came back the very
   * next month.
   */
  readonly returned: number
}

export interface RetentionStage {
  readonly stage: string
  readonly customers: number
}

/**
 * One grouping of the logistics cohort, whatever it was grouped by.
 *
 * ONE ROW SHAPE FOR SEVEN CUTS, because every cut answers the same questions
 * about a different slice and a per-cut shape is how two halves of one screen
 * come to count different things under the same column names. `bucket` and
 * `sub` carry whichever two dimensions the arm grouped on; see
 * `LogisticsCutRow` for the reading.
 *
 * `fakt1*` and `delivered*` are the two figures the whole screen hangs on and
 * they are NOT the same population: `fakt1` is what left Тасдиклаш as an
 * order, `delivered` is what a courier actually handed over. On the `fakt`
 * cut they are ЗАКАЗ and FAKT 2 exactly as `/analytics/sellers` reports them.
 */
export interface LogisticsCut {
  readonly bucket: string
  readonly sub: string | null
  readonly sort: number | null
  readonly orders: number
  readonly amountMinor: bigint
  readonly fakt1Orders: number
  readonly fakt1Minor: bigint
  readonly deliveredOrders: number
  readonly deliveredMinor: bigint
  /**
   * Refused AFTER the parcel moved, and cancelled before it did.
   *
   * THE SPLIT IS THE JOURNEY, NOT THE STAGE. Since June this portal writes
   * every refusal to «Отказ предварительно» — all 150 of August's, every one
   * of which had reached a hub, a carrier or «В пути» first. Read from the
   * stage name alone the screen said nothing came back and 150 orders never
   * left the warehouse; both were the opposite of the truth. The client asked
   * for one «Отказ» column and gets one; these two are what is underneath it,
   * and they are never added together in SQL.
   */
  readonly refusedOrders: number
  readonly refusedMinor: bigint
  readonly cancelledOrders: number
  readonly cancelledMinor: bigint
  /** Still moving: neither delivered nor refused. Reported, never counted against. */
  readonly inFlightOrders: number
  /**
   * `countsAsRevenue` AS A TRIPWIRE, NOT A FILTER — and the distinction is
   * the whole point.
   *
   * Every money query in this codebase must name `countsAsRevenue` or report
   * ~30% too much, because «#10 База» mirrors «#6 Доставка». Filtering on it
   * HERE would be wrong for a different reason: this cohort is chosen by an
   * arrival in Тасдиклаш (#4), and pipelines 4 and 12 are not revenue
   * pipelines — so a WHERE would drop every order still standing in the queue
   * and every order refused there. `confirmationSellerRating` refuses the
   * flag for exactly this reason.
   *
   * The duplicate База deal cannot enter this cohort at all: it never touches
   * a confirmation-signal stage. So the flag has nothing to exclude and
   * everything to prove, and it is counted instead of applied. Expected 0. A
   * non-zero value on the payload is a double-count announcing itself.
   */
  readonly offRevenueOrders: number
  /**
   * Days from the arrival in Тасдиклаш to the `Доставлено` stamp.
   *
   * NOT from the hub, and not to `closedAt`. Both of those were tried and both
   * lie on this portal:
   *
   *   `closedAt` is a DATE — every closed deal lands on UTC midnight, all
   *   105,693 of them — so an hour figure taken against it reports the time of
   *   day the OTHER end happened and calls it precision. Worse, a parcel
   *   delivered the same afternoon it reached the hub had `closedAt` BEFORE
   *   the hub stamp, and the guard that dropped those threw away 52% of every
   *   month's deliveries without saying so.
   *
   *   The hub stamp is not a checkpoint. Measured against the delivered
   *   stamp its median is 0.0 hours: the route is written down when the
   *   parcel is closed out, not when it is picked up.
   *
   * The `Доставлено` stage entry, on the other hand, is a real timestamp on
   * every one of the delivered orders. It is measured from `queued_at`
   * because that is this screen's own clock and the only one every row here
   * shares — which also means the figure on the post-office table is NOT
   * dwell time at that post office. There is no honest in-network clock to
   * prefer.
   *
   * Median, and no p90. Delivery times have a long tail of chased orders, so
   * a mean would let three disasters hide a hundred normal days — but the
   * ninetieth percentile was a tenth column nobody read it on, and a second
   * sort over the same ordered set to say it.
   */
  readonly medianDays: number | null
}

/**
 * The whole logistics screen, from one statement.
 *
 * Split by cut here rather than in the service so the shape of the answer is
 * stated once, where the SQL that produced it can be read beside it.
 */
export interface LogisticsCohort {
  /** The whole queue cohort, once. Carries ЗАКАЗ (FAKT 1) and FAKT 2. */
  readonly fakt: LogisticsCut
  /** ЗАКАЗ — the FAKT 1 grand total the six columns must sum to. */
  readonly total: LogisticsCut
  /** The six columns, in whatever order the database returned them. */
  readonly buckets: readonly LogisticsCut[]
  /** Column × logistics role — what sits under «Отказ» and «Ожидание / нд». */
  readonly parts: readonly LogisticsCut[]
  /** Column × Asia/Tashkent day. Only days that carry orders. */
  readonly days: readonly LogisticsCut[]
  /** ЗАКАЗ per Asia/Tashkent day. */
  readonly dayTotals: readonly LogisticsCut[]
  /** The eight hub and carrier stages, empty ones included. */
  readonly posts: readonly LogisticsCut[]
  readonly postTotal: LogisticsCut
  readonly regions: readonly LogisticsCut[]
  readonly regionTotal: LogisticsCut
  /** All eighteen Доставка stages, verbatim, with the column each belongs to. */
  readonly stages: readonly LogisticsCut[]
  readonly stageTotal: LogisticsCut
  readonly reasons: readonly LogisticsCut[]
}

/**
 * One visit to Тасдиклаш: when the order arrived, and how that visit ended.
 *
 * The order is the unit on this board — one row per deal, dated by its LAST
 * arrival — so an order that came back is filed under the day it came back
 * and its earlier visits would otherwise be invisible. They ride on the row
 * instead of splitting it, and they are never counted anywhere.
 */
export interface ConfirmationVisit {
  /** 1 for the first arrival in the order's life, counting up. */
  readonly no: number
  readonly queuedAt: Date
  /** The visit's last signal. `CONFIRM_NEW` while the visit is still open. */
  readonly outcome: ConfirmationOutcomeValue
  /** When the visit ended. Null while the order is still in the queue. */
  readonly decidedAt: Date | null
}

/** One order in the Тасдиклаш queue, in the column order the floor reads. */
export interface ConfirmationOrderRow {
  readonly dealId: string
  /** РОП — the sales group, as the team names it: "Sevinch", "Lola", "Baza". */
  readonly rop: string | null
  /** № — the order's place in ITS ROP's day. Restarts at 1 each morning. */
  readonly dailyNo: number
  /** Id сделки — the Bitrix24 deal id, the key both systems look an order up by. */
  readonly bitrixId: string | null
  /** `bx…` code parsed from the title, where the title carries one. */
  readonly orderCode: string | null
  readonly title: string
  readonly customerName: string | null
  /** Every number on the contact, in the portal's order. May be empty. */
  readonly customerPhones: readonly string[]
  readonly employeeName: string
  /** Продукт — one entry per line item, "name - N ta". */
  readonly products: readonly string[]
  readonly region: string | null
  readonly deliveryAddress: string | null
  /** Источник — the acquisition channel the order came in through. */
  readonly sourceName: string | null
  readonly amountMinor: bigint
  readonly currency: string
  /** The stage the deal sits in NOW, which is what the outcome was read from. */
  readonly stageName: string
  readonly outcome: ConfirmationOutcomeValue
  /** Дата создания — when the order was placed. What the window selects on. */
  readonly createdAt: Date
  /** The order's last confirmation move, which is where its status comes from. */
  readonly movedAt: Date
  /**
   * When the order entered the queue this state belongs to.
   *
   * Null for an order refused without ever being queued, which the client's
   * bot counts and so does this.
   */
  readonly queuedAt: Date | null
  /** When it left the queue. Null while it is still in one. */
  readonly decidedAt: Date | null
  /** Queue time in hours, one decimal. Null while it is still waiting. */
  readonly hoursToDecide: number | null
  /**
   * How many times this order has reached Тасдиклаш — over its WHOLE life,
   * not over the reporting window.
   *
   * «🔁 ҚАЙТА ТУШДИ» on the board. The client's bot marks this by remembering
   * each deal's previous stage in `deal_state.json` and noticing the move back
   * into `C4:NEW`; that memory is the bot's, and a dashboard that reads the
   * portal once has no "what it was before". The same fact IS in Bitrix
   * though, as a row per entry in the stage history: an order that entered
   * `C4:NEW` more than once came back. This counts those entries.
   *
   * NOT WHAT DRAWS THE MARK — `queueReturns` is. An order can enter twice in
   * fifteen minutes because one person confirmed it, spotted a mistake and
   * pulled it back; that is two entries and no return.
   *
   * ALL TIME, DELIBERATELY. The cohort's own scan is bounded by the window —
   * it has to be, or the queue query is a sequential pass over the history
   * table — so a return that happened this morning to an order first queued
   * last month would look like a first arrival. The count is taken separately,
   * for the page's rows only, where the (dealId, enteredAt) index makes it one
   * scan per row rather than a second pass over the cohort.
   */
  readonly queueEntries: number
  /**
   * How many of those entries were real RETURNS — the mark's own count.
   *
   * A return is an arrival at least `REPEAT_GAP_HOURS` after the previous one,
   * which is the bot's own rule and therefore the one the floor already reads
   * in Telegram. Zero means no mark, however many times the order bounced
   * through the stage in a single afternoon.
   */
  readonly queueReturns: number
  /**
   * The arrival before the last RETURN — when the order was last in the queue
   * before it came back. Null when it has never come back.
   *
   * What turns the mark into something actionable: an order that came back
   * three minutes after it was confirmed is somebody correcting a misclick,
   * and one that came back four days later is a customer who was reached
   * again. The badge cannot tell them apart; the date beside it can.
   */
  readonly previousQueuedAt: Date | null
  /**
   * Every visit this order has made to Тасдиклаш, NEWEST FIRST.
   *
   * `[0]` is the visit the row is filed under — same arrival as `queuedAt`,
   * same state as `outcome` — and the ones after it are what the board used
   * to lose when an order came back and took its row to a later day. A
   * single-visit order carries a one-element list, and the table renders
   * those exactly as before: one chip, no chain.
   *
   * SHOWN, NEVER SUMMED. The five tiles, the ROP panel, the state filter and
   * the header bell all read `outcome` alone.
   */
  readonly queueHistory: readonly ConfirmationVisit[]
}

/** How many orders ended in each of the five states. */
export type ConfirmationOutcomeTotals = Readonly<Record<ConfirmationOutcomeValue, number>>

/**
 * The five states in MONEY — minor units, summed from each deal's own
 * `amountMinor`, one entry per state and nothing outside them.
 *
 * NESTED UNDER ONE KEY, and that is not tidiness. `ConfirmationRopRow` goes
 * onto the wire as it stands (`confirmationQueue` returns the ROP panel's rows
 * unchanged), and `JSON.stringify` THROWS on a bigint — so six more sibling
 * fields would have turned the whole endpoint into a 500. Under a key of their
 * own the service strips them with one `Omit`, and the panel's shape is
 * provably unchanged.
 *
 * NO `orders` TOTAL HERE, on purpose: the ЖАМИ tile's money is these five
 * added up, exactly as its count is. A sixth column summing `count(*)`'s
 * population could differ from the five by a state nobody has named yet, and
 * a band whose total does not equal its parts is unreadable.
 */
export interface ConfirmationOutcomeMoneyMinor {
  readonly confirmed: bigint
  readonly noAnswer: bigint
  readonly rejected: bigint
  readonly pending: bigint
  readonly unconfirmedShipped: bigint
}

/** One ROP group's slice of the queue — the Статистика panel's row. */
export interface ConfirmationRopRow {
  readonly rop: string
  readonly orders: number
  readonly confirmed: number
  readonly noAnswer: number
  readonly rejected: number
  readonly pending: number
  readonly unconfirmedShipped: number
  /** The same five populations in money. Summed for the tiles, not printed here. */
  readonly money: ConfirmationOutcomeMoneyMinor
}

/**
 * What narrows the COHORT the tiles and the ROP panel are measured over.
 *
 * Deliberately a subset of `ConfirmationOrderQuery`: it carries everything
 * that narrows the population and nothing that identifies a group. The two
 * things it leaves out are the state selection and the ROP selection, and both
 * are left out for one reason — each would collapse the comparison the band and
 * the panel exist to make, the states against each other and the groups against
 * each other. Region and сумма narrow what is being compared without taking the
 * comparison away.
 */
export interface ConfirmationCohortFilter {
  readonly q?: string
  readonly regions?: readonly string[]
  readonly amountMinMinor?: bigint
  readonly amountMaxMinor?: bigint
}

export interface ConfirmationOrderQuery {
  /** Any subset of the five states. Undefined or empty means all of them. */
  readonly outcomes?: readonly ConfirmationOutcomeValue[]
  /**
   * ROP groups by name. Undefined or empty means all of them.
   *
   * The service unions the legacy single `?rop=` into this, so the repository
   * has ONE rop predicate to maintain rather than two that can disagree.
   */
  readonly rops?: readonly string[]
  /** Customer regions by name. `NO_REGION` selects the ones carrying none. */
  readonly regions?: readonly string[]
  /**
   * The СУММА range in MINOR units, inclusive. The service converts from the
   * whole soʻm a human typed; nothing below this line knows about that scale.
   */
  readonly amountMinMinor?: bigint
  readonly amountMaxMinor?: bigint
  /** Free text over name, phone, product, Bitrix id, order code and title. */
  readonly q?: string
  readonly page: number
  readonly pageSize: number
  readonly sort: ConfirmationOrderSortValue
  readonly order: 'asc' | 'desc'
}

/** The same shape `SellerBoardFilters` carries, kept local so the two repositories stay independent. */
export interface ConfirmationSellerRatingFilters {
  readonly employeeIds?: readonly string[]
  readonly departmentIds?: readonly string[]
  readonly sourceIds?: readonly string[]
  /**
   * Authorisation scope — whose rows this caller may read at all.
   *
   * A LIST, because a scope can be a team. Null (or absent) is the whole
   * company; a non-null list is exhaustive and never empty, so an account that
   * narrows to nobody reads nothing rather than everything. Applied HERE
   * rather than in the UI so it cannot be bypassed by calling the API
   * directly, and ANDed with `employeeIds` above rather than replacing it: the
   * caller's own pick narrows the scope, it never widens it.
   */
  readonly restrictToEmployeeIds?: readonly string[] | null
}

/**
 * One operator's standing on the confirmation-queue cohort.
 *
 * THE TWO FACTS ARE THE CLIENT'S OWN, NAMED «FAKT 1» AND «FAKT 2» ON THE
 * FLOOR. FAKT 1 is what left the queue as an order — Тасдиқланди AND
 * Тасдиқланмай чиқди, the two states their board prints side by side; see
 * `FAKT1_OUTCOMES` for why the second one's money is on the road exactly like
 * the first one's. FAKT 2 is Доставланди — of those, the ones the carrier
 * actually delivered (`deal.status = 'WON'` on a Доставка-pipeline deal,
 * i.e. C6:WON).
 *
 * «Успешно заказ» (C6:UC_YUKVF1) was considered and rejected for FAKT 1: see
 * `DELIVERY_STAGE_ROLES['C6:UC_YUKVF1']` in `mapping.ts` — it is a settlement
 * stamp automation writes within five seconds of Доставлено in most cases,
 * not an operator's own act, and using it collapsed FAKT 1 into FAKT 2.
 *
 * FAKT 2 IS STILL NOT A SUBSET OF FAKT 1, and the client's definition is
 * why: "har bir buyurtma" — EVERY cohort order that reached delivery counts,
 * including one that was refused in the queue (❌ Тасдиқланмади) and revived
 * afterwards. Тасдиқланмай чиқди used to be the common case of that gap and
 * is now inside FAKT 1, so the two nearly nest; they are still two measures
 * and the page must not print one as a share of the other. For the ordinary
 * order they do nest — `moves` never records a C6:WON visit (WON is not in
 * `CONFIRMATION_SIGNAL_STAGES`), so an order's `outcome` survives delivery —
 * which is what makes inTransit ("out of the queue, still on the way") a
 * meaningful remainder.
 */
export interface ConfirmationSellerRatingRow {
  readonly employeeId: string
  readonly fullName: string
  /** The ROP's own name — see `queueSql`'s `classified.rop`. Null off a team. */
  readonly rop: string | null
  /**
   * EVERY order this operator has in the cohort — the count the confirmation
   * queue shows for the same period. FAKT 1 counts only the ones that left
   * the queue as an order, so the two differ and the screen has to be able to
   * say by how much.
   */
  readonly cohortOrders: number
  /**
   * FAKT 1: Тасдиқланди + Тасдиқланмай чиқди — what this operator sent out.
   * See `FAKT1_OUTCOMES`; the name stays `confirmed*` because FAKT 1 is what
   * the floor calls it and every consumer downstream reads it as that.
   */
  readonly confirmedOrders: number
  readonly confirmedMinor: bigint
  /** FAKT 2: Доставланди — the deal's CURRENT stage is a delivery stage. */
  readonly deliveredOrders: number
  readonly deliveredMinor: bigint
  /** In FAKT 1, not delivered, still OPEN — genuinely on the road. */
  readonly inTransitOrders: number
  readonly inTransitMinor: bigint
  /**
   * In FAKT 1, then LOST before delivery — «Отказ предварительно» and its
   * kind. Not in-transit (nothing is moving) and not a queue refusal (the
   * order DID leave the queue). Its own measure, or a fifth of the in-transit
   * money is a fiction.
   */
  readonly lostAfterConfirmOrders: number
  readonly lostAfterConfirmMinor: bigint
  /** Тасдиқланмади — refused in the queue. Outside FAKT 1, shown so the exclusion is visible. */
  readonly rejectedOrders: number
}

/**
 * The best month one seller has had — one row per calendar month.
 *
 * The same two figures the board and the podium carry, cut by the month of the
 * order's ARRIVAL in C4:NEW rather than by anything on the deal, so a record
 * and the board row it came from can be reconciled by eye.
 */
export interface ConfirmationMonthlyRecordRow {
  /** First day of the month, in `APP_TIMEZONE`, as `YYYY-MM-DD`. */
  readonly month: string
  readonly employeeId: string
  readonly fullName: string
  /** The ROP's own name — see `queueSql`'s `classified.rop`. Null off a team. */
  readonly rop: string | null
  readonly confirmedOrders: number
  readonly confirmedMinor: bigint
  readonly deliveredOrders: number
  readonly deliveredMinor: bigint
}


export interface MarginRow {
  readonly productId: string
  readonly productName: string
  readonly units: number
  readonly revenueMinor: bigint
  /** Given away — sold BELOW the catalogue price. Never negative. */
  readonly discountMinor: bigint
  /** Sold ABOVE the catalogue price. Never negative. The mirror of the above. */
  readonly overListMinor: bigint
  readonly costMinor: bigint | null
  readonly grossMinor: bigint | null
  /** Null only when no purchase price is recorded. -10000 = given away. */
  readonly marginBp: number | null
}

export interface MarginSummary {
  readonly rows: readonly MarginRow[]
  readonly revenueMinor: bigint
  readonly costedRevenueMinor: bigint
  readonly grossMinor: bigint
  /** Total given away. Positive, and never netted against markups. */
  readonly discountMinor: bigint
  /** Total sold above list. Positive. */
  readonly overListMinor: bigint
  readonly marginBp: number
  /** Share of revenue whose product has a purchase price, in basis points. */
  readonly coverageBp: number
}

export interface DispatchRow {
  readonly point: string
  readonly orders: number
  readonly delivered: number
  readonly refused: number
  readonly cancelledEarly: number
  readonly revenueMinor: bigint
  readonly deliveryRateBp: number | null
}

export interface StructureNode {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
  readonly headName: string | null
  /**
   * The head's own employee id, and the two facts the card needs about them.
   *
   * `headIsMember` is not a detail. Bitrix24's own company-structure screen
   * draws NO head row for a unit whose `UF_HEAD` names somebody who is not in
   * it — «Навоий» is exactly that, headed by a person whose departments are
   * «Kompaniya(ROP)» and «Тошкент онлайн» — and a card that printed the name
   * anyway would put a manager in a unit the portal says they do not sit in.
   */
  readonly headId: string | null
  readonly headPosition: string | null
  readonly headIsMember: boolean
  /** Everyone whose PRIMARY unit is this one, active or not. */
  readonly headcount: number
  /** Marked active in Bitrix24. */
  readonly activeHeadcount: number
  /**
   * Active people the PORTAL lists in this unit — its own `UF_DEPARTMENT`
   * membership, which is many-to-many. Larger than `activeHeadcount` wherever
   * somebody's second unit is this one. See the DepartmentMember model.
   */
  readonly memberCount: number
  /**
   * Those people's names, for the chart's own search box.
   *
   * Active only, and shipped with the tree rather than fetched per keystroke —
   * the whole roster is a few kilobytes and the payload is already on the wire.
   */
  readonly memberNames: readonly string[]
  /**
   * `memberCount` minus the head, when the head is one of them. This is the
   * figure the portal's card prints as «N сотрудников» under «Подчинённые»,
   * and the one the floor will hold this screen up against.
   */
  readonly subordinateCount: number
  /**
   * Active people in this unit's whole subtree, minus this unit's own head —
   * what the portal prints in the pill beside the head's name. DISTINCT, so a
   * person who sits in two units of the same branch is one person.
   */
  readonly headManagesCount: number
  /** Direct child units. The card's footer prints this or says there are none. */
  readonly childCount: number
  readonly sortOrder: number
}

/** One person on a department's roster, for the side panel. */
/**
 * One unit the reader belongs to, and whether it is the PRIMARY one.
 *
 * Both travel, because the screen needs both and they answer different
 * questions. Every membership gets the «SIZ» badge — a person listed in two
 * units is in two units, and badging one would be a claim about the other.
 * But the chain line, «Rahbaringiz» and «Meni topish» are statements about ONE
 * unit, and that unit is the primary: the one this dashboard credits the
 * person's numbers to. Collapsing the list to whichever id the tree happened
 * to walk past first answered a question nobody asked.
 */
export interface ViewerDepartment {
  readonly departmentId: string
  readonly isPrimary: boolean
}

export interface DepartmentMemberRow {
  readonly id: string
  readonly fullName: string
  readonly position: string | null
  readonly isActive: boolean
  /** False when this unit is their SECOND department. */
  readonly isPrimary: boolean
  readonly isHead: boolean
}

export class InsightsRepository {
  private readonly tz: string

  constructor(private readonly prisma: PrismaClient) {
    this.tz = env.APP_TIMEZONE
  }

  // -------------------------------------------------------------------------
  // 1 — Cohorts
  // -------------------------------------------------------------------------

  /**
   * Repeat-purchase matrix.
   *
   * A customer's cohort is the month of their FIRST revenue-bearing win, and
   * each cell counts how many of that cohort bought again N months later.
   *
   * Counting DISTINCT customers rather than deals is what makes the row a
   * retention rate: one buyer placing three orders in month 2 is one retained
   * customer, not three. Revenue is summed alongside so the same matrix answers
   * "how much is repeat business worth", which is the number that decides
   * whether the retention team is funded.
   */
  /**
   * The matrix, its WHOLE-HISTORY totals, and the calendar it is read against.
   *
   * THREE THINGS, BECAUSE TWO OF THEM USED TO BE INFERRED AND BOTH WERE WRONG.
   *
   * 1. `months` bounds which cohort ROWS are drawn, and it always did. The
   *    summary the service folds on top of them must NOT inherit that bound:
   *    every tile above the matrix says «butun tarix», and a customer whose
   *    first order predates the cut is a real customer with real repeat
   *    revenue. The `is_total` arm below is computed over every cohort, and it
   *    survives an empty matrix — the first month the database's history
   *    exceeds 18 months, the windowed arm can return nothing at all.
   *
   * 2. `currentMonth` comes from the CLOCK. The service used to take the
   *    newest key in the data as "now", on the stated assumption that there is
   *    a row for every month up to this one. There is not: a month in which
   *    nobody made a first purchase emits no row, so the horizon fell behind
   *    the calendar and every elapsed month past it rendered as «maʼlumot
   *    yoʻq» — "not measured" — when the truth was a measured zero. That is
   *    the exact opposite of the finding, and it is worst on a narrowed
   *    employee scope, where a quiet month is ordinary.
   *
   * One statement, not three: the CTEs are built once and both arms read them.
   */
  async cohorts(options: { months: number }): Promise<CohortMatrix> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        is_total: number
        cohort: Date | null
        size: bigint | null
        months_since: number | null
        customers: bigint | null
        revenue: MoneyText
        returned: bigint | null
        total_customers: bigint | null
        total_returned: bigint | null
        first_revenue: MoneyText
        later_revenue: MoneyText
        current_month: Date | null
      }[]
    >(
      `
      WITH first_win AS (
        SELECT
          d."customerId" AS customer_id,
          date_trunc('month', min(d."closedAt") AT TIME ZONE 'UTC' AT TIME ZONE $1) AS cohort
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."status" = 'WON'
          AND d."customerId" IS NOT NULL AND d."closedAt" IS NOT NULL
        GROUP BY 1
      ),
      sized AS (
        SELECT cohort, count(*)::bigint AS size FROM first_win GROUP BY cohort
      ),
      purchases AS (
        SELECT
          f.cohort,
          d."customerId" AS customer_id,
          d."amountMinor" AS amount,
          (
            (EXTRACT(YEAR FROM date_trunc('month', d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)) -
             EXTRACT(YEAR FROM f.cohort)) * 12 +
            (EXTRACT(MONTH FROM date_trunc('month', d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)) -
             EXTRACT(MONTH FROM f.cohort))
          )::int AS months_since
        FROM "deal" d
        JOIN first_win f ON f.customer_id = d."customerId"
        WHERE d."countsAsRevenue" AND d."status" = 'WON' AND d."closedAt" IS NOT NULL
      ),
      /*
        Everyone who ever came back, once each.

        It cannot be derived from the matrix beside it: a customer who
        returned in month +1 AND month +3 appears in two cells, so summing
        double-counts them, and taking only the first cell counts only the
        ones who came back immediately. Measured on this database: 320 by
        that reading against 751 who actually returned.

        A separate aggregate rather than a window function, because a window
        function may not take DISTINCT.
      */
      returners AS (
        SELECT cohort, count(DISTINCT customer_id) AS returned
          FROM purchases
         WHERE months_since > 0
         GROUP BY cohort
      )
      SELECT
        0 AS is_total,
        p.cohort,
        s.size,
        p.months_since,
        count(DISTINCT p.customer_id)::bigint AS customers,
        sum(p.amount)::text AS revenue,
        -- How many of this cohort ever came back, counted once each; see the
        -- returners CTE. Repeated on every row of the cohort, which is what
        -- lets one query carry both the matrix and the headline.
        r.returned::bigint AS returned,
        NULL::bigint AS total_customers,
        NULL::bigint AS total_returned,
        NULL::text AS first_revenue,
        NULL::text AS later_revenue,
        NULL::timestamp AS current_month
      FROM purchases p
      JOIN sized s ON s.cohort = p.cohort
      LEFT JOIN returners r ON r.cohort = p.cohort
      -- The bound is on the ROWS only. The totals arm below deliberately
      -- carries no such clause; see the method's own note.
      WHERE p.cohort >= date_trunc('month', (now() AT TIME ZONE $1)) - make_interval(months => $2::int)
        AND p.months_since >= 0
      GROUP BY p.cohort, s.size, p.months_since, r.returned

      UNION ALL

      /*
        ONE ROW, OVER EVERY COHORT THERE HAS EVER BEEN.

        Emitted from the same CTEs rather than from a second statement, so the
        headline and the matrix can never be built from two different reads of
        a table the sync worker rewrites every minute. It also survives a
        matrix that is empty: the windowed arm returns nothing at all once the
        whole history is older than the bound, and four tiles reading «butun
        tarix» must still have an answer then.

        first / later are split here rather than in TS for the same reason the
        returners CTE exists: the split is a property of the data, and summing
        it on the client from windowed cells is how it drifted in the first
        place.
      */
      SELECT
        1 AS is_total,
        NULL::timestamp AS cohort,
        NULL::bigint AS size,
        NULL::int AS months_since,
        NULL::bigint AS customers,
        NULL::text AS revenue,
        NULL::bigint AS returned,
        (SELECT COALESCE(sum(size), 0)::bigint FROM sized) AS total_customers,
        (SELECT COALESCE(sum(returned), 0)::bigint FROM returners) AS total_returned,
        (SELECT COALESCE(sum(amount), 0)::text FROM purchases WHERE months_since = 0) AS first_revenue,
        (SELECT COALESCE(sum(amount), 0)::text FROM purchases WHERE months_since > 0) AS later_revenue,
        -- The horizon, from the clock. A month with no first-time buyer emits
        -- no cohort row, so the newest key in the data is not "now" and the
        -- service must not read it as one.
        date_trunc('month', (now() AT TIME ZONE $1)) AS current_month

      ORDER BY 1 ASC, 2 DESC, 4 ASC
      `,
      this.tz,
      options.months,
    )

    const byCohort = new Map<string, { size: number; returned: number; cells: CohortCell[] }>()
    const summary = rows.find((row) => row.is_total === 1)

    for (const row of rows) {
      if (row.is_total === 1 || row.cohort === null || row.months_since === null) continue
      const key = row.cohort.toISOString().slice(0, 10)
      const entry =
        byCohort.get(key) ?? { size: int(row.size), returned: int(row.returned), cells: [] }
      entry.cells.push({
        monthsSince: row.months_since,
        customers: int(row.customers),
        revenueMinor: money(row.revenue),
      })
      byCohort.set(key, entry)
    }

    return {
      rows: [...byCohort.entries()].map(([cohort, entry]) => ({
        cohort,
        size: entry.size,
        returned: entry.returned,
        cells: entry.cells,
      })),
      totals: {
        customers: int(summary?.total_customers ?? 0n),
        returned: int(summary?.total_returned ?? 0n),
        firstRevenueMinor: money(summary?.first_revenue ?? null),
        laterRevenueMinor: money(summary?.later_revenue ?? null),
      },
      /*
        The UNION arm always produces exactly one row, so the fallback is
        unreachable in practice. It is written rather than asserted because an
        empty string would make `monthsApart` return 0 for every cohort and
        blank the whole matrix — a louder failure than a stale-looking grid.
      */
      currentMonth: summary?.current_month?.toISOString().slice(0, 10) ?? '',
    }
  }

  /**
   * Where the customer base currently sits in the retention pipeline.
   *
   * `База` is not a sales funnel — its stages are a follow-up cadence (1 day,
   * 3 days, 7, 14, 21) ending in Активный / Неактивные / Недозвоны. Reading
   * the live headcount per stage answers "how many customers are still being
   * worked" in the team's own vocabulary, which the cohort matrix cannot.
   */
  async retentionStages(): Promise<{
    readonly stages: RetentionStage[]
    /**
     * Distinct customers on an OPEN retention deal — the ones actually being
     * worked, counted once each.
     *
     * NOT the sum of the rows. A customer with deals on two stages is in two
     * of them, so adding the column up counted 1,660 people twice and
     * produced a "base" larger than the whole customer list. It also swept in
     * Активный, Неактивные and Недозвоны, which are where the cadence ENDS.
     */
    readonly workedCustomers: number
  }> {
    const rows = await this.prisma.$queryRawUnsafe<
      { stage: string | null; is_total: number; customers: bigint; open_customers: bigint }[]
    >(
      `
      SELECT
        s."name" AS stage,
        GROUPING(s."name")::int AS is_total,
        count(DISTINCT d."customerId")::bigint AS customers,
        count(DISTINCT d."customerId") FILTER (WHERE d."status" = 'OPEN')::bigint
          AS open_customers
      FROM "deal" d
      JOIN "deal_stage" s ON s."id" = d."stageId"
      JOIN "pipeline" p ON p."id" = d."pipelineId"
      WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
      GROUP BY GROUPING SETS ((s."name", s."sortOrder"), ())
      ORDER BY is_total, min(s."sortOrder")
      `,
    )

    return {
      stages: rows
        .filter((r) => r.is_total === 0)
        .map((r) => ({ stage: r.stage ?? '', customers: int(r.customers) })),
      workedCustomers: int(rows.find((r) => r.is_total === 1)?.open_customers ?? 0n),
    }
  }

  // -------------------------------------------------------------------------
  // 2 — Logistics
  // -------------------------------------------------------------------------

  /**
   * The compiler's proof that the client's table names roles that exist.
   *
   * `LOGISTICS_BUCKETS` lives in `src/lib` so the screen and this file read
   * ONE definition of a six-way partition the client approved by name. That
   * module cannot import `@/server/domain/types` — eslint forbids the crossing
   * in both directions — so the check has to be made from this side. `as
   * const` on the table keeps the literals, and this assignment fails `tsc` on
   * a typo, which is the trick `repositories/enumParity.ts` plays on the
   * Prisma enums.
   */
  private static readonly BUCKET_ROLES: readonly LogisticsRoleValue[] =
    LOGISTICS_BUCKETS.flatMap((bucket) => bucket.roles)

  /**
   * ONE CASE, GENERATED FROM THE CLIENT'S OWN TABLE.
   *
   * Hand-writing the eighteen-into-six mapping here would be a second
   * definition of something the client approved stage by stage, and the two
   * would agree right up until somebody moved a stage.
   *
   * `ELSE 'OTHER'` is the honesty valve and is not optional. A FAKT 1 order
   * whose current stage is outside Доставка — confirmed, then moved to
   * another funnel — matches none of the six, and the screen claims the six
   * are the whole of ЗАКАЗ. It is counted and reported instead of quietly
   * dropped out of a partition that says it is exhaustive.
   */
  private static bucketCaseSql(roleColumn: string): string {
    const arms = LOGISTICS_BUCKETS.flatMap((bucket) =>
      bucket.roles.map((role) => `WHEN '${role}' THEN '${bucket.key}'`),
    ).join(`
              `)
    return `CASE ${roleColumn}
              ${arms}
              ELSE '${UNMAPPED_BUCKET}'
            END`
  }

  /**
   * THE CLIENT'S OWN LOGISTICS SHEET, ON THE COHORT THAT MATCHES IT.
   *
   * The floor runs delivery off a Google Sheet exported from the Доставка
   * kanban: ДАТА, ЗАКАЗ, ТАСТИКЛАНГАН, не собран, В пути, Ожидание/нд, Отказ,
   * Успешно, %покрытия. This is that sheet.
   *
   * IT IS BUILT ON THE QUEUE COHORT, NOT ON createdAtSource, AND THAT WAS
   * MEASURED RATHER THAN CHOSEN. Against the client's own week
   * (2026-08-31..09-06) their ЗАКАЗ of 893 489 993 sits 98.6% on FAKT 1
   * (881 270 000) and their Успешно of 698 539 996 sits 100.4% on FAKT 2
   * (701 570 000). The creation-date cohort the old logistics query used gives
   * 788 670 000 — 88.3%. So ЗАКАЗ is FAKT 1, Успешно is FAKT 2, and %покрытия
   * is FAKT 2 over FAKT 1, which is also why the client asked for those two
   * names to appear on this screen.
   *
   * That makes the whole screen ONE clock, and the same clock Savdo dinamikasi
   * and Sotuvchilar reytingi are on. The two figures are built from
   * FAKT1_OUTCOMES and FAKT2_DELIVERED — the constants ratingSql groups by —
   * so summing the sellers board and reading this query's `fakt` row must give
   * the same two numbers. Restating either predicate here is how the two
   * screens would start to disagree.
   *
   * THE SHEET SPECIFIED THE COLUMNS; THE PORTAL SUPPLIES THE NUMBERS.
   *
   * The sheet and this query disagree about the split between "still standing
   * at a post office" and "refused" — on the measured week 8.4% against their
   * 16.70%, and 10.9% against their 4.25%, while Успешно and both totals
   * agree. That is NOT an open defect: the client settled it on 2026-09-11
   * («bitrix24dagi malumot toʻgʻri… undagi malumotlarga tayanma»). Bitrix24 is
   * the source of truth, the sheet was a list of which columns to build, and
   * the mapping it specified is confirmed stage by stage.
   *
   * `by_stage` therefore exists as an AUDIT TRAIL rather than as a dispute:
   * every Доставка stage, one per row, in the portal's Russian and the
   * portal's order, with the column it feeds — so the six columns above can
   * be checked against obey.bitrix24.kz instead of trusted.
   *
   * ONE STATEMENT, SEVEN ARMS. The queueSql prelude is the whole cost — a
   * cohort rebuild is ~0.9 s — and the arms are seven hash aggregates over a
   * few thousand rows already in memory. Two statements would pay for the
   * cohort twice. `numbered` and `visible` go unreferenced and Postgres does
   * not evaluate a CTE nothing selects from.
   *
   * Held as a builder rather than inline so the shape can be asserted without
   * a database. See tests/http/logisticsSql.test.ts.
   */
  private static logisticsCohortSql(): string {
    /*
      ONE AGGREGATE LIST, READ BY SEVEN CUTS — the rule the old logisticsSql
      learned the hard way. Written per cut, the halves of this screen drift
      into counting different things under the same column names.

      count(k.deal_id), NEVER count(*). Two of the seven arms reach their rows
      through a LEFT JOIN from a stage list, so an empty column arrives as one
      all-null row and count(*) would count it and print «Заказ в мой склад 1»
      over nothing. amountMinor is NOT NULL on every real deal, so the two are
      identical for the arms that group the cohort directly and only this one
      is right for all seven.

      The alias is k in every arm, including the two that join it on.
    */
    const AGG = `
        count(k.deal_id)::bigint AS orders,
        COALESCE(sum(k.amount_minor), 0)::text AS amount,
        count(k.deal_id) FILTER (WHERE k.fakt1)::bigint AS fakt1_orders,
        COALESCE(sum(k.amount_minor) FILTER (WHERE k.fakt1), 0)::text AS fakt1_amount,
        count(k.deal_id) FILTER (WHERE ${InsightsRepository.faktDeliveredSql('k.role')})::bigint AS delivered_orders,
        COALESCE(sum(k.amount_minor) FILTER (WHERE ${InsightsRepository.faktDeliveredSql('k.role')}), 0)::text AS delivered_amount,
        count(k.deal_id) FILTER (WHERE k.bucket = 'REFUSED' AND k.dispatched)::bigint AS refused_orders,
        COALESCE(sum(k.amount_minor) FILTER (WHERE k.bucket = 'REFUSED' AND k.dispatched), 0)::text AS refused_amount,
        count(k.deal_id) FILTER (WHERE k.bucket = 'REFUSED' AND NOT k.dispatched)::bigint AS cancelled_orders,
        COALESCE(sum(k.amount_minor) FILTER (WHERE k.bucket = 'REFUSED' AND NOT k.dispatched), 0)::text AS cancelled_amount,
        count(k.deal_id) FILTER (WHERE k.bucket NOT IN ('REFUSED', 'DONE'))::bigint AS in_flight_orders,
        count(k.deal_id) FILTER (WHERE k.fakt1 AND NOT k.counts_as_revenue)::bigint AS off_revenue_orders,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY k.pace_days) AS median_days`

    /*
      The five arms that report the client's partition read FAKT 1 only.

      by_fakt is the exception and has to be: FAKT 2 is measured over the WHOLE
      cohort because it is not a subset of FAKT 1 — an order refused in the
      queue and revived afterwards is delivered money that never counted as
      confirmed, and the sellers board already counts it.
    */
    const FAKT1_ONLY = `WHERE k.fakt1`

    const bucketCase = InsightsRepository.bucketCaseSql(`ds."logisticsRole"::text`)

    return `
    ,
    /*
      THE DELIVERY LEG, BOUNDED ON THE LEFT ONLY — the same argument the
      moves CTE makes one step above.

      Every row in this cohort arrived in Тасдиклаш at or after $1, and a hub
      stamp or a delivery follows the arrival it belongs to, so no history row
      earlier than $1 can change which post office held this order or when it
      landed. What the bound buys is (stageId, enteredAt) range scans instead
      of a sequential pass over 216 000 rows. It is also MORE correct, not
      less: an order delivered in a previous life, bounced back and re-queued
      after $1 is attributed to its second journey, which is the one this
      cohort is about.

      NOT closed on the right, for the reason moves gives at length: an order
      that arrived on the 31st is delivered in the new month, and freezing it
      at $2 would report a status nobody can act on.
    */
    routed AS (
      SELECT DISTINCT ON (h."dealId")
             h."dealId"  AS deal_id,
             h."stageId" AS post_stage_id
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
       WHERE s."logisticsRole" IN ('REGIONAL_HUB', 'CARRIER')
         AND s."externalId" LIKE 'C6:%'
         AND h."enteredAt" >= $1
       ORDER BY h."dealId", h."enteredAt" DESC
    ),
    delivered_at AS (
      SELECT DISTINCT ON (h."dealId")
             h."dealId"    AS deal_id,
             h."enteredAt" AS delivered_at
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
       WHERE s."logisticsRole" = 'DELIVERED'
         AND h."enteredAt" >= $1
       ORDER BY h."dealId", h."enteredAt" ASC
    ),
    dispatched AS (
      SELECT DISTINCT h."dealId" AS deal_id
        FROM "deal_stage_history" h
        JOIN "deal_stage" s ON s."id" = h."stageId"
       WHERE s."logisticsRole" IN ('REGIONAL_HUB', 'CARRIER', 'IN_TRANSIT')
         AND h."enteredAt" >= $1
    ),
    /*
      THE ROW EVERY CUT READS. MATERIALIZED, and that is the whole budget.

      Seven arms reference it. Postgres would materialise a CTE with seven
      references anyway; saying so keeps it true if a later edit leaves one —
      the same argument queueSql's signal_stage measured at 1 881 ms against
      206 ms for the same rows.

      NOT FILTERED TO FAKT 1. The fakt1 column carries the test instead, so
      by_fakt can measure FAKT 2 over the whole cohort while the five arms
      that report the client's columns read FAKT 1 only.

      THE COLUMN IS THE DEAL'S CURRENT STAGE, the way the kanban is read. The
      post office is the opposite question — which hub HANDLED it — and comes
      from history, because a delivered order sits on «Доставлено» and left
      NAVOIY days ago.
    */
    cohort AS MATERIALIZED (
      SELECT
        c.deal_id,
        d."amountMinor"          AS amount_minor,
        d."countsAsRevenue"      AS counts_as_revenue,
        d."refusalReason"        AS refusal_reason,
        COALESCE(d."region", '${InsightsRepository.NO_REGION}') AS region,
        d."stageId"              AS stage_id,
        ds."logisticsRole"::text AS role,
        (${InsightsRepository.FAKT1_OUTCOMES}) AS fakt1,
        ${bucketCase} AS bucket,
        r.post_stage_id,
        (dp.deal_id IS NOT NULL) AS dispatched,
        -- Tashkent, not UTC: the working day is what is being counted, and
        -- five hours of it would otherwise be filed into yesterday.
        (c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${env.APP_TIMEZONE}')::date::text AS day,
        CASE
          WHEN ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')} AND dv.delivered_at >= c.queued_at
          THEN EXTRACT(EPOCH FROM (dv.delivered_at - c.queued_at)) / 86400
        END AS pace_days
      FROM scoped c
      JOIN "deal" d ON d."id" = c.deal_id
      LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"
      LEFT JOIN routed r        ON r.deal_id  = c.deal_id
      LEFT JOIN delivered_at dv ON dv.deal_id = c.deal_id
      LEFT JOIN dispatched dp   ON dp.deal_id = c.deal_id
    ),
    /*
      FAKT 1 AND FAKT 2 — the only arm that reads the whole cohort.

      fakt1_* is ЗАКАЗ and delivered_* is FAKT 2, both from the constants
      ratingSql groups by. Summing the sellers board's rows and reading this
      one row must give the same two figures; that equality is the
      reconciliation property this screen was measured against.
    */
    by_fakt AS (
      SELECT 'fakt'::text AS cut, NULL::text AS bucket, NULL::text AS sub,
             NULL::int AS sort, 1::int AS is_total,${AGG}
      FROM cohort k
    ),
    /*
      THE SIX COLUMNS OF THE CLIENT'S SHEET, AND ЗАКАЗ UNDER THEM.

      Three grouping sets, not two. (bucket, role) is what keeps «Отказ» one
      column on screen and two numbers underneath it — REFUSED and
      CANCELLED_EARLY are never added together in SQL, because one is a parcel
      that travelled and came back and the other a phone call. The same
      mechanism carries the three roles inside «Ожидание / нд», so nothing
      about Отказ is special-cased.

      role is COALESCEd because it is nullable on the deal's stage, and a real
      NULL would be indistinguishable from the NULL a grouping set puts there.
      After the coalesce, sub IS NULL means "this is an aggregate row".
    */
    by_bucket AS (
      SELECT 'bucket'::text, k.bucket, COALESCE(k.role, 'NONE'), NULL::int,
             GROUPING(k.bucket)::int,${AGG}
      FROM cohort k
      ${FAKT1_ONLY}
      GROUP BY GROUPING SETS ((k.bucket, COALESCE(k.role, 'NONE')), (k.bucket), ())
    ),
    /*
      The same six per Asia/Tashkent day, plus the day's own ЗАКАЗ.

      Only days that carry orders come back. Zero-filling the axis is the
      caller's job, because only the caller knows the window it asked for.
    */
    by_day AS (
      SELECT 'day'::text, k.bucket, k.day, NULL::int,
             GROUPING(k.bucket)::int,${AGG}
      FROM cohort k
      ${FAKT1_ONLY}
      GROUP BY GROUPING SETS ((k.day, k.bucket), (k.day))
    ),
    /*
      THE POST OFFICES, FROM HISTORY AND NOT FROM THE CURRENT STAGE.

      routed reads the LAST hub or carrier entry, which attributes every order
      to exactly ONE post office — so these rows PARTITION ЗАКАЗ and can be
      added up. "Ever passed through" was considered and rejected: it
      double-counts the money on a screen whose whole claim is that its
      columns sum to ЗАКАЗ.

      IT STARTS FROM THE EIGHT STAGES, so a post office that moved nothing is
      still a row reading 0 rather than a row that is missing. Hence the LEFT
      JOIN — and hence k.fakt1 riding the ON clause. Moved to the WHERE it
      turns the outer join back into an inner one and deletes the empty hubs,
      which is the trap deliveryBoardSql.test.ts pins on the other board.

      NOTE FOR WHOEVER LABELS THIS TABLE: these eight are REGIONAL_HUB and
      CARRIER. The «Ожидание / нд» column also holds the two CHASING stages,
      so this table is NOT that column's total.
    */
    by_post AS (
      SELECT 'post'::text, st."name", NULL::text, min(st."sortOrder")::int,
             GROUPING(st."name")::int,${AGG}
      FROM "deal_stage" st
      LEFT JOIN cohort k ON k.post_stage_id = st."id" AND k.fakt1
      WHERE st."logisticsRole" IN ('REGIONAL_HUB', 'CARRIER')
        AND st."externalId" LIKE 'C6:%'
      GROUP BY GROUPING SETS ((st."name"), ())
    ),
    by_region AS (
      SELECT 'region'::text, k.region, NULL::text, NULL::int,
             GROUPING(k.region)::int,${AGG}
      FROM cohort k
      ${FAKT1_ONLY}
      GROUP BY GROUPING SETS ((k.region), ())
    ),
    /*
      THE RECONCILIATION CUT: EVERY ACTIVE C6 STAGE, VERBATIM.

      THE COUNT IS NOT WRITTEN DOWN, on purpose. It was eighteen until the
      client added «Ожидание / нд» on 2026-09-10 and it is nineteen now; a
      number in this comment would have been wrong within a day, and a number
      on the screen was. The arm starts from the stage table itself and prints
      whatever the portal currently has.

      Printed one per row, in the portal's own Russian and the portal's own
      sortOrder, with the column each one feeds, it is the only place a reader
      can check that the six columns really are the portal's own stages
      grouped — which is what makes every figure above it checkable rather
      than trusted.

      THE COLUMN IS DECIDED HERE, not in the browser. Re-deriving the
      grouping client-side would be a second definition of the partition.
      min() over a group that is one stage is that stage's own bucket.

      IT IS NOT THE PORTAL'S LIVE KANBAN — /insights/delivery is that, and it
      has no window at all. This is our six columns opened out to the stages
      they are made of, over THIS cohort, which is why it is filtered to fakt1
      on the ON clause like by_post above.

      Its grand total is ЗАКАЗ minus the OTHER bucket, and the two must agree.
    */
    by_stage AS (
      SELECT 'stage'::text, st."name",
             min(${InsightsRepository.bucketCaseSql(`st."logisticsRole"::text`)}),
             min(st."sortOrder")::int,
             GROUPING(st."name")::int,${AGG}
      FROM "deal_stage" st
      LEFT JOIN cohort k ON k.stage_id = st."id" AND k.fakt1
      WHERE st."externalId" LIKE 'C6:%' AND st."isActive"
      GROUP BY GROUPING SETS ((st."name"), ())
    ),
    /*
      WHY THE «Отказ» COLUMN LOST THEM, split by whether the parcel travelled.

        RETURNED  — went to the customer and came back. Cost the delivery, the
                    handling and the return leg.
        CANCELLED — killed before anything shipped. Cost a phone call.

      Kept, and rebased onto this cohort. It is the most useful block on the
      page precisely because Отказ is the column the client's sheet and ours
      disagree about, and it is now a UNION arm rather than a second statement
      that rebuilt the cohort to ask one question.
    */
    by_reason AS (
      SELECT 'reason'::text,
             COALESCE(k.refusal_reason, 'Sabab koʻrsatilmagan'),
             CASE WHEN k.dispatched THEN 'RETURNED' ELSE 'CANCELLED' END,
             NULL::int, 0::int,${AGG}
      FROM cohort k
      WHERE k.fakt1 AND k.bucket = 'REFUSED'
      GROUP BY COALESCE(k.refusal_reason, 'Sabab koʻrsatilmagan'),
               CASE WHEN k.dispatched THEN 'RETURNED' ELSE 'CANCELLED' END
    )
    SELECT * FROM (
      SELECT * FROM by_fakt
      UNION ALL SELECT * FROM by_bucket
      UNION ALL SELECT * FROM by_day
      UNION ALL SELECT * FROM by_post
      UNION ALL SELECT * FROM by_region
      UNION ALL SELECT * FROM by_stage
      UNION ALL SELECT * FROM by_reason
    ) cuts
    ORDER BY cut, is_total, sort NULLS LAST, sub NULLS FIRST, orders DESC
    `
  }

  /**
   * The logistics screen's whole payload, in one round trip.
   *
   * Takes a `ScopedWindow` rather than a `Period` so the caller's employee
   * scope reaches the SQL through the same door every other reading built on
   * `queueSql` uses. The route is company-wide today, so the scope is the
   * whole company — but the plumbing is here, and widening the endpoint later
   * is a line in the route rather than a rewrite of this query.
   */
  async logisticsCohort(window: ScopedWindow): Promise<LogisticsCohort> {
    const rows = await this.prisma.$queryRawUnsafe<LogisticsCutRow[]>(
      `${InsightsRepository.queueSql('window', '$3')}${InsightsRepository.logisticsCohortSql()}`,
      window.start,
      window.end,
      InsightsRepository.scopeValue(window),
    )

    const decode = (row: LogisticsCutRow): LogisticsCut => ({
      bucket: row.bucket ?? '',
      sub: row.sub,
      sort: row.sort,
      orders: int(row.orders),
      amountMinor: money(row.amount),
      fakt1Orders: int(row.fakt1_orders),
      fakt1Minor: money(row.fakt1_amount),
      deliveredOrders: int(row.delivered_orders),
      deliveredMinor: money(row.delivered_amount),
      refusedOrders: int(row.refused_orders),
      refusedMinor: money(row.refused_amount),
      cancelledOrders: int(row.cancelled_orders),
      cancelledMinor: money(row.cancelled_amount),
      inFlightOrders: int(row.in_flight_orders),
      offRevenueOrders: int(row.off_revenue_orders),
      medianDays: row.median_days === null ? null : Number(row.median_days),
    })

    /*
      An empty window still yields every GROUPING SETS total row, so a missing
      one means the arm itself did not run — a shape change, not an empty
      month. EMPTY is what the caller then divides by, and `rateBp` turns a
      zero denominator into null rather than into a confident 0%.
    */
    const EMPTY: LogisticsCut = {
      bucket: '',
      sub: null,
      sort: null,
      orders: 0,
      amountMinor: 0n,
      fakt1Orders: 0,
      fakt1Minor: 0n,
      deliveredOrders: 0,
      deliveredMinor: 0n,
      refusedOrders: 0,
      refusedMinor: 0n,
      cancelledOrders: 0,
      cancelledMinor: 0n,
      inFlightOrders: 0,
      offRevenueOrders: 0,
      medianDays: null,
    }

    const of = (cut: string) => rows.filter((row) => row.cut === cut)
    const peel = (cut: string) => {
      const arm = of(cut)
      return {
        rows: arm.filter((row) => row.is_total === 0).map(decode),
        total: (() => {
          const found = arm.find((row) => row.is_total === 1)
          return found ? decode(found) : EMPTY
        })(),
      }
    }

    const bucketArm = of('bucket')
    const dayArm = of('day')
    const posts = peel('post')
    const regions = peel('region')
    const stages = peel('stage')
    const faktRow = of('fakt')[0]

    return {
      fakt: faktRow ? decode(faktRow) : EMPTY,
      total: (() => {
        const found = bucketArm.find((row) => row.is_total === 1)
        return found ? decode(found) : EMPTY
      })(),
      buckets: bucketArm.filter((row) => row.is_total === 0 && row.sub === null).map(decode),
      parts: bucketArm.filter((row) => row.is_total === 0 && row.sub !== null).map(decode),
      days: dayArm.filter((row) => row.is_total === 0).map(decode),
      dayTotals: dayArm.filter((row) => row.is_total === 1).map(decode),
      posts: posts.rows,
      postTotal: posts.total,
      regions: regions.rows,
      regionTotal: regions.total,
      stages: stages.rows,
      stageTotal: stages.total,
      reasons: of('reason').map(decode),
    }
  }

  // -------------------------------------------------------------------------
  // 4 — Confirmation
  // -------------------------------------------------------------------------

  /**
   * The Тасдиклаш board, one row per order.
   *
   * BUILT TO THE CLIENT'S OWN SPECIFICATION, not to ours. They run a Telegram
   * bot that watches Bitrix and a published dashboard built from its output;
   * the floor reads those numbers every day. Two documents of theirs define
   * the rules exactly — which stages mean what, and which are ignored — so a
   * second, reasonable-looking definition here would not be a variant, it
   * would be a contradiction of the figures the company already works to.
   *
   * THE WINDOW SELECTS ON THE ARRIVAL IN `C4:NEW`. An order belongs to the day
   * it entered the confirmation queue — «БОШЛАНИШ НУҚТАСИ» in their own words —
   * because that is the day their bot announced it and the day it has carried
   * on their board ever since. The bot keys on the stage move (`MOVED_TIME`)
   * and deliberately not on `DATE_MODIFY`, which any edit bumps: «шунинг учун
   * ойлар олдин рад этилган сделкалар "янги воқеа" деб хабар қилинарди».
   *
   * NOT Дата создания, which is what this used to select on and what made the
   * board disagree with the floor. Registration («Регистрация», pipeline 0)
   * holds a deal for as long as it takes to reach the customer, and only the
   * move to «Сделка успешна» hands it to Тасдиклаш as `C4:NEW`. Measured
   * against the portal on 2026-09-03: one order had arrived, their bot showed
   * one, and this board showed four — three of them created that morning but
   * still sitting in Регистрация, unannounced and unworkable.
   *
   * FIVE STAGES SPEAK; THE REST ARE SILENT:
   *
   *   🕔 CONFIRM_NEW          `C4:NEW` — in the queue, nobody has worked it.
   *   🟡 NO_ANSWER            `C4:UC_JQR9F1` — reached for, no answer.
   *   ❌ REJECTED             `C4:LOSE`, and `C12:UC_1OM8B2` where Bitrix
   *                           actually files the refusal.
   *   ✅ CONFIRMED            `C6:NEW` — moved to Доставка, which is the move
   *                           an operator makes once the customer says yes.
   *   🟣 UNCONFIRMED_SHIPPED  the same move, but the deal's «Тастиклаш анализ»
   *                           says the customer was never reached.
   *
   * «Пропущенный», the two SMS stages, `C4:WON` and UTECHKA say nothing: an
   * order parked in one of them has neither been reached nor refused, and is
   * still whatever it was. See CONFIRMATION_SIGNAL_STAGES for why each.
   *
   * № AND РОП COME FROM HERE, because they are properties of the board rather
   * than of the deal. The floor numbers orders per ROP per day — Sevinch's
   * 21st of the 26th — which is why the window function partitions by both, in
   * Tashkent time and not UTC.
   */
  /**
   * The label for orders whose department is not a ROP group.
   *
   * IT IS A REAL FILTER VALUE, not a display string. The breakdown keeps NULL
   * rops so the tiles can total every order, and it labels them with this — so
   * the label has to be something the WHERE clause understands too. It did
   * not: the page compared `c.rop = $5`, which is NULL for exactly these rows
   * and therefore matches none of them, while the tiles were filtered in
   * TypeScript by string equality and matched all of them. Selecting the group
   * showed 40 in the band and an empty table under it.
   *
   * Every predicate on the ROP now compares `coalesce(c.rop, SENTINEL)`, and
   * the group is offered in the dropdown like any other — the 83 orders on
   * this portal whose seller sits outside a ROP department were otherwise
   * countable but unreachable.
   */
  static readonly NO_ROP = '(ROP yoʻq)'

  /**
   * The label for orders whose customer carries no region.
   *
   * THE SAME ARGUMENT AS `NO_ROP`, AND THE SAME TRAP. `d."region"` is NULL for
   * a real population of orders, and `= ANY($n)` never matches a NULL — so a
   * region filter written without this would have offered the reader a column
   * of «—» rows it could describe but never select, exactly as the ROP filter
   * once did with its 83 orders. It is a filter VALUE, not a display string:
   * the column still prints an em dash.
   */
  static readonly NO_REGION = '(Region yoʻq)'

  /**
   * The ROP predicate, written once so the four readings cannot drift.
   *
   * A LIST SINCE 2026-09-09, when the control became a column filter rather
   * than a single-choice dropdown — see `rops` in `queryParams`. NULL, not an
   * empty array: `= ANY` over an empty array is false for every row, so an
   * empty selection would render an empty table instead of the whole queue.
   * That is the same rule the outcome predicate states beside it.
   */
  private static ropMatch(param: string): string {
    return `(${param}::text[] IS NULL OR coalesce(c.rop, '${InsightsRepository.NO_ROP}') = ANY(${param}::text[]))`
  }

  /** The region predicate. Same shape, same NULL-means-everything rule. */
  private static regionMatch(param: string): string {
    return `(${param}::text[] IS NULL OR coalesce(d."region", '${InsightsRepository.NO_REGION}') = ANY(${param}::text[]))`
  }

  /**
   * The СУММА range, in MINOR units — the column's own scale.
   *
   * Two independent bounds rather than one range type, because a reader
   * routinely wants only one of them («everything over a million») and a
   * half-open range is not an edge case here. Both are inclusive: the box says
   * «dan» and «gacha», and a reader who types the exact figure of an order
   * expects to see that order.
   */
  private static amountRange(min: string, max: string): string {
    return `(${min}::bigint IS NULL OR d."amountMinor" >= ${min}::bigint)
          AND (${max}::bigint IS NULL OR d."amountMinor" <= ${max}::bigint)`
  }

  /**
   * The board answers two questions, and they are not the same question.
   *
   *   'window'  — WHAT CAME IN, AND WHERE DOES IT STAND. Orders that ARRIVED
   *               in `C4:NEW` during the reporting window, at whatever state
   *               they have reached by now. This is the client's own
   *               specification, the day their bot announced the order, and
   *               the day their board still carries it.
   *
   *   'backlog' — WHAT IS WAITING, RIGHT NOW. Every still-open order whose
   *               latest confirmation signal is CONFIRM_NEW, whenever it
   *               arrived. The window is opened to all time, and must be: a
   *               queue that only listed today's arrivals reported nothing to
   *               do on a morning with 265 orders unworked, because the oldest of
   *               them came in a year ago and no preset shorter than «Shu
   *               yil» could reach it. The bell counts this, so the number in
   *               the header and the rows behind it are the same set.
   *
   * ONE DEFINITION, TWO COHORTS. Everything below the cohort — the latest
   * signal, the UNCONFIRMED_SHIPPED refinement, the ROP name, the Tashkent
   * daily number — is shared, so the two readings can never drift apart in
   * how they classify an order. Only which orders enter differs.
   */
  /**
   * The SQL fragment that narrows this whole board to one caller's people.
   *
   * Written once and placed in `classified`, the CTE where the operator is
   * resolved, because every reading of this board — the row list, its
   * pagination count, the five tiles, the ROP panel, the ROP filter's own
   * options, the header bell, the rejection control chart and both of the
   * sellers board's queue queries — is built on top of it. Narrowing anywhere
   * else would be narrowing one of them.
   *
   * NULL IS THE WHOLE COMPANY. An empty array is not: `= ANY('{}')` is false
   * for every row, which is the correct answer for a scope that admits nobody
   * and the reason `rowScopeFor` never produces one by accident.
   */
  private static scopeMatch(param: string): string {
    return `(${param}::text IS NULL OR c.operator_id = ANY(string_to_array(${param}, ',')))`
  }

  /**
   * The scope as one bind value: a comma-joined list, or null for everybody.
   *
   * AN EMPTY LIST IS «NOBODY», NEVER «EVERYBODY». Every other id filter in
   * this codebase is written `ids?.length ? … : no filter`, which is right for
   * a filter the reader chose and catastrophic for one the reader is subject
   * to — the same inversion `NO_EMPLOYEE_IN_SCOPE` exists to stop. `null` here
   * has to be said deliberately, and `[]` resolves to the sentinel, which
   * matches no employee row.
   */
  private static scopeValue(window: ScopedWindow): string | null {
    const ids = window.restrictToEmployeeIds
    if (ids === null) return null
    return ids.length > 0 ? ids.join(',') : NO_EMPLOYEE_IN_SCOPE
  }

  /**
   * @param scopeParam The placeholder carrying the caller's employee scope,
   *   e.g. `'$4'`. REQUIRED, and required with no default: a board that
   *   silently answered for the whole company because a new consumer forgot
   *   this argument is the failure this whole mechanism exists to prevent, and
   *   a missing argument is the one kind the compiler can catch.
   */
  private static queueSql(mode: ConfirmationQueueMode, scopeParam: string): string {
    /*
      Backlog mode narrows the history scan to LIVE orders before aggregating.

      Without a window there is no cheap bound on `moves`, and the signal
      history is six figures of rows. Open deals are a small fraction of the
      table and `deal(status, closedAt)` leads on the column, so this is what
      keeps the bell affordable enough to poll from every screen.
    */
    const liveOnly =
      mode === 'backlog' ? `JOIN "deal" d0 ON d0."id" = h."dealId" AND d0."status" = 'OPEN'` : ''

    /*
      The cohort predicate. Both forms still read $1 and $2 — the caller binds
      an all-time span for the backlog — so the parameter positions every
      reading below depends on stay identical in either mode.
    */
    const cohort =
      mode === 'backlog'
        ? `WHERE a.signal = 'CONFIRM_NEW'
         AND a.queued_at >= $1 AND a.queued_at < $2`
        : `WHERE a.queued_at >= $1
         AND a.queued_at <  $2`

    return `
    /*
      The five stages that speak, resolved once.

      MATERIALIZED is load-bearing, not decoration. Inlined, the planner
      estimates the join badly and picks a parallel sequential scan over all
      216 000 history rows; pinned, it drives five index range scans on
      (stageId, enteredAt). Measured on production: 1 881 ms against 206 ms
      for the same rows.
    */
    WITH signal_stage AS MATERIALIZED (
      SELECT "id", "confirmationSignal" AS signal
        FROM "deal_stage"
       WHERE "confirmationSignal" IS NOT NULL
    ),
    /*
      Every confirmation move from the window's start onwards.

      OPEN ON THE RIGHT, and that is what lets the board show a status rather
      than a snapshot. An order that arrived at 23:50 is worked the next
      morning, and one that arrived on the 31st is decided in the new month;
      closing this at $2 would freeze both as «kutilmoqda». Measured when it
      was closed: «Kecha» showed 96 orders against a true 101, «Oʻtgan oy»
      2 970 against 3 103, and «Shu oy» hid the fault entirely because its end
      is tomorrow and nothing can fall past it.

      The consequence is deliberate: an order's status is its status NOW, not
      the one it happened to hold at midnight on the window's last day. A board
      that answers "what came in last month, and where does each stand" has to
      say where they stand — freezing an order as «kutilmoqda» because that is
      what it was six weeks ago describes nothing anybody can act on.

      LEFT BOUND ONLY, AND IT IS WHAT MAKES queued_at HONEST. The cohort
      below keeps orders whose arrival falls inside the window, so the arrival
      itself is at or after $1 and no scan earlier than $1 can change which
      order enters. Nor can it change the state: every move before $1 is older
      than that arrival, so none of them can win max(moved_at). What the
      bound buys is the whole reason this query is affordable — (stageId,
      enteredAt) range scans instead of a sequential pass over the history.
    */
    moves AS (
      SELECT h."dealId" AS deal_id, h."enteredAt" AS moved_at, ss.signal
        FROM signal_stage ss
        JOIN "deal_stage_history" h
          ON h."stageId" = ss."id"
         AND h."enteredAt" >= $1
        ${liveOnly}
    ),
    /*
      One row per order, at its latest signal.

      THE ORDER IS THE UNIT, not the visit. An order that was queued, refused,
      re-queued and confirmed is one line showing where it stands. Counting
      each visit separately would put the same order in a month three times
      and let «тасдиқланиш %» exceed the number of orders.

      The queue arrival is the LAST one, not the first: an order that came
      back into the queue is being worked from the moment it came back, and a
      waiting time measured from a visit that ended weeks ago describes
      nothing that happened. Null when it was refused without ever being
      queued — which happens, and which the client's bot counts too.
    */
    agg AS (
      SELECT deal_id,
             max(moved_at) AS moved_at,
             max(moved_at) FILTER (WHERE signal = 'CONFIRM_NEW') AS queued_at,
             (array_agg(signal ORDER BY moved_at DESC, signal))[1] AS signal
        FROM moves
       GROUP BY deal_id
    ),
    /*
      THE WINDOW IS THE ARRIVAL IN THE QUEUE — a.queued_at.

      Picking "today" means the orders that reached Тасдиклаш today, which is
      the same set their bot posted to the ROP channels today and the same set
      their own board still shows under today. Verified against the portal
      over three weeks, Tashkent days, distinct deals:

                  Дата создания   last move   arrival    portal (C4:NEW)
        08-31            99          157        125           135 visits
        09-01             1            1          1             1 visit
        09-02            80           93         93            96 visits
        09-03             4            6          1             1 visit

      Only the arrival column tracks the portal. Дата создания undercounts
      because a deal can sit in Регистрация for days before anyone can work
      it; the last move overcounts because it drags every order that merely
      CHANGED today onto today — six deals reached Доставка on 09-03, all of
      them yesterday's orders.

      NOT NULL BY CONSTRUCTION, and that is a second fix riding along. An
      order that never touched C4:NEW has no arrival, so the predicate drops
      it — the ~52 deals that appear straight in C6:NEW, which the bot never
      announced and which their board has never listed. They used to be
      counted here purely because they had a creation date.

      THE LAST ARRIVAL, not the first: an order that comes back into the queue
      is being worked from the day it came back, and their bot agrees — it
      keeps one entry per deal and re-posts under 🔁 ҚАЙТА ТУШДИ. Their board
      carries 2 211 rows for 2 211 distinct deals, never a deal twice.

      created_at stays selected. It is still Дата создания, still shown on
      the row, and still sortable — it just no longer decides who is on the
      board.
    */
    dated AS (
      SELECT a.deal_id, d."createdAtSource" AS created_at, a.moved_at, a.queued_at, a.signal
        FROM agg a
        JOIN "deal" d ON d."id" = a.deal_id
       ${cohort}
    ),
    classified AS (
      SELECT
        d."id" AS deal_id,
        /*
          THE OPERATOR, CARRIED FORWARD RATHER THAN RE-DERIVED.

          The caller's cut is applied two CTEs below — after the daily number
          is minted — so it cannot reach the employee join that resolves this
          person. Projecting the id here is what keeps the scope and the ROP
          name and the operator on the row all naming ONE person: a predicate
          that re-derived COALESCE(...) somewhere else would be a second
          definition of whose order this is, which is the drift the join's own
          comment above exists to prevent.
        */
        e."id" AS operator_id,
        w.created_at,
        w.moved_at,
        w.queued_at,
        CASE WHEN w.signal = 'CONFIRM_NEW' THEN NULL ELSE w.moved_at END AS decided_at,
        /*
          РОП is the department's OWN name with the marker stripped, not its
          head's full name. The client's dashboards print "Sevinch", and the
          head of Sevinch(ROP) is "Usmonova 199 Sevinch" — a different string,
          and the one nobody on the floor uses.

          A department is only a ROP if it says so. Stripping '(ROP)'
          unconditionally printed the raw name of any other department into a
          column headed РОП — Регистрация and Операцион, the two back-office
          units, leaked onto 25 orders and into the ROP filter list.
        */
        /*
          The strip is case-INSENSITIVE, like the ILIKE guard above it.

          ILIKE admitted a department written «Charos(rop)» and the
          case-sensitive replace() then left the marker in place, so the queue
          basis would print «Charos(rop)» where the intake basis
          (sellerBoardRepository.ropOf, a case-insensitive regex) prints
          «Charos» — two spellings of one team on the one screen that renders
          both bases. Every ROP department on this portal writes «(ROP)» in
          capitals today, so this is a divergence waiting on a rename rather
          than a wrong number on screen; the two rules still have to agree.

          THE BACKSLASHES ARE DOUBLED BECAUSE THIS IS A TEMPLATE LITERAL.
          A lone backslash before a parenthesis is not a JavaScript escape, so
          it collapses and Postgres receives a bare capture group round the
          three letters ROP — which matches the letters and leaves the
          parentheses exactly where they were, printing «Sevinch()» on every
          ROP. This very comment must therefore avoid both a backtick and a
          lone backslash, or it terminates the literal it documents. Pinned in
          confirmationQueueSql.test.ts by an assertion on the BUILT string,
          since every other check in that file reads the source and would have
          passed either way.
        */
        CASE
          WHEN dep."name" ILIKE '%(ROP)%'
            THEN NULLIF(btrim(regexp_replace(dep."name", '\\(ROP\\)', '', 'gi')), '')
          ELSE NULL
        END AS rop,
        /*
          Shipped without anyone reaching the customer.

          Arriving in Доставка is a confirmation unless the deal's «Тастиклаш
          анализ» field says «Недозвон булиб чикарилган», which is a fact about
          the deal rather than about the stage — so it refines the signal here
          instead of being a sixth signal nothing could ever set.
        */
        CASE
          WHEN w.signal = 'CONFIRMED' AND d."confirmStatus" = 'UNREACHABLE'
            THEN 'UNCONFIRMED_SHIPPED'
          ELSE w.signal::text
        END AS outcome
      FROM dated w
      JOIN "deal" d ON d."id" = w.deal_id
      /*
        ОПЕРАТОР IS WHO SOLD IT, NOT WHO HOLDS THE ROW TODAY.

        The client's definition of the sellers board is «Тасдиқлаш навбати ->
        barcha buyurtmalar, and the ОПЕРАТОР on the row IS the seller». The
        deal's assignee is not that person: this portal moves deals to back
        office while they are processed, so ASSIGNED_BY_ID drifts. Measured on
        July 2026 — 556 orders sat on the head of Операцион, making him the
        board's number one with 4.2x the client's own leader, and twelve of
        twelve sampled deals named a different, real seller in the portal's own
        snapshot field.

        The operatorEmployeeId column is that snapshot resolved to one of our
        people at import (see domain/employees/floorNumber). COALESCE, because
        the field was added in May 2026 and older cohorts are ~20% empty — a
        deal without it keeps the assignee rather than leaving the board.

        The join lives in the classified CTE, so the confirmation queue and the
        sellers board name the same person for the same order. They are one
        cohort and must not disagree about whose order it is.
      */
      JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")
      LEFT JOIN "department" dep ON dep."id" = e."departmentId"
    ),
    /*
      THE CALLER'S OWN PEOPLE, AND NOBODY ELSE'S.

      One predicate, written once, and the two CTEs below are the only doors
      out of this prelude: every one of the nine readings built on it selects
      from scoped or from visible, never from classified. A ROP given
      «Тасдиклаш» reads their own floor; the tiles above the table, the ROP
      panel beside it and the bell in the header describe the same rows,
      because they ARE the same rows.

      MODE-INDEPENDENT on purpose: window and backlog differ only in which
      orders ENTER the cohort, never in whose they are, and
      confirmationQueueSql.test.ts pins the two tails identical from the
      classified CTE down.

      NO BACKTICK MAY APPEAR IN THIS COMMENT. It lives inside a JavaScript
      template literal, so one would end the string it is documenting — the
      same trap the ROP strip above records for a lone backslash.
    */
    scoped AS (
      SELECT * FROM classified c
       WHERE ${InsightsRepository.scopeMatch(scopeParam)}
    ),
    numbered AS (
      /*
        READ BY TWO CALLERS, NOT SIX. The number is only ever shown on the
        board's own rows, so confirmationOrders and confirmationBoard take
        their rows from visible below, and everything else reads scoped
        above — a window function nobody selects is still sorted and
        computed, and this one runs over the whole cohort.

        UNSCOPED ON PURPOSE, AND IT IS THE ONLY CTE HERE THAT IS. See visible
        below: the number has to be minted over the whole queue day, and the
        caller's cut is applied to the numbered rows rather than before them.
      */
      SELECT
        c.*,
        -- Numbered on the SAME clock the cohort is chosen by. Partitioning
        -- this by the creation day while the board is dated by the arrival
        -- would put two «001»s under one ROP on one screen, because a single
        -- queue day holds arrivals created across several days.
        --
        -- Tashkent, not UTC: the working day is the thing being counted, and
        -- five hours of it would otherwise be numbered into yesterday.
        row_number() OVER (
          PARTITION BY c.rop, (c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${env.APP_TIMEZONE}')::date
          ORDER BY c.queued_at ASC, c.deal_id ASC
        )::int AS daily_no
      FROM classified c
    ),
    /*
      THE NUMBER IS MINTED BEFORE THE CUT, AND THAT ORDER IS THE POINT.

      row_number() above runs over the WHOLE queue day, so 006 is 006 for
      everybody. Cut first and the window would count the rows the reader
      happens to be allowed to see: a seller scoped to themselves would call
      their sixth order «001», and their ROP would call the same order «006»
      — over a label the floor reads out loud, to each other and in the bot's
      Тасдиклаш posts.

      That is not an OWN-only hazard, which is what makes numbering first the
      only honest answer rather than a nicety. c.rop is NULL for every unit
      whose name carries no (ROP) marker, so the partition pools Операцион,
      Регистрация, Навоий and everyone else into ONE group; any scope that
      admits some of those people and not the others slices it, and the whole
      reason the operator column exists is that this portal parks reassigned
      work in exactly those units.

      It costs nothing for the readings that do not show a number. They select
      from scoped, which never mentions numbered, and Postgres does not
      evaluate a CTE nothing references — so the tiles, the ROP panel, the ROP
      options, the bell and the rejection chart still skip the sort and the
      window, which is the measured reason they were pointed away from it.
    */
    visible AS (
      SELECT * FROM numbered c
       WHERE ${InsightsRepository.scopeMatch(scopeParam)}
    )
  `
  }

  /**
   * What the header's bell counts: still waiting, and waiting too long.
   *
   * Built on the SAME cohort the board is, so the bell and the screen it
   * links to can never disagree — a header that says three and a page that
   * shows two is worse than no header. That is not a hypothetical: the bell
   * was left counting `mode: 'backlog'` over an all-time span while its link
   * opened the board on its own window, and the header read 7 over a page
   * that read 2 for a fortnight.
   *
   * NOT TODAY'S WINDOW. `alertsService` passes an all-time span in backlog
   * mode, and what keeps that affordable to fetch from every page every
   * minute is the join to open deals inside `queueSql` — not a narrow date
   * bound, which backlog mode by definition does not have.
   *
   * `overdue` is measured from the order's own arrival in the queue, not from
   * the start of the day: an order that arrived ten minutes ago has not been
   * waiting since midnight.
   *
   * The `queued_at IS NOT NULL` guard below is now implied by the cohort — an
   * order with no arrival is not on the board at all — and it is kept because
   * the comparison beneath it is what the count means, and a reader should
   * not have to prove the null case away before trusting the number.
   */
  async queuePressure(
    period: ScopedWindow,
    overdueAfterMinutes = 120,
    mode: ConfirmationQueueMode = 'window',
  ): Promise<{ pending: number; overdue: number }> {
    const rows = await this.prisma.$queryRawUnsafe<{ pending: bigint; overdue: bigint }[]>(
      `${InsightsRepository.queueSql(mode, '$4')}
       SELECT
         count(*) FILTER (WHERE c.outcome = 'CONFIRM_NEW')::bigint AS pending,
         count(*) FILTER (
           WHERE c.outcome = 'CONFIRM_NEW'
             AND c.queued_at IS NOT NULL
             AND c.queued_at < $3
         )::bigint AS overdue
       /*
         classified, NOT numbered — this reading never shows the day's number.

         numbered adds a row_number() partitioned by ROP and Tashkent day,
         which is a Sort plus a WindowAgg over the whole cohort. Postgres does
         not prune a window function nobody selected, so every reader that took
         its rows from numbered paid for the ordering whether or not it showed
         it. Only the board's own row list and the one-statement board need the
         number; the tiles, the ROP panel, the ROP options, the header bell and
         the rejection chart do not.
       */
       FROM scoped c`,
      period.start,
      period.end,
      new Date(Date.now() - overdueAfterMinutes * 60_000),
      InsightsRepository.scopeValue(period),
    )

    return { pending: int(rows[0]?.pending), overdue: int(rows[0]?.overdue) }
  }

  /** How the window's queue split across the five states. */
  async confirmationOutcomes(
    period: ScopedWindow,
    filter: { rops?: readonly string[]; q?: string } = {},
    mode: ConfirmationQueueMode = 'window',
  ): Promise<ConfirmationOutcomeTotals> {
    const rows = await this.prisma.$queryRawUnsafe<
      { outcome: ConfirmationOutcomeValue; orders: bigint }[]
    >(
      `${InsightsRepository.queueSql(mode, '$5')}
       SELECT c.outcome, count(*)::bigint AS orders
         FROM scoped c
         JOIN "deal" d ON d."id" = c.deal_id
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
        WHERE ${InsightsRepository.ropMatch('$3')}
          ${InsightsRepository.SEARCH_SQL('$4')}
        GROUP BY c.outcome`,
      period.start,
      period.end,
      filter.rops && filter.rops.length > 0 ? [...filter.rops] : null,
      filter.q ?? null,
      InsightsRepository.scopeValue(period),
    )

    // Every state is present with a zero rather than absent. A state missing
    // from the payload would render as an em dash — "not measured" — when the
    // truth is "measured, and none".
    const totals = Object.fromEntries(
      CONFIRMATION_OUTCOMES.map((outcome) => [outcome, 0]),
    ) as Record<ConfirmationOutcomeValue, number>

    for (const row of rows) totals[row.outcome] = int(row.orders)

    return totals
  }

  /**
   * How long an order must have been OUT of the queue for its return to count.
   *
   * SIX HOURS, BECAUSE THAT IS WHAT THE FLOOR READS. The bot marks a return
   * only when its last message about the deal is at least this old, and the
   * mark on this board has to mean what the mark in Telegram means or the two
   * contradict each other in front of the same operator.
   *
   * It is also the right rule on its own terms. Deal 319494 on 2026-09-03
   * entered the queue at 14:40, was confirmed at 14:49, came back at 14:55 and
   * was confirmed again at 14:56 — one person correcting themselves inside a
   * quarter of an hour, which is not a customer who had to be reached twice.
   * Without the threshold this board marked it 🔁 and the bot did not, and the
   * board was the one that was wrong. Thirty days of production hold 220
   * re-entries: 11 inside five minutes, 143 inside six hours, and 66 beyond it.
   */
  private static readonly REPEAT_GAP_HOURS = 6

  /**
   * The order's WHOLE life in the queue — every visit, and how each one ended.
   *
   * ONE ORDER IS STILL ONE ROW. The board is dated by the LAST arrival, so an
   * order confirmed on the 29th and pulled back into Тасдиклаш on the 31st
   * leaves the 29th and lands on the 31st. Deal 834920 did exactly that, and
   * the operator reading the 29th found an order their Telegram channel had
   * announced that morning simply gone — six of the 127 orders that arrived
   * that day moved off it the same way. Splitting the row per visit was the
   * other option and it is the wrong one: their bot and their board both keep
   * one entry per deal, and counting visits would let «тасдиқланиш %» exceed
   * the orders it divides. So the row stays one and carries its own past.
   *
   * IT DECIDES NOTHING, IT ONLY SHOWS. The tiles, the ROP panel, the state
   * filter and the header bell all read `classified.outcome` — the latest
   * signal, unchanged. This list is rendered, never summed: an order
   * confirmed in August and refused in September counts once, as refused.
   * `visits[0]` IS that latest state by construction, which is the invariant
   * the chain in the UI is drawn on and which the SQL test pins.
   *
   * ONE SCAN, NOT TWO. «🔁 ҚАЙТА ТУШДИ» rides along, because a visit list
   * already knows it: `entries` is how many visits there are, `returns` is
   * how many of the gaps between consecutive arrivals clear
   * `REPEAT_GAP_HOURS`, and `previous_at` is the arrival before the last
   * qualifying return — so the tooltip names the visit the mark is about
   * rather than whatever happened most recently. Those three used to be their
   * own LATERAL over the same index range.
   *
   * ON THE PAGE ONLY, and UNBOUNDED BY THE WINDOW — both for the reasons the
   * mark always had. It runs in the decorating join, after the LIMIT, so it
   * costs twenty-five index lookups on (dealId, enteredAt) rather than a
   * second pass over a cohort that can be eighteen thousand orders; and the
   * deal is already known here, so its history is read end to end. It has to
   * be: an order first queued in July and returned this morning is a return,
   * and a window that starts today cannot see the July arrival to compare
   * against — nor show it under the row it now dates.
   */
  private static readonly QUEUE_HISTORY_SQL = `
       LEFT JOIN LATERAL (
         SELECT
           count(*)::int AS entries,
           count(*) FILTER (
             WHERE gap >= interval '${InsightsRepository.REPEAT_GAP_HOURS} hours'
           )::int AS returns,
           max(prev) FILTER (
             WHERE gap >= interval '${InsightsRepository.REPEAT_GAP_HOURS} hours'
           ) AS previous_at,
           /*
             NEWEST FIRST, so the UI renders the chain top-down without having
             to reverse it — and so visits[0] is the state the row is filed
             under everywhere else on the screen.

             EVERY VISIT, NOT ONLY THE ONES 🔁 CALLS RETURNS. That filter was
             written and reverted, and the reason is worth keeping.

             The tempting rule is «show only what the mark counts», so the two
             surfaces on one row can never say different things. It is wrong,
             because REPEAT_GAP_HOURS measures ELAPSED TIME while this board is
             cut into Tashkent days. An order that arrives at 22:00, is
             confirmed at 23:00 and comes back at 01:00 has a two-hour gap and
             no mark — and its row still leaves yesterday for today, because
             the cohort dates it by the last arrival. Filtering on the gap
             hands that operator the bare chip this column exists to replace.

             Nor are two close arrivals always the same state twice. Refused at
             09:00, back at 12:00, waiting now: three hours, no mark, and the
             chain is the only place that refusal — the one the ROP's Telegram
             channel announced that morning — is still readable.

             The mark and the list answer different questions. 🔁 asks whether a
             customer had to be reached twice, which a misclick corrected in
             fifteen minutes did not. The list says where the order stood.
             RepeatMark's own tooltip already prints the raw entry count beside
             the returns-gated mark, so the board has always shown both.
           */
           json_agg(
             json_build_object(
               'no', visit_no,
               'queuedAt', queued_at,
               /*
                 The UNCONFIRMED_SHIPPED refinement applies to the LAST visit
                 alone. «Тастиклаш анализ» is a field on the DEAL describing
                 where it stands now, not something the portal keeps per
                 visit, so reading it onto an August visit would be inventing
                 a fact. Confining it here is also what keeps visits[0]
                 identical to classified.outcome.
               */
               'outcome',
               CASE
                 WHEN outcome = 'CONFIRMED' AND is_last AND d."confirmStatus" = 'UNREACHABLE'
                   THEN 'UNCONFIRMED_SHIPPED'
                 ELSE outcome::text
               END,
               'decidedAt', decided_at
             ) ORDER BY visit_no DESC
           ) AS visits
         FROM (
           SELECT
             v.visit_no, v.queued_at, v.outcome, v.decided_at,
             -- The gap is between CONSECUTIVE arrivals, so a long-dormant
             -- order that bounces twice today is one return and not two.
             lag(v.queued_at) OVER (ORDER BY v.visit_no) AS prev,
             v.queued_at - lag(v.queued_at) OVER (ORDER BY v.visit_no) AS gap,
             -- Nothing came after it, so it is the visit the deal's own
             -- «Тастиклаш анализ» is allowed to refine.
             lead(v.queued_at) OVER (ORDER BY v.visit_no) IS NULL AS is_last
           FROM (
             SELECT
               m.visit_no,
               min(m.entered_at) FILTER (WHERE m.signal = 'CONFIRM_NEW') AS queued_at,
               -- The visit's last word, tie-broken exactly as agg breaks it,
               -- so the newest visit and the row's own outcome cannot differ.
               (array_agg(m.signal ORDER BY m.entered_at DESC, m.signal))[1] AS outcome,
               max(m.entered_at) FILTER (WHERE m.signal <> 'CONFIRM_NEW') AS decided_at
             FROM (
               /*
                 A VISIT IS AN ARRIVAL AND EVERYTHING UNTIL THE NEXT ONE, so
                 the running count of arrivals is the visit number.

                 THE ARRIVAL SORTS LAST WITHIN ONE INSTANT, and that is what
                 decides the only genuinely ambiguous case. Two signal moves
                 stamped in the same second are common — 123 pairs in a month
                 — and in two of them one was an arrival and the other a
                 decision (deals 828090 and 847980, both «Кутармади» landing
                 in the same second as the deal bounced back into the queue).
                 Ordering the arrival after the decision files that decision
                 under the visit it ENDED, rather than under a visit that had
                 not begun. Without the term the answer came from the cuid,
                 which is to say from nothing.

                 The row id keeps the order total after that, so the frame
                 below never has peers to argue about; ROWS is written out
                 because the intent is a running count of rows, and a reader
                 should not have to prove the RANGE default harmless.

                 Rows before the first arrival are visit 0 and are dropped:
                 the ~52 orders that appear straight in C6:NEW have a signal
                 and no queue visit, and the cohort does not carry them either.
               */
               SELECT
                 h."enteredAt" AS entered_at,
                 ss.signal,
                 count(*) FILTER (WHERE ss.signal = 'CONFIRM_NEW') OVER (
                   ORDER BY h."enteredAt", (ss.signal = 'CONFIRM_NEW'), h."id"
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ) AS visit_no
               FROM "deal_stage_history" h
               JOIN signal_stage ss ON ss."id" = h."stageId"
              WHERE h."dealId" = d."id"
             ) m
            WHERE m.visit_no > 0
            GROUP BY m.visit_no
           ) v
         ) visits
       ) rep ON true`

  /**
   * The search box, as one predicate.
   *
   * Shared verbatim between the list and its tiles so a search can never
   * narrow the rows and leave the counts above them describing a wider set.
   * The product term needs its own EXISTS: a deal carries up to four line
   * items and joining them in would multiply the row.
   */
  private static SEARCH_SQL(param: string): string {
    /*
      Every column the table shows, searchable from the one box.

      WHAT IT HAS TO WORK OVER. The three queries that use this predicate join
      different things — the tiles and the ROP panel join only `deal` and
      `customer`, the list also joins employee, stage and source. So the
      predicate may only depend on what ALL THREE have: the `numbered` CTE
      aliased `c`, `d` and `cust`. Everything else is reached by a correlated
      EXISTS rather than an outer join, which keeps one definition of "search"
      instead of three that can drift apart.

      TWO KINDS OF MATCH. Text columns match on a plain substring. Phone and
      amount cannot: the phone is displayed masked and formatted (+99894***0037)
      while the column holds +998944340037, and the amount is displayed
      "1 600 000" while the column holds minor units. Both are compared on
      DIGITS ONLY, so what a person reads on screen and types back finds the
      row. The digits branch is guarded — a query with no digits in it would
      otherwise reduce to '%%' and match every row in the table.
    */
    const digits = `regexp_replace(${param}, '[^0-9]', '', 'g')`
    // The digits before the first '*' and after the last one.
    const head = `regexp_replace(split_part(${param}, '*', 1), '[^0-9]', '', 'g')`
    const tail = `regexp_replace(reverse(split_part(reverse(${param}), '*', 1)), '[^0-9]', '', 'g')`

    return `
          AND (
            ${param}::text IS NULL
            OR d."title" ILIKE '%' || ${param} || '%'
            OR d."orderCode" ILIKE '%' || ${param} || '%'
            OR d."externalId" ILIKE '%' || ${param} || '%'
            OR d."region" ILIKE '%' || ${param} || '%'
            OR d."deliveryAddress" ILIKE '%' || ${param} || '%'
            OR c.rop ILIKE '%' || ${param} || '%'
            OR cust."name" ILIKE '%' || ${param} || '%'
            OR EXISTS (
              SELECT 1 FROM "employee" emp
               WHERE emp."id" = d."employeeId" AND emp."fullName" ILIKE '%' || ${param} || '%'
            )
            OR EXISTS (
              SELECT 1 FROM "sales_source" ss
               WHERE ss."id" = d."sourceId" AND ss."name" ILIKE '%' || ${param} || '%'
            )
            OR EXISTS (
              SELECT 1 FROM "deal_item" di
                JOIN "product" pr ON pr."id" = di."productId"
               WHERE di."dealId" = d."id" AND pr."name" ILIKE '%' || ${param} || '%'
            )
            OR (
              ${digits} <> ''
              AND (
                regexp_replace(
                  COALESCE(array_to_string(cust."phones", ' '), '') || ' ' || COALESCE(cust."phone", ''),
                  '[^0-9]', '', 'g'
                ) LIKE '%' || ${digits} || '%'
                OR (d."amountMinor" / 100)::text LIKE '%' || ${digits} || '%'
              )
            )
            /*
              The MASKED phone, as it appears on screen.

              The column shows +99894***0037 and people search by copying what
              they can see. Digits-only turns that into 998940037, a sequence
              that exists in no phone number, so the obvious search silently
              found nothing. Matched as head AND tail instead — both required
              and both non-empty, or a lone '*' would match every row.
            */
            OR (
              ${param} LIKE '%*%'
              AND ${head} <> ''
              AND ${tail} <> ''
              AND EXISTS (
                SELECT 1
                  FROM unnest(
                    CASE
                      WHEN cust."phones" IS NOT NULL AND array_length(cust."phones", 1) > 0
                        THEN cust."phones"
                      ELSE ARRAY[COALESCE(cust."phone", '')]
                    END
                  ) AS one(num)
                 WHERE regexp_replace(one.num, '[^0-9]', '', 'g') LIKE ${head} || '%'
                   AND regexp_replace(one.num, '[^0-9]', '', 'g') LIKE '%' || ${tail}
              )
            )
          )`
  }

  /**
   * The queue broken down by ROP group.
   *
   * The one cut this page cannot make from the row list: a ROP's rate is a
   * statement about their whole day, and the table in front of the reader is
   * twenty-five rows of it. Follows the search box; the state filter is
   * deliberately NOT applied — the panel exists to compare states across
   * groups, which a state filter would collapse.
   */
  async confirmationByRop(
    period: ScopedWindow,
    filter: ConfirmationCohortFilter = {},
    mode: ConfirmationQueueMode = 'window',
  ): Promise<ConfirmationRopRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        rop: string | null
        orders: bigint
        confirmed: bigint
        no_answer: bigint
        rejected: bigint
        pending: bigint
        unconfirmed_shipped: bigint
        confirmed_amount: MoneyText
        no_answer_amount: MoneyText
        rejected_amount: MoneyText
        pending_amount: MoneyText
        unconfirmed_shipped_amount: MoneyText
      }[]
    >(
      `${InsightsRepository.queueSql(mode, '$4')}
       SELECT
         c.rop AS rop,
         count(*)::bigint AS orders,
         count(*) FILTER (WHERE c.outcome = 'CONFIRMED')::bigint AS confirmed,
         count(*) FILTER (WHERE c.outcome = 'NO_ANSWER')::bigint AS no_answer,
         count(*) FILTER (WHERE c.outcome = 'REJECTED')::bigint AS rejected,
         count(*) FILTER (WHERE c.outcome = 'CONFIRM_NEW')::bigint AS pending,
         count(*) FILTER (WHERE c.outcome = 'UNCONFIRMED_SHIPPED')::bigint AS unconfirmed_shipped,
         /*
           THE SAME FIVE FILTERS, OVER MONEY — and ::text, like every money
           column in this file, because sum(bigint) is numeric and the driver
           does not agree with itself about how to hand one back.

           The column is the deal's OWN amountMinor; a state with no orders
           sums to NULL, which money() in TypeScript reads as zero — the honest
           reading for a tile whose count is also zero.
         */
         sum(d."amountMinor") FILTER (WHERE c.outcome = 'CONFIRMED')::text AS confirmed_amount,
         sum(d."amountMinor") FILTER (WHERE c.outcome = 'NO_ANSWER')::text AS no_answer_amount,
         sum(d."amountMinor") FILTER (WHERE c.outcome = 'REJECTED')::text AS rejected_amount,
         sum(d."amountMinor") FILTER (WHERE c.outcome = 'CONFIRM_NEW')::text AS pending_amount,
         sum(d."amountMinor") FILTER (WHERE c.outcome = 'UNCONFIRMED_SHIPPED')::text
           AS unconfirmed_shipped_amount
       FROM scoped c
       JOIN "deal" d ON d."id" = c.deal_id
       LEFT JOIN "customer" cust ON cust."id" = d."customerId"
      /*
        NULL rops are KEPT, and dropped by the caller instead.

        The tiles are this breakdown summed down its columns, so a row excluded
        here is an order missing from the headline total — and the one
        population most likely to have no ROP is exactly the one worth
        noticing. The filter list drops them; the arithmetic does not.

        REGION AND СУММА NARROW THIS; THE ROP SELECTION DOES NOT — the same
        line the long-window shape draws, and it must stay drawn in the same
        place in both or a month and a year answer differently. A ROP filter
        would collapse this breakdown to the one row the reader picked, and
        comparing the groups is the only reason it exists; region and сумма
        narrow the population being compared without taking the comparison
        away, exactly as the period and the search box already do.
      */
      WHERE ${InsightsRepository.regionMatch('$5')}
        AND ${InsightsRepository.amountRange('$6', '$7')}
        ${InsightsRepository.SEARCH_SQL('$3')}
      GROUP BY c.rop
      ORDER BY orders DESC`,
      period.start,
      period.end,
      filter.q ?? null,
      InsightsRepository.scopeValue(period),
      filter.regions && filter.regions.length > 0 ? [...filter.regions] : null,
      filter.amountMinMinor?.toString() ?? null,
      filter.amountMaxMinor?.toString() ?? null,
    )

    return rows.map((r) => ({
        // A group with no ROP is labelled rather than hidden: it still has to
        // be countable, and "(ROP yoʻq)" is a finding, not a gap.
        rop: r.rop ?? InsightsRepository.NO_ROP,
        orders: int(r.orders),
        confirmed: int(r.confirmed),
        noAnswer: int(r.no_answer),
        rejected: int(r.rejected),
        pending: int(r.pending),
        unconfirmedShipped: int(r.unconfirmed_shipped),
        money: {
          confirmed: money(r.confirmed_amount),
          noAnswer: money(r.no_answer_amount),
          rejected: money(r.rejected_amount),
          pending: money(r.pending_amount),
          unconfirmedShipped: money(r.unconfirmed_shipped_amount),
        },
    }))
  }

  /**
   * The РЕГИОН filter's options — every region present in the window.
   *
   * A QUERY OF ITS OWN, AND FETCHED ONLY WHEN THE POPOVER OPENS. It could have
   * ridden on `confirmationByRop` as a second cut over the same cohort, the way
   * `confirmationLogistics` unions its two, and that was the first design. It
   * was dropped because the cost lands in the wrong place: the board reloads
   * every minute on a screen the floor keeps open all day, and the
   * options change about as often as the portal grows a region. Lazy, this
   * runs once per session behind a spinner nobody waits on; unioned, it would
   * have run several hundred times a day to answer a question nobody asked.
   *
   * IT IGNORES EVERY COLUMN FILTER, INCLUDING ITS OWN. A list narrowed by the
   * selection made in it cannot be un-narrowed — pick «Хорезм» and every other
   * region leaves the list, so the only way back is the address bar. The
   * period, the search box and the caller's scope DO apply: those describe
   * which board is on screen rather than which slice of it.
   *
   * Counts ride along because Excel's own filter prints them and they are free
   * here — a region with four orders is worth telling apart from one with four
   * hundred before you click it.
   */
  async confirmationRegions(
    period: ScopedWindow,
    filter: { q?: string } = {},
    mode: ConfirmationQueueMode = 'window',
  ): Promise<{ region: string; orders: number }[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ region: string; orders: bigint }[]>(
      `${InsightsRepository.queueSql(mode, '$4')}
       SELECT
         coalesce(d."region", '${InsightsRepository.NO_REGION}') AS region,
         count(*)::bigint AS orders
       FROM scoped c
       JOIN "deal" d ON d."id" = c.deal_id
       LEFT JOIN "customer" cust ON cust."id" = d."customerId"
      WHERE TRUE
        ${InsightsRepository.SEARCH_SQL('$3')}
      GROUP BY 1
      ORDER BY orders DESC, 1 ASC`,
      period.start,
      period.end,
      filter.q ?? null,
      InsightsRepository.scopeValue(period),
    )

    return rows.map((r) => ({ region: r.region, orders: int(r.orders) }))
  }

  /**
   * The SELECT this rating runs over `classified`, isolated so its predicates
   * can be pinned by a SQL-shape test without a database — see `queueSql`.
   */
  /**
   * WHAT FAKT 1 IS MADE OF — every cohort order that left the queue WITH an
   * order, which is two of the five states and not one.
   *
   * The floor's own board prints them side by side: ✅ ТАСДИҚЛАНДИ and
   * 🟣 ТАСДИҚЛАНМАЙ ЧИҚДИ (91 and 3 on 2026-09-04). The second is not a
   * refusal — it is `outcome = 'CONFIRMED'` refined by the deal's «Тастиклаш
   * анализ» field reading «Недозвон булиб чикарилган» (see `queueSql`): the
   * operator never reached the customer and the order was dispatched anyway.
   * The goods went out and the money is on the road exactly as the confirmed
   * one's is, so the client counts both in FAKT 1. Only ❌ ТАСДИҚЛАНМАДИ is a
   * loss and it stays outside, with 🕔 Тасдиқлаш and 🟡 Кутармади, which have
   * not left the queue at all.
   *
   * STATED ONCE AND READ SIX TIMES. FAKT 1's money, its order count, «yoʻlda»
   * and «bekor qilindi» all describe the same population from different
   * angles; if one of them still read `= 'CONFIRMED'` the row would carry
   * money no other column on it could account for.
   *
   * The Тасдиқлаш board itself keeps the five states apart — that screen is
   * where an operator reads what happened to one order, and this one is where
   * a manager reads what the floor sold.
   */
  private static readonly FAKT1_OUTCOMES = `c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')`

  /**
   * FAKT 2 — «Доставланди» — written once, for the same reason FAKT 1 is.
   *
   * The reasoning is above ratingSql's delivered_orders: a plain WON status is
   * not a delivery. Nine stages across nine pipelines carry category WON and
   * two of them hold real deals that never went anywhere near a courier, so
   * FAKT 2 is the Доставка funnel's own end stage and nothing else. It is read
   * from the deal's CURRENT stage, the way the kanban is read — an order
   * delivered and then bounced back out is not delivered money today.
   *
   * TAKES THE COLUMN because two queries reach the same fact by different
   * routes: the sellers board joins deal_stage as ds, and the logistics cohort
   * has already projected the role onto its own row. Passing the column keeps
   * ONE definition of what FAKT 2 is while letting each caller name it the way
   * its own FROM clause can see it — and it leaves the sellers board's built
   * SQL byte-identical, so the three tests that assert on that string are
   * untouched.
   */
  private static faktDeliveredSql(roleColumn: string): string {
    return `${roleColumn} = 'DELIVERED'`
  }

  private static ratingSql(filterClause: string): string {
    return `
       SELECT
         e."id" AS employee_id,
         e."fullName" AS full_name,
         c.rop AS rop,
         /*
           EVERY ORDER THIS OPERATOR HAS IN THE COHORT.

           The client's definition of this board is «Тасдиқлаш навбати ->
           BARCHA BUYURTMALAR, and the ОПЕРАТОР on the row is the seller», so
           the board owes the reader the same population the queue page shows.
           Without this column the two screens print 2 874 and 3 228 for one
           August with nothing on either saying the first counts only the
           confirmed ones.
         */
         count(*)::bigint AS cohort_orders,
         count(*) FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})::bigint AS confirmed_orders,
         sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})::text AS confirmed,
         /*
           FAKT 2 IS A DELIVERY, NOT ANY WON.

           The client's words: "if that order has moved to «Завершить сделку»,
           it is entered as FAKT 2". «Завершить сделку» is the Доставка
           kanban's end drop-zone, and dropping a deal there lands it in
           C6:WON «Доставлено» — verified against the portal with
           crm.dealcategory.stage.list.

           A plain WON status is NOT that. Nine stages across nine pipelines
           carry category WON, and two of them hold real deals that never went
           near a courier: «База · Успешно» (C10:WON, the retention kanban's
           own success, 1 707 deals) and «Регистрация · Сделка успешна», the
           automation stamp that HANDS a lead to Тасдиқлаш — the opposite end
           of the funnel. Measured over this cohort all-time: 41 База rows
           worth 56 900 000 soʻm and 33 Регистрация rows worth nothing but
           inflating the delivered COUNT, which drives conversion. August
           alone carried 3 (6 300 000 soʻm) and April 26 (33 550 000).

           The DELIVERED logistics role is the mapping's own name for the
           three stages that mean a courier arrived — C6:WON, C14:WON and
           C14:UC_WFN8MP — and it is read from the deal's CURRENT stage, the
           way their kanban is read. An order delivered and then bounced back
           out is not delivered money today: of 19 such orders in August, 7
           had gone to «Отказ предварительно» and 11 back to a hub.
         */
         count(*) FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')})::bigint AS delivered_orders,
         sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')})::text AS delivered,
         /*
           «Yoʻlda» MEANS STILL MOVING, so a dead order may not sit in it.

           The predicate used to be "confirmed and not won", which counts a
           deal the seller confirmed and then LOST as live work the seller is
           carrying. In July that was 102 orders and 176 230 000 soʻm — a
           fifth of the money the screen labelled in-transit. The two are now
           separate measures, because "still on the road" and "confirmed, then
           refused" are different facts about a seller's month and only the
           second one is a loss.
         */
         count(*) FILTER (
           WHERE ${InsightsRepository.FAKT1_OUTCOMES} AND ds."logisticsRole" IS DISTINCT FROM 'DELIVERED'
             AND d."status" = 'OPEN'
         )::bigint AS in_transit_orders,
         sum(d."amountMinor") FILTER (
           WHERE ${InsightsRepository.FAKT1_OUTCOMES} AND ds."logisticsRole" IS DISTINCT FROM 'DELIVERED'
             AND d."status" = 'OPEN'
         )::text AS in_transit,
         count(*) FILTER (
           WHERE ${InsightsRepository.FAKT1_OUTCOMES} AND ds."logisticsRole" IS DISTINCT FROM 'DELIVERED'
             AND d."status" = 'LOST'
         )::bigint AS lost_after_confirm_orders,
         sum(d."amountMinor") FILTER (
           WHERE ${InsightsRepository.FAKT1_OUTCOMES} AND ds."logisticsRole" IS DISTINCT FROM 'DELIVERED'
             AND d."status" = 'LOST'
         )::text AS lost_after_confirm,
         count(*) FILTER (WHERE c.outcome = 'REJECTED')::bigint AS rejected_orders
       FROM scoped c
       JOIN "deal" d ON d."id" = c.deal_id
       JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")
       LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"
       WHERE TRUE
         ${filterClause}
       GROUP BY e."id", e."fullName", c.rop
       /*
         EVERY OPERATOR IN THE COHORT, including one whose whole month was
         refusals.

         The gate used to be "confirmed > 0 OR delivered > 0", which is what
         the client's own published page does (it drops rows with no FAKT 2).
         Their stated model does not: the ОПЕРАТОР on a «barcha buyurtmalar»
         row IS the seller, and a seller who took nine orders in July and had
         all nine refused is exactly the row a floor manager needs. Seven
         operators and 29 orders were invisible that month, four of them in
         real (ROP) sales teams — and their 28 refusals were also missing from
         the conversion rate's denominator, flattering the whole board.
       */
       HAVING count(*) > 0
       ORDER BY sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')}) DESC NULLS LAST`
  }

  /**
   * The same filter grammar `SellerBoardRepository` speaks, reimplemented
   * rather than imported: the two repositories stay independent, and this is
   * four conditions, not a framework.
   */
  private static ratingFilterSql(filters: ConfirmationSellerRatingFilters, params: unknown[]): string {
    const conditions: string[] = []

    if (filters.restrictToEmployeeIds?.length) {
      params.push(filters.restrictToEmployeeIds.join(','))
      conditions.push(`e."id" = ANY(string_to_array($${params.length}, ','))`)
    }
    if (filters.employeeIds?.length) {
      params.push(filters.employeeIds.join(','))
      conditions.push(`e."id" = ANY(string_to_array($${params.length}, ','))`)
    }
    if (filters.departmentIds?.length) {
      params.push(filters.departmentIds.join(','))
      conditions.push(`e."departmentId" = ANY(string_to_array($${params.length}, ','))`)
    }
    if (filters.sourceIds?.length) {
      params.push(filters.sourceIds.join(','))
      conditions.push(`d."sourceId" = ANY(string_to_array($${params.length}, ','))`)
    }

    return conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`
  }

  /**
   * Sotuvchilar reytingi, rebuilt on the confirmation queue instead of order
   * intake — one row per operator, FAKT 1 and FAKT 2 as the floor names them.
   *
   * SAME COHORT AS THE QUEUE, on purpose: `SellerBoardService` calls this and
   * `confirmationOrders`/`confirmationBoard` for the SAME period and they must
   * count the same orders, or the rating and the board it is drawn from would
   * disagree about who is even in it.
   *
   * `countsAsRevenue` is DELIBERATELY NOT NAMED HERE, unlike every other money
   * query in this file. It would not change the total: every deal that reaches
   * this cohort arrived via a confirmation-signal stage in pipeline 4, 6 or
   * 12, none of which is «#10 База» — the duplicate the flag exists to
   * exclude is a separate deal row Bitrix creates later and that row never
   * touches a signal stage, so it can never enter `classified`. What the flag
   * WOULD do here is wrong: pipelines 4 and 12 are not revenue pipelines, so
   * filtering on it would silently drop every still-queued and every refused
   * order — the two states «barcha buyurtmalar» exists to show.
   */
  async confirmationSellerRating(
    period: ScopedWindow,
    filters: ConfirmationSellerRatingFilters = {},
  ): Promise<ConfirmationSellerRatingRow[]> {
    /*
      THE SCOPE IS BOUND BEFORE THE FILTERS, AND THAT ORDER IS LOAD-BEARING.

      `queueSql` needs its placeholder while the string is being built, and
      `ratingFilterSql` numbers whatever it pushes from the length of the array
      it is handed. Binding the scope first gives it the fixed slot $3 and
      leaves the caller's own filters at $4 onwards, where they were. Pushing
      it afterwards would give the scope a position that moved with the number
      of filters the reader happened to set — and the prelude would have had to
      guess it.
    */
    const params: unknown[] = [period.start, period.end, InsightsRepository.scopeValue(period)]
    const filterClause = InsightsRepository.ratingFilterSql(filters, params)

    const rows = await this.prisma.$queryRawUnsafe<
      {
        employee_id: string
        full_name: string
        rop: string | null
        cohort_orders: bigint
        confirmed_orders: bigint
        confirmed: MoneyText
        delivered_orders: bigint
        delivered: MoneyText
        in_transit_orders: bigint
        in_transit: MoneyText
        lost_after_confirm_orders: bigint
        lost_after_confirm: MoneyText
        rejected_orders: bigint
      }[]
    >(
      `${InsightsRepository.queueSql('window', '$3')}${InsightsRepository.ratingSql(filterClause)}`,
      ...params,
    )

    return rows.map((r) => ({
      employeeId: r.employee_id,
      fullName: r.full_name,
      rop: r.rop,
      cohortOrders: int(r.cohort_orders),
      confirmedOrders: int(r.confirmed_orders),
      confirmedMinor: money(r.confirmed),
      deliveredOrders: int(r.delivered_orders),
      deliveredMinor: money(r.delivered),
      inTransitOrders: int(r.in_transit_orders),
      inTransitMinor: money(r.in_transit),
      lostAfterConfirmOrders: int(r.lost_after_confirm_orders),
      lostAfterConfirmMinor: money(r.lost_after_confirm),
      rejectedOrders: int(r.rejected_orders),
    }))
  }

  /**
   * The per-day series, isolated for the same reason `ratingSql` is: it has to
   * be pinned against the board's own predicates without a database.
   *
   * IT IS THE SAME TWO FACTS, SPREAD OVER DAYS — so it has to be measured the
   * same way, and it was not. The chart under an expanded row graded FAKT 2 on
   * `d."status" = 'WON'` while the row above it graded on the deal's CURRENT
   * stage carrying the DELIVERED logistics role, and it named the operator
   * with a bare `d."employeeId"` while the row was minted by
   * `COALESCE(d."operatorEmployeeId", d."employeeId")`. Two definitions of one
   * column and two definitions of one person, on one screen.
   *
   * Neither divergence is theoretical. `status = 'WON'` admits «База · Успешно»
   * (C10:WON) and the «Регистрация · Сделка успешна» stamp — nine stages across
   * nine pipelines carry WON and only three mean a courier arrived — and it
   * keeps an order that was delivered and then bounced back out. The operator
   * column drifts because this portal moves deals to back office while they
   * are processed. Measured on production 2026-09-04 over «Oʻtgan oy», the two
   * agreed for 18 of the top 19 sellers and disagreed for one — Sirojov 115
   * Davlatbek, 1 000 000 soʻm of FAKT 1 the chart could not see, because the
   * order sat on somebody else's row. On the local fixtures, where deals are
   * OPEN inside a delivered stage, the whole FAKT 2 series read flat zero.
   *
   * A chart that quietly answers a different question than the row it hangs
   * under is worse than no chart: nobody reconciles what they cannot see.
   */
  private static ratingDaysSql(): string {
    return `
       SELECT
         (c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${env.APP_TIMEZONE}')::date::text AS date,
         count(*) FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})::bigint AS orders,
         sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})::text AS confirmed,
         sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')})::text AS delivered
       FROM scoped c
       JOIN "deal" d ON d."id" = c.deal_id
       LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"
       WHERE COALESCE(d."operatorEmployeeId", d."employeeId") = $3
       GROUP BY 1
       -- The same gate as the board: a day whose only money was delivered
       -- without a confirmation still belongs to FAKT 2's series.
       HAVING count(*) FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES}) > 0
           OR count(*) FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')}) > 0
       ORDER BY 1`
  }

  /**
   * One operator's daily arrivals into the confirmation queue — the queue
   * basis's counterpart to `SellerBoardRepository.sellerDays`.
   *
   * Dated by `queued_at`, not `createdAtSource`: see `queueSql` for why the
   * arrival in C4:NEW is the only date that tracks the client's own board.
   */
  async confirmationSellerRatingDays(
    period: ScopedWindow,
    employeeId: string,
  ): Promise<{ date: string; confirmedMinor: bigint; deliveredMinor: bigint; orders: number }[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { date: string; confirmed: MoneyText; delivered: MoneyText; orders: bigint }[]
    >(
      /*
        The requested seller is narrowed by the prelude, not checked here.

        `classified` has already dropped every operator outside the caller's
        scope, so asking for a colleague on another floor returns an empty
        series rather than their days — the same fail-closed shape
        `deals/[id]` gets from putting the scope in its WHERE clause instead of
        comparing after the read.
      */
      `${InsightsRepository.queueSql('window', '$4')}${InsightsRepository.ratingDaysSql()}`,
      period.start,
      period.end,
      employeeId,
      InsightsRepository.scopeValue(period),
    )

    return rows.map((r) => ({
      date: r.date,
      orders: int(r.orders),
      confirmedMinor: money(r.confirmed),
      deliveredMinor: money(r.delivered),
    }))
  }

  /**
   * The FAKT 1 / FAKT 2 series behind the hero chart on Savdo dinamikasi.
   *
   * Isolated from the query for the same reason `ratingSql` and
   * `ratingDaysSql` are: it has to be pinned against the board's own
   * predicates without a database. See `confirmationFaktTrendSql.test.ts`.
   *
   * NOT `ratingDaysSql` WITH THE `$3` DROPPED. That one answers "one
   * operator's days" and pins the seller at a fixed placeholder; this answers
   * "the floor's days" under whatever the reader has filtered to, which needs
   * the employee joined rather than compared. The two share every predicate
   * that decides what FAKT 1 and FAKT 2 mean, and nothing else.
   */
  private static faktTrendSql(filterClause: string): string {
    return `
       SELECT
         (c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${env.APP_TIMEZONE}')::date::text AS date,
         count(*) FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})::bigint AS orders,
         sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})::text AS confirmed,
         sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')})::text AS delivered
       FROM scoped c
       JOIN "deal" d ON d."id" = c.deal_id
       /*
         INNER, and joined on the operator the portal snapshotted — the same
         person ratingSql groups by. ratingFilterSql writes e."id" and
         e."departmentId", so without this join an employee or department
         filter would not be an unfiltered chart, it would be a syntax error;
         and reading the row-holder instead would put the 556-orders-on-the-
         head-of-Операцион class of deal on the wrong side of a team filter.
       */
       JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")
       LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"
       WHERE TRUE
         ${filterClause}
       GROUP BY 1
       -- The same gate as the per-seller series: a day whose only money was
       -- delivered without a confirmation still belongs to FAKT 2's line, and
       -- dropping it would break the chart exactly where the two cross.
       HAVING count(*) FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES}) > 0
           OR count(*) FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')}) > 0
       ORDER BY 1`
  }

  /**
   * The whole floor's daily arrivals into the confirmation queue — FAKT 1 and
   * FAKT 2 per day, for the chart the two totals sit under.
   *
   * Dated by `queued_at` like every other figure on the queue basis, which is
   * NOT the clock the revenue area on that same chart is drawn on. The screen
   * says so; see `RevenueTrendChart` and `FaktBasisNote`.
   *
   * ONLY THE DAYS THAT CARRY ORDERS come back, as with the per-seller series.
   * Zero-filling a time axis is the caller's job, because only the caller
   * knows which buckets the chart is drawn on.
   */
  async confirmationFaktDays(
    period: ScopedWindow,
    filters: ConfirmationSellerRatingFilters = {},
  ): Promise<{ date: string; confirmedMinor: bigint; deliveredMinor: bigint; orders: number }[]> {
    // Scope first, at the fixed slot $3 — same reason as
    // `confirmationSellerRating`: `queueSql` needs its placeholder while the
    // string is being built, and the caller's filters number from $4 onwards.
    const params: unknown[] = [period.start, period.end, InsightsRepository.scopeValue(period)]
    const filterClause = InsightsRepository.ratingFilterSql(filters, params)

    const rows = await this.prisma.$queryRawUnsafe<
      { date: string; confirmed: MoneyText; delivered: MoneyText; orders: bigint }[]
    >(
      `${InsightsRepository.queueSql('window', '$3')}${InsightsRepository.faktTrendSql(filterClause)}`,
      ...params,
    )

    return rows.map((r) => ({
      date: r.date,
      orders: int(r.orders),
      confirmedMinor: money(r.confirmed),
      deliveredMinor: money(r.delivered),
    }))
  }

  /**
   * The month-by-month record wall behind the sellers' television.
   *
   * ONE STATEMENT, NOT ONE PER MONTH. Asking `confirmationSellerRating` for
   * each calendar month in turn would reuse tested code and guarantee the wall
   * agrees with the board — a real argument in this file, where two
   * definitions of one column is the recurring bug. It is still wrong here:
   * every call rebuilds the whole `queueSql` cohort for its own window
   * (~0.9 s a month, measured on production), so a year of records is a dozen
   * cohort constructions and eleven seconds of a single vCPU held open. The
   * cohort is built ONCE and cut by month instead, and the agreement is bought
   * back by sharing the predicates literally: `FAKT1_OUTCOMES`, the
   * `logisticsRole = 'DELIVERED'` test and the
   * `COALESCE(d."operatorEmployeeId", d."employeeId")` operator are the same
   * expressions `ratingSql` uses, pinned by `confirmationRecordsSql.test.ts`.
   *
   * THE ORDER IS THE PODIUM'S ORDER, and it has to be. FAKT 2 first and
   * FAKT 1 only when nobody delivered is the client's own rule, already
   * spelled out on `PodiumHero`; a wall that ranked the other way would print
   * one champion in the header and a different one on the seat below it, on
   * the same screen, for the same month.
   *
   * A MONTH OF PURE REFUSALS IS NOT A RECORD. `ratingSql` deliberately keeps
   * an operator whose every order was refused — a floor manager needs that
   * row, and its refusals belong in the conversion denominator. This is a
   * different question: the gate here is FAKT 1 or FAKT 2 above zero, because
   * "the biggest month anyone has had" cannot be answered with nothing sold.
   *
   * The tie-break is the employee id rather than the name. Two operators level
   * to the soʻm is not something this floor produces, but a wall that reorders
   * itself between two polls of identical data would look broken, and a name
   * collates differently under 'uz' and 'ru' (see `branches.ts`).
   */
  async confirmationSellerRecords(
    period: ScopedWindow,
    filters: ConfirmationSellerRatingFilters = {},
  ): Promise<ConfirmationMonthlyRecordRow[]> {
    // Scope first, at the fixed slot $3 — same reason as
    // `confirmationSellerRating`: `queueSql` needs its placeholder while the
    // string is being built, and the caller's filters number from $4 onwards.
    const params: unknown[] = [period.start, period.end, InsightsRepository.scopeValue(period)]
    const filterClause = InsightsRepository.ratingFilterSql(filters, params)

    const rows = await this.prisma.$queryRawUnsafe<
      {
        month: string
        employee_id: string
        full_name: string
        rop: string | null
        confirmed_orders: bigint
        confirmed: MoneyText
        delivered_orders: bigint
        delivered: MoneyText
      }[]
    >(
      `${InsightsRepository.queueSql('window', '$3')}${InsightsRepository.recordsSql(filterClause)}`,
      ...params,
    )

    return rows.map((r) => ({
      month: r.month,
      employeeId: r.employee_id,
      fullName: r.full_name,
      rop: r.rop,
      confirmedOrders: int(r.confirmed_orders),
      confirmedMinor: money(r.confirmed),
      deliveredOrders: int(r.delivered_orders),
      deliveredMinor: money(r.delivered),
    }))
  }

  /**
   * Isolated for the same reason `ratingSql` and `ratingDaysSql` are: it has
   * to be pinned against the board's own predicates without a database.
   */
  private static recordsSql(filterClause: string): string {
    const month = `date_trunc('month', c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${env.APP_TIMEZONE}')::date`
    const fakt1 = `sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})`
    const fakt2 = `sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')})`

    return `
       SELECT m.month::text AS month,
              m.employee_id,
              m.full_name,
              m.rop,
              m.confirmed_orders,
              m.confirmed::text AS confirmed,
              m.delivered_orders,
              m.delivered::text AS delivered
       FROM (
         SELECT
           ${month} AS month,
           e."id" AS employee_id,
           e."fullName" AS full_name,
           c.rop AS rop,
           count(*) FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})::bigint AS confirmed_orders,
           ${fakt1} AS confirmed,
           count(*) FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')})::bigint AS delivered_orders,
           ${fakt2} AS delivered,
           /*
             The podium's rule, as a window: FAKT 2 decides, FAKT 1 decides
             the months nobody has delivered in yet — which is every month
             still in progress, because delivery lags confirmation by days.
           */
           row_number() OVER (
             PARTITION BY ${month}
             ORDER BY ${fakt2} DESC NULLS LAST,
                      ${fakt1} DESC NULLS LAST,
                      e."id"
           ) AS place
         FROM scoped c
         JOIN "deal" d ON d."id" = c.deal_id
         JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")
         LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"
         WHERE TRUE
           ${filterClause}
         GROUP BY 1, e."id", e."fullName", c.rop
         -- A month of pure refusals is a row on the board and not a record.
         HAVING count(*) FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES}) > 0
             OR count(*) FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')}) > 0
       ) m
       WHERE m.place = 1
       ORDER BY m.month DESC`
  }

  /** One page of the queue, newest first by default. */
  /**
   * The whole board in one statement: the page, its total, and the ROP panel.
   *
   * WHY ONE STATEMENT. The page and the panel used to be two queries fired
   * together, and each rebuilt the cohort — every order in the window, its
   * latest signal, its number in the day — from scratch. For a month that was
   * two seconds of duplicated work; for a year, where the cohort is eighteen
   * thousand orders, the two ran the single core against each other and the
   * request died on the twenty-second statement timeout. «Shu yil» was a 500.
   *
   * Here `numbered` is referenced twice inside one statement, which Postgres
   * materialises exactly once, and both readings are taken from it. Measured
   * on production against the two-query shape: [see commit].
   *
   * THE TWO READINGS DIFFER ON PURPOSE. The page obeys every filter — state,
   * ROP, search. The panel obeys the search and nothing else: it is what the
   * five tiles above the table are summed from, and a band whose numbers
   * changed to match its own selection could not be used to compare one
   * state against another, which is the only reason to put five of them side
   * by side.
   *
   * The page is cut BEFORE it is dressed: filter, sort and LIMIT run over the
   * bare cohort, and only the fifty survivors are joined to their customer,
   * operator, stage, source and line items. Both readings come back as JSON
   * so a single row can carry two differently-shaped lists; timestamps arrive
   * as ISO text without a zone and are read back as the UTC they are.
   */
  async confirmationBoard(
    period: ScopedWindow,
    query: ConfirmationOrderQuery,
    mode: ConfirmationQueueMode = 'window',
  ): Promise<{ totalItems: number; rows: ConfirmationOrderRow[]; byRop: ConfirmationRopRow[] }> {
    // Allowlisted, never interpolated from the request: this reaches SQL.
    // Columns of `filtered`, which carries the two deal fields a sort may need.
    const sortColumn: Record<ConfirmationOrderSortValue, string> = {
      createdAt: 'created_at',
      movedAt: 'moved_at',
      queuedAt: 'queued_at',
      decidedAt: 'decided_at',
      amountMinor: 'amount_minor_sort',
      title: 'title_sort',
    }
    const direction = query.order === 'asc' ? 'ASC' : 'DESC'
    const offset = (query.page - 1) * query.pageSize
    // The deal id breaks ties, so paging cannot show one order twice and skip
    // another when a thousand rows share a sort value.
    const order = `${sortColumn[query.sort]} ${direction} NULLS LAST, deal_id ASC`

    type PageJson = {
      pos: number
      deal_id: string
      rop: string | null
      daily_no: number
      bitrix_id: string | null
      order_code: string | null
      title: string
      customer_name: string | null
      customer_phones: string | null
      employee_name: string
      products: string | null
      region: string | null
      delivery_address: string | null
      source_name: string | null
      amount_minor: MoneyText
      currency: string
      stage_name: string
      outcome: ConfirmationOutcomeValue
      created_at: string
      moved_at: string
      queued_at: string | null
      decided_at: string | null
      queue_entries: number
      queue_returns: number
      previous_queued_at: string | null
      visits: VisitJson[] | null
    }
    type RopJson = {
      rop: string | null
      orders: number
      confirmed: number
      no_answer: number
      rejected: number
      pending: number
      unconfirmed_shipped: number
      /*
        TEXT INSIDE THE JSON, unlike the counts beside it.

        These arrive through `json_agg`, so a numeric would be parsed by
        `JSON.parse` as a double — and a year of this cohort in minor units
        runs past the fifteen digits a double keeps exactly. The counts are
        safe as numbers; money never is.
      */
      confirmed_amount: MoneyText
      no_answer_amount: MoneyText
      rejected_amount: MoneyText
      pending_amount: MoneyText
      unconfirmed_shipped_amount: MoneyText
    }

    const rows = await this.prisma.$queryRawUnsafe<
      { total_items: bigint; page: PageJson[]; by_rop: RopJson[] }[]
    >(
      `${InsightsRepository.queueSql(mode, '$8')},
       filtered AS (
         SELECT
           c.deal_id, c.rop, c.daily_no, c.outcome,
           c.created_at, c.moved_at, c.queued_at, c.decided_at,
           d."amountMinor" AS amount_minor_sort,
           d."title" AS title_sort
         FROM visible c
         JOIN "deal" d ON d."id" = c.deal_id
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
        -- NULL, not an empty array: ANY over an empty array is false for every
        -- row, so an empty selection would render an empty table rather than
        -- the whole queue.
        WHERE ($3::text[] IS NULL OR c.outcome = ANY($3::text[]))
          AND ${InsightsRepository.ropMatch('$5')}
          AND ${InsightsRepository.regionMatch('$9')}
          AND ${InsightsRepository.amountRange('$10', '$11')}
          ${InsightsRepository.SEARCH_SQL('$4')}
       ),
       page AS (
         SELECT f.*, row_number() OVER (ORDER BY ${order})::int AS pos
           FROM filtered f
          ORDER BY ${order}
          LIMIT $6 OFFSET $7
       ),
       decorated AS (
         SELECT
           p.pos,
           d."id" AS deal_id,
           p.rop,
           p.daily_no,
           d."externalId" AS bitrix_id,
           d."orderCode" AS order_code,
           d."title" AS title,
           cust."name" AS customer_name,
           -- Joined to text and split in TS: a text[] round-trips differently
           -- depending on the driver, a delimiter does not.
           array_to_string(
             CASE
               WHEN cust."phones" IS NOT NULL AND array_length(cust."phones", 1) > 0
                 THEN cust."phones"
               WHEN cust."phone" IS NOT NULL THEN ARRAY[cust."phone"]
               ELSE ARRAY[]::text[]
             END, E'\n') AS customer_phones,
           e."fullName" AS employee_name,
           items.products AS products,
           d."region" AS region,
           d."deliveryAddress" AS delivery_address,
           src."name" AS source_name,
           d."amountMinor"::text AS amount_minor,
           d."currency" AS currency,
           st."name" AS stage_name,
           p.outcome,
           p.created_at, p.moved_at, p.queued_at, p.decided_at,
           rep.entries AS queue_entries,
           rep.returns AS queue_returns,
           rep.previous_at AS previous_queued_at,
           rep.visits AS visits
         FROM page p
         JOIN "deal" d ON d."id" = p.deal_id
         JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")
         JOIN "deal_stage" st ON st."id" = d."stageId"
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
         LEFT JOIN "sales_source" src ON src."id" = d."sourceId"
         -- LATERAL, not a join: four line items would otherwise become four
         -- rows and the pager would count the same order four times.
         LEFT JOIN LATERAL (
           SELECT string_agg(pr."name" || ' - ' || di."quantity"::text || ' ta', E'\\n' ORDER BY pr."name") AS products
             FROM "deal_item" di
             JOIN "product" pr ON pr."id" = di."productId"
            WHERE di."dealId" = d."id"
         ) items ON true
         ${InsightsRepository.QUEUE_HISTORY_SQL}
       ),
       by_rop AS (
         SELECT
           c.rop,
           count(*)::int AS orders,
           count(*) FILTER (WHERE c.outcome = 'CONFIRMED')::int AS confirmed,
           count(*) FILTER (WHERE c.outcome = 'NO_ANSWER')::int AS no_answer,
           count(*) FILTER (WHERE c.outcome = 'REJECTED')::int AS rejected,
           count(*) FILTER (WHERE c.outcome = 'CONFIRM_NEW')::int AS pending,
           count(*) FILTER (WHERE c.outcome = 'UNCONFIRMED_SHIPPED')::int AS unconfirmed_shipped,
           -- The five state tiles' money, measured here so the long-window
           -- shape returns exactly what the two-query shape does.
           sum(d."amountMinor") FILTER (WHERE c.outcome = 'CONFIRMED')::text AS confirmed_amount,
           sum(d."amountMinor") FILTER (WHERE c.outcome = 'NO_ANSWER')::text AS no_answer_amount,
           sum(d."amountMinor") FILTER (WHERE c.outcome = 'REJECTED')::text AS rejected_amount,
           sum(d."amountMinor") FILTER (WHERE c.outcome = 'CONFIRM_NEW')::text AS pending_amount,
           sum(d."amountMinor") FILTER (WHERE c.outcome = 'UNCONFIRMED_SHIPPED')::text
             AS unconfirmed_shipped_amount
         FROM visible c
         JOIN "deal" d ON d."id" = c.deal_id
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
        /*
          NULL rops are KEPT and dropped by the caller: the tiles are this
          breakdown summed down its columns, so a row excluded here is an
          order missing from the headline total.

          REGION AND СУММА NARROW THIS; THE ROP SELECTION DOES NOT. The line
          is not arbitrary — a ROP filter would collapse this breakdown to the
          one row the reader selected, and comparing the groups is the only
          reason it exists. Region and сумма narrow the population being
          compared without taking the comparison away, exactly as the period
          and the search box already do. The tiles are these rows added up, so
          this is also what makes the band follow the two new filters.
        */
        WHERE ${InsightsRepository.regionMatch('$9')}
          AND ${InsightsRepository.amountRange('$10', '$11')}
          ${InsightsRepository.SEARCH_SQL('$4')}
        GROUP BY c.rop
       )
       SELECT
         (SELECT count(*) FROM filtered)::bigint AS total_items,
         (SELECT coalesce(json_agg(x ORDER BY x.pos), '[]'::json) FROM decorated x) AS page,
         (SELECT coalesce(json_agg(r ORDER BY r.orders DESC), '[]'::json) FROM by_rop r) AS by_rop`,
      period.start,
      period.end,
      query.outcomes && query.outcomes.length > 0 ? [...query.outcomes] : null,
      query.q ?? null,
      query.rops && query.rops.length > 0 ? [...query.rops] : null,
      query.pageSize,
      offset,
      InsightsRepository.scopeValue(period),
      query.regions && query.regions.length > 0 ? [...query.regions] : null,
      query.amountMinMinor?.toString() ?? null,
      query.amountMaxMinor?.toString() ?? null,
    )

    const row = rows[0]

    return {
      totalItems: int(row?.total_items ?? 0n),
      rows: (row?.page ?? []).map((r) => {
        const queuedAt = utcText(r.queued_at)
        const decidedAt = utcText(r.decided_at)
        return {
          dealId: r.deal_id,
          rop: r.rop,
          dailyNo: r.daily_no,
          bitrixId: r.bitrix_id,
          orderCode: r.order_code,
          title: r.title,
          customerName: r.customer_name,
          customerPhones:
            r.customer_phones === null || r.customer_phones === ''
              ? []
              : r.customer_phones.split('\n'),
          employeeName: r.employee_name,
          products: r.products === null ? [] : r.products.split('\n'),
          region: r.region,
          deliveryAddress: r.delivery_address,
          sourceName: r.source_name,
          amountMinor: money(r.amount_minor),
          currency: r.currency,
          stageName: r.stage_name,
          outcome: r.outcome,
          createdAt: utcText(r.created_at)!,
          movedAt: utcText(r.moved_at)!,
          queuedAt,
          decidedAt,
          queueEntries: r.queue_entries,
          queueReturns: r.queue_returns,
          previousQueuedAt: utcText(r.previous_queued_at),
          queueHistory: visits(r.visits),
          // Both ends or nothing: an order refused without ever being queued
          // has no waiting time, and zero would read as "decided instantly".
          hoursToDecide:
            decidedAt === null || queuedAt === null
              ? null
              : Math.round(((decidedAt.getTime() - queuedAt.getTime()) / 3_600_000) * 10) / 10,
        }
      }),
      byRop: (row?.by_rop ?? []).map((r) => ({
        // A group with no ROP is labelled rather than hidden: it still has to
        // be countable, and "(ROP yoʻq)" is a finding, not a gap.
        rop: r.rop ?? InsightsRepository.NO_ROP,
        orders: r.orders,
        confirmed: r.confirmed,
        noAnswer: r.no_answer,
        rejected: r.rejected,
        pending: r.pending,
        unconfirmedShipped: r.unconfirmed_shipped,
        money: {
          confirmed: money(r.confirmed_amount),
          noAnswer: money(r.no_answer_amount),
          rejected: money(r.rejected_amount),
          pending: money(r.pending_amount),
          unconfirmedShipped: money(r.unconfirmed_shipped_amount),
        },
      })),
    }
  }

  async confirmationOrders(
    period: ScopedWindow,
    query: ConfirmationOrderQuery,
    mode: ConfirmationQueueMode = 'window',
  ): Promise<{ totalItems: number; rows: ConfirmationOrderRow[] }> {
    // Allowlisted, never interpolated from the request: this reaches SQL.
    const sortColumn: Record<ConfirmationOrderSortValue, string> = {
      createdAt: 'c.created_at',
      movedAt: 'c.moved_at',
      queuedAt: 'c.queued_at',
      decidedAt: 'c.decided_at',
      amountMinor: 'd."amountMinor"',
      title: 'd."title"',
    }
    const direction = query.order === 'asc' ? 'ASC' : 'DESC'
    const offset = (query.page - 1) * query.pageSize

    const rows = await this.prisma.$queryRawUnsafe<
      {
        deal_id: string
        rop: string | null
        daily_no: number
        bitrix_id: string | null
        order_code: string | null
        title: string
        customer_name: string | null
        customer_phones: string | null
        employee_name: string
        products: string | null
        region: string | null
        delivery_address: string | null
        source_name: string | null
        amount_minor: MoneyText
        currency: string
        stage_name: string
        outcome: ConfirmationOutcomeValue
        created_at: Date
        moved_at: Date
        queued_at: Date | null
        decided_at: Date | null
        queue_entries: number
        queue_returns: number
        previous_queued_at: Date | null
        visits: VisitJson[] | null
        total_items: bigint
      }[]
    >(
      `${InsightsRepository.queueSql(mode, '$8')},
       /*
         PAGE FIRST, DECORATE AFTERWARDS.

         The filter, the sort and the LIMIT run over the bare cohort — deal id,
         ROP, outcome, four timestamps — and only the fifty rows that survive
         are joined to their customer, operator, stage, source and line items.
         It used to be the other way round: every row in the window was fully
         dressed, including a LATERAL over deal_item per row, and then all but
         fifty thrown away. For a month that was three thousand decorated rows
         for a page of fifty; for a year, eighteen thousand, which put the
         request past the twenty-second statement timeout and made «Shu yil»
         a 500 on this screen.

         The search predicate only ever needed the cohort, the deal and the
         customer, so it runs here in full; the total rides on the page rows
         as a window count, computed before the LIMIT cuts them.
       */
       page AS (
         SELECT
           c.deal_id, c.rop, c.daily_no, c.outcome,
           c.created_at, c.moved_at, c.queued_at, c.decided_at,
           (count(*) OVER ())::bigint AS total_items
         FROM visible c
         JOIN "deal" d ON d."id" = c.deal_id
         LEFT JOIN "customer" cust ON cust."id" = d."customerId"
        -- NULL, not an empty array: ANY over an empty array is false for every
        -- row, so an empty selection would render an empty table rather than
        -- the whole queue.
        WHERE ($3::text[] IS NULL OR c.outcome = ANY($3::text[]))
          AND ${InsightsRepository.ropMatch('$5')}
          AND ${InsightsRepository.regionMatch('$9')}
          AND ${InsightsRepository.amountRange('$10', '$11')}
          ${InsightsRepository.SEARCH_SQL('$4')}
        -- The deal id breaks ties, so paging cannot show one order twice and
        -- skip another when a thousand rows share a sort value.
        ORDER BY ${sortColumn[query.sort]} ${direction} NULLS LAST, d."id" ASC
        LIMIT $6 OFFSET $7
       )
       SELECT
         d."id" AS deal_id,
         c.rop AS rop,
         c.daily_no AS daily_no,
         d."externalId" AS bitrix_id,
         d."orderCode" AS order_code,
         d."title" AS title,
         cust."name" AS customer_name,
         -- Joined to text and split in TS: a text[] round-trips differently
         -- depending on the driver, a delimiter does not.
         array_to_string(
           CASE
             WHEN cust."phones" IS NOT NULL AND array_length(cust."phones", 1) > 0
               THEN cust."phones"
             WHEN cust."phone" IS NOT NULL THEN ARRAY[cust."phone"]
             ELSE ARRAY[]::text[]
           END, E'\n') AS customer_phones,
         e."fullName" AS employee_name,
         items.products AS products,
         d."region" AS region,
         d."deliveryAddress" AS delivery_address,
         src."name" AS source_name,
         d."amountMinor"::text AS amount_minor,
         d."currency" AS currency,
         st."name" AS stage_name,
         c.outcome AS outcome,
         c.created_at AS created_at,
         c.moved_at AS moved_at,
         c.queued_at AS queued_at,
         c.decided_at AS decided_at,
         rep.entries AS queue_entries,
         rep.returns AS queue_returns,
         rep.previous_at AS previous_queued_at,
         rep.visits AS visits,
         c.total_items AS total_items
       FROM page c
       JOIN "deal" d ON d."id" = c.deal_id
       JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")
       JOIN "deal_stage" st ON st."id" = d."stageId"
       LEFT JOIN "customer" cust ON cust."id" = d."customerId"
       LEFT JOIN "sales_source" src ON src."id" = d."sourceId"
       -- LATERAL, not a join: four line items would otherwise become four rows
       -- and the pager would count the same order four times.
       LEFT JOIN LATERAL (
         SELECT string_agg(pr."name" || ' - ' || di."quantity"::text || ' ta', E'\\n' ORDER BY pr."name") AS products
           FROM "deal_item" di
           JOIN "product" pr ON pr."id" = di."productId"
          WHERE di."dealId" = d."id"
       ) items ON true
       ${InsightsRepository.QUEUE_HISTORY_SQL}
      -- The same order the page was cut in; a join does not promise to keep it.
      ORDER BY ${sortColumn[query.sort]} ${direction} NULLS LAST, d."id" ASC`,
      period.start,
      period.end,
      query.outcomes && query.outcomes.length > 0 ? [...query.outcomes] : null,
      query.q ?? null,
      query.rops && query.rops.length > 0 ? [...query.rops] : null,
      query.pageSize,
      offset,
      InsightsRepository.scopeValue(period),
      query.regions && query.regions.length > 0 ? [...query.regions] : null,
      query.amountMinMinor?.toString() ?? null,
      query.amountMaxMinor?.toString() ?? null,
    )

    return {
      totalItems: rows.length === 0 ? 0 : int(rows[0]!.total_items),
      rows: rows.map((r) => {
        const queuedAt = r.queued_at === null ? null : new Date(r.queued_at)
        const decidedAt = r.decided_at === null ? null : new Date(r.decided_at)

        return {
          dealId: r.deal_id,
          rop: r.rop,
          dailyNo: int(r.daily_no),
          bitrixId: r.bitrix_id,
          orderCode: r.order_code,
          title: r.title,
          customerName: r.customer_name,
          customerPhones:
            r.customer_phones === null || r.customer_phones === ''
              ? []
              : r.customer_phones.split('\n'),
          employeeName: r.employee_name,
          // string_agg rather than array_agg: a text array's shape depends on
          // the driver, a delimiter does not.
          products: r.products === null ? [] : r.products.split('\n'),
          region: r.region,
          deliveryAddress: r.delivery_address,
          sourceName: r.source_name,
          amountMinor: money(r.amount_minor),
          currency: r.currency,
          stageName: r.stage_name,
          outcome: r.outcome,
          createdAt: new Date(r.created_at),
          movedAt: new Date(r.moved_at),
          queuedAt,
          decidedAt,
          queueEntries: int(r.queue_entries),
          queueReturns: int(r.queue_returns),
          previousQueuedAt: r.previous_queued_at === null ? null : new Date(r.previous_queued_at),
          queueHistory: visits(r.visits),
          // Both ends or nothing: an order refused without ever being queued
          // has no waiting time, and zero would read as "decided instantly".
          hoursToDecide:
            decidedAt === null || queuedAt === null
              ? null
              : Math.round(((decidedAt.getTime() - queuedAt.getTime()) / 3_600_000) * 10) / 10,
        }
      }),
    }
  }

  // -------------------------------------------------------------------------
  // 5 — The command centre
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 9 — Channels
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 8 — Gross margin
  // -------------------------------------------------------------------------

  /**
   * Margin per product, and how much of the revenue it actually covers.
   *
   * Only 22 of the 160 catalogue items carry a purchase price, so a bare
   * margin percentage would describe a fraction of the business while looking
   * like all of it. `coverageBp` is returned beside it for exactly that
   * reason, and rows without a cost report null rather than a 100% margin.
   */
  async margin(period: Period): Promise<MarginSummary> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        product_id: string
        product_name: string
        units: bigint
        revenue: MoneyText
        discount: MoneyText
        over_list: MoneyText
        cost: MoneyText
        has_cost: boolean
      }[]
    >(
      `
      SELECT
        p."id" AS product_id,
        p."name" AS product_name,
        sum(i."quantity")::bigint AS units,
        sum(i."totalMinor")::text AS revenue,
        -- Split by sign rather than netted.
        --
        -- A negative discountMinor is a price ABOVE the catalogue list, not a
        -- giveaway, and netting the two under one heading called "discount
        -- given" cancels real money against real money. In one month 406 lines
        -- carried a markup and they were quietly reducing the reported
        -- giveaway. They are different facts and get different columns.
        sum(i."discountMinor") FILTER (WHERE i."discountMinor" > 0)::text AS discount,
        sum(-i."discountMinor") FILTER (WHERE i."discountMinor" < 0)::text AS over_list,
        -- NULL *OR NON-POSITIVE* IS UNKNOWN, and the guard belongs here.
        --
        -- prisma/schema.prisma states the invariant on the column itself:
        -- "Null means UNKNOWN, never zero: a margin computed against a zero
        -- cost reads as 100% and is worse than no margin at all". MarginPage
        -- repeats the promise to the reader in Uzbek, «nol tannarx yozilmaydi».
        -- Nothing was enforcing it. toMinorUnits returns 0n for an empty string
        -- and for a literal '0'/'0.00', and handlers.ts writes
        -- record.costMinor ?? null, so a blank catalogue field persisted as a
        -- REAL zero. One such product joins the costed set at 100% margin,
        -- pushes its whole revenue into grossMinor, AND enlarges
        -- costedRevenueMinor -- so the coverage gauge that exists to expose
        -- exactly this moves the wrong way with it and the amber honesty
        -- banner switches itself off.
        --
        -- A portal that genuinely publishes a zero purchase price -- a promo or
        -- a sample line -- is excluded from coverage here rather than shown at
        -- 100% margin. That is the schema's contract, and it is the safer of
        -- the two readings: an unreported product is a known gap, an invented
        -- 100% is not. Bitrix24CrmProvider folds the same case back to
        -- undefined on the way in, so neither layer is load-bearing alone.
        CASE WHEN p."costMinor" IS NULL OR p."costMinor" <= 0 THEN NULL
             ELSE sum(i."quantity" * p."costMinor")::text END AS cost,
        (p."costMinor" IS NOT NULL AND p."costMinor" > 0) AS has_cost
      FROM "deal_item" i
      JOIN "deal" d ON d."id" = i."dealId"
      JOIN "product" p ON p."id" = i."productId"
      WHERE d."countsAsRevenue" AND d."status" = 'WON'
        AND d."closedAt" >= $1 AND d."closedAt" < $2
      GROUP BY p."id", p."name", p."costMinor"
      ORDER BY sum(i."totalMinor") DESC
      `,
      period.start,
      period.end,
    )

    const mapped: MarginRow[] = rows.map((r) => {
      const revenue = money(r.revenue)
      const cost = r.cost === null ? null : money(r.cost)
      const gross = cost === null ? null : revenue - cost
      return {
        productId: r.product_id,
        productName: r.product_name,
        units: int(r.units),
        revenueMinor: revenue,
        discountMinor: money(r.discount),
        overListMinor: money(r.over_list),
        costMinor: cost,
        grossMinor: gross,
        /**
         * Null means ONE thing: no purchase price is recorded.
         *
         * It used to mean two — that, or revenue of zero — and the page
         * rendered both as the words "tannarx yoʻq" (no cost), so a product
         * whose cost was sitting in the column beside it was labelled as
         * having none. A line given away entirely has a known cost and a
         * margin of -100%, which is a fact worth seeing, not a blank.
         */
        marginBp:
          gross === null
            ? null
            : revenue === 0n
              ? cost === 0n
                ? 0
                : -10_000
              : Number((gross * 10_000n) / revenue),
      }
    })

    const revenueMinor = mapped.reduce((sum, r) => sum + r.revenueMinor, 0n)
    const costed = mapped.filter((r) => r.costMinor !== null)
    const costedRevenue = costed.reduce((sum, r) => sum + r.revenueMinor, 0n)
    const gross = costed.reduce((sum, r) => sum + (r.grossMinor ?? 0n), 0n)

    return {
      rows: mapped,
      revenueMinor,
      costedRevenueMinor: costedRevenue,
      grossMinor: gross,
      discountMinor: mapped.reduce((sum, r) => sum + r.discountMinor, 0n),
      overListMinor: mapped.reduce((sum, r) => sum + r.overListMinor, 0n),
      marginBp: costedRevenue === 0n ? 0 : Number((gross * 10_000n) / costedRevenue),
      coverageBp: revenueMinor === 0n ? 0 : Number((costedRevenue * 10_000n) / revenueMinor),
    }
  }

  // -------------------------------------------------------------------------
  // 6 — Call activity
  // -------------------------------------------------------------------------

  /**
   * How much each person actually spoke to customers.
   *
   * Talk time counts connected calls only. Including the failed legs would
   * reward dialling over conversation, which is the opposite of what the
   * number is for.
   */
  // -------------------------------------------------------------------------
  // 5 — Dispatch by fulfilment point
  // -------------------------------------------------------------------------

  /**
   * What each warehouse, courier and marketplace actually shipped.
   *
   * This is NOT a stock report. The portal defines four stores and keeps no
   * balances in any of them — `catalog.storeproduct.list` returns nothing and
   * there are no inventory documents — so on-hand quantity genuinely does not
   * exist to be shown. What the portal does record, on every order, is which
   * point fulfils it, and that answers the question the stock page was wanted
   * for: where volume goes and where it fails.
   */
  async dispatchPoints(period: Period): Promise<DispatchRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        point: string
        orders: bigint
        delivered: bigint
        refused: bigint
        cancelled_early: bigint
        revenue: MoneyText
      }[]
    >(
      `
      SELECT
        COALESCE(d."fulfilmentPoint", 'Belgilanmagan') AS point,
        count(*)::bigint AS orders,
        count(*) FILTER (WHERE cur."logisticsRole" = 'DELIVERED')::bigint AS delivered,
        count(*) FILTER (WHERE cur."logisticsRole" = 'REFUSED')::bigint AS refused,
        count(*) FILTER (WHERE cur."logisticsRole" = 'CANCELLED_EARLY')::bigint AS cancelled_early,
        sum(d."amountMinor") FILTER (WHERE d."status" = 'WON')::text AS revenue
      FROM "deal" d
      JOIN "deal_stage" cur ON cur."id" = d."stageId"
      WHERE d."countsAsRevenue"
        AND d."createdAtSource" >= $1 AND d."createdAtSource" < $2
      GROUP BY 1
      ORDER BY orders DESC
      `,
      period.start,
      period.end,
    )

    return rows.map((r) => {
      const delivered = int(r.delivered)
      const refused = int(r.refused)
      /*
        Classified exactly as logisticsRoutes and logisticsRegions classify.
    
        This used to read status WON / LOST and pass 0 for cancelledEarly, so
        the same orders produced a HIGHER delivery rate here than on the
        Logistics page — the gap being precisely the cancelled-before-dispatch
        share, which vanished from the denominator. Two screens, one column
        heading, two quantities. One definition, in one helper, is the fix.
      */
      const cancelledEarly = int(r.cancelled_early)
      return {
        point: r.point,
        orders: int(r.orders),
        delivered,
        refused,
        cancelledEarly,
        revenueMinor: money(r.revenue),
        deliveryRateBp: deliveryRateBp(delivered, refused, cancelledEarly),
      }
    })
  }

  // -------------------------------------------------------------------------
  // 7 — Structure
  // -------------------------------------------------------------------------

  /**
   * The company tree with each unit's own numbers.
   *
   * Figures are the unit's OWN people, not a rollup — the caller assembles the
   * tree and rolls up, because a department's total depends on whether you
   * count sub-departments, and that is a display decision rather than a
   * database one.
   */
  /**
   * The org chart, as ONE statement.
   *
   * Extracted into a builder for the same reason `queueSql` is: this SQL
   * decides figures a floor manager will hold against the portal's own
   * screen, and the only way to pin them without a database is to assert on
   * the built string. See tests/http/structureSql.test.ts.
   *
   * It binds NOTHING. The two parameters it used to take were the reporting
   * window, and the only CTEs that read them are gone — see the note at the
   * top of the statement.
   */
  private static structureSql(): string {
    return `
      /*
        NOTHING IN HERE TOUCHES "deal", AND THAT IS THE POINT.

        This statement used to carry two more CTEs — an «active» roster over
        won deals, feeding a working_headcount column, and a «sales» aggregate
        feeding the card's revenue. Measured together they were 3.4 of the
        query's 3.5 seconds, on the single vCPU that answers every other screen
        too, for a page every seller on the floor is meant to open.

        Both are gone because the screen no longer prints either: money was to
        live on «Boshqaruv markazi» and nowhere else (that screen was removed on
        2026-09-10 and this page still states none), and a period-scoped
        headcount has no meaning on a page that deliberately carries no
        reporting window. What
        is left reads "department", "department_member" and "employee" — three
        small tables, no date bound, and no parameters at all.

        Aggregate per department FIRST, one row each, then join. The shape
        before that took 52 seconds and was cancelled by the statement timeout:
        a deal join multiplied every employee row by their deal count and the
        correlated subqueries ran once per multiplied row, 24 367 index
        searches deep. The rule outlives the deal join that forced it.
      */
      WITH RECURSIVE
      /*
        Every (ancestor, descendant) pair, so a unit's subtree is one join away.

        RECURSIVE is declared on the whole WITH list — Postgres allows the
        non-recursive members beside it — because the head pill on each card
        counts people across the WHOLE branch beneath the unit, which no
        aggregate over one department can answer.

        A depth cap of 16 is not a limit on the company, it is a cycle guard: this
        tree comes from a portal over the wire, parentId is a nullable
        self-reference with no constraint forbidding a loop, and a loop here is
        not a wrong number but a statement that never returns and a page that
        never loads. The real tree is three deep and the deepest this schema has
        ever held is three.
      */
      walk AS (
        SELECT d."id" AS root, d."id" AS node, 0 AS depth
          FROM "department" d
        UNION ALL
        SELECT w.root, c."id", w.depth + 1
          FROM walk w
          JOIN "department" c ON c."parentId" = w.node
         WHERE w.depth < 16
      ),
      /*
        WHO THE PORTAL LISTS HERE — not who is credited here.

        The people CTE below counts the PRIMARY unit, which is what every analytic on
        this dashboard is built on. This counts membership, which is what the
        portal's own screen prints: nine of its 208 active people sit in two
        units and it counts each of them twice, once per card. Reading only the
        primary left five of twenty cards short by one or two.
      */
      members AS (
        SELECT
          m."departmentId" AS dep_id,
          count(*) FILTER (WHERE e."isActive")::bigint AS member_count,
          /*
            THE HEAD IS SUBTRACTED ONLY IF THE HEAD WAS COUNTED.

            member_count is the ACTIVE members, so a head Bitrix24 has since
            deactivated is not among them — and taking one off anyway printed a
            unit of five active people as having four subordinates, one short of
            the portal and one short of its own roster panel. Counted here, in
            the same pass and under the same isActive filter, so the two can
            never be computed under different rules again.
          */
          count(*) FILTER (WHERE e."isActive" AND m."employeeId" = d."headId")::bigint
            AS head_counted,
          /*
            THE NAMES TRAVEL WITH THE TREE SO THE CHART CAN BE SEARCHED BY THEM.

            This screen exists so the floor can answer "who works under whom",
            and the first thing somebody types into it is a person's name — but
            the chart only knew department and head names, so a seller looking
            for themself got «topilmadi» over a dimmed company while their own
            row sat two clicks away in a panel. Roughly 290 names across the
            whole tree, a few kilobytes on a payload the page already fetches,
            against a second round trip per keystroke. Active only: a search
            that surfaced a card because somebody who left in March is still on
            its roster is a wrong answer, not a generous one.
          */
          array_remove(
            array_agg(e."fullName" ORDER BY e."fullName") FILTER (WHERE e."isActive"),
            NULL
          ) AS member_names
        FROM "department_member" m
        JOIN "employee" e ON e."id" = m."employeeId"
        JOIN "department" d ON d."id" = m."departmentId"
        GROUP BY m."departmentId"
      ),
      /*
        DISTINCT, because the subtree is where a two-unit person shows up twice.

        Somebody in both «Регистрация» and «Azizbek(ROP)» is one person under
        NEWGEN, and summing the per-unit counts up the tree would make them two.
        The head themself is excluded here rather than subtracted afterwards,
        because whether they are inside their own subtree depends on which unit
        they actually sit in — the portal's «Навоий» is headed from outside.
      */
      subtree AS (
        SELECT
          w.root AS dep_id,
          count(DISTINCT m."employeeId") FILTER (
            WHERE e."isActive" AND (r."headId" IS NULL OR m."employeeId" <> r."headId")
          )::bigint AS head_manages_count
        FROM walk w
        JOIN "department" r ON r."id" = w.root
        JOIN "department_member" m ON m."departmentId" = w.node
        JOIN "employee" e ON e."id" = m."employeeId"
        GROUP BY w.root
      ),
      kids AS (
        SELECT c."parentId" AS dep_id, count(*)::bigint AS child_count
          FROM "department" c
         WHERE c."parentId" IS NOT NULL
         GROUP BY c."parentId"
      ),
      /*
        THE PRIMARY UNIT, deliberately — this is the only count that still is.

        «members» above reads the join table, because the card's «xodim» figure
        is the portal's membership and a person in two units is drawn on both
        cards. This one is the roster as this dashboard credits it: one person,
        one unit. The two are different numbers on five of the twenty cards and
        the screen prints both.
      */
      people AS (
        SELECT
          e."departmentId" AS dep_id,
          count(*)::bigint AS headcount,
          count(*) FILTER (WHERE e."isActive")::bigint AS active_headcount
        FROM "employee" e
        WHERE e."departmentId" IS NOT NULL
        GROUP BY e."departmentId"
      )
      SELECT
        dep."id",
        dep."name",
        dep."parentId" AS parent_id,
        dep."headId" AS head_id,
        head."fullName" AS head_name,
        head."position" AS head_position,
        /*
          The head is only a head HERE if the portal also lists them here.
          «Навоий» names a head whose own units are two others, and the portal's
          card prints no head row at all rather than claiming they sit there.

          Deliberately NOT filtered on isActive, unlike the arithmetic above:
          this decides whether to DRAW the head row, and a unit whose head
          Bitrix24 has deactivated still has that person as its head on the
          portal. Saying «Rahbar tayinlanmagan» over a named UF_HEAD would be a
          different claim from the one the source screen makes. The count is
          what must not double-think it, and that now lives in the members CTE.
        */
        EXISTS (
          SELECT 1 FROM "department_member" hm
           WHERE hm."departmentId" = dep."id" AND hm."employeeId" = dep."headId"
        ) AS head_is_member,
        COALESCE(p.headcount, 0)::bigint AS headcount,
        COALESCE(p.active_headcount, 0)::bigint AS active_headcount,
        COALESCE(m.member_count, 0)::bigint AS member_count,
        COALESCE(m.member_names, ARRAY[]::text[]) AS member_names,
        -- «Подчинённые: N сотрудников» on the portal's own card: its active
        -- members, minus the head when the head is one of them. GREATEST is a
        -- belt: the two counts come from one pass, so it can no longer go
        -- negative, and a future edit that separates them again would.
        GREATEST(COALESCE(m.member_count, 0) - COALESCE(m.head_counted, 0), 0)::bigint
          AS subordinate_count,
        COALESCE(t.head_manages_count, 0)::bigint AS head_manages_count,
        COALESCE(k.child_count, 0)::bigint AS child_count,
        dep."sortOrder" AS sort_order
      FROM "department" dep
      LEFT JOIN "employee" head ON head."id" = dep."headId"
      LEFT JOIN people p ON p.dep_id = dep."id"
      LEFT JOIN members m ON m.dep_id = dep."id"
      LEFT JOIN subtree t ON t.dep_id = dep."id"
      LEFT JOIN kids k ON k.dep_id = dep."id"
      /*
        Sibling order is the PORTAL's, not alphabetical.

        sortOrder is what the person who arranged the org chart in Bitrix24
        decided, and the screen this reproduces is read left to right in that
        order. The name only breaks a tie, so two units sharing a sort value still
        land in a stable order rather than swapping between requests.
      */
      ORDER BY dep."sortOrder", dep."name"
    `
  }
  /**
   * NO ARGUMENTS, AND THAT IS THE CONTRACT.
   *
   * Who reports to whom is a fact about today. It was period-scoped only
   * because the card once printed the unit's money and the table a
   * period-scoped «Ishlagan» count; both are gone from the screen, so a window
   * here would be a parameter that changes no answer and a cache key that
   * splits one into several.
   */
  async structure(): Promise<StructureNode[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: string
        name: string
        parent_id: string | null
        head_id: string | null
        head_name: string | null
        head_position: string | null
        head_is_member: boolean
        headcount: bigint
        active_headcount: bigint
        member_count: bigint
        member_names: string[]
        subordinate_count: bigint
        head_manages_count: bigint
        child_count: bigint
        sort_order: number
      }[]
    >(InsightsRepository.structureSql())

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      headId: r.head_id,
      headName: r.head_name,
      headPosition: r.head_position,
      headIsMember: r.head_is_member,
      headcount: int(r.headcount),
      activeHeadcount: int(r.active_headcount),
      memberCount: int(r.member_count),
      memberNames: r.member_names ?? [],
      subordinateCount: int(r.subordinate_count),
      headManagesCount: int(r.head_manages_count),
      childCount: int(r.child_count),
      sortOrder: Number(r.sort_order),
    }))
  }

  /**
   * Which units the portal lists this person in.
   *
   * A LIST, because membership is many-to-many: the account reading the org
   * chart can sit in two units, and badging only the first would send «Meni
   * topish» to the wrong side of a tree the reader is trying to find themself
   * in. Prisma rather than raw SQL — it is one indexed lookup on the primary
   * key's second column and there is no aggregate to get wrong.
   */
  async departmentsOfEmployee(employeeId: string): Promise<ViewerDepartment[]> {
    const rows = await this.prisma.departmentMember.findMany({
      where: { employeeId },
      select: { departmentId: true, isPrimary: true },
    })
    return rows.map((r) => ({ departmentId: r.departmentId, isPrimary: r.isPrimary }))
  }

  /**
   * One unit's roster, for the panel that opens beside the chart.
   *
   * Membership, not primary unit: the panel answers "who does the portal list
   * here", which is the same question the card's count answers, and the two may
   * never disagree on the same screen. `isPrimary` marks the people whose
   * numbers are credited here so a reader can tell a borrowed operator from an
   * owned one.
   *
   * NO MONEY AND NO WINDOW. The panel used to carry each person's closed
   * revenue over the page's reporting window, through a LATERAL over `deal`
   * once per member. Money was to be stated in one place — «Boshqaruv markazi»
   * — so the roster is a roster: who the portal lists here, who leads them, and
   * who is credited here rather than borrowed from another unit. That screen
   * went on 2026-09-10 and none of it came back here.
   *
   * Inactive people are returned and marked rather than dropped: a unit reading
   * «13 xodim» over a list of nine is the kind of gap that costs an afternoon,
   * and the count above them is of the ACTIVE ones.
   */
  async departmentRoster(departmentId: string): Promise<DepartmentMemberRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: string
        full_name: string
        position: string | null
        is_active: boolean
        is_primary: boolean
        is_head: boolean
      }[]
    >(
      `
      SELECT
        e."id",
        e."fullName" AS full_name,
        e."position",
        e."isActive" AS is_active,
        m."isPrimary" AS is_primary,
        (dep."headId" = e."id") AS is_head
      FROM "department_member" m
      JOIN "employee" e ON e."id" = m."employeeId"
      JOIN "department" dep ON dep."id" = m."departmentId"
      WHERE m."departmentId" = $1
      -- The head first, then everyone still here, then the deactivated. A
      -- roster sorted by name alone buries the one person the reader opened
      -- the panel to find.
      ORDER BY (dep."headId" = e."id") DESC, e."isActive" DESC, e."fullName"
      `,
      departmentId,
    )

    return rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      position: r.position,
      isActive: r.is_active,
      isPrimary: r.is_primary,
      isHead: r.is_head,
    }))
  }
}
