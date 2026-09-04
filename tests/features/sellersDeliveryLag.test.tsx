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

const { TotalsBand, PodiumHero } = await import('@/features/sellers/SellersPage')

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
      plan: { amount: null, percent: null, basis: null },
    },
    // `PodiumHero` closes with the forecast strip; only these three are read.
    forecast: { elapsedPercent: 77.8, projected: null },
  } as unknown as SellerBoardDto
}

/** Only the fields the three podium cards read. */
function seller(fullName: string, won: number, ordered: number) {
  return {
    employeeId: fullName,
    fullName,
    rop: null,
    orders: 3,
    wonOrders: won > 0 ? 2 : 0,
    ordered: money(ordered),
    won: money(won),
    sharePercent: null,
    conversionPercent: null,
    bonus: { earned: money(0), toNext: null, toNextPercent: null, eligible: false },
  }
}

/** A board with a podium on it — `PodiumHero` reads `rows`, `TotalsBand` does not. */
function withRows(
  base: SellerBoardDto,
  rows: ReturnType<typeof seller>[],
): SellerBoardDto {
  return { ...base, rows } as unknown as SellerBoardDto
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

/**
 * THE PODIUM CHANGES ITS UNIT, SO IT HAS TO CHANGE ITS LABEL WITH IT.
 *
 * Places are decided by FAKT 2 and fall back to FAKT 1 when nobody has any,
 * and the banner prints whichever figure earned the place. Production
 * 2026-09-04: «Bugun» had no FAKT 2 at all and printed 12 900 000 of confirmed
 * money; «Shu oy», four days wide, had 32 000 000 delivered and printed
 * 3 300 000. Same slot, same type, two different quantities — and the month
 * read as though it had sold less than the day inside it. Only the fallback
 * was labelled, so nothing on screen said the unit had changed. This is the
 * question the screen was actually asked.
 */
const PODIUM_PROPS = { status: 'ready' as const, onRetry: () => {}, onOpenSeller: () => {} }

/* «Shu oy» on 2026-09-04: 22 of 263 orders delivered, so 8% decides the rank. */
const THIN = withRows(board({ ordered: 427_170_000, orders: 263, won: 32_000_000, wonOrders: 22, open: 395_170_000 }), [
  seller('Sotuvchi 156', 3_300_000, 4_300_000),
  seller('164 Sotuvchi', 3_200_000, 12_500_000),
  seller('Axtamova 177 Sabina', 3_100_000, 7_800_000),
])

/* «Bugun»: nothing delivered, so the places fall back to confirmed money. */
const FALLBACK = withRows(YOUNG, [
  seller('Saparboyeva 110 Farida', 0, 12_900_000),
  seller('Ashrafova 172 Marjona', 0, 9_000_000),
])

/* «Oʻtgan oy»: 73 of 99 delivered — the ranking rests on the majority. */
const RIPE = withRows(MATURE, [
  seller('154 Marjona Xayrullayeva', 126_950_000, 154_350_000),
  seller('Saparboyeva 110 Farida', 108_000_000, 144_500_000),
])

describe('what the podium says it is ranking on', () => {
  it('names FAKT 2 when the places were decided by deliveries', () => {
    render(<PodiumHero data={THIN} {...PODIUM_PROPS} />)

    expect(screen.getAllByText('FAKT 2 · yetkazilgan').length).toBe(3)
    expect(screen.queryByText('FAKT 1 · tasdiqlangan')).toBeNull()
  })

  it('names FAKT 1 when nobody has delivered yet', () => {
    render(<PodiumHero data={FALLBACK} {...PODIUM_PROPS} />)

    expect(screen.getAllByText('FAKT 1 · tasdiqlangan').length).toBe(2)
    expect(screen.queryByText('FAKT 2 · yetkazilgan')).toBeNull()
  })

  it('says how few orders the rank rests on when most are still moving', () => {
    render(<PodiumHero data={THIN} {...PODIUM_PROPS} />)

    expect(
      screen.getByText(/263 tadan 22 tasi yetkazilgan — reyting shu 22 tasi boʻyicha/),
    ).toBeDefined()
  })

  it('stays quiet once the majority has been delivered', () => {
    render(<PodiumHero data={RIPE} {...PODIUM_PROPS} />)

    expect(screen.getAllByText('FAKT 2 · yetkazilgan').length).toBe(2)
    expect(screen.queryByText(/reyting shu/)).toBeNull()
  })

  it('never adds the note to the FAKT 1 fallback — there is no share to state', () => {
    render(<PodiumHero data={FALLBACK} {...PODIUM_PROPS} />)

    expect(screen.queryByText(/reyting shu/)).toBeNull()
  })
})
