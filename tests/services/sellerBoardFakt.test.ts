import { beforeEach, describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type {
  ConfirmationSellerRatingRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'
import { SellerBoardService, resetSellerBoardCache } from '@/server/services/sellerBoardService'

/**
 * WHAT THE FAKT SPINE ON SAVDO DINAMIKASI IS BUILT FROM.
 *
 * The client asked on 2026-09-09 for that page's essential data to be built on
 * FAKT 1 and FAKT 2. Two things this payload carried were not fit to build on,
 * and both were invisible because nothing rendered them:
 *
 *  1. `forecast` measured its elapsed fraction against the REPORT window, which
 *     for every to-date preset is almost entirely elapsed. Live on 9 September
 *     it answered 94.4% — a «month-end forecast» of tonight.
 *  2. The money behind «confirmed, then cancelled» was measured in SQL and
 *     dropped at the service boundary, so the only way to print it was
 *     `ordered − won − open` — an arithmetic that is WRONG here, because
 *     FAKT 2 is not a subset of FAKT 1.
 *
 * Both are now facts on the payload, and this file is what keeps them true.
 */

// Every case builds a board for one window; without this they share one memo
// entry and each case after the first asserts against the first's fixtures.
beforeEach(resetSellerBoardCache)

const TZ = 'Asia/Tashkent'
/** The 9th of a 30-day month, 09:00 on the floor. */
const NOW = new Date('2026-09-09T09:00:00+05:00')

const mln = (n: number) => BigInt(n) * 1_000_000n * 100n

function rating(
  over: Partial<ConfirmationSellerRatingRow> &
    Pick<ConfirmationSellerRatingRow, 'employeeId' | 'rop'>,
): ConfirmationSellerRatingRow {
  return {
    fullName: over.employeeId,
    cohortOrders: 1,
    confirmedOrders: 1,
    confirmedMinor: 0n,
    deliveredOrders: 0,
    deliveredMinor: 0n,
    inTransitOrders: 0,
    inTransitMinor: 0n,
    lostAfterConfirmOrders: 0,
    lostAfterConfirmMinor: 0n,
    rejectedOrders: 0,
    byOutcome: ZERO_STATES,
    byOutcomeMinor: ZERO_STATES_MINOR,
    ...over,
  }
}

const ZERO_STATES = {
  CONFIRM_NEW: 0,
  NO_ANSWER: 0,
  CONFIRMED: 0,
  REJECTED: 0,
  UNCONFIRMED_SHIPPED: 0,
} as const
const ZERO_STATES_MINOR = {
  CONFIRM_NEW: 0n,
  NO_ANSWER: 0n,
  CONFIRMED: 0n,
  REJECTED: 0n,
  UNCONFIRMED_SHIPPED: 0n,
} as const

async function boardOver(
  rows: readonly ConfirmationSellerRatingRow[],
  preset: 'today' | 'this_month' | 'previous_month' = 'this_month',
) {
  const insights = {
    confirmationSellerRating: async () => [...rows],
  } as unknown as InsightsRepository
  const service = new SellerBoardService({} as SellerBoardRepository, insights)
  // Built by hand rather than through `AnalyticsService.context`, whose module
  // reads `env` at import and would make this a test of the environment.
  const period = resolvePeriod(preset, { timeZone: TZ, now: NOW })
  const ctx = {
    period,
    comparison: previousEquivalent(period),
    currency: 'UZS',
    filters: {},
    now: NOW,
  } as unknown as AnalyticsContext
  return service.board(ctx, 'queue')
}

describe('the FAKT 2 run-rate measures the month, not the window', () => {
  it('reads the fraction of the CALENDAR unit that has elapsed', async () => {
    const board = await boardOver([rating({ employeeId: 'a', rop: 'Lola', deliveredMinor: mln(100) })])

    /*
      26.8% — 8 working days and half an hour of the 9th (09:00, the floor
      opens at 08:30), of thirty 9.5-hour days: 76.5 h of 285 h.

      The figure this replaces was 93.1%: `this_month` resolves to
      [1-sen, 10-sen) and a to-date window is by construction nearly spent, so
      the old reading projected a month's delivery forward by seven percent and
      called it «oy yakuni». `performance.ts` records the identical bug from
      the KPI screen — "The number was wrong every day of every month".
    */
    expect(board.forecast.elapsedPercent).toBeCloseTo(26.8, 1)
    expect(board.forecast.elapsedPercent).toBeLessThan(40)
  })

  it('projects the month from that fraction, not from the window', async () => {
    const board = await boardOver([rating({ employeeId: 'a', rop: 'Lola', deliveredMinor: mln(100) })])

    // 100 mln in 26.8% of the month's working time → ~373 mln by month end. The old reading
    // projected ~107 mln, which is barely a forecast at all.
    const projected = board.forecast.fakt2
    expect(projected).not.toBeNull()
    expect(projected!.amount / 1_000_000).toBeCloseTo(372.5, 0)
  })

  it('projects nothing for a period that is already over', async () => {
    // A finished total is not a forecast. `fullUnitWindow` passes completed
    // presets through unchanged, so the elapsed fraction is 1 and the guard
    // in `forecastOf` returns null rather than restating the total.
    const board = await boardOver(
      [rating({ employeeId: 'a', rop: 'Lola', deliveredMinor: mln(100) })],
      'previous_month',
    )

    expect(board.forecast.elapsedPercent).toBe(100)
    expect(board.forecast.fakt2).toBeNull()
  })
})

describe('the totals carry the loss the page prints', () => {
  const ROWS = [
    rating({
      employeeId: 'a',
      rop: 'Lola',
      cohortOrders: 10,
      confirmedOrders: 8,
      confirmedMinor: mln(80),
      deliveredOrders: 5,
      deliveredMinor: mln(50),
      inTransitOrders: 2,
      inTransitMinor: mln(20),
      lostAfterConfirmOrders: 1,
      lostAfterConfirmMinor: mln(10),
      rejectedOrders: 2,
    }),
    rating({
      employeeId: 'b',
      rop: 'Sevinch',
      cohortOrders: 6,
      confirmedOrders: 4,
      confirmedMinor: mln(40),
      deliveredOrders: 3,
      deliveredMinor: mln(36),
      inTransitOrders: 1,
      inTransitMinor: mln(3),
      lostAfterConfirmOrders: 0,
      lostAfterConfirmMinor: 0n,
      rejectedOrders: 2,
    }),
  ]

  it('sums the three counts the page used to reduce from rows by hand', async () => {
    const { totals } = await boardOver(ROWS)

    expect(totals.openOrders).toBe(3)
    // Refusals at the door PLUS the ones confirmed before they died — the
    // conversion rate's own denominator, which the page was reducing itself.
    expect(totals.lostOrders).toBe(5)
    expect(totals.lostAfterConfirmOrders).toBe(1)
  })

  it('carries the money of «confirmed, then cancelled» rather than leaving it to subtraction', async () => {
    const { totals } = await boardOver(ROWS)

    expect(totals.lostAfterConfirm.amountMinor).toBe(mln(10).toString())

    /*
      AND IT IS NOT `ordered − won − open`, which is the arithmetic a page
      without this field is forced into.

      Seller b delivered 36 mln against 40 mln confirmed with 3 mln still on
      the road, so the subtraction leaves 1 mln of «lost after confirm» for
      somebody who lost nothing — it is really the money of an order that was
      delivered without ever being confirmed. FAKT 2 is not a subset of FAKT 1,
      so the three columns do not close, and only the measured column is true.
    */
    const subtraction =
      BigInt(totals.ordered.amountMinor) -
      BigInt(totals.won.amountMinor) -
      BigInt(totals.open.amountMinor)
    expect(subtraction).not.toBe(BigInt(totals.lostAfterConfirm.amountMinor))
  })

  it('keeps the per-seller money beside the count', async () => {
    const { rows } = await boardOver(ROWS)
    const a = rows.find((r) => r.employeeId === 'a')!

    expect(a.lostAfterConfirmOrders).toBe(1)
    expect(a.lostAfterConfirm.amountMinor).toBe(mln(10).toString())
    expect(a.lostAfterConfirm.currency).toBe('UZS')
  })
})

describe('the totals keep the five queue states apart', () => {
  /*
    2026-09-15, the client: «tasdiqlanganlar, tasdiqlanmay chiqdilar bilan
    tasdiqlanmaganlar nisbati». FAKT 1 folds Тасдиқланди and Тасдиқланмай
    чиқди into one count on purpose; Savdo dinamikasi now prints the fold
    undone, and what this file guards is the arithmetic: the five parts are
    summed the way `cohortOrders` is, so they add up to it, and the rate is
    the Тасдиқлаш board's own — Тасдиқланди over everything that entered.
  */
  const ROWS = [
    rating({
      employeeId: 'a',
      rop: 'Lola',
      cohortOrders: 10,
      confirmedOrders: 8,
      confirmedMinor: mln(80),
      rejectedOrders: 2,
      byOutcome: { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 7, REJECTED: 2, UNCONFIRMED_SHIPPED: 1 },
      byOutcomeMinor: {
        CONFIRM_NEW: 0n,
        NO_ANSWER: 0n,
        CONFIRMED: mln(70),
        REJECTED: mln(20),
        UNCONFIRMED_SHIPPED: mln(10),
      },
    }),
    rating({
      employeeId: 'b',
      rop: 'Sevinch',
      cohortOrders: 6,
      confirmedOrders: 4,
      confirmedMinor: mln(40),
      rejectedOrders: 1,
      byOutcome: { CONFIRM_NEW: 1, NO_ANSWER: 0, CONFIRMED: 3, REJECTED: 1, UNCONFIRMED_SHIPPED: 1 },
      byOutcomeMinor: {
        CONFIRM_NEW: mln(5),
        NO_ANSWER: 0n,
        CONFIRMED: mln(30),
        REJECTED: mln(9),
        UNCONFIRMED_SHIPPED: mln(10),
      },
    }),
  ]

  it('sums each state over the rows, count and money', async () => {
    const { totals } = await boardOver(ROWS)

    expect(totals.outcomes).not.toBeNull()
    expect(totals.outcomes!.CONFIRMED.orders).toBe(10)
    expect(totals.outcomes!.UNCONFIRMED_SHIPPED.orders).toBe(2)
    expect(totals.outcomes!.REJECTED.orders).toBe(3)
    expect(totals.outcomes!.CONFIRM_NEW.orders).toBe(1)
    expect(totals.outcomes!.NO_ANSWER.orders).toBe(0)

    expect(totals.outcomes!.CONFIRMED.amount.amountMinor).toBe(mln(100).toString())
    expect(totals.outcomes!.UNCONFIRMED_SHIPPED.amount.amountMinor).toBe(mln(20).toString())
    expect(totals.outcomes!.REJECTED.amount.amountMinor).toBe(mln(29).toString())
    expect(totals.outcomes!.NO_ANSWER.amount.amount).toBe(0)
  })

  it('partitions the cohort — the five counts add up to cohortOrders', async () => {
    const { totals } = await boardOver(ROWS)

    const parts = Object.values(totals.outcomes!).reduce((sum, state) => sum + state.orders, 0)
    expect(parts).toBe(totals.cohortOrders)
    expect(parts).toBe(16)
    // And FAKT 1's count is the two shipped states, nothing else.
    expect(totals.outcomes!.CONFIRMED.orders + totals.outcomes!.UNCONFIRMED_SHIPPED.orders).toBe(
      totals.orders,
    )
  })

  it('states the confirmation rate over everything that entered the queue', async () => {
    const { totals } = await boardOver(ROWS)

    // 10 of 16 — Тасдиқланди alone, not FAKT 1: an order shipped without
    // reaching the customer is not a confirmation, whatever it earns.
    expect(totals.confirmedRate).toBe(62.5)
  })

  it('has no rate over an empty queue, and zero states rather than none', async () => {
    const { totals } = await boardOver([])

    expect(totals.confirmedRate).toBeNull()
    expect(totals.outcomes).not.toBeNull()
    expect(totals.outcomes!.CONFIRMED.orders).toBe(0)
  })

  it('carries no states on the intake basis, which has no queue to split', async () => {
    const repo = {
      board: async () => [
        {
          employeeId: 'a',
          fullName: 'a',
          rop: 'Lola',
          departmentName: 'Lola(ROP)',
          orders: 3,
          orderedMinor: mln(30),
          wonOrders: 1,
          wonMinor: mln(10),
          openOrders: 2,
          openMinor: mln(20),
          lostOrders: 0,
          lostAfterConfirmOrders: 0,
          lostAfterConfirmMinor: 0n,
          cohortOrders: 3,
          byOutcome: null,
          byOutcomeMinor: null,
        },
      ],
    } as unknown as SellerBoardRepository
    const service = new SellerBoardService(repo, {} as InsightsRepository)
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const ctx = {
      period,
      comparison: previousEquivalent(period),
      currency: 'UZS',
      filters: {},
      now: NOW,
    } as unknown as AnalyticsContext

    const { totals, basis } = await service.board(ctx, 'intake')

    expect(basis).toBe('created_in_period')
    expect(totals.outcomes).toBeNull()
    expect(totals.confirmedRate).toBeNull()
  })
})

/**
 * THE BONUS FUND UNDER THE BRAND SWITCH — 2026-10-06.
 *
 * The client's ladder (45 / 60 / 70 mln) pays on a seller's WHOLE FAKT 2 and is
 * not linear, so cut by brand it states a payout nobody receives: one seller at
 * 30 mln Collagen + 20 mln Zextra earns the 45 mln rung, and read 0 under each
 * of the three slices — which then added up to 0 against 1 000 000 on
 * «Hammasi». A brand slice states no fund at all.
 */
describe('the bonus fund under the brand switch', () => {
  /** FAKT 2 by slice, the way `ratingFilterSql` would narrow it. */
  const FAKT2_BY_SLICE: Readonly<Record<string, bigint>> = {
    all: mln(50),
    Collagen: mln(30),
    Zextra: mln(20),
    none: 0n,
  }

  async function boardFor(brand?: 'Collagen' | 'Zextra' | 'none') {
    const insights = {
      confirmationSellerRating: async (_period: unknown, filters: { brand?: { slice: string } }) => [
        rating({
          employeeId: 'e1',
          // Floor 115 sits inside the ladder's 107–147 band (`bonusEligible`).
          fullName: 'Sirojov 115 Davlatbek',
          rop: 'Lola',
          deliveredOrders: 1,
          deliveredMinor: FAKT2_BY_SLICE[filters.brand?.slice ?? 'all']!,
        }),
      ],
    } as unknown as InsightsRepository
    const service = new SellerBoardService({} as SellerBoardRepository, insights)
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const ctx = {
      period,
      comparison: previousEquivalent(period),
      currency: 'UZS',
      filters: brand === undefined ? {} : { brand },
      now: NOW,
    } as unknown as AnalyticsContext
    return service.board(ctx, 'queue')
  }

  it('pays the ladder on the whole FAKT 2 under «Hammasi»', async () => {
    const { totals } = await boardFor()

    expect(totals.bonusPayable?.amount).toBe(1_000_000)
    expect(totals.sellersInBonus).toBe(1)
  })

  it('states no fund under a brand, rather than one the ladder never pays', async () => {
    for (const brand of ['Collagen', 'Zextra', 'none'] as const) {
      const { totals } = await boardFor(brand)

      expect(totals.bonusPayable).toBeNull()
      expect(totals.sellersInBonus).toBeNull()
    }
  })
})

/**
 * …AND UNDER THE SOURCE FILTER — 2026-10-06.
 *
 * «Manba» narrows each seller's FAKT 2 deal by deal (`"sourceId"` in the
 * rating's filter SQL), exactly as the brand switch does, so the ladder over it
 * states a payout nobody receives: 30 mln from one source and 20 mln from
 * another earn the 45 mln rung and read 0 under each. The employee and
 * department filters keep or drop WHOLE sellers, so the fund over them holds.
 */
describe('the bonus fund under the other filters', () => {
  async function boardWith(filters: Record<string, unknown>) {
    const insights = {
      confirmationSellerRating: async (_period: unknown, cut: { sourceIds?: readonly string[] }) => [
        rating({
          employeeId: 'e1',
          // Floor 115 sits inside the ladder's 107–147 band (`bonusEligible`).
          fullName: 'Sirojov 115 Davlatbek',
          rop: 'Lola',
          deliveredOrders: 1,
          // 30 of the seller's 50 mln came through the source asked for.
          deliveredMinor: cut.sourceIds?.length ? mln(30) : mln(50),
        }),
      ],
    } as unknown as InsightsRepository
    const service = new SellerBoardService({} as SellerBoardRepository, insights)
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const ctx = {
      period,
      comparison: previousEquivalent(period),
      currency: 'UZS',
      filters,
      now: NOW,
    } as unknown as AnalyticsContext
    return service.board(ctx, 'queue')
  }

  it('states no fund under a source filter, which cuts a seller’s FAKT 2 as a brand does', async () => {
    const { totals } = await boardWith({ sourceIds: ['instagram'] })

    expect(totals.bonusPayable).toBeNull()
    expect(totals.sellersInBonus).toBeNull()
  })

  it('pays the fund under the filters that keep whole sellers, and under an empty source list', async () => {
    for (const filters of [{ employeeIds: ['e1'] }, { departmentIds: ['d1'] }, { sourceIds: [] }]) {
      resetSellerBoardCache()
      const { totals } = await boardWith(filters)

      expect(totals.bonusPayable?.amount).toBe(1_000_000)
      expect(totals.sellersInBonus).toBe(1)
    }
  })
})

/**
 * NO FAKT 2 TREND, AND SO NO COMPARISON READ — 2026-10-06.
 *
 * FAKT 2 is where each order stands NOW, and the comparison window is always
 * the OLDER cohort: «Shu oy» on 6 October set Oct 1–6, its last days still
 * undelivered, against Sep 1–6 with a month behind it, so the arrow read a fall
 * for a floor at an unchanged pace. The board reads its own window and nothing
 * else until a comparison can be read at the same age.
 */
describe('the board against the window before it', () => {
  it('reads only its own window, and carries no FAKT 2 trend but the shim', async () => {
    const asked: { start: Date; end: Date }[] = []
    const insights = {
      confirmationSellerRating: async (period: { start: Date; end: Date }) => {
        asked.push(period)
        return [rating({ employeeId: 'a', rop: 'Lola', deliveredOrders: 1, deliveredMinor: mln(10) })]
      },
    } as unknown as InsightsRepository
    const service = new SellerBoardService({} as SellerBoardRepository, insights)
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const ctx = {
      period,
      comparison: previousEquivalent(period),
      currency: 'UZS',
      filters: {},
      now: NOW,
    } as unknown as AnalyticsContext

    const board = await service.board(ctx, 'queue')

    expect(asked).toHaveLength(1)
    expect(asked[0]!.start.toISOString()).toBe(period.start.toISOString())
    expect(asked[0]!.end.toISOString()).toBe(period.end.toISOString())
    /*
      No trend: the only `wonDelta` left is the one-release shim for a tab
      still on the bundle before this change, which reads `delta.kind`
      unguarded and would crash on an absent field. `no_data` is the one
      reading that claims nothing.
    */
    expect(board.totals.wonDelta).toEqual({ kind: 'no_data' })
  })
})

/**
 * WHAT THE BOARD NO LONGER CARRIES — 2026-10-06.
 *
 * `plan` (from a `kpi` table nothing writes to), `leads`, `leadConversionPercent`
 * and `fot` (always null) and the per-seller bonus ladder rode every row, team
 * and total for columns the television dropped on 2026-09-07 and a ladder
 * Savdo dinamikasi dropped on 2026-09-10 — and every build paid a KPI query for
 * the plan. Only the fund and its headcount are read.
 */
describe('what the board does not carry', () => {
  it('sends no plan, lead, fot or per-seller ladder, and still pays the fund', async () => {
    const board = await boardOver([
      rating({ employeeId: 'a', fullName: 'Sirojov 115 Davlatbek', rop: 'Lola', deliveredOrders: 1, deliveredMinor: mln(50) }),
    ])

    for (const key of ['plan', 'leads', 'leadConversionPercent', 'fot', 'bonus']) {
      expect(key in board.rows[0]!).toBe(false)
    }
    for (const key of ['plan', 'leads', 'leadConversionPercent']) {
      expect(key in board.teams[0]!).toBe(false)
    }
    for (const key of ['plan', 'sellersWithPlan', 'sellersEligibleForBonus', 'leads', 'leadConversionPercent']) {
      expect(key in board.totals).toBe(false)
    }
    expect('planWindow' in board).toBe(false)
    expect(board.totals.bonusPayable?.amount).toBe(1_000_000)
    expect(board.totals.sellersInBonus).toBe(1)
  })
})
