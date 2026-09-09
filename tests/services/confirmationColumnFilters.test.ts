import { describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import type {
  ConfirmationCohortFilter,
  ConfirmationRopRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import { InsightsService } from '@/server/services/insightsService'

/**
 * THE COLUMN FILTERS, AND HOW FAR EACH ONE IS ALLOWED TO REACH.
 *
 * The client asked on 2026-09-09 for Excel-style filters on the РОП, РЕГИОН
 * and СУММА columns: «jadvaldagi roplar ustuniga exceldagi filtrga oʻxshab
 * filtr beriladigan boʻlsin, roplarga va regionga va summasiga».
 *
 * Two of the three narrow more than the table. The state band is the per-ROP
 * breakdown added down its columns, so a filter that reaches the breakdown
 * reaches the band and one that does not cannot — and the line between them is
 * a decision, not an accident:
 *
 *   · РЕГИОН and СУММА narrow the cohort. A reader who filters to Хорезм is
 *     asking what Хорезм is worth, and a band answering for the whole country
 *     would sit above a table it visibly disagreed with.
 *   · РОП narrows the rows and the band but NOT the Статистика panel, because
 *     that panel is a comparison OF ROP groups. Applying it would leave the one
 *     row the reader picked and nothing to compare it against — the same reason
 *     the state filter has always been kept out of it.
 *
 * NOTHING ELSE IN THE SUITE WOULD NAME THIS IF IT MOVED. Both readings would
 * still be internally consistent and still be correct measurements; they would
 * simply be of two different populations printed under one heading, which is
 * the exact fault this page has been burned by before.
 *
 * `confirmationQueueSql.test.ts` pins the same contract one layer down, in the
 * SQL. This file pins the layer that decides what the SQL is even asked.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-09T09:00:00+05:00')

/** Minor units, the way the whole application carries money. 1 soʻm = 100. */
const som = (n: number) => BigInt(n) * 100n

const ROWS: readonly ConfirmationRopRow[] = [
  {
    rop: 'Sevinch',
    orders: 10,
    pending: 1,
    noAnswer: 1,
    confirmed: 7,
    rejected: 1,
    unconfirmedShipped: 0,
    money: {
      pending: som(1_000_000),
      noAnswer: som(500_000),
      confirmed: som(7_000_000),
      rejected: som(500_000),
      unconfirmedShipped: 0n,
    },
  },
  {
    rop: 'Azizbek',
    orders: 4,
    pending: 0,
    noAnswer: 1,
    confirmed: 3,
    rejected: 0,
    unconfirmedShipped: 0,
    money: {
      pending: 0n,
      noAnswer: som(200_000),
      confirmed: som(3_000_000),
      rejected: 0n,
      unconfirmedShipped: 0n,
    },
  },
]

const EMPTY_PAGE = { totalItems: 0, rows: [] }

/** Records exactly what each repository reading was asked for. */
function serviceOver(rows: readonly ConfirmationRopRow[]) {
  const asked: {
    orders: unknown[]
    byRop: ConfirmationCohortFilter[]
    board: unknown[]
  } = { orders: [], byRop: [], board: [] }

  const repository = {
    confirmationOrders: async (_period: unknown, query: unknown) => {
      asked.orders.push(query)
      return EMPTY_PAGE
    },
    confirmationByRop: async (_period: unknown, filter: ConfirmationCohortFilter) => {
      asked.byRop.push(filter)
      return rows.map((r) => ({ ...r }))
    },
    confirmationBoard: async (_period: unknown, query: unknown) => {
      asked.board.push(query)
      return { ...EMPTY_PAGE, byRop: rows.map((r) => ({ ...r })) }
    },
  } as unknown as InsightsRepository

  const service = new InsightsService(repository)

  // Partial, because every test here is about ONE filter: the paging and sort
  // the endpoint always sends are supplied below and never varied.
  const run = (query: Partial<Parameters<InsightsService['confirmationQueue']>[1]>) =>
    service.confirmationQueue(
      // Nine days here, which is the short shape — two statements side by side.
      resolvePeriod('this_month', { timeZone: TZ, now: NOW }),
      { page: 1, pageSize: 25, sort: 'queuedAt', order: 'desc', ...query },
      { restrictToEmployeeIds: null },
      'UZS',
    )

  return { run, asked }
}

describe('what each column filter narrows', () => {
  it('sends region and summa to the breakdown the tiles are made of', async () => {
    const { run, asked } = serviceOver(ROWS)

    await run({ regions: ['Хорезм'], amountMin: 500_000, amountMax: 2_000_000 })

    expect(asked.byRop).toHaveLength(1)
    expect(asked.byRop[0]?.regions).toEqual(['Хорезм'])
    /*
      MINOR UNITS ON THE WAY OUT. The reader types whole soʻm — the figure the
      СУММА column prints — and this service is the one place the two scales
      meet. A repository handed 500 000 instead of 50 000 000 would filter to a
      hundredth of what was asked for, and every number on screen would still
      look plausible.
    */
    expect(asked.byRop[0]?.amountMinMinor).toBe(som(500_000))
    expect(asked.byRop[0]?.amountMaxMinor).toBe(som(2_000_000))
  })

  it('never sends the ROP selection to that breakdown', async () => {
    const { run, asked } = serviceOver(ROWS)

    await run({ rops: ['Sevinch'] })

    /*
      THE PROHIBITION. `ConfirmationCohortFilter` has no `rops` field, so this
      cannot be written by accident — but it CAN be written by widening that
      type, which is a one-word edit that would silently collapse the panel to
      a single row while leaving every figure on it correct.
    */
    expect(asked.byRop[0]).not.toHaveProperty('rops')
    expect(Object.keys(asked.byRop[0] ?? {}).sort()).toEqual([
      'amountMaxMinor',
      'amountMinMinor',
      'q',
      'regions',
    ])
  })

  it('still cuts the tiles to the ROP groups the reader picked', async () => {
    const { run } = serviceOver(ROWS)

    const both = await run({})
    const one = await run({ rops: ['Azizbek'] })

    // Fourteen orders across the two groups, four in the one that was picked.
    expect(both.totals.orders).toBe(14)
    expect(one.totals.orders).toBe(4)
    expect(one.totals.amount.amountMinor).toBe(som(3_200_000).toString())

    // And the panel keeps every group, so there is still something to compare.
    expect(one.byRop.map((r) => r.rop)).toEqual(['Sevinch', 'Azizbek'])
  })

  it('takes more than one ROP at a time, which is why the control changed', async () => {
    const { run } = serviceOver(ROWS)

    const picked = await run({ rops: ['Sevinch', 'Azizbek'] })

    // The whole point of the move from a single-choice dropdown to a checkbox
    // list: comparing two groups used to be a page load each.
    expect(picked.totals.orders).toBe(14)
  })

  it('leaves both bounds undefined when the reader set none', async () => {
    const { run, asked } = serviceOver(ROWS)

    await run({})

    /*
      UNDEFINED, NOT ZERO. An absent bound and a bound of zero are different
      questions — «everything» against «nothing below nothing» — and a zero
      creeping in here would quietly drop every order the portal recorded
      without a price the moment the box was cleared.
    */
    expect(asked.byRop[0]?.amountMinMinor).toBeUndefined()
    expect(asked.byRop[0]?.amountMaxMinor).toBeUndefined()
  })

  it('keeps a bound of exactly zero, because that is a real question', async () => {
    const { run, asked } = serviceOver(ROWS)

    await run({ amountMax: 0 })

    expect(asked.byRop[0]?.amountMaxMinor).toBe(0n)
  })

  it('hands the page rows every filter, the ROP selection included', async () => {
    const { run, asked } = serviceOver(ROWS)

    await run({ rops: ['Sevinch'], regions: ['Хорезм'], amountMin: 1_000_000 })

    const query = asked.orders[0] as Record<string, unknown>
    expect(query.rops).toEqual(['Sevinch'])
    expect(query.regions).toEqual(['Хорезм'])
    expect(query.amountMinMinor).toBe(som(1_000_000))
  })
})
