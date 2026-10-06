/**
 * The sellers' board — ranking, teams, bonus tiers and the month's run-rate.
 *
 * It composes what `SellerBoardRepository` reads and adds the three judgements
 * the client's own dashboard makes, each kept explicitly separate from the
 * measurement it is applied to:
 *
 *   1. RANK, by money won from the period's own intake.
 *   2. TEAM, by the ROP the seller's department names.
 *   3. BONUS, by the client's published tiers.
 *
 * The bonus tiers are THEIRS, transcribed in `domain/analytics/sellerBonus`
 * together with the band their `idInRange()` gates the ladder on — see that
 * module for both, and for why the gate is worth carrying.
 *
 * NO PLAN, LEAD, FOT OR PER-ROW LADDER ON THE PAYLOAD (2026-10-06). Their page
 * carries `plan`, `leads`, `conv` and `fot`, and so did this one — the plan
 * read from the `kpi` table nothing writes to, the other three always null —
 * for columns the television dropped on 2026-09-07; the per-seller ladder left
 * Savdo dinamikasi on 2026-09-10. Nothing read any of it, and every build paid
 * a KPI query for the plan. The bonus is still computed per seller, but only
 * its fund and headcount travel.
 */

import { SHARE_DECIMALS, ratePercent, roundPercent } from '@/server/domain/analytics/metrics'
import {
  fullUnitWindow,
  projectRevenueMinor,
  projectionElapsedFraction,
  spreadRemainingMinor,
} from '@/server/domain/analytics/pulse'
import { BONUS_TIERS, bonusEligible } from '@/server/domain/analytics/sellerBonus'
import { mergeSellerTeamSlices } from '@/server/domain/analytics/sellerTeams'
import { type SellerMedal, buildSellerMedals } from '@/server/domain/analytics/sellerMedals'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import { scopedPeriod } from '@/server/domain/employees/branches'
import { brandTeams } from '@/server/domain/rnp/rnpSheet'
import {
  type Period,
  chooseGranularity,
  enumerateBuckets,
  sinceMonth,
  zonedDateKey,
} from '@/server/domain/period/period'
import { CONFIRMATION_OUTCOMES, type ConfirmationOutcomeValue } from '@/server/domain/types'
import type {
  BrandSlice,
  ConfirmationSellerRatingRow,
  ConfirmationSourceRatingRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import { LIVE_CACHE, keyPart, ttlCache } from './ttlCache'
import type {
  SellerBoardFilters,
  SellerBoardRepository,
  SellerBoardRow,
} from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from './analyticsService'

/**
 * Which clock the board reads. See `SellerBoardDto.basis` for what each
 * value means to the reader; this is the API-level switch that picks it.
 */
export const SELLER_BOARD_BASES = ['queue', 'intake'] as const
export type SellerBoardBasisValue = (typeof SELLER_BOARD_BASES)[number]

// ---------------------------------------------------------------------------
// DTOs — mirrored in src/lib/api.ts, which the client imports instead.
// ---------------------------------------------------------------------------

export interface SellerBoardRowDto {
  readonly rank: number
  readonly employeeId: string
  readonly fullName: string
  readonly rop: string | null
  /** Orders taken in the period, cancellations excluded — their `trans`. */
  readonly orders: number
  /** Their value — their `fact1`. */
  readonly ordered: MoneyDto
  /** Of those, the ones won — their `fact2`. This is what rank and bonus read. */
  readonly won: MoneyDto
  readonly wonOrders: number
  /** Still open, already inside `ordered`: live work the seller is carrying. */
  readonly open: MoneyDto
  readonly openOrders: number
  /** Refused in the queue PLUS confirmed-then-cancelled. Both are resolved. */
  readonly lostOrders: number
  /**
   * Of `lostOrders`, the ones the operator had already CONFIRMED before the
   * order died — «Отказ предварительно» and its kind. A different fact from a
   * refusal at the door, and July hid 102 of them inside «yoʻlda».
   */
  readonly lostAfterConfirmOrders: number
  /** What those orders were worth. NOT `ordered − won − open`; see `SellerBoardRow`. */
  readonly lostAfterConfirm: MoneyDto
  /**
   * EVERY order of theirs in the window, whatever became of it — the count the
   * Тасдиқлаш navbati page shows. Bigger than `orders`, which counts only the
   * confirmed ones: August is 3 228 against 2 874, and until the screen prints
   * both, two pages state two true numbers 354 apart with no explanation.
   */
  readonly cohortOrders: number
  /** wonOrders / (orders resolved so far), 0-100. Null when nothing resolved. */
  readonly conversionPercent: number | null
  /** This seller's share of the board's total won intake, 0-100. */
  readonly sharePercent: number | null
  /**
   * Where this seller's month lands at today's pace. See `SellerForecastDto`.
   *
   * ONE ELAPSED FRACTION FOR THE WHOLE PAYLOAD, so a row, its team and the
   * company headline are three readings of one clock. Computed per row rather
   * than re-derived on the client for the usual reason: a second definition of
   * a business figure agrees with the first until the day it does not.
   */
  readonly forecast: SellerForecastDto
}

export interface SellerTeamRowDto {
  readonly rank: number
  readonly rop: string
  readonly sellers: number
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  readonly wonOrders: number
  readonly open: MoneyDto
  readonly conversionPercent: number | null
  readonly sharePercent: number | null
  /**
   * The team's own projection — summed from its sellers' MONEY and projected
   * once, never summed from its sellers' projections.
   *
   * The two agree under a straight line and would stop agreeing the moment
   * anything about the rule stopped being one (a floor, a cap, a per-seller
   * horizon). Projecting the team's own total is the reading that stays true
   * to «the team ends the month at», which is what the column is asked.
   */
  readonly forecast: SellerForecastDto
}

/**
 * One source on «Manbalar boʻyicha» — the teams table's columns, cut by the
 * deal's source instead of the operator's ROP.
 *
 * Asked for on 2026-09-23: every source in the «Manba» filter as a ranked row
 * with its full figures. Ranked by the teams' own rule — FAKT 2, then FAKT 1,
 * then the name — so the two tables under one hero cannot disagree about what
 * «1-oʻrin» means.
 *
 * `sourceId` null is the deals with no source set, named on the screen rather
 * than dropped: the rows are a partition of the cohort and add up to the hero.
 */
export interface SellerSourceRowDto {
  readonly rank: number
  readonly sourceId: string | null
  readonly name: string | null
  /** Operators holding at least one order from this source. */
  readonly sellers: number
  /** Every order from this source that entered the queue. */
  readonly cohortOrders: number
  /** FAKT 1's order count — Тасдиқланди + Тасдиқланмай чиқди. */
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  readonly wonOrders: number
  readonly open: MoneyDto
  readonly lostAfterConfirm: MoneyDto
  /** Тасдиқланмади — refused in the queue. */
  readonly rejectedOrders: number
  /** Resolved orders only, the board's own denominator. Null over nothing. */
  readonly conversionPercent: number | null
  /** Of the whole cohort's FAKT 1 — early in a day FAKT 2 is zero everywhere. */
  readonly fakt1SharePercent: number | null
  /** Of the whole cohort's FAKT 2, as `SellerTeamRowDto.sharePercent`. */
  readonly sharePercent: number | null
  readonly forecast: SellerForecastDto
}

/** One queue state's slice of the cohort: how many orders, and what they were worth. */
export interface SellerOutcomeDto {
  readonly orders: number
  readonly amount: MoneyDto
}

export interface SellerBoardTotalsDto {
  readonly sellers: number
  readonly teams: number
  /**
   * Sellers with no ROP, and so on no team row.
   *
   * The teams tab divides by the WHOLE board, so without this the reader has
   * no way to see that the shares do not add to a hundred — six sellers and
   * 40.9 mln of intake were sitting outside every row on the screen.
   */
  readonly teamlessSellers: number
  readonly orders: number
  /** Every order in the cohort — what the confirmation queue counts. */
  readonly cohortOrders: number
  /**
   * WHERE THE WHOLE QUEUE WENT — the five states apart, each with its count
   * and its money, summed over the rows exactly as `cohortOrders` is, so the
   * five counts add up to it and the screen prints a partition rather than a
   * remainder. Asked for on 2026-09-15 for Savdo dinamikasi: FAKT 1 folds
   * Тасдиқланди and Тасдиқланмай чиқди together on purpose, and the client
   * wanted the fold undone beside it («tasdiqlanganlar, tasdiqlanmay
   * chiqdilar bilan tasdiqlanmaganlar nisbati»). Null on the intake basis,
   * which has no queue to have states in.
   */
  readonly outcomes: Readonly<Record<ConfirmationOutcomeValue, SellerOutcomeDto>> | null
  /**
   * «Тасдиқланиш %» — Тасдиқланди over everything that entered the queue,
   * 0–100 to one decimal. The Тасдиқлаш board's own rate, computed the same
   * way (`confirmedRate` in `insightsService`), so the two screens cannot
   * print two rates for one month. Тасдиқланди ALONE: an order shipped
   * without reaching the customer earns FAKT 1 money but is not a
   * confirmation. Null when nothing entered, and on the intake basis.
   */
  readonly confirmedRate: number | null
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  readonly wonOrders: number
  readonly open: MoneyDto
  /** Orders inside `open` — «yoʻlda» money needs its count beside it. */
  readonly openOrders: number
  /** Refused in the queue PLUS confirmed-then-cancelled — the rate's own loss pool. */
  readonly lostOrders: number
  /** Of those, the ones already confirmed when they died, and what they were worth. */
  readonly lostAfterConfirmOrders: number
  readonly lostAfterConfirm: MoneyDto
  readonly conversionPercent: number | null
  /**
   * Total bonus the tiers would pay on today's standings.
   *
   * NULL UNDER A BRAND SLICE OR A SOURCE FILTER, with `sellersInBonus`: the
   * ladder pays on a seller's WHOLE FAKT 2 and is not linear, so it cannot be
   * cut deal by deal — see `slicesSellerFakt2`.
   */
  readonly bonusPayable: MoneyDto | null
  readonly sellersInBonus: number | null
}

/**
 * One row's or one team's projection — BOTH facts, never one.
 *
 * FAKT 2 ALONE WAS THE WHOLE FORECAST UNTIL 2026-09-16, and on this cohort
 * that is the half that moves last: delivery lags the arrival it is projected
 * from by about two days, so a team's FAKT 2 projection is still near zero on
 * a morning its FAKT 1 projection already says the month is on pace. A floor
 * manager asked «kim orqada» reads the first and acts on it; reading only the
 * second told them every team was behind, every morning.
 *
 * Null rather than zero when there is nothing to project from — see
 * `forecastMoney`. A zero here would say "this team ends the month at
 * nothing", which is a claim, and the wrong one.
 */
export interface SellerForecastDto {
  /** Straight-line projection of FAKT 1 to the end of the calendar unit. */
  readonly fakt1: MoneyDto | null
  /** The same for FAKT 2 — what the bonus ladder and the payroll screen are paid on. */
  readonly fakt2: MoneyDto | null
}

export interface SellerBoardForecastDto extends SellerForecastDto {
  /**
   * How much of the FULL calendar unit has elapsed, 0-100 — never of the
   * report window. See `forecastOf` for the four-month-old bug that
   * distinction fixes.
   */
  readonly elapsedPercent: number
  /**
   * The instant the projection runs TO, ISO — the end of `fullUnitWindow`.
   *
   * The screen prints it. «Oyning 53% qismi oʻtdi» does not say WHICH month,
   * and on «Shu hafta» it is not a month at all; a projection that will not
   * name its own horizon invites the reader to assume the one they had in
   * mind. Half-open like every other window here, so this is the first
   * instant NOT projected.
   */
  readonly windowEnd: string
  /**
   * The dashed continuation for the trend chart: one point per bucket the
   * period has left, on the SAME cadence and the SAME calendar as
   * `faktTrend`.
   *
   * IT RIDES THE BOARD RATHER THAN THE TREND, and that is deliberate. Appended
   * to `faktTrend` these points would reach `ConfirmationOutcomeSection`,
   * whose tiles and confirmation-rate line reduce over every point they are
   * given — a forecast bucket has no queue states, so it would have dragged
   * that rate towards zero with nothing on screen saying a projection had been
   * counted as a measurement. Empty for a finished period, and empty below the
   * projection floor.
   */
  readonly buckets: readonly FaktForecastPointDto[]
}

/**
 * One projected bucket — the same shape and the same lossy major-unit money as
 * `FaktTrendPointDto`, because the chart draws them on one axis.
 *
 * It carries the two series and nothing else: no order count, no queue states.
 * A run-rate projects money, and a projected order count printed in a tooltip
 * beside real ones is a number a reader will quote.
 */
export interface FaktForecastPointDto {
  /** Bucket start as an ISO instant, exactly as `FaktTrendPointDto.date`. */
  readonly date: string
  readonly fakt1: number
  readonly fakt2: number
}

export interface SellerBoardDto {
  readonly rows: readonly SellerBoardRowDto[]
  readonly teams: readonly SellerTeamRowDto[]
  readonly totals: SellerBoardTotalsDto
  readonly forecast: SellerBoardForecastDto
  /**
   * The basis, stated in the payload so the screen cannot forget to print it.
   *
   * 'confirmation_queue' — FAKT 1 / FAKT 2, the floor's own vocabulary.
   *   `ordered` is FAKT 1 — Тасдиқланди AND Тасдиқланмай чиқди, everything
   *   that left the queue as an order — `won` is Доставланди (C6:WON), and
   *   everything is dated by the order's OWN arrival in C4:NEW. See
   *   `InsightsRepository.FAKT1_OUTCOMES` and `confirmationSellerRating`.
   * 'created_in_period' — the original reading, dated by the day the ORDER
   *   WAS TAKEN (`createdAtSource`) — see `SellerBoardRepository`.
   */
  readonly basis: 'confirmation_queue' | 'created_in_period'
}

/**
 * One point of the FAKT 1 / FAKT 2 line drawn over the revenue area on Savdo
 * dinamikasi.
 *
 * MONEY AS A PLAIN NUMBER IN SOʻM, not a `MoneyDto`, and that is the one place
 * in this service where that is right: it exists to be plotted on the same
 * axis as `TrendPointDto.revenue`, which `/analytics/sales` has always
 * serialised as a lossy major-unit number. A `MoneyDto` here would make the
 * chart divide one series and not the other.
 *
 * `date` is the BUCKET START as an ISO instant, exactly as the revenue trend
 * writes it, so the two series zip on equal strings rather than on an index.
 */
export interface FaktTrendPointDto {
  readonly date: string
  /** Тасдиқланди + Тасдиқланмай чиқди — what left the queue as an order. */
  readonly fakt1: number
  /** Доставланди — what a courier actually delivered. */
  readonly fakt2: number
  /** FAKT 1's own order count. Not the cohort — see `SellerBoardTotalsDto`. */
  readonly orders: number
  /**
   * The bucket's five queue states, counts only — what the confirmation-rate
   * line under the hero divides. On the SAME point as FAKT 1 / FAKT 2 so a
   * day's share and the period's share are one arithmetic over one cohort.
   */
  readonly byOutcome: Readonly<Record<ConfirmationOutcomeValue, number>>
  /** Every order that entered the queue in the bucket — the five states summed. */
  readonly cohortOrders: number
}

// ---------------------------------------------------------------------------

/**
 * Sixty seconds, matching the sync tick.
 *
 * The data behind this board moves exactly once a minute, so an entry is never
 * older than the numbers would have been anyway — and the client polls on the
 * same minute clock, which means a TTL any shorter is missed by every solo
 * reader while buying them nothing.
 */
const boardCache = ttlCache<SellerBoardDto>(120_000, LIVE_CACHE)

/**
 * Test seam only — and it is not optional in a test that builds two boards.
 *
 * The memo is module-level, which is what makes it shared between readers in
 * production and what makes it shared between TESTS in a suite. Two cases that
 * stub the repository differently and then ask for the same window, currency
 * and filters are asking the same QUESTION as far as this key is concerned, so
 * the second one is served the first one's board. It does not error: it
 * returns a complete, well-formed DTO built from another test's fixtures, and
 * the assertion fails somewhere that has nothing to do with the cause. That is
 * exactly how it was found — four ranking assertions in
 * `sellerBoardTeams.test.ts` failed with another case's ROP names in them.
 */
export function resetSellerBoardCache(): void {
  boardCache.clear()
}

/** Test seam for `faktTrend`'s memo, same hazard as `resetSellerBoardCache`. */
export function resetFaktTrendCache(): void {
  faktDaysCache.clear()
}

/**
 * One month's champion on the sellers' television.
 *
 * Mirrored in `src/lib/api.ts` as `SellerRecordDto`, where the field-by-field
 * reasoning lives. Nothing checks the mirror — edit both sides.
 */
export interface SellerRecordDto {
  readonly month: string
  readonly running: boolean
  readonly employeeId: string
  readonly fullName: string
  readonly rop: string | null
  /** Which of the two figures earned the place — the podium's own rule. */
  readonly basis: 'delivered' | 'confirmed'
  readonly amount: MoneyDto
  readonly orders: number
  readonly confirmed: MoneyDto
  readonly confirmedOrders: number
  readonly delivered: MoneyDto
  readonly deliveredOrders: number
}

export interface SellerRecordsDto {
  /** Newest month first. */
  readonly months: readonly SellerRecordDto[]
  /** The first instant the wall covers. See `RECORDS_FROM`. */
  readonly from: string
}

/**
 * Bitta medal — va uning sababi, ekran yig'ib oladigan bo'laklarda.
 *
 * Mirrored in `src/lib/api.ts` as `SellerMedalDto`. Nothing checks the
 * mirror — edit both sides.
 */
export interface SellerMedalDto {
  readonly code: SellerMedal['code']
  readonly count: number
  /** Sababning oyi yoki kuni, `YYYY-MM-DD`. */
  readonly at: string | null
  readonly amount: MoneyDto | null
  /**
   * Odatda buyurtma soni — lekin ikki medalda BOSHQA narsani tashiydi:
   * `rookie` da bu sotuvchining o'sha oydagi O'RNI, `work-month` da esa
   * necha KUN ishlagani. Taxta bu maydonni HOZIR O'QIMAYDI (medal faqat nomi
   * va ×N ini ko'rsatadi); kelajakdagi o'quvchi shu ikki medalni alohida
   * o'qishi shart — umumiy yo'ldan o'tsa, ikkalasi ham noto'g'ri chiziladi.
   */
  readonly orders: number | null
  readonly percent: number | null
}

/**
 * Bir sotuvchi va uning medallari — boshqa hech narsa.
 *
 * DARAJA YO'Q (2026-09-17, mijoz: «uroven kerak emas, medallar qolsin»):
 * daraja, unvon, jami pul, ostonalar va «bugun» maydoni payload'dan olib
 * tashlandi, va ular bilan birga medallarni yashirgan eshik ham. Mirrored in
 * `src/lib/api.ts` — nothing checks the mirror, edit both sides.
 */
export interface SellerMedalRowDto {
  readonly employeeId: string
  /**
   * Motor topgan HAR BIR medal, chizilish tartibida (`MEDAL_ORDER`) — eshiksiz.
   * BO'SH BO'LISHI MUMKIN: oynada oy fakti bor har sotuvchi ro'yxatda, medali
   * bo'lmasa ham. Ekran javobni `employeeId` bo'yicha xaritaga yig'adi, ya'ni
   * bo'sh qator va yo'q qator unga bir xil — lekin ro'yxat oynadagi floor.
   */
  readonly medals: readonly SellerMedalDto[]
}

export interface SellerMedalsDto {
  /** `employeeId` bo'yicha — tartib ma'no tashimaydi, faqat ikki so'rov bir xil javob bersin. */
  readonly sellers: readonly SellerMedalRowDto[]
  /** The first instant the medals cover. See `RECORDS_FROM`. */
  readonly from: string
}

/**
 * Medal rekord devori bilan bir xil sekin fakt, va uning kogortasi shu
 * ekrandagi eng keng o'qish. Taxtaning oltmish soniyasi emas, devorning
 * o'n daqiqasi.
 */
const medalsCache = ttlCache<SellerMedalsDto>(600_000)

/** Test seam only — see `resetSellerBoardCache`, same hazard. */
export function resetSellerMedalsCache(): void {
  medalsCache.clear()
}

/**
 * The first month the record wall may report on.
 *
 * NOT A PREFERENCE — the month the numbers before it stop being about sellers.
 * Until the portal began writing «Фамилия имя ответсвенный»
 * (`UF_CRM_1778416910`) onto the deal, a row was credited to `ASSIGNED_BY_ID`,
 * the CURRENT assignee, and this portal moves deals to back office while they
 * are processed. Measured on production 2026-09-08, by month, on FAKT 2:
 *
 *   June 2026   Fazliddinov Bunyodjon   321 630 000 soʻm over 220 orders
 *   July 2026   Fazliddinov Bunyodjon   830 660 000 soʻm over 551 orders
 *   August 2026 154 Marjona Xayrullayeva 128 550 000 soʻm over 74 orders
 *
 * Bunyodjon is the head of Операцион and belongs to no ROP team. The same
 * board's ROP-LESS total is what proves the snapshot is the thing that
 * changed: 840 510 000 soʻm in July against 29 600 000 in August.
 *
 * An unbounded wall therefore opens on a 830 mln «record» that no seller set
 * and none can beat, on the television the floor reads to know where they
 * stand — the same attribution failure `mapping.ts` documents at `UF.
 * OPERATOR_NAME`, arriving on a different screen. If the portal is ever
 * backfilled, this constant moves and nothing else does.
 */
const RECORDS_FROM = '2026-08'

/**
 * The record wall changes when a month closes and, within the running month,
 * no faster than the sync worker. Ten minutes rather than the board's sixty
 * seconds: the wall is a slow fact and its query builds a cohort spanning
 * every month it covers, which is the most expensive read on this screen.
 */
const recordsCache = ttlCache<SellerRecordsDto>(600_000)

/** Test seam only — see `resetSellerBoardCache`, same hazard. */
export function resetSellerRecordsCache(): void {
  recordsCache.clear()
}

/**
 * The sources table moves on the board's clock — same cohort, same sync tick —
 * so it keeps the board's sixty seconds.
 */
const sourcesCache = ttlCache<readonly SellerSourceRowDto[]>(120_000, LIVE_CACHE)
const faktDaysCache = ttlCache<Awaited<ReturnType<InsightsRepository['confirmationFaktDays']>>>(120_000, LIVE_CACHE)

/** Test seam only — see `resetSellerBoardCache`, same hazard. */
export function resetSellerSourcesCache(): void {
  sourcesCache.clear()
}

function recordWindow(now: Date, timeZone: string): Period {
  return sinceMonth(RECORDS_FROM, now, timeZone)
}

/** `YYYY-MM` for an instant, read in the reporting timezone. */
function monthKey(instant: Date, timeZone: string): string {
  // `en-CA` renders ISO order, which is the one thing needed from it here.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).format(instant)
}

export class SellerBoardService {
  constructor(
    private readonly repo: SellerBoardRepository,
    private readonly insights: InsightsRepository,
  ) {}

  /**
   * ONE board per question, shared by everyone looking at it.
   *
   * This screen is the floor's, and the floor opens it together — the same
   * arrival pattern the command centre's cache was written for. Each build is
   * a full confirmation-cohort construction (`queueSql` + the rating
   * aggregate), and the route passes `ctx.query` and never `ctx.scope`, so
   * every one of those readers was paying for an identical answer.
   *
   * NO SCOPE IN THE KEY, BECAUSE THERE IS NO SCOPE IN THE ANSWER. This board
   * is company-wide for every caller by decision — the client's, stated on
   * 2026-09-08 and argued in `analytics/sellers/route.ts` — so two accounts
   * asking for the same window are asking the identical question and must
   * share the entry. `boardFilters` drops `restrictToEmployeeIds` rather than
   * forwarding it, which is the second of the two places a scope would have to
   * reappear before it could reach the SQL.
   *
   * IF THIS SCREEN IS EVER NARROWED AGAIN, this memo has to gain the scope in
   * the same commit or be deleted in it. That is not a style note: keyed
   * without it, an administrator and a ROP asking for the same window inside
   * the same minute share one entry and the second is served the first's
   * board. `keyPart` is imported and ready for exactly that, and
   * `sellerBoardCacheScope.test.ts` fails the moment the service starts
   * reading a scope it is not keying on.
   *
   * The reader's own `employeeIds`, `departmentIds` and `sourceIds` ARE in the
   * key. They are the caller's claim rather than the server's, which is fine
   * because they can only narrow what is already public — and `keyPart` keeps
   * `undefined` and `[]` distinct, since an empty array reads as "no filter"
   * in every repository here and widens back to the whole company.
   *
   * THE PRESET IS IN THE KEY, and it is not decoration. The run-rate projects
   * to the preset's own calendar unit (`fullUnitWindow`), so on a Monday
   * «Bugun» and «Shu hafta» resolve to one window and still project to a day
   * and to a week; without the preset they would share an entry and swap each
   * other's forecasts. The same class of bug — a key without its preset — is
   * documented, with its measured numbers, in `ttlCache.ts`.
   *
   * NO COMPARISON WINDOW IN THE KEY, because none is read — see `buildBoard`.
   */
  async board(ctx: AnalyticsContext, basis: SellerBoardBasisValue = 'queue'): Promise<SellerBoardDto> {
    const filters = boardFilters(ctx)

    const key = [
      basis,
      ctx.period.preset,
      ctx.period.start.toISOString(),
      ctx.period.end.toISOString(),
      ctx.currency,
      keyPart(filters.employeeIds),
      keyPart(filters.departmentIds),
      keyPart(filters.sourceIds),
      filters.brand?.slice ?? '',
    ].join('|')

    return boardCache.get(key, () => this.buildBoard(ctx, basis, filters))
  }

  private async buildBoard(
    ctx: AnalyticsContext,
    basis: SellerBoardBasisValue,
    filters: SellerBoardFilters,
  ): Promise<SellerBoardDto> {

    /*
      NO COMPARISON WINDOW, AND SO NO FAKT 2 TREND (2026-10-06). The board
      used to read `ctx.comparison` through the same cohort and print FAKT 2
      against it — but FAKT 2 is where each order stands NOW, and the
      comparison is always the OLDER cohort: on 6 October, Sep 1–6 has had a
      month to be delivered and Oct 1–6 a few days, while delivery lags the
      arrival by about two days (by arrival day on 2026-09-04: 04-sen 79
      confirmed / 0 delivered, 03-sen 94 / 0, 02-sen 80 / 20, 31-avg 99 / 73).
      So the arrow read as a fall on «Shu oy», «Shu hafta», «Kecha» and every
      custom window for a floor working at an unchanged pace. Payroll left the
      queue clock for the same lean (7fdadaf). A trend comes back only with
      the comparison read AS OF THE SAME AGE — a comparison delivery counted
      only if it landed within (now − period.start) of comparison.start —
      and until then the second cohort construction per build bought nothing.
    */
    const { rows, teamSlices } = await this.rowsFor(ctx.period, basis, filters)

    const totalWonMinor = sum(rows, (r) => r.wonMinor)
    const totalOrderedMinor = sum(rows, (r) => r.orderedMinor)

    /*
      ONE ELAPSED FRACTION FOR EVERY PROJECTION ON THE PAYLOAD.

      Resolved here, once, and handed down to the rows, the teams and the
      company headline — so the three cannot be read against three different
      moments. Asked per row it would also be asked 126 times for one answer.
      `ctx.now` rather than `new Date()` for the reason every clock in this
      service takes it from the context: a test that cannot move `now` cannot
      test a forecast at all.
    */
    const elapsed = projectionElapsedFraction(ctx.period, ctx.now)

    /*
      FAKT 2 FIRST, THEN FAKT 1 — the client's own rule, stated 2026-09-04:
      «kimda koʻp fakt 1 va fakt 2 boʻlsa u yuqori oʻrinda turadi».

      Delivered money leads, because that is what the floor is paid on. But
      ranking on it ALONE leaves the board blank for most of a working day:
      delivery takes days, so on «Bugun» and «Kecha» every row holds zero
      FAKT 2, the whole ranking collapses to a tie and the deciding factor
      becomes an internal employee id — 55 sellers, 148 mln soʻm confirmed
      between them, and not one of them ranked. Confirmed money is the honest
      second key: it is the work they have actually done today, and it orders
      exactly the people FAKT 2 cannot separate yet.

      The employee id remains the last resort, so two sellers level on both
      figures do not swap places between two refreshes of one screen — and a
      name sort would reorder them on a rename.
    */
    const ordered = [...rows].sort(
      (a, b) =>
        (b.wonMinor > a.wonMinor ? 1 : b.wonMinor < a.wonMinor ? -1 : 0) ||
        (b.orderedMinor > a.orderedMinor ? 1 : b.orderedMinor < a.orderedMinor ? -1 : 0) ||
        a.employeeId.localeCompare(b.employeeId),
    )

    /*
      COMPETITION RANKING: equal money, equal rank, and the next rank skips.

      Equal on BOTH figures, now that both decide the order — otherwise two
      sellers level on FAKT 2 but far apart on FAKT 1 would share a rank the
      sort had already separated them by, and the board would print 1, 1, 3
      over rows that visibly differ.

      `/analytics/leaderboard` ranks the same floor 1, 2, 2, 4 and two boards
      disagreeing about who is second is the kind of thing a bonus argument
      starts over. The id still decides DISPLAY order among true ties, so the
      table does not reshuffle between two refreshes of one screen.
    */
    const rankOf = ordered.map((row, index) => {
      const previous = index > 0 ? ordered[index - 1] : undefined
      return previous &&
        previous.wonMinor === row.wonMinor &&
        previous.orderedMinor === row.orderedMinor
        ? -1
        : index + 1
    })
    for (let i = 1; i < rankOf.length; i++) {
      if (rankOf[i] === -1) rankOf[i] = rankOf[i - 1]!
    }

    const boardRows = ordered.map<SellerBoardRowDto>((row, index) => ({
      rank: rankOf[index]!,
      employeeId: row.employeeId,
      fullName: row.fullName,
      rop: row.rop,
      orders: row.orders,
      ordered: toMoneyDto(money(row.orderedMinor, ctx.currency)),
      won: toMoneyDto(money(row.wonMinor, ctx.currency)),
      wonOrders: row.wonOrders,
      open: toMoneyDto(money(row.openMinor, ctx.currency)),
      openOrders: row.openOrders,
      lostOrders: row.lostOrders,
      lostAfterConfirmOrders: row.lostAfterConfirmOrders,
      lostAfterConfirm: toMoneyDto(money(row.lostAfterConfirmMinor, ctx.currency)),
      cohortOrders: row.cohortOrders,
      /*
        Resolved, not taken: an order still open has not failed, so counting
        it against the seller would make a busy week look like a bad one. The
        denominator is what has actually been decided.
      */
      conversionPercent: roundOrNull(ratePercent(row.wonOrders, row.wonOrders + row.lostOrders)),
      sharePercent: roundOrNull(ratePercent(row.wonMinor, totalWonMinor)),
      forecast: forecastFor(row.orderedMinor, row.wonMinor, elapsed, ctx.currency),
    }))

    /*
      THE LADDER, PER SELLER — summed into the fund and counted, never sent
      per row: the seat chips left the television on 2026-09-07 and the
      ladder left Savdo dinamikasi on 2026-09-10. Not computed at all under a
      filter that cuts a seller's FAKT 2 apart; see `bonusPayable`.
    */
    const bonusMinor = slicesSellerFakt2(filters)
      ? null
      : rows.map((row) => bonusEarnedMinor(row.wonMinor, row.fullName))

    /*
      Summed here, beside every other total, and only on the queue basis —
      the intake rows carry null for the same reason the DTO field can be.
    */
    const outcomes = basis === 'queue' ? outcomeTotals(rows, ctx.currency) : null
    const cohortOrders = rows.reduce((a, r) => a + r.cohortOrders, 0)

    return {
      rows: boardRows,
      /*
        Said on the payload, not inferred from the row count. Twelve rows is a
        small company and also one ROP's floor, and the difference decides
        whether «1-oʻrin» means anything.
      */
      /*
        FROM THE SLICES, NOT FROM THE SELLERS' ROWS. On the queue basis an
        order counts for the team on its own deal card, so a seller who
        moved team mid-window is in both tables' worth of money — see
        `mergeSellerTeamSlices`.
      */
      teams: teamRows(teamSlices, totalWonMinor, elapsed, ctx.currency),
      totals: {
        sellers: rows.length,
        teams: new Set(teamSlices.map((r) => r.rop).filter((r): r is string => r !== null)).size,
        teamlessSellers: rows.filter((r) => r.rop === null).length,
        orders: rows.reduce((a, r) => a + r.orders, 0),
        cohortOrders,
        outcomes,
        /*
          The queue board's own arithmetic, to the digit: one decimal, over
          the whole cohort, null over nothing. Not `ratePercent` +
          `roundOrNull` — those round to SHARE_DECIMALS, and a rate that the
          two screens print differently in the last place is the kind of
          disagreement this figure exists to prevent.
        */
        confirmedRate:
          outcomes === null || cohortOrders === 0
            ? null
            : Math.round((outcomes.CONFIRMED.orders / cohortOrders) * 1000) / 10,
        ordered: toMoneyDto(money(totalOrderedMinor, ctx.currency)),
        won: toMoneyDto(money(totalWonMinor, ctx.currency)),
        wonOrders: rows.reduce((a, r) => a + r.wonOrders, 0),
        open: toMoneyDto(money(sum(rows, (r) => r.openMinor), ctx.currency)),
        openOrders: rows.reduce((a, r) => a + r.openOrders, 0),
        /*
          THE THREE COUNTS THE PAGE WAS REDUCING FROM `rows` BY HAND.

          `ConfirmationFaktSection` already summed `wonOrders + lostOrders`
          across every row to print the conversion's own denominator, because
          the totals carried no loss count — and the moment a second block
          needed «how many are still on the road» or «how many died after
          confirmation», the page would have grown a second and a third
          hand-rolled reduction over the same array. Each one is a place where
          a filtered, sliced or paged `rows` silently disagrees with the totals
          printed beside it. They are summed once, here, where every other
          total on this payload is summed.
        */
        lostOrders: rows.reduce((a, r) => a + r.lostOrders, 0),
        lostAfterConfirmOrders: rows.reduce((a, r) => a + r.lostAfterConfirmOrders, 0),
        lostAfterConfirm: toMoneyDto(
          money(sum(rows, (r) => r.lostAfterConfirmMinor), ctx.currency),
        ),
        conversionPercent: roundOrNull(
          ratePercent(
            rows.reduce((a, r) => a + r.wonOrders, 0),
            rows.reduce((a, r) => a + r.wonOrders + r.lostOrders, 0),
          ),
        ),
        /*
          THE FUND IS NOT BRAND-KNOWABLE, so a brand slice states none — and
          nor does a source filter, which cuts the same way (2026-10-06).

          The client's ladder (45 / 60 / 70 mln → 1 / 1.5 / 2 mln) pays on a
          seller's WHOLE FAKT 2, and a step function of a sum is not the sum of
          the steps: a seller at 30 mln Collagen + 20 mln Zextra earns the
          45 mln rung, yet read 0 under «Collagen», 0 under «Zextra» and 0
          under «Brendsiz» — three slices adding up to 0 against 1 000 000 on
          «Hammasi», on a page whose brand slices are promised to add up. The
          unsliced fund is no answer either: every figure under the switch
          follows it, and this one would not. «Manba» narrows each seller's
          FAKT 2 deal by deal too, so 30 mln from one source and 20 mln from
          another read 0 under each.
        */
        bonusPayable:
          bonusMinor === null ? null : toMoneyDto(money(sum(bonusMinor, (b) => b), ctx.currency)),
        sellersInBonus: bonusMinor === null ? null : bonusMinor.filter((b) => b > 0n).length,
      },
      forecast: forecastOf(totalOrderedMinor, totalWonMinor, elapsed, ctx),
      basis: basis === 'queue' ? 'confirmation_queue' : 'created_in_period',
    }
  }

  /**
   * The record wall — the biggest month each seller has had, newest first.
   *
   * WHY THE WALL STARTS WHERE IT DOES, AND WHY THE DATE IS A CONSTANT RATHER
   * THAN «BARCHA VAQT». Before the operator snapshot
   * (`UF_CRM_1778416910`) began arriving, a deal was credited to
   * `ASSIGNED_BY_ID` — the CURRENT assignee — and this portal moves deals to
   * back office while they are processed. Measured on production 2026-09-08,
   * by month, on FAKT 2: June's champion is Fazliddinov Bunyodjon with
   * 321 630 000 soʻm over 220 orders and July's is the same man with
   * 830 660 000 over 551, and he is the head of Операцион, not a seller.
   * August's is a real one — 154 Marjona Xayrullayeva, 128 550 000 — and the
   * proof that the snapshot is what changed is the ROP-less total on the same
   * board: 840 510 000 soʻm in July against 29 600 000 in August.
   *
   * So an unbounded wall would open on a 830 mln «record» that no seller set
   * and none can ever beat, on a television the floor reads to know where they
   * stand. The wall begins the month the attribution became true. That is a
   * data fact, not a preference: if the portal is ever backfilled, this
   * constant moves and nothing else does.
   *
   * THE SPAN'S UPPER BOUND IS `now`, so the month in progress is on the wall
   * and can take the record from a closed one. Delivery lags confirmation by
   * about two days, which is exactly why the ordering falls back to FAKT 1 —
   * see `recordsSql`. A running month is marked on the DTO rather than hidden:
   * a champion who is winning a month that is not over is a different claim
   * from one who won it, and the screen says which.
   */
  async records(ctx: AnalyticsContext): Promise<SellerRecordsDto> {
    const filters = boardFilters(ctx)
    const period = recordWindow(ctx.now, ctx.period.timeZone)

    /*
      NO `period.end` IN THE KEY — the trap `medals()` documents below, and
      the one this memo sat in until 2026-10-06. `recordWindow` builds the end
      from `ctx.now`, a fresh `new Date()` per request, so the key changed
      every millisecond: the wall — the widest cohort on the landing page,
      re-asked by every open television every ten minutes — was rebuilt on
      every request, and readers arriving together never shared a build. The
      start (`RECORDS_FROM`), the zone, the currency and the filters name the
      question; the ten-minute TTL bounds how old the answer is, which at a
      month's turn means `running` may lag the calendar by that much.
    */
    const key = [
      period.start.toISOString(),
      period.timeZone,
      ctx.currency,
      keyPart(filters.employeeIds),
      keyPart(filters.departmentIds),
      keyPart(filters.sourceIds),
      filters.brand?.slice ?? '',
    ].join('|')

    return recordsCache.get(key, () => this.buildRecords(ctx, period, filters))
  }

  private async buildRecords(
    ctx: AnalyticsContext,
    period: Period,
    filters: SellerBoardFilters,
  ): Promise<SellerRecordsDto> {
    const rows = await this.insights.confirmationSellerRecords(
      scopedPeriod(period, filters),
      filters,
    )

    const runningMonth = monthKey(ctx.now, period.timeZone)

    return {
      from: period.start.toISOString(),
      months: rows.map((r) => {
        // The seat's own rule, restated on the DTO so the screen does not have
        // to re-derive which of the two figures earned the place.
        const delivered = r.deliveredMinor > 0n
        return {
          month: r.month,
          running: r.month.slice(0, 7) === runningMonth,
          employeeId: r.employeeId,
          fullName: r.fullName,
          rop: r.rop,
          basis: delivered ? ('delivered' as const) : ('confirmed' as const),
          amount: toMoneyDto(
            money(delivered ? r.deliveredMinor : r.confirmedMinor, ctx.currency),
          ),
          orders: delivered ? r.deliveredOrders : r.confirmedOrders,
          confirmed: toMoneyDto(money(r.confirmedMinor, ctx.currency)),
          confirmedOrders: r.confirmedOrders,
          delivered: toMoneyDto(money(r.deliveredMinor, ctx.currency)),
          deliveredOrders: r.deliveredOrders,
        }
      }),
    }
  }

  /**
   * Medallar — `{ sellers: [{ employeeId, medals }], from }`, darajasiz.
   *
   * DAVR FILTRIGA BO'YSUNMAYDI, va bu ataylab: oyna doim `RECORDS_FROM` dan
   * bugungacha. Medal butun tarixning fakti, «Bugun» tanlanganda yo'qoladigan
   * narsa emas — aks holda filtr motivatsiyani o'chirib qo'yadigan tugmaga
   * aylanardi. Devor ham aynan shu sababdan o'z oynasida yashaydi.
   *
   * Kesh kaliti `records()` ning kaliti bilan bir xil — ikkalasida ham
   * `period.end` ATAYLAB yo'q; pastdagi izohga qarang.
   */
  async medals(ctx: AnalyticsContext): Promise<SellerMedalsDto> {
    const filters = boardFilters(ctx)
    const period = recordWindow(ctx.now, ctx.period.timeZone)

    /*
      `period.end` BU YERDA ATAYLAB YO'Q. `recordWindow` uni `ctx.now`dan
      quradi — har so'rovda yangi `new Date()` — ya'ni kalitga qo'shilsa,
      kalit har millisekundda boshqacha bo'lib, kesh HECH QACHON hit
      bo'lmasdi: ikkala kogorta qurilishi ham (~2 s o'lchangan) HAR
      SO'ROVDA ishga tushardi, va `ttlCache`ning promise'ni qo'shib
      yuborishi — butun floor bir vaqtda ochganda ishlashi uchun
      yozilgan — hech qachon ishlamas edi. O'N DAQIQALIK TTL javobni yangi
      ushlab turadi; kalitga esa faqat SAVOLNI aniqlash kerak, savol esa
      "RECORDS_FROM dan buyon qaysi medallar, shu filtrlar ostida" — buni
      `period.start` (RECORDS_FROM ning o'zi), mintaqa, valyuta va filtrlar
      to'liq aytib beradi, `end`siz ham.
    */
    const key = [
      period.start.toISOString(),
      period.timeZone,
      ctx.currency,
      keyPart(filters.employeeIds),
      keyPart(filters.departmentIds),
      keyPart(filters.sourceIds),
      filters.brand?.slice ?? '',
    ].join('|')

    return medalsCache.get(key, () => this.buildMedals(ctx, period, filters))
  }

  private async buildMedals(
    ctx: AnalyticsContext,
    period: Period,
    filters: SellerBoardFilters,
  ): Promise<SellerMedalsDto> {
    const facts = await this.insights.sellerMedalFacts(scopedPeriod(period, filters), filters)

    const rows = buildSellerMedals({
      months: facts.months,
      days: facts.days,
      runningMonth: monthKey(ctx.now, period.timeZone),
      // Tugamagan kun ⚡ ham, 🌅 ham bermaydi — hisobot mintaqasidagi bugun.
      runningDay: zonedDateKey(ctx.now, period.timeZone),
    })

    return {
      from: period.start.toISOString(),
      sellers: rows.map((row) => ({
        employeeId: row.employeeId,
        medals: row.medals.map((m) => ({
          code: m.code,
          count: m.count,
          at: m.at,
          amount: m.amountMinor === null ? null : toMoneyDto(money(m.amountMinor, ctx.currency)),
          orders: m.orders,
          percent: m.percent === null ? null : roundPercent(m.percent),
        })),
      })),
    }
  }

  /**
   * FAKT 1 and FAKT 2 as a time series, on the hero chart's own buckets.
   *
   * THE BUCKETS ARE NOT THIS METHOD'S CHOICE. They come from
   * `enumerateBuckets(ctx.period)` with its default granularity — the same
   * call `revenueTrend` makes for the area these two lines are drawn over — so
   * the two series share one x axis by construction rather than by agreement.
   * Widen one and the other widens with it; give this one its own granularity
   * and the chart compares the 3rd of September with the 5th while looking
   * perfectly ordinary.
   *
   * EVERY BUCKET IS EMITTED, including the ones the queue was empty on. The
   * repository returns only the days that carry orders, which is wrong for a
   * series drawn beside another: a shorter array is silently indexed against
   * the longer one and every point after the first quiet day is drawn a day
   * early.
   *
   * A DIFFERENT CLOCK FROM THE AREA UNDERNEATH, and the screen says so. These
   * are dated by the order's arrival in the confirmation queue (C4:NEW);
   * revenue is dated by the close. The client asked for the comparison on one
   * chart on 2026-09-09 knowing that; `RevenueTrendChart` prints the basis
   * under the title and in the tooltip so no reader has to be told twice.
   */
  async faktTrend(ctx: AnalyticsContext): Promise<readonly FaktTrendPointDto[]> {
    const filters = boardFilters(ctx)
    /*
      Memoised like the board beside it (2026-10-05): it rebuilds the same
      queue cohort, polled with it, and had no memo at all. Company-wide by the
      same rule as the board (`boardFilters` drops the scope), so the key is the
      window and the filters.
    */
    const key = [
      ctx.period.preset,
      ctx.period.start.toISOString(),
      ctx.period.end.toISOString(),
      keyPart(filters.employeeIds),
      keyPart(filters.departmentIds),
      keyPart(filters.sourceIds),
      filters.brand?.slice ?? '',
    ].join('|')
    const days = await faktDaysCache.get(key, () =>
      this.insights.confirmationFaktDays(scopedPeriod(ctx.period, filters), filters),
    )

    return enumerateBuckets(ctx.period).map((bucket) => {
      /*
        Matched on the ZONED DATE STRING, which is what the query grouped by.
        Comparing the day against the bucket's instants would work until a
        bucket boundary and a UTC offset disagreed — Tashkent midnight is
        19:00 the previous day — and the failure is a day of money moved one
        column left, not an error.
      */
      const from = zonedDateKey(bucket.start, ctx.period.timeZone)
      const until = zonedDateKey(bucket.end, ctx.period.timeZone)

      let fakt1 = 0n
      let fakt2 = 0n
      let orders = 0
      const byOutcome: Record<ConfirmationOutcomeValue, number> = {
        CONFIRM_NEW: 0,
        NO_ANSWER: 0,
        CONFIRMED: 0,
        REJECTED: 0,
        UNCONFIRMED_SHIPPED: 0,
      }
      /*
        A scan per bucket rather than an index: the widest window this chart
        draws is a year of days against 53 weekly buckets, so the whole thing
        is a few thousand string comparisons — cheaper to read than a second
        grouping that would have to reproduce the granularity rule.
      */
      for (const day of days) {
        if (day.date < from || day.date >= until) continue
        fakt1 += day.confirmedMinor
        fakt2 += day.deliveredMinor
        orders += day.orders
        for (const state of CONFIRMATION_OUTCOMES) byOutcome[state] += day.byOutcome[state]
      }

      return {
        date: bucket.start.toISOString(),
        fakt1: Number(fakt1) / 100,
        fakt2: Number(fakt2) / 100,
        orders,
        byOutcome,
        cohortOrders: CONFIRMATION_OUTCOMES.reduce((a, state) => a + byOutcome[state], 0),
      }
    })
  }

  /**
   * FAKT 1 / FAKT 2 by source — «Manbalar boʻyicha» on Savdo dinamikasi.
   *
   * Queue basis only: the table sits under the hero, which is FAKT 1 / FAKT 2,
   * and the intake reading has no such words to print.
   *
   * KEYED LIKE THE BOARD, and unscoped like it, for the same reason — see
   * `board()`. `boardFilters` drops the scope here too, so a ROP reading this
   * table reads the company's sources exactly as they read the company's
   * teams one table above.
   */
  async sources(ctx: AnalyticsContext): Promise<readonly SellerSourceRowDto[]> {
    const filters = boardFilters(ctx)

    const key = [
      ctx.period.preset,
      ctx.period.start.toISOString(),
      ctx.period.end.toISOString(),
      ctx.currency,
      keyPart(filters.employeeIds),
      keyPart(filters.departmentIds),
      keyPart(filters.sourceIds),
      filters.brand?.slice ?? '',
    ].join('|')

    return sourcesCache.get(key, async () => {
      const rows = await this.insights.confirmationSourceRating(
        scopedPeriod(ctx.period, filters),
        filters,
      )
      return sourceRows(rows, projectionElapsedFraction(ctx.period, ctx.now), ctx.currency)
    })
  }

  /**
   * One row per operator, on whichever clock `basis` names — and the per-team
   * slices those rows were folded from, for the team table.
   *
   * On the intake basis the two are the same array: that query groups by the
   * assignee alone and names the team off their department, so a seller has
   * one team by construction. On the queue basis the team is the deal's own
   * snapshot and a seller can have several — see `mergeSellerTeamSlices`.
   */
  private async rowsFor(
    period: Period,
    basis: SellerBoardBasisValue,
    filters: SellerBoardFilters,
  ): Promise<{ rows: SellerBoardRow[]; teamSlices: SellerBoardRow[] }> {
    if (basis === 'intake') {
      const rows = await this.repo.board(period, filters)
      return { rows, teamSlices: rows }
    }

    /*
      THE SAME RESTRICTION, TWICE, BECAUSE THE TWO BASES SCOPE ON TWO PEOPLE.

      `intake` groups by the deal's assignee and takes the scope through
      `filterSql`. The queue basis groups by the OPERATOR — the portal's own
      snapshot of who sold it, resolved in the confirmation cohort — so its
      restriction has to travel on the window and be applied in the prelude
      against that person. Filtering the queue basis by the assignee would put
      the 556-orders-on-the-head-of-Операцион class of deal on the wrong side
      of a team boundary, which is the same drift the operator column exists
      to fix.
    */
    const slices = await this.insights.confirmationSellerRating(
      scopedPeriod(period, filters),
      filters,
    )
    const toBoardRow = (r: ConfirmationSellerRatingRow): SellerBoardRow => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        rop: r.rop,
        // Not carried: the confirmation-queue cohort already resolves `rop`
        // from the department name, and nothing downstream reads this field.
        departmentName: null,
        orders: r.confirmedOrders,
        orderedMinor: r.confirmedMinor,
        wonOrders: r.deliveredOrders,
        wonMinor: r.deliveredMinor,
        openOrders: r.inTransitOrders,
        openMinor: r.inTransitMinor,
        /*
          BOTH KINDS OF LOSS, because the conversion rate divides by them.

          A refusal in the queue and an order confirmed then cancelled before
          dispatch are different events, but they are both resolved and both
          belong in the denominator. Counting only the first flattered July's
          board by 3.4 points — 84.1% where the truth is 80.7%.
        */
        lostOrders: r.rejectedOrders + r.lostAfterConfirmOrders,
        lostAfterConfirmOrders: r.lostAfterConfirmOrders,
        // Measured in `ratingSql` since the FAKT columns were written and
        // dropped here until 2026-09-09 — see `SellerBoardRow`.
        lostAfterConfirmMinor: r.lostAfterConfirmMinor,
        cohortOrders: r.cohortOrders,
        byOutcome: r.byOutcome,
        byOutcomeMinor: r.byOutcomeMinor,
      })
    return {
      rows: mergeSellerTeamSlices(slices).map(toBoardRow),
      teamSlices: slices.map(toBoardRow),
    }
  }
}

// ---------------------------------------------------------------------------

/** Keep only the filters this board's SQL can honestly honour. */
/**
 * The reader's OWN filters, and deliberately not their data scope.
 *
 * `restrictToEmployeeIds` is dropped rather than forwarded, and dropping it
 * here is what makes the omission hard to undo by accident: the route already
 * declines to spread `ctx.scope`, and this is the second place a scope would
 * have to reappear before it could reach the SQL. See the route's own docblock
 * for why this board is company-wide for every caller.
 */
function boardFilters(ctx: AnalyticsContext): SellerBoardFilters {
  return {
    employeeIds: ctx.filters.employeeIds,
    departmentIds: ctx.filters.departmentIds,
    sourceIds: ctx.filters.sourceIds,
    ...brandSliceOf(ctx),
  }
}

/**
 * Whether the reader's filters cut a seller's FAKT 2 apart DEAL BY DEAL — the
 * brand switch (`saleBrand`) and the source filter (`"sourceId"` in both
 * repositories' filter SQL) — rather than keeping or dropping whole sellers,
 * as the employee and department filters do. The bonus ladder pays on the
 * WHOLE FAKT 2 and is not linear, so under such a cut it has no fund to state
 * (`bonusPayable`). An empty `sourceIds` is no filter, as everywhere here.
 */
function slicesSellerFakt2(filters: SellerBoardFilters): boolean {
  return filters.brand !== undefined || (filters.sourceIds?.length ?? 0) > 0
}

/**
 * The brand switch as a sales filter (`BrandSlice`): an order is its
 * product's brand (`saleBrand` — the client, 2026-10-06: «mahsulot
 * bo'yicha»), and only an order with no line items its selling team's. «Brendsiz»
 * is every order neither brand claims, so the three slices add up to the
 * whole board. Empty for «Hammasi».
 */
export function brandSliceOf(ctx: AnalyticsContext): { brand?: BrandSlice } {
  const brand = ctx.filters.brand
  if (brand === undefined || brand === 'all') return {}
  return { brand: { slice: brand, collagenTeams: brandTeams('Collagen'), zextraTeams: brandTeams('Zextra') } }
}

/**
 * What the client's ladder pays one seller: the bonus of the highest tier their
 * FAKT 2 has cleared, nothing below the first floor.
 *
 * GATED ON THE BAND FIRST. Outside 107–147 the client's ladder pays nothing,
 * so neither does this — see `bonusEligible`.
 */
function bonusEarnedMinor(wonMinor: bigint, fullName: string): bigint {
  if (!bonusEligible(fullName)) return 0n
  return BONUS_TIERS.find((tier) => wonMinor >= tier.floorMinor)?.bonusMinor ?? 0n
}

/**
 * Sellers folded into their ROP's team, ranked the same way rows are.
 *
 * "The same way" is literal since 2026-09-07 and has to stay so: FAKT 2, then
 * FAKT 1, then the name, with competition ranking over both figures. The two
 * lists sit side by side on the floor's television, and one of them ordering
 * by a key the other does not is a disagreement a reader can see.
 */
function teamRows(
  /** One row per seller AND team — see `rowsFor`. A seller may be in two teams. */
  rows: readonly SellerBoardRow[],
  totalWonMinor: bigint,
  /** The board's ONE elapsed fraction — see `buildBoard`. Never re-derived here. */
  elapsed: number,
  currency: string,
): readonly SellerTeamRowDto[] {
  const byRop = new Map<string, SellerBoardRow[]>()
  for (const row of rows) {
    // A seller off every ROP team is left out rather than bucketed into an
    // "Other" team: this table is about teams, and a bucket of people who
    // share only the absence of a manager is not one.
    if (row.rop === null) continue
    const group = byRop.get(row.rop)
    if (group) group.push(row)
    else byRop.set(row.rop, [row])
  }

  /*
    THE SAME TWO KEYS THE SELLERS ARE ORDERED BY, AND FOR THE SAME REASON.

    FAKT 2 alone left this list ALPHABETICAL for most of a working day:
    delivery lags confirmation by days, so on «Bugun» every team's FAKT 2 is
    zero, the money comparison ties for all fifteen of them and the name was
    the only thing left deciding — «Asliddin» first on 2 mln confirmed,
    «Gulzora» fourth on 40 mln. The table it used to feed printed the figures
    beside the rank and the reader could see the order was not the money's;
    the television seats the first three on a podium and each seat names the
    fact that put it there («FAKT 1 · tasdiqlangan»), which an alphabetical
    order makes a false claim rather than an odd one — and every «Liderga +N»
    gap on a card behind it goes negative.

    FAKT 1 is therefore the second key here exactly as it is for a seller, and
    the name stays the last resort so two teams level on both figures do not
    swap places between two refreshes of one screen.
  */
  const ordered = [...byRop.entries()]
    .map(([rop, members]) => ({
      rop,
      members,
      wonMinor: sum(members, (m) => m.wonMinor),
      orderedMinor: sum(members, (m) => m.orderedMinor),
    }))
    .sort(
      (a, b) =>
        (b.wonMinor > a.wonMinor ? 1 : b.wonMinor < a.wonMinor ? -1 : 0) ||
        (b.orderedMinor > a.orderedMinor ? 1 : b.orderedMinor < a.orderedMinor ? -1 : 0) ||
        a.rop.localeCompare(b.rop),
    )

  /*
    COMPETITION RANKING, the seller rule applied to teams: equal on BOTH
    figures, equal rank, and the next rank skips. Two teams level on FAKT 2
    and far apart on FAKT 1 print 1 and 2 over visibly different rows, because
    the sort has already separated them by the second key.
  */
  const rankOf = ordered.map((team, index) => {
    const previous = index > 0 ? ordered[index - 1] : undefined
    return previous &&
      previous.wonMinor === team.wonMinor &&
      previous.orderedMinor === team.orderedMinor
      ? -1
      : index + 1
  })
  for (let i = 1; i < rankOf.length; i++) {
    if (rankOf[i] === -1) rankOf[i] = rankOf[i - 1]!
  }

  return ordered
    .map<SellerTeamRowDto>((team, index) => {
      const wonOrders = team.members.reduce((a, m) => a + m.wonOrders, 0)
      const lostOrders = team.members.reduce((a, m) => a + m.lostOrders, 0)
      return {
        rank: rankOf[index]!,
        rop: team.rop,
        sellers: team.members.length,
        orders: team.members.reduce((a, m) => a + m.orders, 0),
        ordered: toMoneyDto(money(team.orderedMinor, currency)),
        won: toMoneyDto(money(team.wonMinor, currency)),
        wonOrders,
        open: toMoneyDto(money(sum(team.members, (m) => m.openMinor), currency)),
        conversionPercent: roundOrNull(ratePercent(wonOrders, wonOrders + lostOrders)),
        sharePercent: roundOrNull(ratePercent(team.wonMinor, totalWonMinor)),
        /* The team's own money projected once — not its sellers' projections
           summed. See `SellerTeamRowDto.forecast`. */
        forecast: forecastFor(team.orderedMinor, team.wonMinor, elapsed, currency),
      }
    })
}

/**
 * The sources ranked by the teams' rule — FAKT 2, then FAKT 1, then the name —
 * with competition ranking over both figures. See `teamRows` for why FAKT 1 is
 * the second key: on «Bugun» FAKT 2 is zero for every row and the name alone
 * would be ordering the table.
 *
 * The unnamed row sorts on its money like any other; only a tie on both
 * figures puts it after the named ones.
 */
function sourceRows(
  rows: readonly ConfirmationSourceRatingRow[],
  elapsed: number,
  currency: string,
): readonly SellerSourceRowDto[] {
  const totalOrderedMinor = sum(rows, (r) => r.confirmedMinor)
  const totalWonMinor = sum(rows, (r) => r.deliveredMinor)

  const ordered = [...rows].sort(
    (a, b) =>
      (b.deliveredMinor > a.deliveredMinor ? 1 : b.deliveredMinor < a.deliveredMinor ? -1 : 0) ||
      (b.confirmedMinor > a.confirmedMinor ? 1 : b.confirmedMinor < a.confirmedMinor ? -1 : 0) ||
      (a.sourceName === null ? 1 : 0) - (b.sourceName === null ? 1 : 0) ||
      (a.sourceName ?? '').localeCompare(b.sourceName ?? ''),
  )

  const rankOf = ordered.map((row, index) => {
    const previous = index > 0 ? ordered[index - 1] : undefined
    return previous &&
      previous.deliveredMinor === row.deliveredMinor &&
      previous.confirmedMinor === row.confirmedMinor
      ? -1
      : index + 1
  })
  for (let i = 1; i < rankOf.length; i++) {
    if (rankOf[i] === -1) rankOf[i] = rankOf[i - 1]!
  }

  return ordered.map<SellerSourceRowDto>((row, index) => {
    // Both kinds of loss, as on a seller's row — see `rowsFor`.
    const lostOrders = row.rejectedOrders + row.lostAfterConfirmOrders
    return {
      rank: rankOf[index]!,
      sourceId: row.sourceId,
      name: row.sourceName,
      sellers: row.sellers,
      cohortOrders: row.cohortOrders,
      orders: row.confirmedOrders,
      ordered: toMoneyDto(money(row.confirmedMinor, currency)),
      won: toMoneyDto(money(row.deliveredMinor, currency)),
      wonOrders: row.deliveredOrders,
      open: toMoneyDto(money(row.inTransitMinor, currency)),
      lostAfterConfirm: toMoneyDto(money(row.lostAfterConfirmMinor, currency)),
      rejectedOrders: row.rejectedOrders,
      conversionPercent: roundOrNull(
        ratePercent(row.deliveredOrders, row.deliveredOrders + lostOrders),
      ),
      fakt1SharePercent: roundOrNull(ratePercent(row.confirmedMinor, totalOrderedMinor)),
      sharePercent: roundOrNull(ratePercent(row.deliveredMinor, totalWonMinor)),
      forecast: forecastFor(row.confirmedMinor, row.deliveredMinor, elapsed, currency),
    }
  })
}

/**
 * Straight-line run-rate for the period's won intake.
 *
 * Null once the period is over — a finished total is not a forecast — and
 * null below a 2% elapsed floor, where dividing by a sliver of a month
 * multiplies one early order into a fantasy.
 *
 * THE FRACTION IS OF THE WHOLE CALENDAR UNIT, NOT OF THE WINDOW — and the
 * difference is the whole value of this field.
 *
 * `periodElapsedFraction(ctx.period, …)` was what stood here, and a to-date
 * preset is by construction almost entirely elapsed: «Shu oy» resolves to
 * [1-sen, tomorrow), so on 9 September this returned 94.4% and projected
 * FAKT 2 forward by six percent — a "month-end forecast" of tonight.
 * `performance.ts` records the same bug from the KPI screen at length
 * («on the 2nd of a 30-day month the page announced davrning 79% qismi
 * oʻtdi… The number was wrong every day of every month»), and `pulse.ts`
 * already carries the fix that screen's forecast uses. This one had simply
 * never been rendered, so nobody saw it: it reached the DTO, and every
 * feature that could have printed it left it alone.
 *
 * `projectionElapsedFraction` measures against `fullUnitWindow` — this_month
 * against its month, this_week against its seven days — and passes finished
 * presets through unchanged, where the elapsed fraction is 1 and the
 * "projection" is simply what happened.
 */
function forecastOf(
  orderedMinor: bigint,
  wonMinor: bigint,
  elapsed: number,
  ctx: AnalyticsContext,
): SellerBoardForecastDto {
  const company = forecastFor(orderedMinor, wonMinor, elapsed, ctx.currency)
  const full = fullUnitWindow(ctx.period)

  /*
    THE CONTINUATION IS DRAWN ON THE TREND'S OWN CADENCE, AND THE GRANULARITY
    IS PASSED IN RATHER THAN RE-CHOSEN.

    `enumerateBuckets` defaults to `chooseGranularity(period)`, and the period
    handed to it here is the FULL unit while `faktTrend` hands it the to-date
    window. On «Shu yil» in February those are 46 days and 365 — one either
    side of the 62-day threshold — so the default would have drawn a DAILY
    measurement and a WEEKLY forecast on one axis, six dashed points continuing
    a line of forty-six. Asking `chooseGranularity` the SAME question the trend
    asks is what keeps the two halves of one line the same stride.

    ONLY BUCKETS THAT START AFTER THE REPORT WINDOW ENDS. Today's bucket is
    half-elapsed and already carries measured money in `faktTrend`; projecting
    into it as well would draw the same hours twice, and the overlap is
    invisible — a solid point and a dashed point sitting on one date, both
    plausible.
  */
  const future = enumerateBuckets(full, chooseGranularity(ctx.period)).filter(
    (bucket) => bucket.start.getTime() >= ctx.period.end.getTime(),
  )

  const spread = (projected: MoneyDto | null, actualMinor: bigint): readonly bigint[] =>
    projected === null
      ? []
      : spreadRemainingMinor(BigInt(projected.amountMinor) - actualMinor, future.length)

  const fakt1Buckets = spread(company.fakt1, orderedMinor)
  const fakt2Buckets = spread(company.fakt2, wonMinor)

  return {
    ...company,
    elapsedPercent: roundPercent(Math.min(1, Math.max(0, elapsed)) * 100),
    windowEnd: full.end.toISOString(),
    /*
      Lossy major units, `Number(minor) / 100`, exactly as `faktTrend` writes
      its own points — the two arrays are concatenated onto one axis by the
      chart, and a bucket serialised the other way would plot a hundredfold
      out with no error anywhere.
    */
    buckets: future.map((bucket, index) => ({
      date: bucket.start.toISOString(),
      fakt1: Number(fakt1Buckets[index] ?? 0n) / 100,
      fakt2: Number(fakt2Buckets[index] ?? 0n) / 100,
    })),
  }
}

/**
 * One money figure projected to the end of its calendar unit, or null.
 *
 * NULL IS THREE DIFFERENT ABSENCES AND THE SCREEN NAMES EACH ONE: the period
 * is over (a total is not a forecast), too little of it has elapsed to divide
 * by (`PROJECTION_ELAPSED_FLOOR`, ~the first fourteen hours of a month), or
 * there is nothing yet to project from. None of them is a zero, and a zero
 * printed for any of them is the page telling a floor that is working normally
 * that the month ends at nothing.
 */
function forecastMoney(minor: bigint, elapsed: number, currency: string): MoneyDto | null {
  if (!(elapsed < 1)) return null
  const projected = projectRevenueMinor(minor, elapsed)
  return projected === null ? null : toMoneyDto(money(projected, currency))
}

/** Both facts of one row, one team or the whole company, on one elapsed clock. */
function forecastFor(
  orderedMinor: bigint,
  wonMinor: bigint,
  elapsed: number,
  currency: string,
): SellerForecastDto {
  return {
    fakt1: forecastMoney(orderedMinor, elapsed, currency),
    fakt2: forecastMoney(wonMinor, elapsed, currency),
  }
}

function sum<T>(rows: readonly T[], pick: (row: T) => bigint): bigint {
  return rows.reduce((total, row) => total + pick(row), 0n)
}

/**
 * A share of the board, kept precise enough to say it is not zero.
 *
 * Six sellers who had genuinely won money read "0.0%" beside the eight who had
 * won none — see SHARE_DECIMALS.
 */
function roundOrNull(value: number | null): number | null {
  return value === null ? null : roundPercent(value, SHARE_DECIMALS)
}

/**
 * The five queue states summed over the board's rows — the same reduction
 * `cohortOrders` is, state by state, so the parts add up to the whole.
 *
 * A row with no states (the intake basis) counts as nothing rather than
 * poisoning the sum; the caller has already decided the whole map is null on
 * that basis, so this only ever meets nulls in a mixed fixture.
 */
function outcomeTotals(
  rows: readonly SellerBoardRow[],
  currency: string,
): Readonly<Record<ConfirmationOutcomeValue, SellerOutcomeDto>> {
  const totals = {} as Record<ConfirmationOutcomeValue, SellerOutcomeDto>
  for (const state of CONFIRMATION_OUTCOMES) {
    totals[state] = {
      orders: rows.reduce((a, r) => a + (r.byOutcome?.[state] ?? 0), 0),
      amount: toMoneyDto(money(sum(rows, (r) => r.byOutcomeMinor?.[state] ?? 0n), currency)),
    }
  }
  return totals
}
