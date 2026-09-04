// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SellerBoardDto } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'

/**
 * A ZERO FAKT 2 ON A YOUNG WINDOW IS A DATE, AND THE TILE HAS TO SAY SO.
 *
 * FAKT 2 counts the cohort's orders that are in a delivery stage NOW, while
 * the cohort itself is dated by its arrival in C4:NEW — so the two clocks are
 * days apart and a fresh window is legitimately empty. Production on
 * 2026-09-04, by arrival day: 04-sen 79 confirmed / 0 delivered, 03-sen 94 / 0,
 * 02-sen 80 / 20, 31-avg 99 / 73, 29-avg 101 / 87. The portal agrees — of the
 * 111 orders that reached C4:NEW that morning not one was in C6:WON, against
 * 34 of 50 sampled from 10-avgust.
 *
 * The board opens on «Bugun», so this is the state a reader meets first, and
 * what the tile printed for it was «0 ta yakunlangan buyurtma» over
 * «oʻzgarishsiz». Both true, and together they read as a broken screen — they
 * were read as one. These tests hold the three readings apart: money on the
 * road, nothing at all, and a window that has actually delivered.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/sellers',
  useSearchParams: () => new URLSearchParams(''),
}))

/*
  jsdom has no `matchMedia`, and `AnimatedNumber` asks it whether the reader
  wants motion. Answering "yes, reduced" is also the honest answer for a test:
  the figure is then printed once rather than counted up, so what `getByText`
  reads is the final value instead of whichever frame it caught.
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

const { TotalsBand } = await import('@/features/sellers/SellersPage')

function money(amount: number) {
  return { amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount }
}

/** Only the fields `TotalsBand` reads; the DTO carries two dozen more. */
function board(over: {
  ordered: number
  orders: number
  won: number
  wonOrders: number
  open: number
}): SellerBoardDto {
  return {
    rows: [],
    totals: {
      sellers: 51,
      orders: over.orders,
      cohortOrders: over.orders,
      ordered: money(over.ordered),
      won: money(over.won),
      wonOrders: over.wonOrders,
      open: money(over.open),
      conversionPercent: null,
      wonDelta: { kind: 'unchanged' },
      bonusPayable: money(0),
      sellersInBonus: 0,
    },
  } as unknown as SellerBoardDto
}

/* «Bugun» on production, 2026-09-04: everything confirmed, nothing landed. */
const YOUNG = board({
  ordered: 126_670_000,
  orders: 79,
  won: 0,
  wonOrders: 0,
  open: 126_670_000,
})

/* A window with no orders in it at all — a Sunday, or a filter that matched nothing. */
const EMPTY = board({ ordered: 0, orders: 0, won: 0, wonOrders: 0, open: 0 })

/* 31-avgust, four days on: most of the cohort has been delivered. */
const MATURE = board({
  ordered: 156_450_000,
  orders: 99,
  won: 119_200_000,
  wonOrders: 73,
  open: 37_250_000,
})

describe('FAKT 2 on a window younger than the delivery', () => {
  it('names the money still on the road instead of counting nothing', () => {
    render(<TotalsBand data={YOUNG} status="ready" />)

    // Built from the formatter rather than typed out: the group separator is
    // a deliberate one-line change in `format.ts`, and this test is about what
    // the tile SAYS, not about which character stands between the thousands.
    expect(
      screen.getByText(`hali yetkazilmagan — ${formatFullUzs(126_670_000)} soʻm yoʻlda`),
    ).toBeDefined()
    expect(screen.queryByText(/0 ta yakunlangan buyurtma/)).toBeNull()
  })

  it('drops the trend, because zero against zero explains nothing', () => {
    render(<TotalsBand data={YOUNG} status="ready" />)

    // «oʻzgarishsiz» is what `wonDelta: unchanged` renders. It is true and
    // useless beside the very figure the reader is questioning.
    expect(screen.queryByText(/oʻzgarishsiz/)).toBeNull()
  })

  it('says so plainly when there is no order in the window either', () => {
    render(<TotalsBand data={EMPTY} status="ready" />)

    expect(screen.getByText('bu davrda yetkazilgan buyurtma yoʻq')).toBeDefined()
  })
})

describe('FAKT 2 once the couriers have arrived', () => {
  it('counts the deliveries and keeps the comparison', () => {
    render(<TotalsBand data={MATURE} status="ready" />)

    expect(screen.getByText('73 ta yakunlangan buyurtma')).toBeDefined()
    expect(screen.getByText(/oʻzgarishsiz/)).toBeDefined()
    expect(screen.queryByText(/yoʻlda/)).toBeNull()
  })
})
