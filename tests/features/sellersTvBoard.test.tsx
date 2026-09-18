// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
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
 * - The FAKT 1 / FAKT 2 switch re-ranks the board it is pressed on AND the
 *   one beside it, because a team's money is its sellers' money summed.
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

const PROPS = {
  status: 'ready' as const,
  onRetry: () => {},
  fakt: 'auto' as const,
  onFakt: () => {},
}

/**
 * The page's own wiring: ONE choice, pressed from either heading.
 * `SellersPage` holds this state — see the block there for why it is not two.
 */
function Board({ data }: { data: SellerBoardDto }) {
  const [fakt, setFakt] = useState<'auto' | 'fakt1' | 'fakt2'>('auto')
  const props = { status: 'ready' as const, onRetry: () => {}, fakt, onFakt: setFakt }
  return (
    <>
      <SellersColumn data={data} {...props} />
      <TeamsColumn data={data} {...props} />
    </>
  )
}

const column = (id: 'tv-sellers' | 'tv-teams') => within(document.getElementById(id)!)

/** Presses FAKT 1 (or FAKT 2) in one column's heading. */
function press(id: 'tv-sellers' | 'tv-teams', label: string) {
  fireEvent.click(column(id).getByRole('button', { name: label }))
}

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
    const pill = document.querySelector('#tv-sellers .tv-seat--1 .chase-chip--lead')!
    expect(pill.textContent).toBe(`2-oʻrindan+${formatUzs(18_950_000)} oldinda`)
    // «Oldinda» is a drawn double chevron now (`BoardIcon`), not a colour emoji — decorative, so it adds no text.
    expect(pill.querySelector('.bi.bi--lead[aria-hidden="true"] svg')).not.toBeNull()
  })

  /*
    THE PILL HOLDS ITS OWN WORDS. «+21,500,000 soʻm oldinda» was ONE nowrap run,
    150px wide, inside a pill a 1366 laptop caps at 148px and a 720p television
    at 132px — a nowrap flex item cannot shrink and had nothing to wrap, so the
    words stood outside the pill on both sides (1.2px and 9px, measured on
    production figures on the old board and on this one). Two halves now: the
    sum with its unit, and «oldinda», each unbreakable, with an ordinary space
    between them — the one place the line may part. jsdom lays nothing out, so
    what is pinned is the structure that lets it, and the stylesheet's half.
  */
  it('lets the champion’s margin part before «oldinda», never inside the sum', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)

    const pill = document.querySelector('#tv-sellers .tv-seat--1 .chase-chip--lead')!
    const halves = [...pill.querySelectorAll('span.tabular > span')]
    expect(halves.map((h) => h.textContent)).toEqual([`+${formatUzs(18_950_000)}`, 'oldinda'])
    for (const half of halves) expect(half.className).toContain('whitespace-nowrap')
    // The wrapper itself must be free to break, or the two halves are one run again.
    expect(pill.querySelector('span.tabular')!.className).not.toContain('whitespace-nowrap')
    expect(pill.querySelector('span.tabular')!.textContent).toBe(`+${formatUzs(18_950_000)} oldinda`)
  })

  it('steps the seat’s pill down with the rest of the seat type between 1280 and 1599', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const band = css.slice(css.indexOf('@media (min-width: 1280px) and (max-width: 1599px) {\n  .tv-col {'))
    const block = band.slice(0, band.indexOf('\n}\n'))
    expect(block).toMatch(/\.tv-seat-card \.chase-chip \{\s*font-size: 10px;\s*padding-left: 6px;\s*padding-right: 6px;\s*\}/)
    // `.tv-seat .tv-seat-card`: the bare class loses to the card's own `padding` shorthand further down.
    expect(block).toMatch(/\.tv-seat \.tv-seat-card \{\s*padding-left: 8px;\s*padding-right: 8px;\s*\}/)
    // And the pill may always wrap inside its seat rather than leave it.
    expect(css).toMatch(/\.tv-seat-card \.chase-chip \{\s*max-width: 100%;\s*flex-wrap: wrap;/)
  })

  /*
    On a 1366 laptop the champion's sum is ~17px of type and a 40px medal over
    it out-shouted the money (review, 2026-09-17). The shelf steps down with the
    rest of the seat on that band only; the television's 40 / 36 ride the
    width/height attributes and no rule outside the band may cap them. The
    champion's rule must come second — the two selectors weigh the same.
  */
  it('steps the seat’s medal shelf down to 36 / 32 between 1280 and 1599, and nowhere else', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const band = css.slice(css.indexOf('@media (min-width: 1280px) and (max-width: 1599px) {\n  .tv-col {'))
    const block = band.slice(0, band.indexOf('\n}\n'))
    expect(block).toMatch(
      /\.tv-seat-card \.seat-medals > \.medal-mark \{\s*max-width: 32px;\s*\}\s*\.tv-seat--1 \.seat-medals > \.medal-mark \{\s*max-width: 36px;\s*\}/,
    )
    expect(css.match(/\.seat-medals > \.medal-mark \{[^}]*max-width/g) ?? []).toHaveLength(2)
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

  /*
    THE «BUGUN» MORNING (klassik spec §1.6). Most of the floor has confirmed
    nothing yet, and the old board printed «0» for each of them — in the
    row's heaviest ink under the fact being read, forty bold zeros down the
    column the eye goes to first. A row with nothing on EITHER fact now prints
    the muted dash its rank cell already printed. Three things it must not do:
    touch a row that has money on one fact (that «0» is a measurement), move
    anybody (the order is the service's), or drop a row.
  */
  it('prints a muted dash, not a bold zero, on a row with no money on either fact', () => {
    const MORNING = board({
      orders: 9,
      wonOrders: 0,
      rows: [
        seller('Aziz 101', 1, 0, 5_000_000),
        seller('Bonu 102', 2, 0, 4_000_000),
        seller('Charos 103', 3, 0, 3_000_000),
        seller('Dilnoza 104', 4, 0, 2_000_000),
        seller('Eldor 105', 5, 0, 0),
        seller('Farida 106', 5, 0, 0),
      ],
    })
    render(<SellersColumn data={MORNING} {...PROPS} />)

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell')
    // Same rows, same order.
    expect(rows.map((r) => cells(r)[1]!.textContent)).toEqual([
      expect.stringContaining('Dilnoza 104'),
      expect.stringContaining('Eldor 105'),
      expect.stringContaining('Farida 106'),
    ])

    // Confirmed money, nothing delivered: FAKT 2 stays a real «0».
    const paid = cells(rows[0]!)
    expect(paid[2]!.textContent).toBe('0')
    expect(paid[3]!.textContent).toBe(formatFullUzs(2_000_000))

    for (const row of rows.slice(1)) {
      const [rank, , fakt2, fakt1] = cells(row)
      expect(rank!.textContent).toBe('—')
      for (const money of [fakt2!, fakt1!]) {
        expect(money.textContent).toBe('—')
        const dash = money.querySelector('span')!
        expect(dash.getAttribute('aria-label')).toBe('Hali puli yoʻq')
        expect(dash.className).not.toContain('font-semibold')
        expect(dash.style.color).toBe('var(--ink-muted)')
      }
    }
  })

  it('draws no medal and no medal holder when the column is handed none', () => {
    const { container } = render(<SellersColumn data={RIPE} {...PROPS} />)

    expect(container.querySelector('.medal-mark, .seat-medals, .row-medals, .tv-list--medals')).toBeNull()
    // Every name cell is the plain block the old board had.
    for (const cell of container.querySelectorAll('.tv-cell')) expect(cell.className).toBe('tv-cell')
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

/*
  «Shu oy», crossed: the order the floor has DELIVERED is not the order it has
  CONFIRMED. Farida has taken the most money into the queue and delivered the
  second-most of it; Nodira has confirmed 200 mln and delivered almost none of
  it yet. Reading FAKT 2 seats Marjona, Farida, Mahliyo — reading FAKT 1 seats
  Farida, Nodira, Marjona, and not one assertion below is true of both.
*/
const CROSSED = board({
  orders: 300,
  wonOrders: 120,
  won: 285_000_000,
  rows: [
    seller('Ashrafova 172 Marjona', 1, 120_000_000, 130_000_000, 'Gulzora'),
    seller('Saparboyeva 110 Farida', 2, 90_000_000, 240_000_000, 'Sevinch'),
    seller('Yusupova 139 Mahliyo', 3, 60_000_000, 70_000_000, 'Gulzora'),
    seller('Nodira 118 Karimova', 4, 10_000_000, 200_000_000, 'Lola'),
    seller('Aziza 121 Toshmatova', 5, 5_000_000, 20_000_000, 'Lola'),
  ],
  teams: [
    team('Gulzora', 1, 12, 180_000_000, 200_000_000),
    team('Sevinch', 2, 9, 90_000_000, 240_000_000),
    team('Lola', 3, 7, 15_000_000, 220_000_000),
  ],
})

/*
  Two sellers level on BOTH facts, one ahead of them on FAKT 1 alone, one
  behind them on everything. Competition ranking is the service's own rule and
  the switch has to keep it whichever way the keys are ordered: equal money is
  an equal rank, and the rank after a shared one skips.
*/
const TIED = board({
  orders: 60,
  wonOrders: 12,
  won: 26_000_000,
  rows: [
    seller('Karimova Aziza', 1, 10_000_000, 30_000_000),
    seller('Karimova Barno', 1, 10_000_000, 30_000_000),
    seller('Toshmatova Charos', 3, 5_000_000, 90_000_000),
    seller('Yusupova Dilnoza', 4, 1_000_000, 10_000_000),
  ],
})

/** The seat names of one column, in DOM order — which is 1, 2, 3. */
const seatsOf = (id: 'tv-sellers' | 'tv-teams') =>
  [...document.querySelectorAll(`#${id} .tv-seat-name`)].map((n) => n.textContent)

/** The rank each seat's plaque states, digits only: the ranking, not the seat. */
const ranksOf = (id: 'tv-sellers' | 'tv-teams') =>
  [...document.querySelectorAll(`#${id} .podium-plaque .sr-only`)].map((n) =>
    (n.textContent ?? '').replace(/\D/g, ''),
  )

describe('reading the same board on the other fact', () => {
  /*
    THE CLIENT ASKED FOR THE SWITCH IN BOTH HEADINGS, 2026-09-10: «ikkita
    boʻlimni sotuvchilar va komandalar boʻyichasini fakt 1 va fakt 2 boʻyicha
    koʻrish mumkin boʻlsin». A phone shows one column at a time, so a control
    over only one of them is unreachable from the other.
  */
  it('draws both buttons in both headings, lit on the fact the data decides', () => {
    render(<Board data={CROSSED} />)

    for (const id of ['tv-sellers', 'tv-teams'] as const) {
      expect(column(id).getByRole('button', { name: 'FAKT 1' }).getAttribute('aria-pressed')).toBe(
        'false',
      )
      expect(column(id).getByRole('button', { name: 'FAKT 2' }).getAttribute('aria-pressed')).toBe(
        'true',
      )
    }
  })

  it('re-seats the podium on confirmed money, and says so on every seat', () => {
    render(<Board data={CROSSED} />)

    expect(seatsOf('tv-sellers')).toEqual([
      'Ashrafova 172 Marjona',
      'Saparboyeva 110 Farida',
      'Yusupova 139 Mahliyo',
    ])

    press('tv-sellers', 'FAKT 1')

    expect(seatsOf('tv-sellers')).toEqual([
      'Saparboyeva 110 Farida',
      'Nodira 118 Karimova',
      'Ashrafova 172 Marjona',
    ])
    expect(column('tv-sellers').getAllByText(/tasdiqlangan/).length).toBe(3)
    // The champion's seat prints the figure it was seated on, to the last
    // digit — and prints it ONCE. `AnimatedNumber` is a single text node now
    // (it used to carry a second, visually hidden copy for a screen reader),
    // so the whole line is the figure and its unit and nothing else: a
    // doubled «240,000,000240,000,000» is what this would catch.
    expect(document.querySelector('#tv-sellers .tv-seat-figure')?.textContent).toBe(
      `${formatFullUzs(240_000_000)}soʻm`,
    )
    // And the seller the delivered board seated third is a row now.
    expect(within(column('tv-sellers').getByRole('table')).getByText(/Mahliyo/)).toBeDefined()
    // The seat still carries the OTHER fact under it — real money on this
    // window, and printed for the first time under a FAKT 1 reading.
    expect(document.querySelector('#tv-sellers .tv-seat-card')?.textContent).toContain(
      `FAKT 2 ${formatFullUzs(90_000_000)}`,
    )
  })

  /*
    ONE CHOICE, BOTH COLUMNS. A team's money is its sellers' money summed, so
    a board reading FAKT 1 on the left and FAKT 2 on the right is the
    reconciliation `PodiumBasis` exists to prevent, one column deep.
  */
  it('moves the other column with it, pressed from either heading', () => {
    render(<Board data={CROSSED} />)

    expect(seatsOf('tv-teams')[0]).toBe('Gulzora')

    press('tv-sellers', 'FAKT 1')
    expect(seatsOf('tv-teams')[0]).toBe('Sevinch')
    expect(column('tv-teams').getByRole('button', { name: 'FAKT 1' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    press('tv-teams', 'FAKT 2')
    expect(seatsOf('tv-sellers')[0]).toBe('Ashrafova 172 Marjona')
    expect(
      column('tv-sellers').getByRole('button', { name: 'FAKT 2' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  /*
    THE RANKS IT DERIVES ARE THE RANKS THE SERVICE SENT. `rankedBy` mirrors
    `SellerBoardService`; read on FAKT 2 it must reproduce it exactly, or the
    board and `/analytics/leaderboard` start disagreeing about who is second.
  */
  it('reproduces the service ranking, shared ranks and skips included', () => {
    render(<Board data={TIED} />)

    expect(ranksOf('tv-sellers')).toEqual(['1', '1', '3'])
    expect(column('tv-sellers').getByRole('table').querySelector('.tv-rank')?.textContent).toBe('4')
  })

  it('keeps that rule when the two keys swap', () => {
    render(<Board data={TIED} />)
    press('tv-sellers', 'FAKT 1')

    // Charos alone on 90 mln confirmed, then the pair level on 30 mln — and
    // the rank behind a shared one still skips.
    expect(seatsOf('tv-sellers')).toEqual([
      'Toshmatova Charos',
      'Karimova Aziza',
      'Karimova Barno',
    ])
    expect(ranksOf('tv-sellers')).toEqual(['1', '2', '2'])
    expect(column('tv-sellers').getByRole('table').querySelector('.tv-rank')?.textContent).toBe('4')
  })
})
