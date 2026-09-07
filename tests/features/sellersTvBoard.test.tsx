// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SellerBoardDto } from '@/lib/api'
import { formatFullUzs, formatUzs } from '@/lib/format'

/**
 * THE TELEVISION BOARD: two columns, each a podium over a list.
 *
 * What these tests pin is what a seller reading the floor's TV from a desk
 * away would notice if it broke — and could not tell anyone about, because
 * nothing errors:
 *
 * - The seat says WHICH FACT put the person there. Places are decided by
 *   FAKT 2 and fall back to FAKT 1 when nobody has delivered, and the seat
 *   prints whichever figure it is showing. Production 2026-09-04: «Bugun»
 *   printed 12 900 000 of confirmed money in the slot «Shu oy» printed
 *   3 300 000 of delivered — and the month read as smaller than the day.
 * - The rows continue the podium, they do not repeat it: the first three
 *   are on screen once, and the fourth row's chase names the bronze seat.
 * - The teams column is the same board over the same words, with the
 *   headcount where the seller's team would be.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/sellers',
  useSearchParams: () => new URLSearchParams(''),
}))

/*
  Reduced motion, answered "yes": `AnimatedNumber` then prints its final
  value once, and `useAutoScroll` — a list that moves on its own — stays off.
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

const { SellersColumn, TeamsColumn } = await import('@/features/sellers/SellersPage')

function money(amount: number) {
  return { amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount }
}

/** Only the fields the seats and rows read. */
function seller(fullName: string, rank: number, won: number, ordered: number, rop: string | null = null) {
  return {
    employeeId: fullName,
    rank,
    fullName,
    rop,
    orders: 3,
    wonOrders: won > 0 ? 2 : 0,
    openOrders: 0,
    ordered: money(ordered),
    won: money(won),
    sharePercent: null,
    conversionPercent: null,
    bonus: { earned: money(0), toNext: null, toNextPercent: null, eligible: false },
  }
}

function team(rop: string, rank: number, sellers: number, won: number, ordered: number) {
  return {
    rank,
    rop,
    sellers,
    orders: 10,
    wonOrders: won > 0 ? 6 : 0,
    ordered: money(ordered),
    won: money(won),
    open: money(0),
    conversionPercent: null,
    sharePercent: null,
  }
}

function board(over: {
  rows?: ReturnType<typeof seller>[]
  teams?: ReturnType<typeof team>[]
  orders: number
  wonOrders: number
  won?: number
  teamlessSellers?: number
}): SellerBoardDto {
  return {
    rows: over.rows ?? [],
    teams: over.teams ?? [],
    totals: {
      orders: over.orders,
      wonOrders: over.wonOrders,
      won: money(over.won ?? 0),
      teamlessSellers: over.teamlessSellers ?? 0,
    },
  } as unknown as SellerBoardDto
}

const PROPS = { status: 'ready' as const, onRetry: () => {} }

/* «Shu oy» on 2026-09-04: 22 of 263 orders delivered, so 8% decides the rank. */
const THIN = board({
  orders: 263,
  wonOrders: 22,
  won: 32_000_000,
  rows: [
    seller('Sotuvchi 156', 1, 3_300_000, 4_300_000),
    seller('164 Sotuvchi', 2, 3_200_000, 12_500_000),
    seller('Axtamova 177 Sabina', 3, 3_100_000, 7_800_000),
  ],
  teams: [
    team('Gulzora', 1, 12, 20_000_000, 200_000_000),
    team('Sevinch', 2, 9, 12_000_000, 150_000_000),
  ],
})

/* «Bugun»: nothing delivered, so the places fall back to confirmed money. */
const FALLBACK = board({
  orders: 79,
  wonOrders: 0,
  rows: [
    seller('Saparboyeva 110 Farida', 1, 0, 12_900_000),
    seller('Ashrafova 172 Marjona', 2, 0, 9_000_000),
  ],
})

/* «Oʻtgan oy»: 73 of 99 delivered — the ranking rests on the majority. */
const RIPE = board({
  orders: 99,
  wonOrders: 73,
  won: 234_950_000,
  rows: [
    seller('154 Marjona Xayrullayeva', 1, 126_950_000, 154_350_000, 'Gulzora'),
    seller('Saparboyeva 110 Farida', 2, 108_000_000, 144_500_000, 'Sevinch'),
    seller('Yusupova 139 Mahliyo', 3, 41_000_000, 60_000_000, 'Lola'),
    seller('Nodira 118 Karimova', 4, 39_000_000, 52_000_000, 'Gulzora'),
    seller('Aziza 121 Toshmatova', 5, 20_000_000, 31_000_000, null),
  ],
  teams: [
    team('Gulzora', 1, 12, 165_950_000, 206_350_000),
    team('Sevinch', 2, 9, 108_000_000, 144_500_000),
    team('Lola', 3, 7, 41_000_000, 60_000_000),
    team('Azizbek', 4, 8, 12_000_000, 30_000_000),
  ],
  teamlessSellers: 1,
})

/* «Bugun» on the teams side: four teams, nothing delivered — the seats fall
   back to FAKT 1, in the FAKT 1 order the service sends them in. */
const TEAM_FALLBACK = board({
  orders: 120,
  wonOrders: 0,
  teams: [
    team('Gulzora', 1, 12, 0, 40_000_000),
    team('Azizbek', 2, 14, 0, 15_000_000),
    team('Asliddin', 3, 8, 0, 2_000_000),
    team('Baza', 4, 5, 0, 1_000_000),
  ],
})

describe('what a seat says it is ranking on', () => {
  it('names FAKT 2 when the places were decided by deliveries', () => {
    render(<SellersColumn data={THIN} {...PROPS} />)

    expect(screen.getAllByText('FAKT 2 · yetkazilgan').length).toBe(3)
    expect(screen.queryByText('FAKT 1 · tasdiqlangan')).toBeNull()
  })

  it('names FAKT 1 when nobody has delivered yet', () => {
    render(<SellersColumn data={FALLBACK} {...PROPS} />)

    expect(screen.getAllByText('FAKT 1 · tasdiqlangan').length).toBe(2)
    expect(screen.queryByText('FAKT 2 · yetkazilgan')).toBeNull()
  })

  /*
    THE SEAT SAYS IT, THE HEADING DOES NOT. The column used to carry two
    grey captions under its title — the ranking rule («oʻrinlar hozircha
    FAKT 1 boʻyicha», with the delivered-share note beside it) and a two-
    swatch legend for the bar. The client asked for both off on 2026-09-07:
    on a television read from across the floor they were unreadable at that
    size and pushed the first seat down. `PodiumBasis` still names the
    deciding fact on every seat, which is where a reader looks anyway.
  */
  it('carries no rule caption and no legend under the heading', () => {
    render(<SellersColumn data={THIN} {...PROPS} />)

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/oʻrinlar hozircha/)
    expect(text).not.toMatch(/Avval FAKT 2/)
    expect(text).not.toMatch(/reyting shu/)
    expect(text).not.toMatch(/ikkalasi bir oʻlchovda/)
    expect(document.querySelector('.tv-legend-swatch')).toBeNull()
  })
})

describe('what the seats carry, and what they do not', () => {
  /*
    «bonus kerak emas, bonus hali aytilmadi» — the client, 2026-09-07. The
    ladder and the fund live on Savdo dinamikasi; the television prints no
    word of a bonus on any seat or row, whatever the DTO carries.
  */
  it('prints nothing about a bonus anywhere on the board', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)

    expect(document.body.textContent).not.toMatch(/bonus/i)
  })

  it('gives the champion the margin over second place, in soʻm', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)

    // 126 950 000 − 108 000 000, on the FAKT 2 figure the seats were decided by.
    expect(screen.getByText(`+${formatUzs(18_950_000)} oldinda`)).toBeDefined()
  })

  it('stands every seat on a pedestal numbered by its place', () => {
    const { container } = render(<SellersColumn data={RIPE} {...PROPS} />)

    const numerals = [...container.querySelectorAll('.tv-pedestal-num')].map((n) => n.textContent)
    expect(numerals).toEqual(['1', '2', '3'])
  })
})

describe('the rows under the seats', () => {
  it('start at fourth place and chase the bronze seat above them', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)

    const table = screen.getByRole('table')
    const names = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1]!.textContent)

    expect(names[0]).toContain('Nodira 118 Karimova')
    expect(names.some((n) => n?.includes('154 Marjona Xayrullayeva'))).toBe(false)
    // 41 000 000 (bronze) − 39 000 000 (fourth), on the FAKT 2 figure — with
    // its unit, the way every other money delta on the board carries one. The
    // figure is its own span so a phone may break the line before it.
    const figure = within(table).getByText(`+${formatUzs(2_000_000)}`)
    expect(figure.parentElement?.textContent).toContain('Oldingiga')
  })

  it('prints both facts on every row, in full', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)

    const table = screen.getByRole('table')
    expect(within(table).getByText(formatFullUzs(39_000_000))).toBeDefined()
    expect(within(table).getByText(formatFullUzs(52_000_000))).toBeDefined()
  })

  it('renders no table at all when the podium seats everyone', () => {
    render(<SellersColumn data={THIN} {...PROPS} />)

    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('the teams column', () => {
  it('is the same board over the same words, with the headcount beside the name', () => {
    render(<TeamsColumn data={RIPE} {...PROPS} />)

    expect(screen.getAllByText('FAKT 2 · yetkazilgan').length).toBe(3)
    expect(screen.getByText('12 sotuvchi')).toBeDefined()
    expect(screen.getByText('Gulzora')).toBeDefined()
    // The fourth team is a row, not a seat.
    expect(within(screen.getByRole('table')).getByText('Azizbek')).toBeDefined()
    // Sellers on no team are named once, as the reason the shares do not add up.
    expect(screen.getByText(/1 ta sotuvchi komandasiz/)).toBeDefined()
  })

  /*
    THE STATE THE BOARD OPENS IN. The window is «Bugun» and delivery lags
    confirmation by days, so for most of a working day no team has a FAKT 2
    and the seats fall back to FAKT 1. The service used to order the teams by
    FAKT 2 alone and break the tie on the ROP's NAME, which seated «Asliddin»
    on 2 mln over «Gulzora» on 40 mln under a caption claiming FAKT 1 — and
    every distance behind the leader came out negative («Liderga
    +-13,000,000»). The column cannot re-sort what it is handed, so what it
    can assert is that a gap is never negative: a minus inside one means the
    order the seats were given is not the order they claim.
  */
  it('seats the teams by FAKT 1 when none has delivered, with no negative gap', () => {
    render(<TeamsColumn data={TEAM_FALLBACK} {...PROPS} />)

    expect(screen.getAllByText('FAKT 1 · tasdiqlangan').length).toBe(3)
    expect(screen.queryByText('FAKT 2 · yetkazilgan')).toBeNull()
    expect(document.body.textContent).not.toContain('+-')
    // The FAKT 1 leader is on the podium, so it is not also in the table.
    expect(screen.getByText('Gulzora')).toBeDefined()
    expect(within(screen.getByRole('table')).queryByText('Gulzora')).toBeNull()
    expect(within(screen.getByRole('table')).getByText('Baza')).toBeDefined()
  })
})
