// @vitest-environment jsdom
import { readFileSync } from 'node:fs'

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MedalDefs } from '@/features/sellers/MedalDefs'
import { resetCelebrations } from '@/features/sellers/usePromotions'
import type { MedalCode, SellerBoardDto, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
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
  medals: new Map<string, SellerMedalRowDto>(),   // ← qo'shiladi
  medalsToday: null,
}

/**
 * The page's own wiring: ONE choice, pressed from either heading.
 * `SellersPage` holds this state — see the block there for why it is not two.
 */
function Board({ data }: { data: SellerBoardDto }) {
  const [fakt, setFakt] = useState<'auto' | 'fakt1' | 'fakt2'>('auto')
  const props = {
    status: 'ready' as const,
    onRetry: () => {},
    fakt,
    onFakt: setFakt,
    medals: new Map<string, SellerMedalRowDto>(),
    medalsToday: null,
  }
  return (
    <>
      <MedalDefs />
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
    /* Qator chekkalari: ostonaga yaqin turgan va hali savdo qilmagan ikki
       sotuvchi. Ular qatorda qoladi — medal oynasi taxtanikidan boshqa, ya'ni
       davr puli kichkina bo'lsa ham daraja katta bo'lishi mumkin. */
    seller('Qodirova 188 Zilola', 6, 8_000_000, 11_000_000, 'Lola'),
    seller('Rustamov 201 Diyor', 7, 0, 0, 'Azizbek'),
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

  /*
    CHEMPIONNING MASOFASI OLIB TASHLANDI, VA MAQSAD SHU. Seat ilgari
    raqam ostida «2-oʻrindan +18 950 000 oldinda» deb yozardi — bu
    yugurib kelayotgan seatlardagi chase chipining chempiondagi ko‘zgusi
    edi. Mijoz 2026-09-15 da o‘sha butun joyni so‘radi — «noaniq keraksiz
    xolat» — va o‘rniga pagonni tanladi. Test o‘chirilmadi, teskarisiga
    aylantirildi: olib tashlash tasodifan qaytarilib qo‘yilmasin.
  */
  it('chempionning 2-o‘rindan masofasi endi chizilmaydi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(screen.queryByText(`+${formatUzs(18_950_000)} oldinda`)).toBeNull()
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
    // digit. Read off the seat rather than the page: `AnimatedNumber` writes
    // the value twice, visibly and for a screen reader.
    expect(document.querySelector('#tv-sellers .tv-seat-figure')?.textContent).toContain(
      formatFullUzs(240_000_000),
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

function medalRow(
  employeeId: string,
  over: Partial<SellerMedalRowDto> = {},
): SellerMedalRowDto {
  return {
    employeeId,
    level: 4,
    legendaTier: 0,
    rankTitle: 'Usta',
    delivered: money(173_000_000),
    levelFloor: money(100_000_000),
    nextLevelAt: money(300_000_000),
    nextTitle: 'Ustoz',
    promotedOn: null,
    medals: [
      {
        code: 'month-gold',
        count: 3,
        at: '2026-08-01',
        amount: money(128_550_000),
        orders: 74,
        percent: null,
      },
    ],
    ...over,
  }
}

/* RIPE taxtasining birinchi seati va to'rtinchi qatori — `seller()`
   `employeeId` ni to'liq ismdan yasaydi, shuning uchun kalit ham shu. */
const MEDALS = new Map<string, SellerMedalRowDto>([
  ['154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva')],
  [
    'Nodira 118 Karimova',
    medalRow('Nodira 118 Karimova', {
      level: 3,
      rankTitle: 'Katta sotuvchi',
      delivered: money(81_300_000),
      levelFloor: money(30_000_000),
      nextLevelAt: money(100_000_000),
      nextTitle: 'Usta',
    }),
  ],
  /* 95 mln, 30..100 oralig'ida — 92.9%, ya'ni unvon so'zi ko'karadi. */
  [
    'Qodirova 188 Zilola',
    medalRow('Qodirova 188 Zilola', {
      level: 3,
      rankTitle: 'Katta sotuvchi',
      delivered: money(95_000_000),
      levelFloor: money(30_000_000),
      nextLevelAt: money(100_000_000),
      nextTitle: 'Usta',
    }),
  ],
  /* Hali savdosiz: 0-daraja, unvonsiz, medalsiz. */
  [
    'Rustamov 201 Diyor',
    medalRow('Rustamov 201 Diyor', {
      level: 0,
      rankTitle: null,
      delivered: money(0),
      levelFloor: money(0),
      nextLevelAt: money(0.01),
      nextTitle: 'Yangi',
      medals: [],
    }),
  ],
])

/**
 * PAGON KETDI — UNING TESTLARI TASHIGAN INVARIANTLAR QOLDI.
 *
 * `describe('pagon')` o'sha komponent bilan birga o'chdi, lekin uchta
 * tekshiruvi pagonga umuman bog'liq emas edi va ular tashigan qarorlar
 * bugun ham kuchda: medal so'rovining ULANISHI, «Liderga nisbatan»
 * chizig'ining YO'QLIGI (mijozning 2026-09-15 dagi so'rovi) va jadvalning
 * olti ustuni. Yangi lavha qatlamining testlari 5-vazifada keladi; bu
 * uchtasi oraliqda himoyasiz qolmasligi uchun shu yerda turadi.
 */
describe('medallar so‘rovi va o‘rindiq — pagon ketdi, invariantlar qoldi', () => {
  it('medal so‘rovi taxtanikidan alohida kalitda va o‘z soatida', () => {
    // DOM javob bera olmaydigan yagona narsa: so'rovning ulanishi.
    const source = readFileSync('src/features/sellers/SellersPage.tsx', 'utf8')
    expect(source).toContain("queryKey: ['sellers', 'medals']")
    expect(source).toContain('staleTime: 600_000')
    // Taxta hech qachon medal so'rovining holatiga qaramaydi: u sekin kelsa
    // yoki xato bersa, reyting hech nima sezmasligi kerak.
    expect(source).not.toMatch(/medals\.(isError|isPending)/)
  })

  it('liderga nisbatan foiz chizig‘i seatda yo‘q', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(document.querySelector('[aria-label="Liderga nisbatan"]')).toBeNull()
  })

  it('jadvalda oltita ustun — 390px da yon skroll yomonlashmaydi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(column('tv-sellers').getAllByRole('columnheader')).toHaveLength(6)
  })
})

/**
 * LAVHA VA MEDALLAR — 2026-09-16 dizayni (spec §3).
 *
 * Seat: daraja bloki (lavha + shtamplar + «… qoldi»), medal tokchasi,
 * gapiruvchi karta. Narvon podium ostida, BIR MARTA. Qator: chapda lavha,
 * ism yonida unvon so'zi, o'ngda medallar; ustun qo'shilmagan; chase
 * chizig'i ikkinchi bo'lak bilan. Medal so'rovi alohida va o'z soatida.
 */
describe('lavha va medallar', () => {
  it('seat kartasi lavhani o‘yma unvon bilan, shtamplarni va «… qoldi»ni chizadi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const col = column('tv-sellers')
    const seat = col.getByText(/154 Marjona Xayrullayeva/).closest('.podium-card')!
    expect(seat.querySelector('svg.lavha--seat')!.getAttribute('data-level')).toBe('4')
    expect(seat.querySelector('text.lavha__title')!.textContent).toBe('USTA')
    expect(seat.querySelectorAll('.lv-stamps i.on')).toHaveLength(3)
    expect(seat.textContent).toContain('Ustozga 127 mln qoldi')
    // Chempion — sharpa bor.
    expect(seat.querySelector('.lv-ghost')).not.toBeNull()
  })

  it('seat tokchasi medalni ×N bilan chizadi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const seat = column('tv-sellers').getByText(/154 Marjona Xayrullayeva/).closest('.podium-card')!
    expect(seat.querySelector('.medal-rail svg[data-medal="month-gold"]')).not.toBeNull()
    expect(seat.querySelector('.medal-count')!.textContent).toBe('×3')
  })

  it('«N / M buyurtma · %» satri seatdan olib tashlangan — mijozning «noaniq keraksiz xolat»i', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const seat = column('tv-sellers').getByText(/154 Marjona Xayrullayeva/).closest('.podium-card')!
    expect(seat.textContent).not.toMatch(/\d+ \/ \d+ buyurtma/)
    expect(document.querySelector('[aria-label="Liderga nisbatan"]')).toBeNull()
  })

  it('narvon podium ostida BIR MARTA, olti pog‘ona', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(document.getElementById('tv-sellers')!.querySelectorAll('.narvon')).toHaveLength(1)
    expect(document.getElementById('tv-sellers')!.querySelectorAll('.narvon-rung')).toHaveLength(6)
  })

  it('medal so‘rovi bo‘sh bo‘lsa — lavha, narvon, tokcha hech qayerda chizilmaydi, reyting o‘z joyida', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(document.querySelector('.lavha')).toBeNull()
    expect(document.querySelector('.narvon')).toBeNull()
    expect(document.querySelector('.medal-rail')).toBeNull()
    expect(column('tv-sellers').getByRole('table')).toBeTruthy()
  })

  it('jadval qatori: chapda lavha, ism yonida unvon so‘zi, o‘ngda medal', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const rowEl = column('tv-sellers').getByText('Nodira 118 Karimova').closest('tr')!
    const cell = rowEl.querySelector('.tv-namecell')!
    expect(cell.querySelector('svg.lavha--row')!.getAttribute('data-level')).toBe('3')
    expect(cell.querySelector('.lavha-word')!.textContent).toBe('Katta sotuvchi')
    expect(cell.querySelector('.tv-rowmedals svg[data-medal="month-gold"]')).not.toBeNull()
    expect(cell.querySelector('.medal-count')).toBeNull()
  })

  it('chase chizig‘i ikkinchi bo‘lakni oladi — «Ustaga 18.7 mln»', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const rowEl = column('tv-sellers').getByText('Nodira 118 Karimova').closest('tr')!
    expect(rowEl.querySelector('.tv-chase')!.textContent).toContain('Ustaga 18.7 mln')
    expect(rowEl.querySelector('.tv-chase')!.textContent).toMatch(/Oldingiga|Lider|teng/)
  })

  it('jadvalga yangi ustun qo‘shilmagan — 390px da yon skroll yomonlashmaydi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(column('tv-sellers').getAllByRole('columnheader')).toHaveLength(6)
  })

  it('belgilar to‘plami sahifada BIR MARTA', () => {
    render(<Board data={RIPE} />)
    expect(document.querySelectorAll('#khatam')).toHaveLength(1)
  })

  it('medal so‘rovi taxtanikidan alohida kalitda va o‘z soatida', () => {
    const source = readFileSync('src/features/sellers/SellersPage.tsx', 'utf8')
    expect(source).toContain("queryKey: ['sellers', 'medals']")
    expect(source).toContain('staleTime: 600_000')
    expect(source).not.toMatch(/medals\.(isError|isPending)/)
    /*
      VA BELGILAR TO'PLAMINING JOYI. `<use href="#…">` hali e'lon qilinmagan
      belgiga bog'lansa hech narsa chizilmaydi va hech narsa xato bermaydi,
      shuning uchun `MedalDefs` — bitta, va taxtaning eng boshida: qobiq
      ochilgandan keyin, undagi birinchi chinakam blokdan oldin. DOM buni
      ayta olmaydi (`Board` yordamchisi sahifa emas), shuning uchun manba.
    */
    expect(source.match(/<MedalDefs \/>/g)).toHaveLength(1)
    const defs = source.indexOf('<MedalDefs />')
    expect(defs).toBeGreaterThan(source.indexOf('tv-board-shell'))
    expect(defs).toBeLessThan(source.indexOf('tv-switch'))
  })

  /*
    PODIUM BO'SH BO'LGANDA HAM NARVON KERAK — sharh 1-topshiriqdan.
    Taxta kunning birinchi daqiqalarida aynan shu holatda turadi: seat yo'q,
    lekin jadval bor va qatorlarda lavha bor. Legendasiz plastina esa o'zini
    tushuntirmaydi. `fakt="fakt2"` — hech kim yetkazmagan taxtani yetkazilgan
    pulga qadab qo'yish, ya'ni g'olib yo'q.
  */
  it('podium bo‘sh bo‘lsa ham narvon turadi — qatorlarda lavha izohsiz qolmaydi', () => {
    render(<SellersColumn data={FALLBACK} {...PROPS} fakt="fakt2" medals={MEDALS} />)
    expect(column('tv-sellers').getByText(/Podium hali boʻsh/)).toBeTruthy()
    expect(document.getElementById('tv-sellers')!.querySelectorAll('.narvon')).toHaveLength(1)
  })

  it('komandalar ustunida narvon yo‘q — bo‘sh podiumda ham; daraja shaxsiy', () => {
    render(<TeamsColumn data={TEAM_FALLBACK} {...PROPS} fakt="fakt2" medals={MEDALS} />)
    expect(column('tv-teams').getByText(/Podium hali boʻsh/)).toBeTruthy()
    expect(document.getElementById('tv-teams')!.querySelectorAll('.narvon')).toHaveLength(0)
  })

  /*
    IKKI CHEKKA. 90% dan oshgan qator unvon so'zini ko'kartiradi — bu
    `LevelBlock` bilan BITTA qoida (`isNearNextLevel`). Hali savdosiz qator
    esa plastinani 0-darajada, unvon o'rniga «hali savdosiz» bilan chizadi,
    va uning chase chizig'ini faqat ikkinchi bo'lak ushlab turadi: oldinda
    kim borligi 0 so'mlik odamga aytiladigan gap emas.
  */
  it('ostonaga yaqin qator ko‘karadi; hali savdosiz qator 0-daraja plastinasi bilan turadi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)

    const near = column('tv-sellers').getByText('Qodirova 188 Zilola').closest('tr')!
    expect(near.querySelector('.lavha-word')!.className).toContain('lavha-word--near')

    const zero = column('tv-sellers').getByText('Rustamov 201 Diyor').closest('tr')!
    expect(zero.querySelector('svg.lavha--row')!.getAttribute('data-level')).toBe('0')
    expect(zero.querySelector('.lavha-word')!.textContent).toBe('hali savdosiz')
    expect(zero.querySelector('.lavha-word')!.className).not.toContain('--near')
    expect(zero.querySelector('.tv-chase')!.textContent).toBe('Birinchi savdo kutilmoqda')
    expect(zero.querySelector('.tv-rowmedals')).toBeNull()
  })
})

/**
 * MAROSIM — ko‘tarilish jamoat voqeasi (spec §6).
 *
 * 40-o‘rindagi odam o‘z lavhasining sokin animatsiyasini ko‘rmaydi; ustun
 * sarlavhasidagi 8 soniyalik e‘lonni hamma ko‘radi. `resetCelebrations()`
 * har testdan oldin: to‘plam modul darajasida — sahifa sessiyasida bir
 * marta e‘lon qilish uchun — ya‘ni testlar orasida ham yashaydi.
 */
describe('ko‘tarilish marosimi', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCelebrations()
  })
  afterEach(() => vi.useRealTimers())

  it('bugun ko‘tarilgan seat: e‘lon ustun sarlavhasida, lavha ko‘tarilish sinfida; 8 soniyadan keyin jim', () => {
    const today = '2026-09-16'
    const medals = new Map(MEDALS)
    medals.set('154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva', { promotedOn: today }))
    render(<SellersColumn data={RIPE} {...PROPS} medals={medals} medalsToday={today} />)
    const col = column('tv-sellers')
    expect(col.getByRole('status').textContent).toContain('154 Marjona Xayrullayeva — endi USTA · 100 mln')
    expect(document.getElementById('tv-sellers')!.querySelector('.lv-plate--rise')).not.toBeNull()
    act(() => vi.advanceTimersByTime(8_000))
    expect(col.queryByRole('status')).toBeNull()
    expect(document.getElementById('tv-sellers')!.querySelector('.lv-plate--rise')).toBeNull()
  })

  it('kecha ko‘tarilgan — e‘lon yo‘q', () => {
    const medals = new Map(MEDALS)
    medals.set('154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva', { promotedOn: '2026-09-15' }))
    render(<SellersColumn data={RIPE} {...PROPS} medals={medals} medalsToday="2026-09-16" />)
    expect(column('tv-sellers').queryByRole('status')).toBeNull()
  })
})

/**
 * YANGI MEDAL — OXIRGI YANGILANISHDA PAYDO BO'LGANI, va faqat o'sha.
 *
 * `useNewMedals` ni hook testlari o'lchaydi, `Medal`/`RowMedals` ning
 * `newKeys` propini esa `sellersLavha.test.tsx`. Ular orasidagi SIM —
 * ustun → jadval/podium → tokcha — hech qayerda tortilmagan edi: bir
 * uchini uzsa, ikkala uchi ham yashil qolardi.
 */
describe('yangi medal ustundan tokchagacha', () => {
  const extra = (key: string, code: MedalCode): SellerMedalRowDto => {
    const base = MEDALS.get(key)!
    const added: SellerMedalDto = { code, count: 1, at: '2026-09-16', amount: null, orders: null, percent: null }
    return { ...base, medals: [...base.medals, added] }
  }

  it('qo‘shilgan medal seatda ham, qatorda ham kattalashib tushadi — va boshqa hech qayerda', () => {
    const { rerender } = render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    // Birinchi payload hech narsani «yangi» demaydi.
    expect(document.querySelectorAll('.medal-slot--new')).toHaveLength(0)

    const grown = new Map(MEDALS)
    grown.set('154 Marjona Xayrullayeva', extra('154 Marjona Xayrullayeva', 'day-winner')) // chempion seat
    grown.set('Nodira 118 Karimova', extra('Nodira 118 Karimova', 'day-winner')) // jadval qatori
    rerender(<SellersColumn data={RIPE} {...PROPS} medals={grown} />)

    const col = document.getElementById('tv-sellers')!
    const seat = column('tv-sellers').getByText(/154 Marjona Xayrullayeva/).closest('.podium-card')!
    expect(seat.querySelector('.medal-rail .medal-slot--new svg[data-medal="day-winner"]')).not.toBeNull()

    const rowEl = column('tv-sellers').getByText('Nodira 118 Karimova').closest('tr')!
    expect(rowEl.querySelector('.tv-rowmedals .medal-slot--new svg[data-medal="day-winner"]')).not.toBeNull()

    // Eski medal yangi emas, va boshqa hech kimniki ham.
    expect(col.querySelectorAll('.medal-slot--new')).toHaveLength(2)
  })
})
