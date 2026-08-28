/**
 * The seller-close basis.
 *
 * These prove the two rules the basis stands or falls on: one deal counts ONCE
 * however many times it entered the seller's won stage, and the window boundary
 * is the Asia/Tashkent calendar month rather than the UTC one. Both are
 * failures that would produce plausible numbers — a slightly inflated count, a
 * month that starts five hours early — which is exactly why they are tested
 * rather than reasoned about.
 */

import { describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import { LEADERBOARD_METRICS } from '@/server/domain/analytics/performance'
import {
  LEADERBOARD_METRICS_ALL,
  SELLER_PIPELINE_ROLES,
  type SellerCloseEvent,
  type SellerCloseRankableRow,
  emptySellerCloseTotals,
  isSellerCloseMetric,
  rankBySellerClose,
  tallySellerCloses,
} from '@/server/domain/analytics/sellerClose'

const TZ = 'Asia/Tashkent'
const UZS = 'UZS'
const NOW = new Date('2026-08-23T09:30:00.000Z')

const august = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
const july = previousEquivalent(august)

function entered(
  dealId: string,
  employeeId: string,
  iso: string,
  amountMinor = 1_000_000_00n,
): SellerCloseEvent {
  return { dealId, employeeId, enteredAt: new Date(iso), amountMinor, currency: UZS }
}

describe('tallySellerCloses', () => {
  it('counts a deal ONCE when it entered the seller-won stage twice', () => {
    // The deal was won, pushed back into the funnel, and won again in the same
    // month. Two history rows, one sale.
    const totals = tallySellerCloses(
      [
        entered('deal-1', 'emp-1', '2026-08-04T07:00:00.000Z', 900_000_00n),
        entered('deal-1', 'emp-1', '2026-08-19T07:00:00.000Z', 900_000_00n),
      ],
      august,
      UZS,
    )

    expect(totals.get('emp-1')!.closedCount).toBe(1)
    // And the value is counted once too — a double count here would be a
    // 900 000 so'm overstatement that nothing downstream could detect.
    expect(totals.get('emp-1')!.closedValue.amountMinor).toBe(900_000_00n)
  })

  it('counts distinct deals separately', () => {
    const totals = tallySellerCloses(
      [
        entered('deal-1', 'emp-1', '2026-08-04T07:00:00.000Z', 300_000_00n),
        entered('deal-2', 'emp-1', '2026-08-05T07:00:00.000Z', 200_000_00n),
      ],
      august,
      UZS,
    )

    expect(totals.get('emp-1')).toEqual({
      closedCount: 2,
      closedValue: { amountMinor: 500_000_00n, currency: UZS },
    })
  })

  it('credits each deal to its assigned employee', () => {
    const totals = tallySellerCloses(
      [
        entered('deal-1', 'emp-1', '2026-08-04T07:00:00.000Z'),
        entered('deal-2', 'emp-2', '2026-08-05T07:00:00.000Z'),
        entered('deal-3', 'emp-2', '2026-08-06T07:00:00.000Z'),
      ],
      august,
      UZS,
    )

    expect(totals.get('emp-1')!.closedCount).toBe(1)
    expect(totals.get('emp-2')!.closedCount).toBe(2)
  })

  it('leaves out employees with no close rather than giving them a zero row', () => {
    // The caller decides who deserves a zero — the roster does, not the tally.
    const totals = tallySellerCloses(
      [entered('deal-1', 'emp-1', '2026-08-04T07:00:00.000Z')],
      august,
      UZS,
    )

    expect(totals.has('emp-2')).toBe(false)
    expect(emptySellerCloseTotals(UZS)).toEqual({
      closedCount: 0,
      closedValue: { amountMinor: 0n, currency: UZS },
    })
  })

  it('buckets the window in Asia/Tashkent, not UTC', () => {
    // 2026-07-31T19:30Z is 2026-08-01 00:30 in Tashkent -> August.
    // 2026-07-31T18:30Z is 2026-07-31 23:30 in Tashkent -> July.
    const events = [
      entered('deal-in', 'emp-1', '2026-07-31T19:30:00.000Z'),
      entered('deal-out', 'emp-1', '2026-07-31T18:30:00.000Z'),
    ]

    const totals = tallySellerCloses(events, august, UZS)
    expect(totals.get('emp-1')!.closedCount).toBe(1)
  })

  it('dedups per WINDOW, so a deal re-won next month counts in both', () => {
    // One query loads the current and comparison windows together; each window
    // is asked its own question and answers it independently.
    const events = [
      entered('deal-1', 'emp-1', '2026-07-10T07:00:00.000Z'),
      entered('deal-1', 'emp-1', '2026-08-10T07:00:00.000Z'),
    ]

    expect(tallySellerCloses(events, july, UZS).get('emp-1')!.closedCount).toBe(1)
    expect(tallySellerCloses(events, august, UZS).get('emp-1')!.closedCount).toBe(1)
  })

  it('returns an empty tally for no events', () => {
    expect(tallySellerCloses([], august, UZS).size).toBe(0)
  })
})

describe('the metric enum', () => {
  it('keeps every existing metric and adds exactly the two new ones', () => {
    // The delivered-revenue metrics must keep working untouched: an existing
    // ?metric=revenue link cannot start meaning something else.
    for (const metric of LEADERBOARD_METRICS) {
      expect(LEADERBOARD_METRICS_ALL).toContain(metric)
    }
    expect(LEADERBOARD_METRICS_ALL).toHaveLength(LEADERBOARD_METRICS.length + 2)
    expect(LEADERBOARD_METRICS_ALL).toContain('closed_deals')
    expect(LEADERBOARD_METRICS_ALL).toContain('closed_value')
  })

  it('separates the two bases', () => {
    expect(isSellerCloseMetric('closed_deals')).toBe(true)
    expect(isSellerCloseMetric('closed_value')).toBe(true)
    expect(isSellerCloseMetric('revenue')).toBe(false)
    expect(isSellerCloseMetric('deals_won')).toBe(false)
  })

  it('names the pipeline role instead of an external stage id', () => {
    // The guard against 'C12:WON' creeping back in. A literal portal id here
    // would keep passing every test and silently score zero the day the portal
    // is reconfigured.
    expect(SELLER_PIPELINE_ROLES).toEqual(['QUALIFICATION'])
    expect(JSON.stringify(SELLER_PIPELINE_ROLES)).not.toContain(':')
  })
})

describe('rankBySellerClose', () => {
  const rows: SellerCloseRankableRow[] = [
    { employeeId: 'emp-1', closedCount: 3, closedValue: { amountMinor: 300_000_00n } },
    { employeeId: 'emp-2', closedCount: 5, closedValue: { amountMinor: 200_000_00n } },
    { employeeId: 'emp-3', closedCount: 5, closedValue: { amountMinor: 100_000_00n } },
    { employeeId: 'emp-4', closedCount: 0, closedValue: { amountMinor: 0n } },
  ]

  it('ranks by closed deals, descending', () => {
    const board = rankBySellerClose(rows, 'closed_deals')
    expect(board.map((e) => e.employeeId)).toEqual(['emp-2', 'emp-3', 'emp-1', 'emp-4'])
    expect(board[0]!.value).toBe(5)
  })

  it('gives tied entries the same rank and skips the next, as every metric does', () => {
    const board = rankBySellerClose(rows, 'closed_deals')
    expect(board.map((e) => e.rank)).toEqual([1, 1, 3, 4])
    expect(board[1]!.tied).toBe(true)
  })

  it('ranks closed value by minor units and hands back the money object', () => {
    const board = rankBySellerClose(rows, 'closed_value')
    expect(board.map((e) => e.employeeId)).toEqual(['emp-1', 'emp-2', 'emp-3', 'emp-4'])
    expect(board[0]!.display).toEqual({ amountMinor: 300_000_00n })
  })

  it('sorts an UNMEASURED seller last and reports null, never zero', () => {
    // Null is the unresolved basis, and a zero close is a real result: the
    // seller who closed nothing must still outrank the row nobody measured.
    const board = rankBySellerClose(
      [
        { employeeId: 'emp-none', closedCount: null, closedValue: null },
        { employeeId: 'emp-zero', closedCount: 0, closedValue: { amountMinor: 0n } },
      ],
      'closed_deals',
    )

    expect(board.map((e) => e.employeeId)).toEqual(['emp-zero', 'emp-none'])
    expect(board.at(-1)!.value).toBeNull()
    expect(board.at(-1)!.display).toBeNull()
    expect(board[0]!.value).toBe(0)
  })

  it('is stable for equal values', () => {
    const first = rankBySellerClose(rows, 'closed_deals').map((e) => e.employeeId)
    const second = rankBySellerClose(rows, 'closed_deals').map((e) => e.employeeId)
    expect(first).toEqual(second)
  })

  it('handles an empty board', () => {
    expect(rankBySellerClose([], 'closed_value')).toEqual([])
  })
})
