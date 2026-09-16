// @vitest-environment jsdom
import { readFileSync } from 'node:fs'

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MedalDefs } from '@/features/sellers/MedalDefs'
import { LADDER } from '@/features/sellers/medalCatalog'
import { resetCelebrations } from '@/features/sellers/usePromotions'
import type { MedalCode, SellerBoardDto, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { NARROW_NBSP, formatSomFull } from '@/lib/format'

/**
 * THE TELEVISION BOARD — EFIR (spec 2026-09-16-efir-taxta): two columns,
 * the sellers' a podium of three seats over a timing-tower list, the teams'
 * a one-line list with metal numerals.
 *
 * What these tests pin is what a seller reading the floor's TV from a desk
 * away would notice if it broke — and could not tell anyone about, because
 * nothing errors:
 *
 * - The seat says WHICH FACT put the person there («FAKT 2» caption, the
 *   other fact beside it). Production 2026-09-04: «Bugun» printed confirmed
 *   money in the slot «Shu oy» printed delivered, and the month read as
 *   smaller than the day.
 * - The rows continue the podium: the first three are on screen once, the
 *   label strip is OUTSIDE the scroll box so the fourth row is never hidden.
 * - The level WORD is said once, on the seat; rows carry the band and the
 *   crest only. `first-sale` is never drawn in a row.
 * - The FAKT 1 / FAKT 2 switch re-ranks the board it is pressed on AND the
 *   one beside it, with the service's own competition ranking.
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

const S = NARROW_NBSP

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
    conversionPercent: won > 0 ? 91.3 : null,
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
  medals: new Map<string, SellerMedalRowDto>(),
  medalsToday: null,
}

/**
 * The page's own wiring: ONE choice, pressed from either heading.
 * `SellersPage` holds this state — see the block there for why it is not two.
 */
function Board({ data, medals = PROPS.medals }: { data: SellerBoardDto; medals?: ReadonlyMap<string, SellerMedalRowDto> }) {
  const [fakt, setFakt] = useState<'auto' | 'fakt1' | 'fakt2'>('auto')
  const props = {
    status: 'ready' as const,
    onRetry: () => {},
    fakt,
    onFakt: setFakt,
    medals,
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

/** The seats of the sellers column, in DOM order — which is 1, 2, 3. */
const seatsOf = () =>
  [...document.querySelectorAll('#tv-sellers .seat')].map((s) => s.getAttribute('data-seat-name'))

/** The rank each seat's halo states: the RANKING, not the seat. */
const ranksOf = () => [...document.querySelectorAll('#tv-sellers .halo')].map((h) => h.textContent)

const rowNamesOf = (id: 'tv-sellers' | 'tv-teams') =>
  [...document.querySelectorAll(`#${id} .row__name, #${id} .trow__name`)].map(
    (n) => n.firstChild?.textContent ?? '',
  )

const rowOf = (name: string) => screen.getByText(name, { selector: '.row__name' }).closest('li.row')!
const seatOf = (name: string) => document.querySelector(`#tv-sellers .seat[data-seat-name="${name}"]`)!

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
       sotuvchi. Medal oynasi taxtanikidan boshqa — davr puli kichkina bo'lsa
       ham daraja katta bo'lishi mumkin. */
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

/* «Bugun» on the teams side: four teams, nothing delivered — read on FAKT 1. */
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

/*
  «Shu oy», crossed: the order the floor has DELIVERED is not the order it has
  CONFIRMED. Reading FAKT 2 seats Marjona, Farida, Mahliyo — reading FAKT 1
  seats Farida, Nodira, Marjona, and not one assertion below is true of both.
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
  the switch has to keep it whichever way the keys are ordered.
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

function medalRow(employeeId: string, over: Partial<SellerMedalRowDto> = {}): SellerMedalRowDto {
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
      { code: 'month-gold', count: 3, at: '2026-08-01', amount: money(128_550_000), orders: 74, percent: null },
      { code: 'first-sale', count: 1, at: '2026-08-03', amount: null, orders: null, percent: null },
    ],
    ...over,
  }
}

/* RIPE taxtasining o'rindiqlari va qatorlari — `seller()` `employeeId` ni
   to'liq ismdan yasaydi, shuning uchun kalit ham shu. */
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
  /* Faqat «Birinchi savdo»si bor sotuvchi — qatorda medal uyasi ataylab bo'sh. */
  [
    'Qodirova 188 Zilola',
    medalRow('Qodirova 188 Zilola', {
      level: 3,
      rankTitle: 'Katta sotuvchi',
      delivered: money(95_000_000),
      levelFloor: money(30_000_000),
      nextLevelAt: money(100_000_000),
      nextTitle: 'Usta',
      medals: [{ code: 'first-sale', count: 1, at: '2026-08-03', amount: null, orders: null, percent: null }],
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

describe('o‘rindiq qaysi faktni aytadi', () => {
  it('yetkazilgan pul o‘rin bergan bo‘lsa — «FAKT 2» yozuvi, yonida FAKT 1 raqami', () => {
    render(<SellersColumn data={THIN} {...PROPS} />)
    const caps = [...document.querySelectorAll('#tv-sellers .seat__cap')].map((c) => c.textContent)
    expect(caps).toEqual(['FAKT 2', 'FAKT 2', 'FAKT 2'])
    expect(seatOf('Sotuvchi 156').querySelector('.seat__other')!.textContent).toBe(`FAKT 1 4${S}300${S}000`)
  })

  it('hech kim yetkazmagan bo‘lsa — «FAKT 1» yozuvi, FAKT 2 satri chizilmaydi', () => {
    render(<SellersColumn data={FALLBACK} {...PROPS} />)
    const caps = [...document.querySelectorAll('#tv-sellers .seat__cap')].map((c) => c.textContent)
    expect(caps).toEqual(['FAKT 1', 'FAKT 1'])
    expect(document.querySelector('#tv-sellers .seat__other')).toBeNull()
  })

  it('sarlavha ostida qoida yozuvi va legenda yo‘q; sarlavhada soni', () => {
    render(<SellersColumn data={THIN} {...PROPS} />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/oʻrinlar hozircha/)
    expect(text).not.toMatch(/Avval FAKT 2/)
    expect(document.querySelector('.tv-legend-swatch')).toBeNull()
    expect(column('tv-sellers').getByText('3 sotuvchi')).toBeDefined()
  })
})

describe('o‘rindiqda nima bor, nima yo‘q', () => {
  it('bonus, «oldinda», pedestal, podium xromi — hech biri yo‘q', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(document.body.textContent).not.toMatch(/bonus/i)
    expect(document.body.textContent).not.toMatch(/oldinda/)
    for (const gone of ['.tv-pedestal', '.podium-card', '.podium-plaque', '.medal-ring', '.tv-seat-card']) {
      expect(document.querySelector(gone), gone).toBeNull()
    }
  })

  it('uch o‘rindiq: halqada rank, metall 1/2/3, DOM tartibi 1-2-3', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(seatsOf()).toEqual(['154 Marjona Xayrullayeva', 'Saparboyeva 110 Farida', 'Yusupova 139 Mahliyo'])
    expect(ranksOf()).toEqual(['1', '2', '3'])
    expect([...document.querySelectorAll('#tv-sellers .halo')].map((h) => h.getAttribute('data-metal'))).toEqual([
      'gold', 'silver', 'bronze',
    ])
    expect(document.querySelector('#tv-sellers .seat--1 .halo--lg')).not.toBeNull()
  })

  it('daraja so‘zi HAR o‘rindiqda bir marta, qatorlarda hech qachon', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const seat = seatOf('154 Marjona Xayrullayeva')
    expect(seat.querySelectorAll('.seat__level')).toHaveLength(1)
    expect(seat.querySelector('.seat__level')!.textContent).toBe('Usta')
    expect(document.querySelectorAll('#tv-sellers .tv-rows .seat__level')).toHaveLength(0)
    const rows = document.getElementById('tv-sellers')!.querySelector('.tv-rows')!
    expect(rows.textContent).not.toMatch(/Katta sotuvchi|Usta|hali savdosiz/)
  })
})

describe('o‘rindiq ostidagi qatorlar (spec §5)', () => {
  it('4-o‘rindan boshlanadi; yorliq qatori skroll qutisidan TASHQARIDA, uning oldida', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    const col = document.getElementById('tv-sellers')!
    const strip = col.querySelector('.tv-cols')!
    const rows = col.querySelector('ol.tv-rows')!
    expect(strip.nextElementSibling).toBe(rows)
    expect(rows.contains(strip)).toBe(false)
    expect(rows.querySelector('.tv-cols')).toBeNull()
    expect(rowNamesOf('tv-sellers')[0]).toBe('Nodira 118 Karimova')
    expect(rowNamesOf('tv-sellers')).not.toContain('154 Marjona Xayrullayeva')
    expect(rowOf('Nodira 118 Karimova').querySelector('.row__rank')!.textContent).toBe('4')
  })

  it('sakkizta yorliq: # Daraja Sotuvchi Medallar FAKT 2 FAKT 1 Buyurtma Konv.', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    const labels = [...document.querySelectorAll('#tv-sellers .tv-cols span')]
      .map((s) => s.textContent)
      .filter((t) => t !== '')
    expect(labels).toEqual([
      '#', 'Daraja', 'Sotuvchi', 'Medallar', 'FAKT 2, yetkazilgan', 'FAKT 1, tasdiqlangan', 'Buyurtma', 'Konv.',
    ])
  })

  it('har qatorda ikkala fakt to‘liq so‘mda, buyurtma va konversiya «91,3 %»; «Oldingiga» satri yo‘q', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    const row = rowOf('Nodira 118 Karimova')
    expect(row.querySelector('.row__f2')!.textContent).toBe(`39${S}000${S}000`)
    expect(row.querySelector('.row__f1')!.textContent).toBe(`52${S}000${S}000`)
    expect(row.querySelector('.row__orders')!.textContent).toBe('3')
    expect(row.querySelector('.row__conv')!.textContent).toBe(`91,3${S}%`)
    expect(row.querySelector('.row__team')!.textContent).toBe('Gulzora')
    expect(document.querySelector('.tv-chase')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Oldingiga|Lider/)
    expect(document.body.textContent).not.toMatch(/mln|soʻm|so‘m/)
  })

  it('puli yo‘q qator rank o‘rniga chiziqcha, konversiyasi chiziqcha', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    const zero = rowOf('Rustamov 201 Diyor')
    expect(zero.querySelector('.row__rank')!.textContent).toBe('—')
    expect(zero.querySelector('.row__conv')!.textContent).toBe('—')
  })

  it('podium hammani o‘tqazganda qatorlar ham, yorliq qatori ham chizilmaydi', () => {
    render(<SellersColumn data={THIN} {...PROPS} />)
    expect(document.querySelector('.tv-rows')).toBeNull()
    expect(document.querySelector('.tv-cols')).toBeNull()
  })

  it('o‘qilayotgan fakt qatorda `data-read` bilan belgilanadi', () => {
    render(<Board data={CROSSED} />)
    expect(document.querySelector('#tv-sellers .tv-rows')!.getAttribute('data-read')).toBe('fakt2')
    expect(document.querySelector('#tv-sellers .tv-cols')!.getAttribute('data-read')).toBe('fakt2')
    press('tv-sellers', 'FAKT 1')
    expect(document.querySelector('#tv-sellers .tv-rows')!.getAttribute('data-read')).toBe('fakt1')
  })
})

describe('komandalar ustuni (spec §6)', () => {
  it('podium yo‘q; bir qatorli qatorlar; 1–3 metall raqam, qolgani none', () => {
    render(<TeamsColumn data={RIPE} {...PROPS} />)
    const col = document.getElementById('tv-teams')!
    expect(col.querySelector('.seat')).toBeNull()
    expect(col.querySelector('.tv-podium')).toBeNull()
    expect(col.querySelectorAll('li.trow')).toHaveLength(4)
    expect(rowNamesOf('tv-teams')).toEqual(['Gulzora', 'Sevinch', 'Lola', 'Azizbek'])
    expect([...col.querySelectorAll('.trow__rank')].map((r) => r.textContent)).toEqual(['1', '2', '3', '4'])
    expect([...col.querySelectorAll('.trow__rank')].map((r) => r.getAttribute('data-metal'))).toEqual([
      'gold', 'silver', 'bronze', 'none',
    ])
    expect(column('tv-teams').getByText('4 komanda')).toBeDefined()
  })

  it('sotuvchi soni, FAKT 2, ulush «50,8 %», FAKT 1; ulush chizig‘i = ulush ÷ yetakchi ulushi', () => {
    render(<TeamsColumn data={RIPE} {...PROPS} />)
    const rows = [...document.querySelectorAll('#tv-teams li.trow')] as HTMLElement[]
    expect(rows[0]!.querySelector('.trow__cnt')!.textContent).toBe('12')
    expect(rows[0]!.querySelector('.trow__f2')!.textContent).toBe(`165${S}950${S}000`)
    expect(rows[0]!.querySelector('.trow__f1')!.textContent).toBe(`206${S}350${S}000`)
    // 165 950 000 / 326 950 000 = 50,76 %; Sevinch 108 / 326,95 = 33,03 %.
    expect(rows[0]!.querySelector('.trow__share')!.textContent).toBe(`50,8${S}%`)
    expect(rows[1]!.querySelector('.trow__share')!.textContent).toBe(`33${S}%`)
    // `--share` inline style'da CSS uchun; jsdom'ning custom-property qo'llovi
    // versiyaga bog'liq, shuning uchun o'sha qiymat `data-share` da ham turadi.
    expect(rows[0]!.getAttribute('data-share')).toBe('1.000')
    expect(rows[1]!.getAttribute('data-share')).toBe('0.651')
  })

  it('yorliq qatori va pastki jumla: «1 sotuvchi komandasiz, ulushlar ularsiz»', () => {
    render(<TeamsColumn data={RIPE} {...PROPS} />)
    const labels = [...document.querySelectorAll('#tv-teams .tv-tcols span')].map((s) => s.textContent)
    expect(labels).toEqual(['#', 'Komanda (ROP)', 'Sotuvchi', 'FAKT 2, yetkazilgan', 'Ulush', 'FAKT 1', 'Buyurtma', 'Konv.'])
    expect(document.querySelector('#tv-teams .tv-tfoot')!.textContent).toBe('1 sotuvchi komandasiz, ulushlar ularsiz')
  })

  it('komandasiz sotuvchi bo‘lmasa pastki jumla chizilmaydi', () => {
    render(<TeamsColumn data={THIN} {...PROPS} />)
    expect(document.querySelector('#tv-teams .tv-tfoot')).toBeNull()
  })

  /*
    THE STATE THE BOARD OPENS IN: «Bugun», nothing delivered, the teams read
    on FAKT 1 in FAKT 1 order — the service's FAKT 2 tie-break on the ROP's
    NAME must not leak through as the ranking.
  */
  it('hech kim yetkazmagan — FAKT 1 bo‘yicha tartib, kalit FAKT 1 da yoniq', () => {
    render(<TeamsColumn data={TEAM_FALLBACK} {...PROPS} />)
    expect(rowNamesOf('tv-teams')).toEqual(['Gulzora', 'Azizbek', 'Asliddin', 'Baza'])
    expect(column('tv-teams').getByRole('button', { name: 'FAKT 1' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('#tv-teams .tv-trows')!.getAttribute('data-read')).toBe('fakt1')
    expect(document.body.textContent).not.toContain('+-')
  })
})

describe('bir taxtani boshqa faktda o‘qish', () => {
  it('ikkala sarlavhada ikkita tugma, ma‘lumot hal qilgan faktda yoniq', () => {
    render(<Board data={CROSSED} />)
    for (const id of ['tv-sellers', 'tv-teams'] as const) {
      expect(column(id).getByRole('button', { name: 'FAKT 1' }).getAttribute('aria-pressed')).toBe('false')
      expect(column(id).getByRole('button', { name: 'FAKT 2' }).getAttribute('aria-pressed')).toBe('true')
    }
    expect(document.querySelector('.tv-fakt-dot')).toBeNull()
  })

  it('tasdiqlangan pulga qayta o‘tqazadi va har o‘rindiqda aytadi', () => {
    render(<Board data={CROSSED} />)
    expect(seatsOf()).toEqual(['Ashrafova 172 Marjona', 'Saparboyeva 110 Farida', 'Yusupova 139 Mahliyo'])

    press('tv-sellers', 'FAKT 1')

    expect(seatsOf()).toEqual(['Saparboyeva 110 Farida', 'Nodira 118 Karimova', 'Ashrafova 172 Marjona'])
    expect([...document.querySelectorAll('#tv-sellers .seat__cap')].map((c) => c.textContent)).toEqual([
      'FAKT 1', 'FAKT 1', 'FAKT 1',
    ])
    // The champion's seat prints the figure it was seated on, to the last digit.
    expect(document.querySelector('#tv-sellers .seat--1 .seat__figure')!.textContent).toContain(
      formatSomFull(240_000_000),
    )
    // The seller the delivered board seated third is a row now.
    expect(rowNamesOf('tv-sellers')).toContain('Yusupova 139 Mahliyo')
    // And the seat still carries the OTHER fact beside the caption.
    expect(document.querySelector('#tv-sellers .seat--1 .seat__other')!.textContent).toBe(
      `FAKT 2 ${formatSomFull(90_000_000)}`,
    )
  })

  it('ikkinchi ustunni ham suradi, qaysi sarlavhadan bosilsa ham', () => {
    render(<Board data={CROSSED} />)
    expect(rowNamesOf('tv-teams')[0]).toBe('Gulzora')

    press('tv-sellers', 'FAKT 1')
    expect(rowNamesOf('tv-teams')[0]).toBe('Sevinch')
    expect(column('tv-teams').getByRole('button', { name: 'FAKT 1' }).getAttribute('aria-pressed')).toBe('true')

    press('tv-teams', 'FAKT 2')
    expect(seatsOf()[0]).toBe('Ashrafova 172 Marjona')
    expect(column('tv-sellers').getByRole('button', { name: 'FAKT 2' }).getAttribute('aria-pressed')).toBe('true')
  })

  /*
    THE RANKS IT DERIVES ARE THE RANKS THE SERVICE SENT. `rankedBy` mirrors
    `SellerBoardService`; read on FAKT 2 it must reproduce it exactly.
  */
  it('servis reytingini takrorlaydi — teng o‘rinlar va sakrash bilan', () => {
    render(<Board data={TIED} />)
    expect(ranksOf()).toEqual(['1', '1', '3'])
    expect(document.querySelector('#tv-sellers .row__rank')!.textContent).toBe('4')
  })

  it('kalitlar almashganda ham o‘sha qoida', () => {
    render(<Board data={TIED} />)
    press('tv-sellers', 'FAKT 1')
    expect(seatsOf()).toEqual(['Toshmatova Charos', 'Karimova Aziza', 'Karimova Barno'])
    expect(ranksOf()).toEqual(['1', '2', '2'])
    expect(document.querySelector('#tv-sellers .row__rank')!.textContent).toBe('4')
  })
})

/**
 * EFIR — o'rindiq, qator, legenda (spec §2–§5). Medal so'rovi alohida va o'z
 * soatida; kelmasa taxta hech nima sezmaydi.
 */
describe('EFIR — daraja va medallar taxtada', () => {
  it('o‘rindiq: tasma darajasi, gerb, so‘z, «… qoldi» to‘liq so‘mda, medallar ×N bilan (first-sale bor)', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const seat = seatOf('154 Marjona Xayrullayeva')
    expect(seat.getAttribute('data-tier')).toBe('4')
    expect(seat.querySelector('svg.crest--seat')!.querySelectorAll('use.on')).toHaveLength(4)
    expect(seat.querySelector('.seat__level')!.textContent).toBe('Usta')
    expect(seat.querySelector('.seat__next')!.textContent).toBe(`Ustozga 127${S}000${S}000 qoldi`)
    expect((seat.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('36.5%')
    expect([...seat.querySelectorAll('.seat__medals svg.medal')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'month-gold', 'first-sale',
    ])
    expect(seat.querySelector('.medal-count')!.textContent).toBe('×3')
  })

  it('qator: tasma va gerb darajada, so‘z yo‘q, medallar first-sale siz va ×N siz', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const row = rowOf('Nodira 118 Karimova')
    expect(row.getAttribute('data-tier')).toBe('3')
    expect(row.querySelector('.row__band')).not.toBeNull()
    expect(row.querySelector('svg.crest--row')!.querySelectorAll('use.on')).toHaveLength(3)
    expect([...row.querySelectorAll('.row__medals svg.medal')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'month-gold',
    ])
    expect(row.querySelector('.medal-count')).toBeNull()
    expect(row.querySelector('.seat__level')).toBeNull()

    // Faqat «Birinchi savdo»si bor — uya ataylab bo'sh.
    const only = rowOf('Qodirova 188 Zilola')
    expect(only.querySelector('.row__medals')).not.toBeNull()
    expect(only.querySelector('.row__medals svg')).toBeNull()

    // Hali savdosiz — 0-daraja: kontur tasma, bo'sh gerb, bo'sh uya.
    const zero = rowOf('Rustamov 201 Diyor')
    expect(zero.getAttribute('data-tier')).toBe('0')
    expect(zero.querySelector('svg.crest--row')!.querySelectorAll('use.on')).toHaveLength(0)
    expect(zero.querySelector('.row__medals svg')).toBeNull()
  })

  it('legenda ustunning PASTIDA bir marta, olti pog‘ona, qisqa ostona — komandalar ustunida yo‘q', () => {
    render(<Board data={RIPE} medals={MEDALS} />)
    const col = document.getElementById('tv-sellers')!
    expect(col.querySelectorAll('.tv-legend')).toHaveLength(1)
    const rungs = col.querySelectorAll('.legend__rung')
    expect(rungs).toHaveLength(6)
    expect(col.lastElementChild!.classList.contains('tv-legend')).toBe(true)
    // KALIT — YAGONA ISTISNO: ostona qisqa yozilgani uchun 1920 da bir qator
    // (spec §1/§2; `TierLegend.tsx` o‘lchovlarni yozadi). Yangi yorliqsiz.
    expect(rungs[0]!.querySelector('i')).toBeNull()
    for (let i = 1; i <= 5; i += 1) {
      expect(rungs[i]!.querySelector('i')!.textContent).toBe(LADDER[i]!.thresholdLabel)
    }
    // Sahifaning boshqa hamma joyida to‘liq so‘m; KALITDA esa hech qachon.
    expect(col.querySelector('.tv-legend')!.textContent).not.toMatch(
      new RegExp(`\\d{1,3}(${S}\\d{3}){2,}`),
    )
    expect(col.querySelector('.tv-legend__title')).toBeNull()
    expect(document.getElementById('tv-teams')!.querySelector('.tv-legend')).toBeNull()
  })

  it('medal so‘rovi bo‘sh bo‘lsa — gerb, so‘z, progress, legenda hech qayerda; reyting o‘z joyida', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(document.querySelector('.crest')).toBeNull()
    expect(document.querySelector('.seat__level')).toBeNull()
    expect(document.querySelector('.seat__prog')).toBeNull()
    expect(document.querySelector('.tv-legend')).toBeNull()
    expect(document.querySelectorAll('#tv-sellers li.row')).toHaveLength(4)
    expect(document.querySelectorAll('#tv-sellers .row__medals')).toHaveLength(4)
  })

  it('podium bo‘sh bo‘lsa ham legenda turadi — qatorlarda gerb izohsiz qolmaydi', () => {
    render(<SellersColumn data={FALLBACK} {...PROPS} fakt="fakt2" medals={MEDALS} />)
    expect(column('tv-sellers').getByText(/Podium hali boʻsh/)).toBeTruthy()
    expect(document.querySelectorAll('#tv-sellers .tv-legend')).toHaveLength(1)
    expect(document.querySelectorAll('#tv-sellers li.row')).toHaveLength(2)
  })

  it('belgilar to‘plami sahifada BIR MARTA', () => {
    render(<Board data={RIPE} />)
    expect(document.querySelectorAll('#ch')).toHaveLength(1)
  })

  it('medal so‘rovi taxtanikidan alohida kalitda va o‘z soatida; `MedalDefs` taxta boshida', () => {
    const source = readFileSync('src/features/sellers/SellersPage.tsx', 'utf8')
    expect(source).toContain("queryKey: ['sellers', 'medals']")
    expect(source).toContain('staleTime: 600_000')
    expect(source).not.toMatch(/medals\.(isError|isPending)/)
    expect(source.match(/<MedalDefs \/>/g)).toHaveLength(1)
    const defs = source.indexOf('<MedalDefs />')
    expect(defs).toBeGreaterThan(source.indexOf('tv-board-shell'))
    expect(defs).toBeLessThan(source.indexOf('tv-switch'))
  })
})

/**
 * MAROSIM — ko'tarilish jamoat voqeasi (spec §8). `resetCelebrations()` har
 * testdan oldin: to'plam modul darajasida, testlar orasida ham yashaydi.
 */
describe('ko‘tarilish marosimi', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCelebrations()
  })
  afterEach(() => vi.useRealTimers())

  it('bugun ko‘tarilgan: e‘lon EFIR tilida sarlavha ustida, gerbning yangi katakchasi to‘ladi; 8 soniyadan keyin jim', () => {
    const today = '2026-09-16'
    const medals = new Map(MEDALS)
    medals.set('154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva', { promotedOn: today }))
    render(<SellersColumn data={RIPE} {...PROPS} medals={medals} medalsToday={today} />)
    const col = column('tv-sellers')
    const status = col.getByRole('status')
    expect(status.textContent).toBe(`154 Marjona Xayrullayeva — endi USTA · 100${S}000${S}000`)
    expect(status.classList.contains('tv-promo')).toBe(true)
    expect(status.getAttribute('data-tier')).toBe('4')
    expect(status.querySelector('.tv-promo__band')).not.toBeNull()
    expect(status.querySelector('svg.crest')!.querySelectorAll('use.on')).toHaveLength(4)
    expect(status.parentElement!.classList.contains('tv-col-head')).toBe(true)
    expect(seatOf('154 Marjona Xayrullayeva').querySelectorAll('.crest__cell--fill')).toHaveLength(1)
    expect(status.textContent).not.toMatch(/mln/)
    act(() => vi.advanceTimersByTime(8_000))
    expect(col.queryByRole('status')).toBeNull()
    expect(seatOf('154 Marjona Xayrullayeva').querySelector('.crest__cell--fill')).toBeNull()
  })

  it('daraja payloadlar orasida OSHDI — e‘lon «endi USTOZ · 300 000 000»', () => {
    const grown = new Map(MEDALS)
    grown.set(
      '154 Marjona Xayrullayeva',
      medalRow('154 Marjona Xayrullayeva', {
        level: 5,
        rankTitle: 'Ustoz',
        delivered: money(310_000_000),
        levelFloor: money(300_000_000),
        nextLevelAt: money(1_000_000_000),
        nextTitle: 'Legenda',
      }),
    )
    const { rerender } = render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(column('tv-sellers').queryByRole('status')).toBeNull()

    rerender(<SellersColumn data={RIPE} {...PROPS} medals={grown} />)
    const col = column('tv-sellers')
    expect(col.getByRole('status').textContent).toBe(`154 Marjona Xayrullayeva — endi USTOZ · 300${S}000${S}000`)
    const fill = seatOf('154 Marjona Xayrullayeva').querySelectorAll('use.crest__cell--fill')
    expect(fill).toHaveLength(1)
    expect(fill[0]!.getAttribute('x')).toBe('44')

    act(() => vi.advanceTimersByTime(8_000))
    expect(col.queryByRole('status')).toBeNull()
  })

  it('kecha ko‘tarilgan — e‘lon yo‘q', () => {
    const medals = new Map(MEDALS)
    medals.set('154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva', { promotedOn: '2026-09-15' }))
    render(<SellersColumn data={RIPE} {...PROPS} medals={medals} medalsToday="2026-09-16" />)
    expect(column('tv-sellers').queryByRole('status')).toBeNull()
  })
})

/**
 * YANGI MEDAL — oxirgi yangilanishda paydo bo'lgani, va faqat o'sha; ustun →
 * o'rindiq/qator → medal simi tortilgan.
 */
describe('yangi medal ustundan uyagacha', () => {
  const extra = (key: string, code: MedalCode): SellerMedalRowDto => {
    const base = MEDALS.get(key)!
    const added: SellerMedalDto = { code, count: 1, at: '2026-09-16', amount: null, orders: null, percent: null }
    return { ...base, medals: [...base.medals, added] }
  }

  it('qo‘shilgan medal o‘rindiqda ham, qatorda ham bir marta kattalashadi — boshqa hech qayerda', () => {
    const { rerender } = render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(document.querySelectorAll('.medal--new')).toHaveLength(0)

    const grown = new Map(MEDALS)
    grown.set('154 Marjona Xayrullayeva', extra('154 Marjona Xayrullayeva', 'day-winner'))
    grown.set('Nodira 118 Karimova', extra('Nodira 118 Karimova', 'day-winner'))
    rerender(<SellersColumn data={RIPE} {...PROPS} medals={grown} />)

    expect(seatOf('154 Marjona Xayrullayeva').querySelector('.seat__medals svg.medal--new[data-medal="day-winner"]')).not.toBeNull()
    expect(rowOf('Nodira 118 Karimova').querySelector('.row__medals svg.medal--new[data-medal="day-winner"]')).not.toBeNull()
    expect(document.querySelectorAll('.medal--new')).toHaveLength(2)
  })
})
