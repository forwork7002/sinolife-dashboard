// @vitest-environment jsdom
import { render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { fromSeller, queuedOf, rankedBy, splitBoard } from '@/features/sellers/board'
import { idleTeamGroups } from '@/features/sellers/TeamsBoard'
import { resetCelebrations } from '@/features/sellers/usePromotions'
import type { SellerBoardDto, SellerBoardRowDto, SellerMedalRowDto } from '@/lib/api'
import { NARROW_NBSP, formatSomFull } from '@/lib/format'

/**
 * SIYRAK «BUGUN» — EFIR Premium §8 (delta 16–17a). Ertalab bir-ikki kishi pul
 * qilgan, bir nechtasining buyurtmasi tasdiq navbatida, qolganlarida hech
 * narsa yo'q. Taxta shu uch holatni o'z so'zi bilan aytadi: sahna (yoki sokin
 * sahna), «Tasdiq kutilmoqda» guruhi, va hech narsasi yo'qlar — umuman yo'q.
 * Oy konteksti bloklari va «hozircha» — YO'Q (mijoz qarorlari 2, 3).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/sellers',
  useSearchParams: () => new URLSearchParams(''),
}))

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

/**
 * Production shakli: `orders` — FAKT 1 buyurtmalari, `cohortOrders` — navbatga
 * kirgan hammasi, `lostOrders` — rad etilgan + tasdiqdan keyin bekor.
 */
function seller(
  fullName: string,
  rop: string | null,
  o: { ordered?: number; won?: number; orders?: number; queued?: number; rejected?: number } = {},
) {
  const orders = o.orders ?? (o.ordered ? 1 : 0)
  return {
    rank: 1,
    employeeId: fullName,
    fullName,
    rop,
    orders,
    ordered: money(o.ordered ?? 0),
    won: money(o.won ?? 0),
    wonOrders: o.won ? 1 : 0,
    open: money(o.ordered ?? 0),
    openOrders: orders,
    lostOrders: o.rejected ?? 0,
    lostAfterConfirmOrders: 0,
    lostAfterConfirm: money(0),
    cohortOrders: orders + (o.queued ?? 0) + (o.rejected ?? 0),
    conversionPercent: null,
    sharePercent: null,
  }
}

function team(rop: string, sellers: number, ordered: number, won = 0) {
  return {
    rank: 1,
    rop,
    sellers,
    orders: ordered > 0 ? 1 : 0,
    ordered: money(ordered),
    won: money(won),
    wonOrders: 0,
    open: money(ordered),
    conversionPercent: null,
    sharePercent: null,
  }
}

function board(rows: ReturnType<typeof seller>[], teams: ReturnType<typeof team>[] = []): SellerBoardDto {
  return {
    rows,
    teams,
    totals: { orders: 0, wonOrders: 0, won: money(0), teamlessSellers: 0 },
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

/* 2026-09-17, 09:40: bitta kishi pul qilgan, ikki kishi navbatda, biri faqat rad etilgan, biri bo'sh. */
const MORNING = board(
  [
    seller('Содиков Мурод', 'Kompaniya', { ordered: 1_600_000 }),
    seller('Yusupova 139 Mahliyo', 'Lola', { queued: 1 }),
    seller('Ravshanov 158 Asilbek', 'Azizbek', { queued: 3 }),
    seller('Karimova 140 Nodira', 'Lola', { rejected: 1 }),
    seller('Toshmatov 141 Bekzod', 'Sevinch'),
  ],
  [team('Kompaniya', 1, 1_600_000), team('Lola', 9, 0), team('Azizbek', 11, 0), team('Sevinch', 9, 0)],
)

const TWO = board([
  seller('Saparboyeva 110 Farida', 'Sevinch', { ordered: 12_900_000, orders: 4 }),
  seller('Ashrafova 172 Marjona', 'Gulzora', { ordered: 9_000_000, orders: 2 }),
  seller('Yusupova 139 Mahliyo', 'Lola', { queued: 2 }),
])

const NONE = board([seller('Yusupova 139 Mahliyo', 'Lola', { queued: 2 }), seller('Toshmatov 141 Bekzod', 'Sevinch')])

const THREE = board([
  seller('A 1', null, { ordered: 3_000_000 }),
  seller('B 2', null, { ordered: 2_000_000 }),
  seller('C 3', null, { ordered: 1_000_000 }),
])

const col = (id: 'tv-sellers' | 'tv-teams') => document.getElementById(id)!
const rowNames = () => [...col('tv-sellers').querySelectorAll('li.row')].map((r) => r.getAttribute('data-row-name'))

describe('navbatdagi buyurtmalar — qaysi maydon', () => {
  it('`cohortOrders − orders − (lostOrders − lostAfterConfirmOrders)` = CONFIRM_NEW + NO_ANSWER; `openOrders` EMAS', () => {
    // Production «Bugun» qatori: 3 buyurtma tasdiqlangan va yo'lda (openOrders 3), navbatda hech narsa.
    const onRoad = { cohortOrders: 3, orders: 3, lostOrders: 0, lostAfterConfirmOrders: 0, openOrders: 3 }
    expect(queuedOf(onRoad as unknown as SellerBoardRowDto)).toBe(0)
    // 5 kirgan: 2 tasdiqlangan (biri keyin bekor), 1 rad etilgan, 2 navbatda.
    const mixed = { cohortOrders: 5, orders: 2, lostOrders: 2, lostAfterConfirmOrders: 1, openOrders: 1 }
    expect(queuedOf(mixed as unknown as SellerBoardRowDto)).toBe(2)
    // Eski payload — son kafolatlanmaydi.
    expect(queuedOf({ orders: 2 } as unknown as SellerBoardRowDto)).toBeNull()
  })

  it('uch xil qator: earner, navbatdagi, hech narsasi yo‘q (ro‘yxatga chiqmaydi)', () => {
    const ranked = rankedBy(MORNING.rows.map(fromSeller), false)
    const split = splitBoard(ranked, false)
    expect(split.earners.map((e) => e.name)).toEqual(['Содиков Мурод'])
    expect(split.queued.map((e) => e.name)).toEqual(['Ravshanov 158 Asilbek', 'Yusupova 139 Mahliyo'])
    expect(split.ranked.map((e) => e.name)).toEqual(['Содиков Мурод'])
    expect(split.idle.map((e) => e.name)).toEqual(['Karimova 140 Nodira', 'Toshmatov 141 Bekzod'])
  })
})

describe('sotuvchilar ustuni — siyrak holat', () => {
  it('1 earner: bitta to‘liq kenglikdagi sahna, podium yo‘q; ikkinchi fakt «hali yoʻq»', () => {
    render(<SellersColumn data={MORNING} {...PROPS} today />)
    expect(col('tv-sellers').querySelector('.tv-podium')).toBeNull()
    const stages = col('tv-sellers').querySelectorAll('article.stage')
    expect(stages).toHaveLength(1)
    const stage = stages[0]!
    expect(stage.getAttribute('aria-label')).toBe('1-oʻrin')
    expect(stage.querySelector('.stage__name')!.textContent).toBe('Содиков Мурод')
    expect(stage.querySelector('use[href="#halo-laurel"]')).not.toBeNull()
    expect(stage.querySelector('.halo')!.getAttribute('width')).toBe('84')
    expect(stage.querySelector('.seat__money')!.textContent).toBe(`1${S}600${S}000`)
    // Yorliq va matn orasida haqiqiy bo'shliq — ekran o'quvchi «FAKT 1tasdiqlangan» demaydi.
    expect([...stage.querySelectorAll('.stage__fakt > span')].map((s) => s.textContent)).toEqual([
      'FAKT 1 tasdiqlangan · 1 buyurtma',
      'FAKT 2 hali yoʻq — yetkazish kutilmoqda',
    ])
    // Rank qatori yo'q — yorliq qatori ham yo'q; faqat navbat.
    expect(col('tv-sellers').querySelector('.tv-cols')).toBeNull()
  })

  it('sahna medal qatori bilan: «Avgustdan beri yetkazilgan», tokcha va izoh', () => {
    const medals = new Map<string, SellerMedalRowDto>([
      [
        'Содиков Мурод',
        {
          employeeId: 'Содиков Мурод',
          level: 2,
          legendaTier: 0,
          rankTitle: 'Sotuvchi',
          delivered: money(18_200_000),
          levelFloor: money(10_000_000),
          nextLevelAt: money(30_000_000),
          nextTitle: 'Katta sotuvchi',
          promotedOn: null,
          medals: [{ code: 'month-gold', count: 1, at: '2026-08-01', amount: money(1), orders: 1, percent: null }],
        },
      ],
    ])
    render(<SellersColumn data={MORNING} {...PROPS} medals={medals} today />)
    const stage = col('tv-sellers').querySelector('article.stage')!
    expect(stage.querySelector('.seat__life')!.textContent).toBe(
      `Avgustdan beri yetkazilgan18${S}200${S}000 / 30${S}000${S}000`,
    )
    expect(stage.querySelector('.stage__rack svg.medal')!.getAttribute('data-medal')).toBe('month-gold')
    expect(stage.querySelector('.seat__cap')!.textContent).toBe('Oy chempioniavgust')
    expect(stage.querySelector('.lvl')!.textContent).toBe('Sotuvchi')
    expect(stage.textContent).not.toMatch(/hozircha/)
  })

  it('2 earner: sahnada birinchisi, ikkinchisi — birinchi rank qatori (servis ranki bilan)', () => {
    render(<SellersColumn data={TWO} {...PROPS} today />)
    expect(col('tv-sellers').querySelectorAll('article.stage')).toHaveLength(1)
    expect(col('tv-sellers').querySelector('article.stage')!.getAttribute('data-seat-name')).toBe('Saparboyeva 110 Farida')
    const first = col('tv-sellers').querySelector('.tv-rows > li')!
    expect(first.getAttribute('data-row-name')).toBe('Ashrafova 172 Marjona')
    expect(first.querySelector('.row__rank')!.textContent).toBe('2')
    expect(first.querySelector('.row__hero')!.textContent).toBe(formatSomFull(9_000_000))
    expect(col('tv-sellers').querySelector('.tv-cols')).not.toBeNull()
  })

  it('0 earner: `#halo-ghost` va «Bugun hali savdo yoʻq»; navbat qatori qoladi', () => {
    render(<SellersColumn data={NONE} {...PROPS} today />)
    const ghost = col('tv-sellers').querySelector('article.stage--ghost')!
    expect(ghost.querySelector('use')!.getAttribute('href')).toBe('#halo-ghost')
    expect(within(ghost as HTMLElement).getByText('Bugun hali savdo yoʻq')).toBeTruthy()
    expect(rowNames()).toEqual(['Yusupova 139 Mahliyo'])
  })

  it('3 earner: odatdagi uchlik, sahna yo‘q', () => {
    render(<SellersColumn data={THREE} {...PROPS} today />)
    expect(col('tv-sellers').querySelectorAll('.tv-podium article.seat')).toHaveLength(3)
    expect(col('tv-sellers').querySelector('.stage')).toBeNull()
  })

  it('navbat qatorlari: tasma, ism, komanda; bitta keng uya; «—» ham, «0» ham hech qayerda', () => {
    render(<SellersColumn data={MORNING} {...PROPS} today />)
    const queue = [...col('tv-sellers').querySelectorAll('li.row--queue')]
    expect(queue.map((r) => r.getAttribute('data-row-name'))).toEqual(['Ravshanov 158 Asilbek', 'Yusupova 139 Mahliyo'])
    expect(queue.map((r) => r.querySelector('.row__wait')!.textContent)).toEqual([
      '3 buyurtma tasdiq navbatida',
      '1 buyurtma tasdiq navbatida',
    ])
    for (const row of queue) {
      expect(row.querySelector('.row__band')).not.toBeNull()
      expect(row.querySelector('.row__team')!.textContent).not.toBe('')
      expect(row.querySelector('.row__rank')!.textContent).toBe('')
      for (const el of row.querySelectorAll('*')) {
        if (el.children.length > 0) continue
        expect(el.textContent).not.toBe('—')
        expect(el.textContent).not.toBe('0')
      }
    }
    expect(col('tv-sellers').querySelector('.group h4')!.textContent).toBe('Tasdiq kutilmoqda')
  })

  it('hech narsasi yo‘q qatorlar (faqat rad etilgan ham) taxtada yo‘q', () => {
    render(<SellersColumn data={MORNING} {...PROPS} today />)
    expect(rowNames()).not.toContain('Karimova 140 Nodira')
    expect(rowNames()).not.toContain('Toshmatov 141 Bekzod')
    expect(col('tv-sellers').textContent).not.toMatch(/hozircha|Shu oy yetakchilari/)
  })

  /*
    NAVBATDAN KEYIN, O'Z SARLAVHASI OSTIDA (premium review, 2026-09-17). Idle qatorlar
    rank qatorlari ortidan — navbatdagilarning USTIDA — rank-siz, chiziqchali blok
    bo'lib turardi: butun oyi bekor bo'lgan sotuvchi hali buyurtmasi kutayotganlardan
    oldin. Endi tartib: rank qatorlari · «Tasdiq kutilmoqda» · «Savdosiz».
  */
  it('uzunroq davrda hech narsasi yo‘q qator rank-siz qoladi — ro‘yxat OXIRIDA, «Savdosiz» ostida, navbatdan keyin', () => {
    render(<SellersColumn data={MORNING} {...PROPS} />)
    expect(rowNames()).toEqual([
      'Ravshanov 158 Asilbek',
      'Yusupova 139 Mahliyo',
      'Karimova 140 Nodira',
      'Toshmatov 141 Bekzod',
    ])
    expect(col('tv-sellers').querySelector('li[data-row-name="Karimova 140 Nodira"] .row__rank')!.textContent).toBe('')
    const list = col('tv-sellers').querySelector('ol.tv-rows')!
    const order = [...list.children].map((li) =>
      li.classList.contains('group') ? `# ${li.querySelector('h4')!.textContent}` : li.getAttribute('data-row-name'),
    )
    expect(order).toEqual([
      '# Tasdiq kutilmoqda',
      'Ravshanov 158 Asilbek',
      'Yusupova 139 Mahliyo',
      '# Savdosiz',
      'Karimova 140 Nodira',
      'Toshmatov 141 Bekzod',
    ])
    // Rank qatori yo'q, lekin idle qatorlar ustunli — yorliq qatori ular uchun chiziladi.
    expect(col('tv-sellers').querySelector('.tv-cols')).not.toBeNull()
  })

  /*
    E'LON FAQAT EKRANDAGI ODAMGA (premium review, 2026-09-17): `onBoard` barcha
    kirishlardan qurilardi, ya'ni «Bugun» da chizilmagan idle sotuvchi uchun ham
    «endi USTA» chiqardi — taxtada topib bo'lmaydigan ism.
  */
  it('«Bugun» da chizilmagan sotuvchining ko‘tarilishi e‘lon qilinmaydi; u chizilgan davrda qilinadi', () => {
    const day = '2026-09-17'
    const promoted = new Map<string, SellerMedalRowDto>([
      [
        'Karimova 140 Nodira',
        {
          employeeId: 'Karimova 140 Nodira',
          level: 4,
          legendaTier: 0,
          rankTitle: 'Usta',
          delivered: money(120_000_000),
          levelFloor: money(100_000_000),
          nextLevelAt: money(300_000_000),
          nextTitle: 'Ustoz',
          promotedOn: day,
          medals: [],
        },
      ],
    ])
    resetCelebrations()
    const hidden = render(<SellersColumn data={MORNING} {...PROPS} medals={promoted} medalsToday={day} today />)
    expect(rowNames()).not.toContain('Karimova 140 Nodira')
    expect(col('tv-sellers').querySelector('.tv-promo')).toBeNull()
    hidden.unmount()
    render(<SellersColumn data={MORNING} {...PROPS} medals={promoted} medalsToday={day} />)
    expect(col('tv-sellers').querySelector('.tv-promo')!.textContent).toMatch(/^Karimova 140 Nodira — endi USTA/)
  })

  it('sarlavha sanog‘idagi raqamlar `<b>` da — jumla matni o‘zgarmaydi', () => {
    render(<SellersColumn data={MORNING} {...PROPS} today />)
    const count = col('tv-sellers').querySelector('.tv-col-head__count')!
    expect([...count.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['1', '2'])
    expect(count.textContent).toBe('bugun 1 sotuvchi savdo qildi · 2 tasi tasdiq kutmoqda')
  })

  it('«Bugun» da «Savdosiz» guruhi ham, uning qatorlari ham yo‘q', () => {
    render(<SellersColumn data={MORNING} {...PROPS} today />)
    const heads = [...col('tv-sellers').querySelectorAll('.group h4')].map((h) => h.textContent)
    expect(heads).toEqual(['Tasdiq kutilmoqda'])
  })

  it('sarlavha sanog‘i: «bugun N sotuvchi savdo qildi · M tasi tasdiq kutmoqda»; boshqa davrda oddiy son', () => {
    const { unmount } = render(<SellersColumn data={MORNING} {...PROPS} today />)
    expect(col('tv-sellers').querySelector('.tv-col-head__count')!.textContent).toBe(
      'bugun 1 sotuvchi savdo qildi · 2 tasi tasdiq kutmoqda',
    )
    unmount()
    render(<SellersColumn data={MORNING} {...PROPS} />)
    expect(col('tv-sellers').querySelector('.tv-col-head__count')!.textContent).toBe('5 sotuvchi')
  })

  /*
    FE'L O'QILAYOTGAN FAKTDA (real-data audit, 2026-09-17): production «Bugun» da
    FAKT 2 bosilganda sarlavha «bugun 0 sotuvchi savdo qildi» derdi, ostida esa
    15 sotuvchining FAKT 1 puli turardi. `earners` faol faktdagi pul — FAKT 2 da
    ular yetkazganlar.
  */
  it('FAKT 2 o‘qilganda sanoq «yetkazdi» deydi — «savdo qildi» emas', () => {
    render(<SellersColumn data={MORNING} {...PROPS} fakt="fakt2" today />)
    expect(col('tv-sellers').querySelector('.tv-col-head__count')!.textContent).toBe(
      'bugun 0 sotuvchi yetkazdi · 2 tasi tasdiq kutmoqda',
    )
  })
})

describe('komandalar ustuni — siyrak holat', () => {
  it('rank faqat pulli komandaga; bitta sokin satr «Hali savdosiz: … — navbatda K tadan buyurtma»', () => {
    render(<TeamsColumn data={MORNING} {...PROPS} today />)
    expect([...col('tv-teams').querySelectorAll('li.trow .nm')].map((n) => n.textContent)).toEqual(['Kompaniya'])
    const quiet = col('tv-teams').querySelectorAll('.quiet')
    expect(quiet).toHaveLength(1)
    // Azizbek: 3 navbatda; Lola: 1 (Nodira faqat rad etilgan — hisobga kirmaydi);
    // Sevinch: puli ham, navbati ham yo'q — aytilmaydi.
    expect(quiet[0]!.textContent).toBe(
      'Hali savdosiz: Azizbek — navbatda 3 ta buyurtma · Lola — navbatda 1 ta buyurtma',
    )
    expect(quiet[0]!.textContent).not.toMatch(/\b0 ta/)
  })

  it('bir xil navbatli komandalar bitta bo‘lakda — «tadan»', () => {
    const entries = (names: string[]) =>
      names.map((name) => ({ key: name, rank: 1, name, badge: null, sellers: 1, won: 0, ordered: 0, wonOrders: 0, orders: 0, openOrders: null, queuedOrders: null, conversionPercent: null, sharePercent: null }))
    const sellers = [
      fromSeller(seller('x', 'Azizbek', { queued: 1 }) as unknown as SellerBoardRowDto),
      fromSeller(seller('y', 'Lola', { queued: 1 }) as unknown as SellerBoardRowDto),
    ]
    expect(idleTeamGroups(entries(['Azizbek', 'Lola']), sellers)).toEqual([{ names: ['Azizbek', 'Lola'], queued: 1 }])
  })

  it('plaket «Bugun jami · FAKT 1»; sarlavha «bugun 1 komanda savdo qildi»', () => {
    render(<TeamsColumn data={MORNING} {...PROPS} today />)
    expect(col('tv-teams').querySelector('.jami__k')!.textContent).toBe('Bugun jami · FAKT 1')
    expect(col('tv-teams').querySelector('.jami__v')!.textContent).toBe(`1${S}600${S}000`)
    expect(col('tv-teams').querySelector('.tv-col-head__count')!.textContent).toBe('bugun 1 komanda savdo qildi')
  })

  it('FAKT 2 o‘qilganda komandalar sanog‘i ham «yetkazdi»', () => {
    render(<TeamsColumn data={MORNING} {...PROPS} fakt="fakt2" today />)
    expect(col('tv-teams').querySelector('.tv-col-head__count')!.textContent).toBe('bugun 0 komanda yetkazdi')
  })
})
