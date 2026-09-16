import { describe, expect, it } from 'vitest'

import type { CohortMatrix, InsightsRepository } from '@/server/repositories/insightsRepository'
import { InsightsService } from '@/server/services/insightsService'

/**
 * THE CURVE, AND THE TWO WAYS IT GOES WRONG.
 *
 * A cumulative retention curve is a running sum of FIRST returns. Build it
 * from the monthly headcounts instead and a customer who buys every month is
 * counted every month, so the curve walks past 100%. Carry the running total
 * past the measured horizon and a row's last drawn value stops agreeing with
 * its own «Qaytgan» column, which is the one cross-check the matrix offers a
 * reader.
 */

const cell = (
  monthsSince: number,
  over: Partial<{ customers: number; orders: number; firstReturners: number; revenueMinor: bigint }> = {},
) => ({
  monthsSince,
  customers: over.customers ?? 0,
  orders: over.orders ?? 0,
  firstReturners: over.firstReturners ?? 0,
  revenueMinor: over.revenueMinor ?? 0n,
})

/**
 * Two rows, on purpose. `rows[0]` (Jan) has lived the grid's full five
 * months, so every offset on it is measured and a "nulls match" comparison
 * against it is vacuous — six `false`s equal six `false`s whatever the code
 * does. `rows[1]` (May) has lived only one month against the same June
 * clock, so offsets +2..+5 on IT must be null while the grid still draws
 * five columns (`maxOffset` is the OLDEST cohort's span, not this row's own).
 * That is the row the null-rule test below actually needs.
 */
const MATRIX: CohortMatrix = {
  rows: [
    // One cohort of 10, of whom 4 ever return: 2 in +1, 1 in +2, 1 in +4.
    {
      cohort: '2026-01-01',
      size: 10,
      returned: 4,
      cells: [
        cell(0, { customers: 10, orders: 12, revenueMinor: 1_000n }),
        cell(1, { customers: 2, orders: 2, firstReturners: 2, revenueMinor: 200n }),
        cell(2, { customers: 3, orders: 4, firstReturners: 1, revenueMinor: 400n }),
        cell(3, { customers: 0, orders: 0, firstReturners: 0, revenueMinor: 0n }),
        cell(4, { customers: 1, orders: 1, firstReturners: 1, revenueMinor: 100n }),
      ],
    },
    // A cohort of 5 that has only lived one month: +0 and +1 measured, +2..+5
    // have not happened yet.
    {
      cohort: '2026-05-01',
      size: 5,
      returned: 1,
      cells: [
        cell(0, { customers: 5, orders: 5, revenueMinor: 500n }),
        cell(1, { customers: 1, orders: 1, firstReturners: 1, revenueMinor: 50n }),
      ],
    },
  ],
  totals: {
    customers: 15,
    returned: 5,
    firstRevenueMinor: 1_500n,
    laterRevenueMinor: 750n,
  },
  // June 2026: the Jan cohort has lived five whole months, +0 … +5; the grid
  // is drawn to that span even though May has lived only one of them.
  currentMonth: '2026-06-01',
}

function service(matrix: CohortMatrix): InsightsService {
  const repository = {
    cohorts: async () => matrix,
    retentionStages: async () => ({ groups: [], totalCustomers: 0, workedCustomers: 0 }),
  } as unknown as InsightsRepository
  return new InsightsService(repository)
}

describe('the cumulative curve', () => {
  it('walks each returning customer in exactly once', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    // 2 of 10 by +1, 3 by +2, still 3 by +3, 4 by +4.
    expect(rows[0]?.cumulativeCustomers.slice(0, 5)).toEqual([0, 2, 3, 3, 4])
    expect(rows[0]?.cumulative.slice(0, 5)).toEqual([0, 20, 30, 30, 40])
  })

  it('starts at 0, not 100 — nobody has RETURNED in the month they first bought', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    expect(rows[0]?.cumulative[0]).toBe(0)
    expect(rows[0]?.retention[0]).toBe(100)
  })

  it('ends its last MEASURED value on the «Qaytgan» share', async () => {
    /*
      `returned / size` is counted by the database, once per customer. The
      curve is folded in TypeScript. The two must land on the same number or
      the matrix disagrees with its own left-hand column.
    */
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    const row = rows[0]!
    const lastMeasured = row.cumulative[row.maxOffset]
    expect(lastMeasured).toBe(Math.round((row.returned / row.size) * 1000) / 10)
  })

  it('nulls in exactly the same places as the monthly reading', async () => {
    /*
      This has to be the MAY row, not January's. The grid draws five columns
      (the OLDEST cohort's span), but January has itself lived all five, so
      every one of its cells is measured and a "same nulls" comparison on it
      is vacuously true — six `false`s next to six `false`s, whatever the
      code does. May has lived one month against the same June clock, so its
      tail (+2..+5) genuinely nulls, which is the case this rule exists for.
    */
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    const row = rows[1]!
    const nulls = (a: readonly (number | null)[]) => a.map((v) => v === null)
    expect(nulls(row.cumulative)).toEqual(nulls(row.retention))
    expect(nulls(row.cumulativeCustomers)).toEqual(nulls(row.retention))
    expect(nulls(row.orders)).toEqual(nulls(row.retention))
    // And the comparison has to be non-vacuous: at least one cell must
    // actually be null, or the equality above proves nothing.
    expect(nulls(row.retention)).toContain(true)
  })

  it('reports a measured month with no returns as 0, never as null', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    // +3 happened and nobody returned in it; +5 has not been reached by data
    // but HAS elapsed, so it is a measured zero too.
    expect(rows[0]?.retention[3]).toBe(0)
    expect(rows[0]?.cumulative[3]).toBe(30)
    expect(rows[0]?.retention[5]).toBe(0)
  })

  it('sums the cohort’s whole revenue and divides it by the cohort', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    const row = rows[0]!
    // 1000 + 200 + 400 + 0 + 100 = 1700 minor units, over 10 customers.
    expect(row.revenueTotal.amountMinor).toBe('1700')
    expect(row.revenuePerCustomer.amountMinor).toBe('170')
  })

  it('states the cohort’s age, so money-to-date is never compared blind', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    expect(rows[0]?.ageMonths).toBe(5)
  })
})
