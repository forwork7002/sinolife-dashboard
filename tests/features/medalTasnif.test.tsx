// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BoardIcon } from '@/features/sellers/BoardIcon'
import { MedalTasnif } from '@/features/sellers/MedalTasnif'
import { MEDALS, MEDAL_ORDER } from '@/features/sellers/medalCatalog'
import {
  CLEAN_MONTH_PERCENT,
  JUMP_GROWTH,
  MEDAL_MIN_ORDERS,
  ROOKIE_PLACE,
  STREAK_FIRE_PLACE,
  STREAK_MONTHS,
  STREAK_STEADY_PLACE,
  WORK_MONTH_SHARE,
  buildSellerMedals,
} from '@/server/domain/analytics/sellerMedals'

/**
 * «Medallar tasnifi» — taxtaning pastida aylanib turadigan medal kaliti
 * (mijoz, 2026-09-18), va emoji o'rnidagi chiziqli ikonkalar (`BoardIcon`).
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/* jsdom has no `matchMedia`; `useReducedMotion` reads it. Motion allowed — what stops the crawl here is the missing measurement. */
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

describe('MedalTasnif — medal kaliti', () => {
  it('14 medalning hammasi, MEDAL_ORDER tartibida: belgi, nom va qoida; uch guruh bir martadan', () => {
    const { container } = render(<MedalTasnif />)
    const strip = container.querySelector('.medal-tasnif')!
    expect(strip.getAttribute('aria-label')).toBe('Medallar tasnifi')
    const entries = [...strip.querySelectorAll('.medal-tasnif-entry')]
    expect(entries.map((e) => e.querySelector('svg.medal-mark')!.getAttribute('data-medal'))).toEqual([...MEDAL_ORDER])
    expect(entries.map((e) => e.querySelector('.medal-tasnif-name')!.textContent)).toEqual(MEDAL_ORDER.map((c) => MEDALS[c].name))
    for (const e of entries) expect(e.querySelector('.medal-tasnif-rule')!.textContent!.length).toBeGreaterThan(8)
    expect([...strip.querySelectorAll('.medal-tasnif-group')].map((g) => [g.getAttribute('data-group'), g.textContent])).toEqual([
      ['honour', 'Oliy mukofot'],
      ['rare', 'Nodir'],
      ['daily', 'Kundalik'],
    ])
  })

  it('nom BIR MARTA aytiladi: belgi aria-hidden o‘ramda, yonidagi matn o‘qiladi', () => {
    const { container } = render(<MedalTasnif />)
    for (const mark of container.querySelectorAll('svg.medal-mark')) {
      expect(mark.closest('[aria-hidden="true"]'), mark.getAttribute('data-medal')!).not.toBeNull()
    }
  })

  /*
    jsdom o'lchamaydi (scrollWidth 0) — lenta aylanmaydi, IKKINCHI nusxa
    chizilmaydi. Brauzerda nusxa `aria-hidden`; bu yerda pinlanadigani —
    aylanmayotgan lenta kontentni ikki marta aytmasligi.
  */
  it('o‘lchov yo‘q joyda aylanmaydi va kontent bir nusxada', () => {
    const { container } = render(<MedalTasnif />)
    expect(container.querySelector('.medal-tasnif-track--crawling')).toBeNull()
    expect(container.querySelectorAll('.medal-tasnif-run')).toHaveLength(1)
  })

  /*
    MIJOZ SO'RAGANI AYNAN SHU — «pastda aylanib turishi kerak». O'lchov bor
    joyda (brauzer) lenta aylanadi: masofa o'lchangan kenglik, tezlik piksel
    (38 px/s), ikkinchi nusxa bezak — ekran o'quvchiga jim, rollarsiz.
  */
  describe('o‘lchov bor joyda', () => {
    afterEach(() => vi.restoreAllMocks())

    it('aylanadi: masofa = bitta nusxa kengligi, davomiylik pikseldan; ikkinchi nusxa jim', () => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2400)
      const { container } = render(<MedalTasnif />)
      const track = container.querySelector<HTMLElement>('.medal-tasnif-track--crawling')!
      expect(track).not.toBeNull()
      expect(track.style.getPropertyValue('--tasnif-travel')).toBe('2400px')
      expect(track.style.animationDuration).toBe(`${2400 / 38}s`)
      const runs = container.querySelectorAll('.medal-tasnif-run')
      expect(runs).toHaveLength(2)
      expect(runs[0]!.getAttribute('role')).toBe('list')
      expect(runs[1]!.getAttribute('aria-hidden')).toBe('true')
      expect(runs[1]!.getAttribute('role')).toBeNull()
      // Ro'yxat rollari faqat birinchi nusxada; medal SVG'larining `role="img"` i aria-hidden ichida qoladi.
      expect(runs[1]!.querySelector('[role="list"], [role="listitem"]')).toBeNull()
    })

    it('reduced-motion: o‘lchov bo‘lsa ham aylanmaydi, bitta nusxa', () => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2400)
      const original = window.matchMedia
      window.matchMedia = ((q: string) => ({ ...original(q), matches: q.includes('prefers-reduced-motion') })) as typeof window.matchMedia
      try {
        const { container } = render(<MedalTasnif />)
        expect(container.querySelector('.medal-tasnif-track--crawling')).toBeNull()
        expect(container.querySelectorAll('.medal-tasnif-run')).toHaveLength(1)
      } finally {
        window.matchMedia = original
      }
    })
  })

  /*
    QOIDALAR MOTORNIKI. Frontend server domenini import qila olmaydi (qatlam
    qoidasi), shuning uchun lenta chegaralarni qo'lda yozadi — testlar qatlam
    qoidasidan ozod, va shu test nusxani aslidan tekshiradi: motorda chegara
    o'zgarsa, lentadagi gap shu yerda yiqiladi.
  */
  it('lentadagi chegaralar motordagi konstantalar bilan bir xil', () => {
    const { container } = render(<MedalTasnif />)
    const rule = (code: string) =>
      container.querySelector(`.medal-tasnif-entry svg[data-medal="${code}"]`)!.closest('.medal-tasnif-entry')!.querySelector('.medal-tasnif-rule')!.textContent!
    expect(rule('streak-fire')).toBe(`${STREAK_MONTHS} oy ketma-ket top-${STREAK_FIRE_PLACE} da`)
    expect(rule('streak-steady')).toBe(`${STREAK_MONTHS} oy ketma-ket top-${STREAK_STEADY_PLACE} da`)
    expect(rule('rookie')).toBe(`birinchi toʻliq oyida top-${ROOKIE_PLACE} da`)
    expect(rule('clean-month')).toContain(`${CLEAN_MONTH_PERCENT}%`)
    expect(rule('clean-month')).toContain(`${MEDAL_MIN_ORDERS}+ buyurtma`)
    expect(rule('conversion-master')).toContain(`${MEDAL_MIN_ORDERS}+ buyurtma`)
    expect(rule('work-month')).toContain(`${Math.round(WORK_MONTH_SHARE * 100)}%`)
    expect(rule('jump')).toContain(`${String(JUMP_GROWTH).replace('.', ',')} barobar`)
  })

  /*
    `JUMP_GROWTH` NI MOTOR O'QIMAYDI — qoida `sellerMedals.ts` da butun sonli
    `2n >= 3n` (BigInt, kasr yo'q). Konstanta bilan solishtirish yetmaydi:
    literal o'zgarib konstanta qolsa, lenta «1,5 barobar» deb yolg'on gapirardi.
    Shuning uchun motorning o'zi aynan JUMP_GROWTH chegarasida medal berishi
    va bir tiyin kamida bermasligi tekshiriladi.
  */
  it('«Sakrash» motorda aynan JUMP_GROWTH barobarda beriladi — lentadagi son motorniki', () => {
    const past = 1_000_000n
    const atRule = BigInt(Math.round(Number(past) * JUMP_GROWTH))
    const fact = (month: string, deliveredMinor: bigint) => ({
      month,
      employeeId: 'a',
      confirmedOrders: 1,
      confirmedMinor: 0n,
      deliveredOrders: 1,
      deliveredMinor,
      place: 99,
    })
    const codesAt = (now: bigint) =>
      buildSellerMedals({ months: [fact('2026-07-01', past), fact('2026-08-01', now)], days: [], runningMonth: '2026-09', runningDay: '2026-09-01' })
        .find((r) => r.employeeId === 'a')!
        .medals.map((m) => m.code)
    expect(codesAt(atRule)).toContain('jump')
    expect(codesAt(atRule - 1n)).not.toContain('jump')
  })
})

describe('globals.css — tasnif lentasi va sayqal', () => {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

  it('lenta rekord devori mexanizmida: piksel tezlik, pauza, reduced-motion qo‘lda suriladi', () => {
    expect(code).toMatch(/\.medal-tasnif-track--crawling \{[^}]*animation-name: medal-tasnif-crawl;[^}]*animation-timing-function: linear;/)
    expect(code).toMatch(/@keyframes medal-tasnif-crawl \{[\s\S]*?translate3d\(calc\(-1 \* var\(--tasnif-travel\)\), 0, 0\)/)
    expect(code).toMatch(/\.medal-tasnif-track--crawling \{[^}]*animation-iteration-count: infinite;/)
    // Faqat kursor to'xtatadi: lenta ichida fokuslanadigan narsa yo'q, `:focus-within` hech qachon mos kelmasdi.
    expect(code).toMatch(/\.medal-tasnif:hover \.medal-tasnif-track--crawling \{\s*animation-play-state: paused;/)
    expect(code).not.toContain('.medal-tasnif:focus-within')
    const reduced = code.slice(code.indexOf('.medal-tasnif:hover'))
    expect(reduced).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.medal-tasnif-window \{\s*overflow-x: auto;[\s\S]*?\.medal-tasnif-track \{\s*animation: none;/)
  })

  it('lenta to‘liq kenglikda; kredit uning ostida, sahifa chekkasida — ro‘yxatlardan joy olmaydi', () => {
    expect(code).toMatch(/\.tv-foot \{[^}]*position: relative;[^}]*flex-shrink: 0;[^}]*display: flex;/)
    expect(code).toMatch(/\.medal-tasnif \{[^}]*flex: 1 1 0;[^}]*min-width: 0;/)
    // Oqimdan tashqarida: lenta butun kenglikni oladi, kredit uning o'ng chetining ostida.
    expect(code).toMatch(/\.tv-foot > \.tv-credit \{[^}]*position: absolute;[^}]*top: calc\(100% \+ 5px\);[^}]*right: 6px;/)
  })

  it('sayqal tokenlari uchala mavzu blokida, ikki qorong‘i blok bir xil', () => {
    for (const token of ['--px-hair', '--px-hair-soft', '--px-well', '--px-bezel-gap', '--px-sheen', '--px-engrave', '--px4-track', '--px4-thumb-hi', '--px4-thumb-drop']) {
      const values = [...CSS.matchAll(new RegExp(`^\\s*${token}: ([^;]+);`, 'gm'))].map((m) => m[1])
      expect(values, token).toHaveLength(3)
      expect(values[1], token).toBe(values[2])
      expect(values[0], token).not.toBe(values[1])
    }
  })

  /*
    TOJ XATOSI: `.rise` `transform: none` da tugaydi (fill-mode both) va inline
    `translateX(-50%)` ni o'chirardi — toj halqadan 12,5px o'ngda turardi.
    Markazlash margin bilan, va sahifa manbaida inline transform YO'Q.
  */
  it('toj margin bilan markazlanadi, inline transform yo‘q', () => {
    expect(code).toMatch(/\.bi--crown \{[^}]*width: 25px;[^}]*margin-left: -12\.5px;/)
    const page = readFileSync(join(process.cwd(), 'src/features/sellers/SellersPage.tsx'), 'utf8')
    expect(page).not.toMatch(/transform: 'translateX\(-50%\)/)
  })
})

describe('BoardIcon — emoji o‘rnidagi chiziqli ikonkalar', () => {
  it('bitta span, aria-hidden, sinf SHU spanga qo‘shiladi (o‘ram yo‘q); `dim` faqat so‘ralganda', () => {
    const { container } = render(
      <>
        <BoardIcon name="trophy" className="tv-col-glyph" />
        <BoardIcon name="target" dim />
        <BoardIcon name="target" />
      </>,
    )
    const [glyph, dim, lit] = container.querySelectorAll('span.bi')
    expect(container.querySelectorAll('span')).toHaveLength(3)
    expect(glyph!.className).toBe('tv-col-glyph bi bi--trophy')
    expect(glyph!.getAttribute('aria-hidden')).toBe('true')
    expect(glyph!.querySelector('svg')).not.toBeNull()
    expect(dim!.classList.contains('bi--dim')).toBe(true)
    expect(lit!.classList.contains('bi--dim')).toBe(false)
  })

  it('sotuvchilar bo‘limi manbaida rangli emoji qolmagan', () => {
    for (const file of ['SellersPage.tsx', 'RecordWall.tsx', 'MedalTasnif.tsx']) {
      const source = readFileSync(join(process.cwd(), 'src/features/sellers', file), 'utf8')
      // Izohlar tarixni emoji bilan eslaydi — tekshiriladigani JSX'ga chiqadigan satrlar.
      const jsx = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(jsx, file).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}◆]/u)
    }
  })
})
