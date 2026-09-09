import { describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import type {
  ConfirmationRopRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import { InsightsService } from '@/server/services/insightsService'

/**
 * WHAT THE TASDIQLASH BAND IS WORTH — the sum printed under each of its six
 * tiles.
 *
 * The client asked for it on 2026-09-09: «shu yerda menda summasi turishi
 * kerak… shu 6 ta boʻlimda jami summasi turishi kerak». A count alone cannot
 * tell twenty small orders from twenty large ones, which is the question a
 * confirmation desk is asked at the end of a day.
 *
 * THE SUMS COME FROM THE ROP BREAKDOWN, exactly as the counts do — one round
 * trip, one population. That is the whole reason this file exists: three
 * separate properties hold only because both readings are derived from the same
 * rows, and every one of them is invisible when it breaks.
 *
 *   1. ЖАМИ is the five states added up, never a sixth reading of the cohort.
 *   2. The ROP filter cuts the sums exactly where it cuts the counts.
 *   3. No bigint reaches the wire — `JSON.stringify` THROWS on one. The
 *      panel's rows now CARRY the money on purpose (the client asked for the
 *      per-ROP sums on 2026-09-09), so what must hold is that every one of
 *      them was CONVERTED. A bigint left anywhere under the DTO is a 500 that
 *      no typecheck and no other test here would have named.
 *
 * The window's LENGTH picks between two SQL shapes (`LONG_WINDOW_DAYS`), and
 * they are two hand-maintained copies of one measurement, so both are asked
 * for the same answer here.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-09T09:00:00+05:00')

/** Minor units, the way the whole application carries money. 1 soʻm = 100. */
const som = (n: number) => BigInt(n) * 100n

/**
 * Two ROP groups whose five states hold different money — deliberately not
 * proportional to the counts, so a tile that summed counts instead of money
 * (or divided one by the other) could not accidentally pass.
 */
const ROWS: readonly ConfirmationRopRow[] = [
  {
    rop: 'Sevinch(ROP)',
    orders: 11,
    pending: 4,
    noAnswer: 1,
    confirmed: 5,
    rejected: 1,
    unconfirmedShipped: 0,
    money: {
      pending: som(4_000_000),
      noAnswer: som(250_000),
      confirmed: som(12_500_000),
      rejected: som(900_000),
      unconfirmedShipped: 0n,
    },
  },
  {
    rop: '(ROP yoʻq)',
    orders: 9,
    pending: 4,
    noAnswer: 1,
    confirmed: 2,
    rejected: 2,
    unconfirmedShipped: 0,
    money: {
      pending: som(1_100_000),
      noAnswer: som(70_000),
      confirmed: som(3_300_000),
      rejected: som(2_040_000),
      unconfirmedShipped: 0n,
    },
  },
]

const EMPTY_PAGE = { totalItems: 0, rows: [] }

function serviceOver(rows: readonly ConfirmationRopRow[]) {
  const repository = {
    // The short-window shape: two statements side by side.
    confirmationOrders: async () => EMPTY_PAGE,
    confirmationByRop: async () => rows.map((r) => ({ ...r })),
    // The long-window shape: one statement carrying both readings.
    confirmationBoard: async () => ({ ...EMPTY_PAGE, byRop: rows.map((r) => ({ ...r })) }),
  } as unknown as InsightsRepository

  const service = new InsightsService(repository)

  // 'this_month' is nine days here and 'this_year' is 252, which is what puts
  // the two readings on either side of LONG_WINDOW_DAYS.
  return (preset: 'this_month' | 'this_year', rop?: string) =>
    service.confirmationQueue(
      resolvePeriod(preset, { timeZone: TZ, now: NOW }),
      {
        page: 1,
        pageSize: 25,
        sort: 'queuedAt',
        order: 'desc',
        // A list since the control became a column filter; one entry here,
        // because what this file measures is the cut, not the arity.
        rops: rop ? [rop] : undefined,
      },
      { restrictToEmployeeIds: null },
      'UZS',
    )
}

describe('the state band prints what each state is worth', () => {
  it('sums each state across every ROP group', async () => {
    const { totals } = await serviceOver(ROWS)('this_month')

    expect(totals.byOutcomeAmount.CONFIRM_NEW.amountMinor).toBe(som(5_100_000).toString())
    expect(totals.byOutcomeAmount.NO_ANSWER.amountMinor).toBe(som(320_000).toString())
    expect(totals.byOutcomeAmount.CONFIRMED.amountMinor).toBe(som(15_800_000).toString())
    expect(totals.byOutcomeAmount.REJECTED.amountMinor).toBe(som(2_940_000).toString())
    // A state nobody reached is zero soʻm, not «—»: its count is a measured 0.
    expect(totals.byOutcomeAmount.UNCONFIRMED_SHIPPED.amountMinor).toBe('0')
  })

  it('makes ЖАМИ the five states added up', async () => {
    const { totals } = await serviceOver(ROWS)('this_month')

    const parts = Object.values(totals.byOutcomeAmount).reduce(
      (sum, m) => sum + BigInt(m.amountMinor),
      0n,
    )

    /*
      THE BAND'S TOTAL EQUALS ITS PARTS, and it has to be derived that way
      rather than measured separately. A sixth `sum(*)` over the cohort would
      differ from the five by any state nobody has named yet — and a total that
      does not equal the tiles beside it is a band a reader stops trusting.
    */
    expect(totals.amount.amountMinor).toBe(parts.toString())
    expect(totals.amount.amountMinor).toBe(som(24_160_000).toString())
    // The lossy major reading rides along for the tile that prints it.
    expect(totals.amount.amount).toBe(24_160_000)
    expect(totals.amount.currency).toBe('UZS')
  })

  it('cuts the sums exactly where the ROP filter cuts the counts', async () => {
    const { totals } = await serviceOver(ROWS)('this_month', 'Sevinch(ROP)')

    expect(totals.orders).toBe(11)
    expect(totals.amount.amountMinor).toBe(som(17_650_000).toString())
    expect(totals.byOutcomeAmount.CONFIRMED.amountMinor).toBe(som(12_500_000).toString())
  })

  it('reads the same money out of both window shapes', async () => {
    const run = serviceOver(ROWS)
    const short = await run('this_month')
    const long = await run('this_year')

    /*
      Two SQL statements, one measurement. The long-window shape exists because
      «Shu yil» died on a statement timeout as two queries; it builds the same
      by_rop CTE by hand, and a money column added to one and not the other
      would show up as a year's band reading zero — with every count on it
      correct.
    */
    expect(long.totals.amount).toEqual(short.totals.amount)
    expect(long.totals.byOutcomeAmount).toEqual(short.totals.byOutcomeAmount)
    // The PER-ROP money too, since the panel prints it: the long shape builds
    // by_rop by hand, and a column present in one copy and not the other reads
    // as a year of zeros with every count on it correct.
    expect(long.byRop).toEqual(short.byRop)
  })

  it('keeps every bigint off the wire', async () => {
    const dto = await serviceOver(ROWS)('this_month')

    /*
      THE PROPERTY IS «NO BIGINT», NOT «NO KEY CALLED money».

      The panel's rows CARRY the money now — the client asked for it on
      2026-09-09 — so the old `not.toHaveProperty('money')` would pass while
      proving nothing: the absence of that key was only ever a proxy. What
      still has to hold is that every bigint was converted, and the walk NAMES
      the path so a regression says which field leaked. `JSON.stringify` alone
      is not a replacement — it throws only when a bigint is reachable, and a
      bare `.not.toThrow()` reads as incidental. Keep both.
    */
    const bigints: string[] = []
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'bigint') bigints.push(path)
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`))
      else if (value !== null && typeof value === 'object')
        for (const [key, v] of Object.entries(value)) walk(v, `${path}.${key}`)
    }
    walk(dto, 'dto')

    expect(bigints).toEqual([])
    expect(() => JSON.stringify(dto)).not.toThrow()

    // Everything the Статистика panel reads — the counts, and now the money.
    expect(dto.byRop[0]).toEqual({
      rop: 'Sevinch(ROP)',
      orders: 11,
      pending: 4,
      noAnswer: 1,
      confirmed: 5,
      rejected: 1,
      unconfirmedShipped: 0,
      amounts: {
        CONFIRM_NEW: { amountMinor: som(4_000_000).toString(), currency: 'UZS', amount: 4_000_000 },
        NO_ANSWER: { amountMinor: som(250_000).toString(), currency: 'UZS', amount: 250_000 },
        CONFIRMED: {
          amountMinor: som(12_500_000).toString(),
          currency: 'UZS',
          amount: 12_500_000,
        },
        REJECTED: { amountMinor: som(900_000).toString(), currency: 'UZS', amount: 900_000 },
        UNCONFIRMED_SHIPPED: { amountMinor: '0', currency: 'UZS', amount: 0 },
      },
      /*
        4 000 000 + 250 000 + 12 500 000 + 900 000 + 0 — the same 17 650 000
        the ROP-filter test above reads out of `totals`, now by construction
        rather than by coincidence.
      */
      amountTotal: {
        amountMinor: som(17_650_000).toString(),
        currency: 'UZS',
        amount: 17_650_000,
      },
    })
  })

  it('makes every row’s ЖАМИ that row’s five states added up', async () => {
    const dto = await serviceOver(ROWS)('this_month')

    /*
      The row-level echo of the band-level rule proved above, and the one thing
      a sixth money column in SQL would break — which is what
      `ConfirmationOutcomeMoneyMinor` forbids in prose and what
      `confirmationQueueSql.test.ts`'s `toHaveLength(10)` enforces mechanically.
    */
    for (const row of dto.byRop) {
      const parts = Object.values(row.amounts).reduce((sum, m) => sum + BigInt(m.amountMinor), 0n)
      expect(row.amountTotal.amountMinor).toBe(parts.toString())
    }
  })
})
