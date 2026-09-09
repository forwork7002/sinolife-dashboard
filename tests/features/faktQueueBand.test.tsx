// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SellerBoardDto } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'

/**
 * WHERE THE REST OF FAKT 1 WENT — the band the client's 2026-09-09 request
 * put under the headline pair.
 *
 * A floor manager reads FAKT 1 and immediately owes three answers: what is
 * still on the road, what died after we had already confirmed it, and why
 * Tasdiqlash navbati counts 811 orders where this page counts 669. Every one
 * of those numbers was already riding in this payload and rendered nowhere.
 *
 * Three of the rules here are invisible when they break, which is why they are
 * pinned: the loss money must be the MEASURED column and never a subtraction,
 * the «not in FAKT 1» partition must add up, and a run-rate must refuse to
 * project from a cohort nothing has been delivered out of yet.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/analytics/sales',
  useSearchParams: () => new URLSearchParams(''),
}))

/*
  jsdom has no `matchMedia`, and `AnimatedNumber` (inside every money tile)
  asks it whether the reader wants motion. Answering "yes, reduced" is also the
  honest answer for a test: the figure is then printed once rather than counted
  up, so what `getByText` reads is the final value instead of whichever frame
  it caught. Same stub `confirmationFakt.test.tsx` installs, for the same
  reason.
*/
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

/*
  EXPLICIT, because this file renders the SAME fixture in four cases.

  Auto-cleanup is not in force here, so without it every render stacks another
  copy of the band into one document and `getByText` fails with "found
  multiple" on the second case that asserts a figure the first also printed —
  a failure about the test harness wearing the costume of a failure about the
  band.
*/
afterEach(cleanup)

/**
 * A money figure appears TWICE in the DOM, and both copies are correct.
 *
 * `AnimatedNumber` counts up behind `aria-hidden` and prints a settled
 * `sr-only` copy beside it, so a screen reader is read one final figure
 * instead of forty frames of one. `getByText` therefore throws "found
 * multiple" on every soʻm figure on this band — which is a fact about the
 * primitive, not about the tile, so it is stated here once and the assertions
 * below read the visible copy.
 */
const figure = (value: string) => screen.getAllByText(value).length

const { QueueBand } = await import('@/features/sales/ConfirmationFaktSection')

function money(amount: number) {
  return { amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount }
}

/** Only the fields `QueueBand` reads; the DTO carries two dozen more. */
function board(over: {
  orders: number
  cohortOrders: number
  wonOrders: number
  lostOrders: number
  lostAfterConfirmOrders: number
  lostAfterConfirm: number
  open: number
  openOrders: number
  projected?: number | null
}): SellerBoardDto {
  return {
    rows: [],
    teams: [],
    basis: 'confirmation_queue',
    totals: {
      orders: over.orders,
      cohortOrders: over.cohortOrders,
      ordered: money(1_103_710_001),
      won: money(666_820_000),
      wonOrders: over.wonOrders,
      open: money(over.open),
      openOrders: over.openOrders,
      lostOrders: over.lostOrders,
      lostAfterConfirmOrders: over.lostAfterConfirmOrders,
      lostAfterConfirm: money(over.lostAfterConfirm),
      conversionPercent: 72.4,
      wonDelta: { kind: 'unchanged' },
      bonusPayable: money(0),
      sellersInBonus: 0,
      teamlessSellers: 0,
    },
    forecast: {
      elapsedPercent: 27.9,
      projected: over.projected === undefined ? money(2_389_000_000) : null,
    },
  } as unknown as SellerBoardDto
}

/** The live shape of September 2026 on production, 1–9 September. */
const LIVE = board({
  orders: 669,
  cohortOrders: 811,
  wonOrders: 411,
  lostOrders: 156,
  lostAfterConfirmOrders: 29,
  lostAfterConfirm: 46_350_000,
  open: 390_540_001,
  openOrders: 233,
})

describe('the orders that never left the queue as an order', () => {
  it('prints the difference between the two true counts and partitions it', () => {
    render(<QueueBand data={LIVE} status="ready" />)

    // 811 reached the queue, 669 left it as an order — the 142 in between are
    // what Tasdiqlash navbati counts and this page did not.
    expect(figure('142')).toBe(2)
    // 156 resolved losses, 29 of which died AFTER confirmation and are
    // therefore inside FAKT 1 — so 127 were refused at the door, and the rest
    // of the 142 are still waiting or did not pick up.
    expect(screen.getByText('127 ta rad etildi · 15 ta hali navbatda yoki koʻtarmadi')).toBeDefined()
  })

  it('never prints a negative remainder', () => {
    /*
      The partition is two counts from one payload and they can only disagree
      if the cohort changed under them mid-request. Clamped rather than
      trusted: «-3 ta hali navbatda» is a number no reader can act on, and it
      would be the only wrong thing on an otherwise correct band.
    */
    render(
      <QueueBand
        data={board({
          orders: 669,
          cohortOrders: 700,
          wonOrders: 411,
          lostOrders: 156,
          lostAfterConfirmOrders: 29,
          lostAfterConfirm: 46_350_000,
          open: 390_540_001,
          openOrders: 233,
        })}
        status="ready"
      />,
    )

    expect(screen.getByText('127 ta rad etildi · 0 ta hali navbatda yoki koʻtarmadi')).toBeDefined()
  })
})

describe('«confirmed, then cancelled»', () => {
  it('prints the measured money, not the gap between the other three', () => {
    render(<QueueBand data={LIVE} status="ready" />)

    expect(figure(formatFullUzs(46_350_000))).toBe(2)
    expect(screen.getByText('29 ta buyurtma navbatdan chiqqach bekor boʻldi')).toBeDefined()

    /*
      `ordered − won − open` is 46 349 999 on these very figures and it is a
      coincidence of one window, not the same measurement: FAKT 2 is not a
      subset of FAKT 1, so the subtraction silently borrows the money of every
      order refused in the queue, revived and then delivered. The tile reads
      the column the SQL measured.
    */
  })

  it('separates what is on the road from what died', () => {
    render(<QueueBand data={LIVE} status="ready" />)

    expect(figure(formatFullUzs(390_540_001))).toBe(2)
    expect(
      screen.getByText('233 ta buyurtma yoʻlda — tasdiqlangan, hali yetkazilmagan'),
    ).toBeDefined()
  })
})

describe('the FAKT 2 run-rate', () => {
  it('projects the month once something has landed', () => {
    render(<QueueBand data={LIVE} status="ready" />)

    expect(figure(formatFullUzs(2_389_000_000))).toBe(2)
    expect(screen.getByText('Oyning 28% qismi oʻtdi — shu surʼatda davom etsa')).toBeDefined()
  })

  it('refuses to project from a cohort nothing has been delivered out of', () => {
    /*
      A straight line through zero is zero, and here zero is a DATE: delivery
      lags the cohort's own arrival by about two days, so «Bugun» and the first
      morning of a month are legitimately empty. «0 soʻm — shu surʼatda davom
      etsa» would tell a floor that is working normally that its month ends at
      nothing.
    */
    render(
      <QueueBand
        data={board({
          orders: 79,
          cohortOrders: 79,
          wonOrders: 0,
          lostOrders: 0,
          lostAfterConfirmOrders: 0,
          lostAfterConfirm: 0,
          open: 126_670_000,
          openOrders: 79,
          projected: null,
        })}
        status="ready"
      />,
    )

    expect(screen.getByText('hali yetkazilgan buyurtma yoʻq — prognoz uchun erta')).toBeDefined()
    expect(screen.queryByText(/shu surʼatda davom etsa/)).toBeNull()
  })
})
