import { beforeEach, describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import type {
  ConfirmationRopRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import { InsightsService, resetConfirmationRopCache } from '@/server/services/insightsService'

/**
 * THE ROP BREAKDOWN IS BUILT ONCE PER COHORT, AND ONLY EVER FOR THE ACCOUNT
 * THAT ASKED FOR IT. This file pins both halves.
 *
 * WHY THE MEMO EXISTS. The breakdown feeds the six state tiles, the Статистика
 * panel and the РОП filter's options, and none of those three reads the state
 * selection, the ROP selection, the page, the page size or the sort — see
 * `confirmationBreakdown`. It nevertheless rode on the same request as the
 * table, so every click of a tile, every sort, every page and every tick of a
 * РОП checkbox re-ran a whole-cohort aggregation (about two seconds on
 * production) to arrive at figures that were already on screen and could not
 * have moved. The first three cases below are that saving, stated as
 * behaviour.
 *
 * WHY THE KEY IS THE DANGEROUS PART. This cohort is narrowed per account: a
 * ROP given «Тасдиклаш» reads their own floor and a salesperson their own
 * orders, threaded through `ctx.scope` into the CTE. A memo whose key omitted
 * that would not serve a slightly stale answer — it would serve SOMEBODY
 * ELSE'S, as a complete, well-formed breakdown carrying the wrong population,
 * with nothing on screen or in a log to say so. `ttlCache`'s own note states
 * the rule; the last two cases are what makes it fail loudly if the key ever
 * drifts from what the query reads.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-07T09:00:00+05:00')

beforeEach(resetConfirmationRopCache)

function ropRow(rop: string): ConfirmationRopRow {
  return {
    rop,
    orders: 1,
    confirmed: 1,
    noAnswer: 0,
    rejected: 0,
    pending: 0,
    unconfirmedShipped: 0,
    money: {
      confirmed: 100n,
      noAnswer: 0n,
      rejected: 0n,
      pending: 0n,
      unconfirmedShipped: 0n,
    },
  }
}

/**
 * A service whose repository answers a DIFFERENT breakdown every time it is
 * asked, and records the scope it was asked with.
 *
 * Answering differently is what makes a cache hit visible: comparing two DTOs
 * built from one fixture would pass whether or not the second call happened.
 */
function tracked() {
  const scopes: (readonly string[] | null)[] = []
  const repository = {
    confirmationOrders: async () => ({ totalItems: 0, rows: [] }),
    confirmationBoard: async () => ({ totalItems: 0, rows: [], byRop: [] }),
    confirmationByRop: async (period: { restrictToEmployeeIds: readonly string[] | null }) => {
      scopes.push(period.restrictToEmployeeIds)
      return [ropRow(`rop-${scopes.length}`)]
    },
  } as unknown as InsightsRepository

  const service = new InsightsService(repository)

  const queue = (
    scope: { restrictToEmployeeIds: readonly string[] | null },
    query: Record<string, unknown> = {},
  ) =>
    service.confirmationQueue(
      resolvePeriod('today', { timeZone: TZ, now: NOW }),
      { page: 1, pageSize: 25, sort: 'queuedAt', order: 'desc', ...query } as never,
      scope,
      'UZS',
    )

  return { queue, scopes, builds: () => scopes.length }
}

describe('the confirmation board’s ROP breakdown', () => {
  it('is built once for a cohort, however the table beneath it is cut', async () => {
    const { queue, builds } = tracked()

    await queue({ restrictToEmployeeIds: null })
    // Everything a reader can do to the TABLE without changing the population
    // the tiles measure: pick states, pick groups, sort, and page.
    await queue({ restrictToEmployeeIds: null }, { outcomes: ['CONFIRMED'] })
    await queue({ restrictToEmployeeIds: null }, { rops: ['Sevinch'] })
    await queue({ restrictToEmployeeIds: null }, { sort: 'amountMinor' })
    await queue({ restrictToEmployeeIds: null }, { page: 3 })

    expect(builds()).toBe(1)
  })

  it('is built once for the readers who arrive together', async () => {
    const { queue, builds } = tracked()

    // The case the memo exists for. The floor opens this board together at the
    // start of a shift, and each build is a whole-cohort aggregation against
    // one database core.
    await Promise.all([
      queue({ restrictToEmployeeIds: null }),
      queue({ restrictToEmployeeIds: null }),
      queue({ restrictToEmployeeIds: null }),
    ])

    expect(builds()).toBe(1)
  })

  it('is rebuilt when the cohort itself changes', async () => {
    const { queue, builds } = tracked()

    await queue({ restrictToEmployeeIds: null })
    // Each of these narrows the population the breakdown is measured over, so
    // each is a different question and must not read the previous answer.
    await queue({ restrictToEmployeeIds: null }, { q: '944' })
    await queue({ restrictToEmployeeIds: null }, { regions: ['Xorazm'] })
    await queue({ restrictToEmployeeIds: null }, { amountMin: 1_000_000 })
    await queue({ restrictToEmployeeIds: null }, { amountMax: 1_000_000 })

    expect(builds()).toBe(5)
  })

  it('never serves one account’s breakdown to another', async () => {
    const { queue, builds } = tracked()

    const company = await queue({ restrictToEmployeeIds: null })
    const oneTeam = await queue({ restrictToEmployeeIds: ['e1', 'e2'] })
    const oneSeller = await queue({ restrictToEmployeeIds: ['e1'] })

    // Three principals, three builds. If this ever reads 1, the key has
    // stopped carrying the scope and the board is a disclosure.
    expect(builds()).toBe(3)
    expect(company.byRop[0]!.rop).toBe('rop-1')
    expect(oneTeam.byRop[0]!.rop).toBe('rop-2')
    expect(oneSeller.byRop[0]!.rop).toBe('rop-3')
  })

  it('shares one build between two readers of the SAME scope', async () => {
    const { queue, builds } = tracked()

    // The other half of the bargain: keying on the scope must not degrade into
    // keying on the reader, or a ROP's whole floor pays for the memo and gets
    // nothing back.
    const first = await queue({ restrictToEmployeeIds: ['e2', 'e1'] })
    // Same set, written the other way round — one question, and `keyPart`
    // sorts so the two cannot miss each other.
    const second = await queue({ restrictToEmployeeIds: ['e1', 'e2'] })

    expect(builds()).toBe(1)
    expect(second.byRop).toEqual(first.byRop)
  })
})
