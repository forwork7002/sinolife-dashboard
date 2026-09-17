// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ROW_MEDAL_SIZE } from '@/features/sellers/RowMedals'
import { MEDALS } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalDto } from '@/lib/api'

/**
 * THE MEDALS ON THE KLASSIK BOARD (spec 2026-09-17-klassik-taxta-medallar §1.5).
 *
 * The board is the old board; the medals are the one thing added to it, and
 * the client has rejected this screen four times, so what is pinned here is
 * every promise the spec makes about them that a reader of the television
 * would notice and that nothing in TypeScript can see:
 *
 * - a seat's shelf holds 4 / 3 / 3 and a row holds 3 — what does not fit is
 *   NOT DRAWN, and nothing anywhere says «+N»;
 * - `first-sale` (92 of 100 sellers hold it) is never drawn in a row;
 * - a repeat is the ×N plate struck inside the medal, on a seat only;
 * - every medal says its own Uzbek name, and the shelf prints no words;
 * - the teams column has no medals — ever;
 * - a medal animates ONLY when it appears between two payloads, never on a
 *   reload, because the first payload has nothing to be new against;
 * - and NOTHING OF THE LEVELS IS LEFT: no crest, no «daraja», no legend.
 *
 * It mounts the real `SellersPage` over a stubbed `fetch`, so the wiring is
 * under test too: one `<MedalDefs />`, the `?include=medals` request with no
 * period on it, the join by `employeeId`.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/sellers',
  useSearchParams: () => new URLSearchParams('preset=this_month'),
}))

/* Reduced motion «yes»: `AnimatedNumber` prints its final value, `useAutoScroll` stays off. */
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

const { SellersPage } = await import('@/features/sellers/SellersPage')

const money = (amount: number) => ({ amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount })

function seller(employeeId: string, rank: number, won: number, ordered: number) {
  return {
    employeeId,
    rank,
    fullName: `Sotuvchi ${employeeId}`,
    rop: 'Sevinch',
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

function team(rop: string, rank: number, won: number) {
  return {
    rank,
    rop,
    sellers: 4,
    orders: 10,
    wonOrders: 6,
    ordered: money(won * 1.2),
    won: money(won),
    open: money(0),
    conversionPercent: null,
    sharePercent: null,
  }
}

const medal = (code: MedalCode, count = 1): SellerMedalDto => ({
  code,
  count,
  at: '2026-08-01',
  amount: null,
  orders: null,
  percent: null,
})

/*
  e1–e3 take the seats, e4–e6 the rows. A TEAM IS NAMED «e1» ON PURPOSE: the
  medals are keyed by `employeeId` and a team by its ROP's name, so this is
  the one fixture in which a careless join would hang a seller's medals on a
  team — and the teams column has to stay bare anyway.
*/
const BOARD = {
  rows: [
    seller('e1', 1, 90_000_000, 120_000_000),
    seller('e2', 2, 70_000_000, 90_000_000),
    seller('e3', 3, 50_000_000, 60_000_000),
    seller('e4', 4, 40_000_000, 50_000_000),
    seller('e5', 5, 30_000_000, 40_000_000),
    seller('e6', 6, 0, 0),
  ],
  teams: [team('e1', 1, 300_000_000), team('e4', 2, 200_000_000), team('Sevinch', 3, 100_000_000), team('Lola', 4, 50_000_000)],
  totals: { orders: 18, wonOrders: 10, won: money(280_000_000), teamlessSellers: 0 },
}

const SEVEN: SellerMedalDto[] = [
  medal('first-sale'),
  medal('work-month'),
  medal('day-winner', 4),
  medal('clean-month'),
  medal('streak-fire', 2),
  medal('month-silver'),
  medal('month-gold', 3),
]

const MEDALS_A = {
  from: '2026-08-01T00:00:00.000Z',
  sellers: [
    { employeeId: 'e1', medals: SEVEN },
    { employeeId: 'e2', medals: SEVEN },
    { employeeId: 'e3', medals: SEVEN },
    { employeeId: 'e4', medals: SEVEN },
    { employeeId: 'e5', medals: [medal('first-sale')] },
    { employeeId: 'e6', medals: [medal('rookie')] },
  ],
}

const META = { dataSource: 'DEMO', generatedAt: '2026-09-17T06:00:00.000Z' }

let medalsPayload: unknown = MEDALS_A
let medalsFails = false
const asked: string[] = []

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    asked.push(url)
    if (url.includes('include=medals') && medalsFails) {
      return { ok: false, status: 500, json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'x' }, meta: META }) } as unknown as Response
    }
    const data = url.includes('include=medals')
      ? medalsPayload
      : url.includes('include=records')
        ? { months: [], from: '2026-08-01T00:00:00.000Z' }
        : url.includes('/analytics/sellers')
          ? BOARD
          : {}
    return { ok: true, status: 200, json: async () => ({ data, meta: META }) } as unknown as Response
  })
}

let client: QueryClient

beforeEach(() => {
  medalsPayload = MEDALS_A
  medalsFails = false
  asked.length = 0
  window.history.replaceState(null, '', '/sellers')
  vi.stubGlobal('fetch', mockFetch())
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: Infinity } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openBoard() {
  const view = render(
    <QueryClientProvider client={client}>
      <SellersPage />
    </QueryClientProvider>,
  )
  // A seat's shelf is drawn from BOTH payloads, so it cannot appear until both have landed.
  await waitFor(() => expect(view.container.querySelector('#tv-sellers .seat-medals')).not.toBeNull())
  return view
}

const codes = (root: Element | null) =>
  [...(root?.querySelectorAll('svg.medal-mark') ?? [])].map((m) => m.getAttribute('data-medal'))

const seat = (container: HTMLElement, place: 1 | 2 | 3) => container.querySelector(`#tv-sellers .tv-seat--${place}`)!

const rowOf = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll('#tv-sellers .tv-row')].find((r) => r.textContent?.includes(name))!

describe('podium tokchasi — 4 / 3 / 3, «+N» yo‘q, izoh yo‘q', () => {
  it('chempion 4 tagacha 40 px, 2- va 3-o‘rin 3 tagacha 36 px; nodiri avval; po‘lat nishon haqiqiy mukofotga joy beradi', async () => {
    const { container } = await openBoard()
    expect(codes(seat(container, 1))).toEqual(['month-gold', 'month-silver', 'streak-fire', 'clean-month'])
    expect(codes(seat(container, 2))).toEqual(['month-gold', 'month-silver', 'streak-fire'])
    expect(codes(seat(container, 3))).toEqual(['month-gold', 'month-silver', 'streak-fire'])
    for (const m of seat(container, 1).querySelectorAll('svg.medal-mark')) expect(m.getAttribute('width')).toBe('40')
    for (const place of [2, 3] as const) {
      for (const m of seat(container, place).querySelectorAll('svg.medal-mark')) expect(m.getAttribute('width')).toBe('36')
    }
  })

  it('tokcha jamoa chipidan KEYIN, summadan OLDIN — va bitta', async () => {
    const { container } = await openBoard()
    const card = seat(container, 1).querySelector('.tv-seat-card')!
    const shelf = card.querySelectorAll('.seat-medals')
    expect(shelf).toHaveLength(1)
    const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const chip = [...card.querySelectorAll('span')].find((s) => s.textContent === 'Sevinch')!
    expect(after(chip, shelf[0]!)).toBe(true)
    expect(after(shelf[0]!, card.querySelector('.tv-seat-figure')!)).toBe(true)
  })

  it('takror — medalning ICHIDAGI ×N plastinkasi va aria’dagi «×N»; tokchada bitta ham so‘z yo‘q', async () => {
    const { container } = await openBoard()
    const gold = seat(container, 1).querySelector('svg.medal-mark[data-medal="month-gold"]')!
    expect(gold.getAttribute('aria-label')).toBe('Oy chempioni ×3')
    expect(gold.querySelector('rect.medal-mark__plate-rim')).not.toBeNull()
    expect(gold.querySelector('.medal-mark__count')).not.toBeNull()
    // Bir martalik medalda plastinka yo'q.
    const silver = seat(container, 1).querySelector('svg.medal-mark[data-medal="month-silver"]')!
    expect(silver.getAttribute('aria-label')).toBe('Kumush oy')
    expect(silver.querySelector('rect')).toBeNull()
    for (const shelf of container.querySelectorAll('.seat-medals')) expect(shelf.textContent).toBe('')
  })

  it('medali yo‘q o‘rindiq — tokcha ham yo‘q: karta eski kartaning o‘zi', async () => {
    medalsPayload = { ...MEDALS_A, sellers: MEDALS_A.sellers.filter((s) => s.employeeId !== 'e2') }
    const { container } = await openBoard()
    expect(seat(container, 2).querySelector('.seat-medals')).toBeNull()
    expect(seat(container, 2).querySelector('svg.medal-mark')).toBeNull()
    expect(seat(container, 1).querySelector('.seat-medals')).not.toBeNull()
  })
})

describe('qator medallari — 3 tagacha, first-sale yashirin, sanoq yo‘q', () => {
  it('yettitadan uchtasi, nodiri avval; first-sale qatorda chizilmaydi; ×N qatorda yo‘q', async () => {
    const { container } = await openBoard()
    const row = rowOf(container, 'Sotuvchi e4')
    expect(codes(row)).toEqual(['month-gold', 'month-silver', 'streak-fire'])
    for (const m of row.querySelectorAll('svg.medal-mark')) {
      expect(m.getAttribute('width')).toBe(String(ROW_MEDAL_SIZE))
      expect(m.querySelector('rect')).toBeNull()
      expect(m.getAttribute('aria-label')).not.toContain('×')
    }
    expect(container.querySelector('#tv-sellers .tv-row svg.medal-mark[data-medal="first-sale"]')).toBeNull()
    expect(row.querySelector('.row-medals')!.textContent).toBe('')
  })

  it('faqat first-sale bor qator — medalsiz qator: quti ham, grid ham yo‘q', async () => {
    const { container } = await openBoard()
    const row = rowOf(container, 'Sotuvchi e5')
    expect(row.querySelector('.row-medals')).toBeNull()
    expect(row.querySelector('.tv-cell')!.className).toBe('tv-cell')
  })

  it('medallar ism katagida, chase satridan keyin; pulsiz qator (chase yo‘q) o‘z shaklida', async () => {
    const { container } = await openBoard()
    const paid = rowOf(container, 'Sotuvchi e4').querySelector('.tv-cell')!
    expect(paid.className).toBe('tv-cell tv-cell--medals')
    expect([...paid.children].map((c) => c.className.split(' ')[0])).toEqual(['tv-nameline', 'tv-bar', 'tv-chase', 'row-medals'])
    const bare = rowOf(container, 'Sotuvchi e6').querySelector('.tv-cell')!
    expect(bare.className).toBe('tv-cell tv-cell--medals tv-cell--bare')
    expect([...bare.children].map((c) => c.className.split(' ')[0])).toEqual(['tv-nameline', 'tv-bar', 'row-medals'])
    expect(codes(bare)).toEqual(['rookie'])
    // Ro'yxat bitta sinf bilan barcha chiziqlarni bir xil qisqartiradi.
    expect(container.querySelector('#tv-sellers .tv-list')!.classList.contains('tv-list--medals')).toBe(true)
  })
})

describe('taxta bo‘ylab', () => {
  it('hech qayerda «+N» yo‘q', async () => {
    const { container } = await openBoard()
    const texts = [...container.querySelectorAll('#tv-sellers *, #tv-teams *')]
      .filter((e) => e.children.length === 0)
      .map((e) => e.textContent?.trim() ?? '')
    // «+21,500,000 soʻm» — chase; «+3» — sanoq. Faqat ikkinchisi taqiqlangan.
    for (const text of texts) expect(text, text).not.toMatch(/^\+\s?\d{1,3}$/)
  })

  it('har bir medal o‘z o‘zbekcha nomini aytadi', async () => {
    const { container } = await openBoard()
    const names = new Set(Object.values(MEDALS).map((m) => m.name))
    const marks = [...container.querySelectorAll('svg.medal-mark')]
    expect(marks.length).toBeGreaterThan(10)
    for (const m of marks) {
      expect(m.getAttribute('role')).toBe('img')
      const label = m.getAttribute('aria-label')!
      expect(names.has(label.replace(/ ×\d+$/, '')), label).toBe(true)
    }
  })

  it('komandalar panelida medal yo‘q — «e1» nomli komanda ham sotuvchi e1 ning medallarini olmaydi', async () => {
    const { container } = await openBoard()
    const teams = container.querySelector('#tv-teams')!
    expect(teams.querySelectorAll('.tv-seat')).toHaveLength(3)
    expect(teams.querySelector('svg.medal-mark')).toBeNull()
    expect(teams.querySelector('.seat-medals')).toBeNull()
    expect(teams.querySelector('.row-medals')).toBeNull()
    expect(teams.querySelector('.tv-list')!.classList.contains('tv-list--medals')).toBe(false)
  })

  it('sahifada BITTA <defs>, va medal so‘rovi davr filtrini olib yurmaydi', async () => {
    const { container } = await openBoard()
    expect(container.querySelectorAll('svg.medal-defs')).toHaveLength(1)
    const medalCalls = asked.filter((u) => u.includes('include=medals'))
    expect(medalCalls).toEqual(['/api/v1/analytics/sellers?include=medals'])
    // Taxtaning o'zi esa davrni olib yuradi.
    expect(asked.some((u) => u.includes('/analytics/sellers?') && u.includes('preset=this_month') && !u.includes('include='))).toBe(true)
  })

  it('medal so‘rovi yiqilsa, taxta eski taxtaning o‘zi: reyting turadi, medal yo‘q', async () => {
    medalsFails = true
    const { container } = render(
      <QueryClientProvider client={client}>
        <SellersPage />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(container.querySelectorAll('#tv-sellers .tv-seat')).toHaveLength(3))
    await waitFor(() => expect(asked.some((u) => u.includes('include=medals'))).toBe(true))
    expect(container.querySelector('svg.medal-mark')).toBeNull()
    expect(container.querySelector('.tv-list--medals')).toBeNull()
    expect(container.querySelectorAll('#tv-sellers .tv-row')).toHaveLength(3)
  })

  it('darajadan HECH NARSA qolmagan: gerb yo‘q, «daraja» yo‘q, legenda yo‘q', async () => {
    const { container } = await openBoard()
    expect(container.querySelector('[class*="crest"], [id*="crest"], [data-tier], [class*="tier"], [class*="legend"], [class*="halo"]')).toBeNull()
    expect(container.innerHTML).not.toMatch(/crest|halo-|tier-/i)
    expect(container.textContent).not.toMatch(/daraja|uroven|legenda|ustoz|shogird/i)
  })

  /*
    DEPLOY ORALIG'I: server bu sahifadan keyin yangilansa, televizor tabi bir
    muddat daraja maydonlari bor eski payload'ni oladi. Sahifa ularni o'qimaydi.
  */
  it('eski payload (daraja maydonlari bilan) kelsa ham ekranda daraja yo‘q', async () => {
    medalsPayload = {
      from: MEDALS_A.from,
      today: '2026-09-17',
      sellers: MEDALS_A.sellers.map((s) => ({ ...s, level: 4, legendaTier: 0, rankTitle: 'Usta', promotedOn: '2026-09-17' })),
    }
    const { container } = await openBoard()
    expect(container.textContent).not.toMatch(/Usta|daraja/i)
    expect(codes(seat(container, 1))).toHaveLength(4)
  })
})

describe('yangi medal — faqat ikki payload orasida', () => {
  it('birinchi payload (reload) hech narsani «yangi» demaydi', async () => {
    const { container } = await openBoard()
    expect(container.querySelectorAll('svg.medal-mark').length).toBeGreaterThan(0)
    expect(container.querySelector('.medal-mark--new')).toBeNull()
  })

  it('keyingi payload’da paydo bo‘lgan medal — faqat o‘sha, o‘rindiqda ham qatorda ham; o‘zgarmagan payload hech narsani qo‘zg‘atmaydi', async () => {
    const { container } = await openBoard()

    // Bir xil javob: hech narsa yangi emas.
    await act(async () => {
      await client.refetchQueries({ queryKey: ['sellers', 'medals'] })
    })
    expect(container.querySelector('.medal-mark--new')).toBeNull()

    // e3 yil chempioni bo'ldi (o'rindiq), e5 kun rekordini oldi (qator).
    medalsPayload = {
      ...MEDALS_A,
      sellers: MEDALS_A.sellers.map((s) =>
        s.employeeId === 'e3'
          ? { ...s, medals: [...s.medals, medal('year-champion')] }
          : s.employeeId === 'e5'
            ? { ...s, medals: [...s.medals, medal('day-record')] }
            : s,
      ),
    }
    await act(async () => {
      await client.refetchQueries({ queryKey: ['sellers', 'medals'] })
    })
    await waitFor(() => expect(container.querySelectorAll('.medal-mark--new')).toHaveLength(2))
    const fresh = [...container.querySelectorAll('.medal-mark--new')]
    expect(fresh.map((m) => m.getAttribute('data-medal')).sort()).toEqual(['day-record', 'year-champion'])
    expect(seat(container, 3).querySelector('.medal-mark--new')!.getAttribute('data-medal')).toBe('year-champion')
    expect(rowOf(container, 'Sotuvchi e5').querySelector('.medal-mark--new')!.getAttribute('data-medal')).toBe('day-record')
  })
})

describe('globals.css — medallarning taxtadagi joyi', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  const title = css.indexOf(' * MEDALS — «ZARB»')
  const section = css.slice(css.lastIndexOf('/* =====', title), css.indexOf('/* =====', title))
  const code = section.replace(/\/\*[\s\S]*?\*\//g, '')
  const phone = code.slice(code.indexOf('@media (max-width: 639px)'))

  it('qator o‘smaydi: tutqich aynan bitta medal balandligida, ikkinchi satri ko‘rinmaydi', () => {
    const holder = code.match(/\n\.row-medals \{([^}]*)\}/)![1]!
    expect(holder).toMatch(new RegExp(`height: ${ROW_MEDAL_SIZE}px;`))
    expect(holder).toMatch(/overflow: hidden;/)
    expect(holder).toMatch(/flex-flow: row-reverse wrap;/)
    expect(holder).toMatch(new RegExp(`row-gap: ${ROW_MEDAL_SIZE}px;`))
    // Birinchi satrni ochib beradigan nol kenglikdagi qorovul.
    expect(code).toMatch(new RegExp(`\\.row-medals::before \\{[^}]*width: 0;\\s*height: ${ROW_MEDAL_SIZE}px;`))
  })

  it('raqam ustunlari qo‘zg‘almaydi: tutqich katakning ichki kengligiga HECH NARSA qo‘shmaydi', () => {
    const holder = code.match(/\n\.row-medals \{([^}]*)\}/)![1]!
    expect(holder).toMatch(/contain: inline-size;/)
    // Padding/gap tutqichning minimal kengligiga aylanadi va ism satrini siqadi — oraliq medalning o'z marjasi.
    expect(holder).not.toMatch(/padding|(?<!row-)gap/)
    expect(code).toMatch(/\.row-medals > \.medal-mark \{\s*margin-left: 6px;\s*\}/)
    // `minmax(0, …)` emas: aks holda ism satri ustun minimumiga kirmay qoladi.
    expect(code).toMatch(/\.tv-cell--medals \{\s*display: grid;\s*grid-template-columns: auto 1fr;/)
  })

  it('medallar chiziq va chase satrlarida (2–3), pulsiz qatorda ism va chiziq satrlarida (1–2)', () => {
    expect(code).toMatch(/\.tv-cell--medals > \.tv-bar \{\s*grid-area: 2 \/ 1 \/ 3 \/ -1;/)
    expect(code).toMatch(/\.tv-cell--medals > \.tv-chase \{\s*grid-area: 3 \/ 1 \/ 4 \/ 2;/)
    expect(code).toMatch(/\.tv-cell--medals > \.row-medals \{\s*grid-area: 2 \/ 2 \/ 4 \/ 3;/)
    expect(code).toMatch(/\.tv-cell--bare > \.row-medals \{\s*grid-area: 1 \/ 2 \/ 3 \/ 3;/)
  })

  it('chiziq RO‘YXAT bo‘yicha bir xil qisqaradi, va tutqich o‘sha joydan keng bo‘la olmaydi', () => {
    expect(code).toMatch(/\.tv-list--medals \{\s*--row-medals-room: 96px;\s*\}/)
    expect(code).toMatch(/\.tv-list--medals \.tv-bar \{\s*max-width: min\(260px, calc\(100% - var\(--row-medals-room\)\)\);/)
    expect(code).toMatch(/\n\.row-medals \{[^}]*max-width: var\(--row-medals-room\);/)
    // 3 × (26 + 6) = 96; tor ikki ustunli oraliqda ikki medal: 2 × 32 = 64.
    expect(3 * (ROW_MEDAL_SIZE + 6)).toBe(96)
    expect(code).toMatch(/@media \(min-width: 1280px\) and \(max-width: 1799px\) \{\s*\.tv-list--medals \{\s*--row-medals-room: 64px;/)
  })

  /*
    Ism katagi jadval ustun qo'shgan ikki nuqtadan keyin eng tor: 1280 da 195 px,
    1600 da 189 px — chase ~160 px. U yerda medalga joy yo'q, shuning uchun chiziq
    ham qisqarmaydi: joy nol, tutqichning `max-width` i ham nol. Tartib MUHIM —
    bu qoida 64 px qoidasidan KEYIN turishi kerak, aks holda u yutqazadi.
  */
  it('medal sig‘maydigan ikki tor oraliqda joy NOL: chiziq eski uzunligida, qatorda medal yo‘q', () => {
    const none = code.indexOf('@media (min-width: 1280px) and (max-width: 1319px), (min-width: 1600px) and (max-width: 1659px)')
    expect(none).toBeGreaterThan(code.indexOf('--row-medals-room: 64px;'))
    expect(code.slice(none)).toMatch(/^[^{]*\{\s*\.tv-list--medals \{\s*--row-medals-room: 0px;/)
  })

  it('telefonda grid yo‘q: medallar o‘z satrida, chapdan, chiziq eski uzunligida', () => {
    expect(phone).toMatch(/\.tv-cell--medals \{\s*display: block;/)
    expect(phone).toMatch(/\.row-medals \{[^}]*justify-self: start;[^}]*flex-flow: row wrap;/)
    expect(phone).toMatch(/\.tv-list--medals \.tv-bar \{\s*max-width: 260px;/)
  })

  it('tokcha tor kartada kichrayadi, kartadan chiqmaydi', () => {
    expect(code).toMatch(/\.seat-medals \{[^}]*display: flex;[^}]*justify-content: center;/)
    expect(code).toMatch(/\.seat-medals > \.medal-mark \{\s*flex: 0 1 auto;\s*min-width: 0;\s*height: auto;/)
  })
})
