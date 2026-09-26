import { describe, expect, it } from 'vitest'

import { type SellerTeamSlice, mergeSellerTeamSlices } from '@/server/domain/analytics/sellerTeams'

/**
 * A seller who sold for two teams in one window arrives as two slices, since
 * the team became the deal's own «Организация сотрудника» snapshot
 * (2026-09-26). Everything that prints a PERSON folds them here; these cases
 * pin the fold — every figure summed, one label, nothing lost.
 */

const STATES = ['CONFIRM_NEW', 'NO_ANSWER', 'CONFIRMED', 'REJECTED', 'UNCONFIRMED_SHIPPED'] as const

function slice(
  over: Partial<SellerTeamSlice> & Pick<SellerTeamSlice, 'employeeId' | 'rop'>,
): SellerTeamSlice {
  return {
    cohortOrders: 1,
    confirmedOrders: 1,
    confirmedMinor: 100n,
    deliveredOrders: 0,
    deliveredMinor: 0n,
    inTransitOrders: 0,
    inTransitMinor: 0n,
    lostAfterConfirmOrders: 0,
    lostAfterConfirmMinor: 0n,
    rejectedOrders: 0,
    byOutcome: Object.fromEntries(STATES.map((s) => [s, s === 'CONFIRMED' ? 1 : 0])),
    byOutcomeMinor: Object.fromEntries(STATES.map((s) => [s, s === 'CONFIRMED' ? 100n : 0n])),
    ...over,
  }
}

const at = (day: number) => new Date(Date.UTC(2026, 8, day, 6))

describe('mergeSellerTeamSlices', () => {
  it('returns a seller with one slice unchanged, as the same object', () => {
    const only = slice({ employeeId: 'a', rop: 'Lola' })
    const [merged] = mergeSellerTeamSlices([only])
    expect(merged).toBe(only)
  })

  it('folds a seller who moved team into one row carrying every figure summed', () => {
    // The measured case: sold for Sevinchxon until the 19th, Sadriddin after.
    const merged = mergeSellerTeamSlices([
      slice({
        employeeId: 's',
        rop: 'Sevinchxon',
        lastQueuedAt: at(19),
        cohortOrders: 22,
        confirmedOrders: 22,
        confirmedMinor: 5_390_000_000n,
        deliveredOrders: 16,
        deliveredMinor: 3_460_000_000n,
        byOutcome: { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 22, REJECTED: 0, UNCONFIRMED_SHIPPED: 0 },
        byOutcomeMinor: {
          CONFIRM_NEW: 0n,
          NO_ANSWER: 0n,
          CONFIRMED: 5_390_000_000n,
          REJECTED: 0n,
          UNCONFIRMED_SHIPPED: 0n,
        },
      }),
      slice({
        employeeId: 's',
        rop: 'Sadriddin',
        lastQueuedAt: at(25),
        cohortOrders: 6,
        confirmedOrders: 5,
        confirmedMinor: 800_000_000n,
        rejectedOrders: 1,
        byOutcome: { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 5, REJECTED: 1, UNCONFIRMED_SHIPPED: 0 },
        byOutcomeMinor: {
          CONFIRM_NEW: 0n,
          NO_ANSWER: 0n,
          CONFIRMED: 800_000_000n,
          REJECTED: 150_000_000n,
          UNCONFIRMED_SHIPPED: 0n,
        },
      }),
    ])

    expect(merged).toHaveLength(1)
    const row = merged[0]!
    expect(row.employeeId).toBe('s')
    expect(row.rop).toBe('Sadriddin')
    expect(row.cohortOrders).toBe(28)
    expect(row.confirmedOrders).toBe(27)
    expect(row.confirmedMinor).toBe(6_190_000_000n)
    expect(row.deliveredOrders).toBe(16)
    expect(row.deliveredMinor).toBe(3_460_000_000n)
    expect(row.rejectedOrders).toBe(1)
    expect(row.byOutcome).toEqual({
      CONFIRM_NEW: 0,
      NO_ANSWER: 0,
      CONFIRMED: 27,
      REJECTED: 1,
      UNCONFIRMED_SHIPPED: 0,
    })
    expect(row.byOutcomeMinor.REJECTED).toBe(150_000_000n)
    // The five states still partition the folded cohort.
    expect(Object.values(row.byOutcome).reduce((a, b) => a + b, 0)).toBe(row.cohortOrders)
  })

  it('labels the row with the team of the newest order, whatever order the slices came in', () => {
    const old = slice({ employeeId: 's', rop: 'Sevinchxon', lastQueuedAt: at(10) })
    const now = slice({ employeeId: 's', rop: 'Sadriddin', lastQueuedAt: at(24) })
    expect(mergeSellerTeamSlices([old, now])[0]!.rop).toBe('Sadriddin')
    expect(mergeSellerTeamSlices([now, old])[0]!.rop).toBe('Sadriddin')
  })

  it('never lets a slice with no team win the label over a named one', () => {
    const merged = mergeSellerTeamSlices([
      slice({ employeeId: 's', rop: 'Lola', lastQueuedAt: at(3) }),
      slice({ employeeId: 's', rop: null, lastQueuedAt: at(25) }),
    ])
    expect(merged[0]!.rop).toBe('Lola')
  })

  it('keeps sellers apart and in the order they first appeared', () => {
    const merged = mergeSellerTeamSlices([
      slice({ employeeId: 'b', rop: 'Lola' }),
      slice({ employeeId: 'a', rop: 'Lola' }),
      slice({ employeeId: 'b', rop: 'Charos' }),
    ])
    expect(merged.map((r) => [r.employeeId, r.cohortOrders])).toEqual([
      ['b', 2],
      ['a', 1],
    ])
  })
})
