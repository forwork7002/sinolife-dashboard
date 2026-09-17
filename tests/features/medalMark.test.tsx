// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MedalDefs } from '@/features/sellers/MedalDefs'
import { MedalMark } from '@/features/sellers/MedalMark'
import { ROW_MEDALS, ROW_MEDAL_SIZE, RowMedals } from '@/features/sellers/RowMedals'
import { MEDAL_ORDER } from '@/features/sellers/medalCatalog'
import type { SellerMedalDto } from '@/lib/api'

/**
 * «ZARB» medal bo'laklari (klassik taxta spec §1.4–1.5): sahifaning yagona
 * `<defs>` i, bitta medal va qatorning medal to'plami. Bu yerda faqat
 * komponentlar va ularning CSS bo'limi — taxtaga ulanish o'z testida.
 */
const medal = (over: Partial<SellerMedalDto> & { code: SellerMedalDto['code'] }): SellerMedalDto => ({
  count: 1,
  at: '2026-08-01',
  amount: null,
  orders: null,
  percent: null,
  ...over,
})

describe('MedalDefs — sahifaga bir marta o‘rnatiladigan belgilar to‘plami', () => {
  it('bitta yashirin <svg class="medal-defs">: 14 ta `m-<code>`, uch dafna, ×N raqamlari — va boshqa belgi yo‘q', () => {
    const { container } = render(<MedalDefs />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect((svg as unknown as HTMLElement).style.position).toBe('absolute')
    // Gradientlar o'rta tonni SHU sinfdan meros oladi — globals.css, MEDALS bo'limi.
    expect(svg.classList.contains('medal-defs')).toBe(true)
    for (const code of MEDAL_ORDER) expect(container.querySelector(`symbol#m-${code}`), code).not.toBeNull()
    for (const m of ['gold', 'silver', 'bronze']) expect(container.querySelector(`symbol#m-laurel-${m}`)).not.toBeNull()
    expect(container.querySelector('path#nx')).not.toBeNull()
    expect(container.querySelector('path#n7')).not.toBeNull()
    const symbols = [...container.querySelectorAll('symbol')].map((s) => s.id)
    expect(symbols).toHaveLength(17)
    for (const id of symbols) expect(id, id).toMatch(/^m-/)
  })
})

describe('MedalMark — bitta medal', () => {
  it('32 birlik quti, bitta <use href="#m-<code>">, 28 px standart; nomi bir marta', () => {
    const { container } = render(<MedalMark code="streak-fire" />)
    const svg = container.querySelector('svg.medal-mark')!
    expect(svg.getAttribute('data-medal')).toBe('streak-fire')
    expect(svg.getAttribute('viewBox')).toBe('0 0 32 32')
    expect(svg.getAttribute('width')).toBe('28')
    expect([...svg.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#m-streak-fire'])
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Olov seriyasi')
    expect(svg.querySelector('text')).toBeNull()
  })

  it('oy oilasi: podium kartasida ≥ 40 px dafna o‘z metallida, tanadan OLDIN; qatorda va 32 px da yo‘q', () => {
    const { container } = render(
      <>
        <MedalMark code="month-silver" size={40} seat />
        <MedalMark code="month-bronze" size={48} seat />
        <MedalMark code="month-gold" size={32} seat />
        <MedalMark code="month-gold" size={48} />
        <MedalMark code="day-record" size={48} seat />
      </>,
    )
    const hrefs = [...container.querySelectorAll('svg.medal-mark')].map((m) =>
      [...m.querySelectorAll('use')].map((u) => u.getAttribute('href')),
    )
    expect(hrefs).toEqual([
      ['#m-laurel-silver', '#m-month-silver'],
      ['#m-laurel-bronze', '#m-month-bronze'],
      ['#m-month-gold'],
      ['#m-month-gold'],
      ['#m-day-record'],
    ])
  })

  it('×N plastinkasi — faqat podium kartasida va count > 1 da, SVG ICHIDA; aria nomga ×N qo‘shadi', () => {
    const { container } = render(<MedalMark code="day-winner" size={48} count={4} seat />)
    const svg = container.querySelector('svg.medal-mark')!
    expect(svg.getAttribute('aria-label')).toBe('Kun gʻolibi ×4')
    const rim = svg.querySelector('rect.medal-mark__plate-rim')!
    expect([rim.getAttribute('x'), rim.getAttribute('y'), rim.getAttribute('width'), rim.getAttribute('height')]).toEqual([
      '16.80', '21.2', '15', '10.6',
    ])
    // Po'lat tana — rim gradienti tana metallida; raqam belgi metallida (gilt).
    expect(rim.getAttribute('fill')).toBe('url(#mg-steel-rim)')
    expect(svg.querySelector('rect.medal-mark__plate-well')!.getAttribute('x')).toBe('17.90')
    const count = svg.querySelector('g.medal-mark__count')!
    expect(count.getAttribute('data-dev')).toBe('gilt')
    expect([...count.querySelectorAll('use')].map((u) => [u.getAttribute('href'), u.getAttribute('transform')])).toEqual([
      ['#nx', 'translate(21.85 26.7) scale(0.421)'],
      ['#n4', 'translate(26.75 26.7) scale(0.540)'],
    ])
    // Tashqarida HTML sanoq yo'q — «+N» ham, matnli izoh ham.
    expect(container.textContent).toBe('')
  })

  it('ikki raqam — keng plastinka; 99 da qisiladi; qatorda (seat yo‘q) plastinka yo‘q, aria baribir ×N', () => {
    const { container } = render(
      <>
        <MedalMark code="month-gold" size={48} count={12} seat />
        <MedalMark code="rookie" size={40} count={140} seat />
        <MedalMark code="jump" count={3} />
        <MedalMark code="jump" size={48} count={1} seat />
      </>,
    )
    const [twelve, many, row, one] = container.querySelectorAll('svg.medal-mark')
    expect(twelve!.querySelector('rect.medal-mark__plate-rim')!.getAttribute('width')).toBe('19.8')
    expect(twelve!.querySelector('rect.medal-mark__plate-rim')!.getAttribute('fill')).toBe('url(#mg-gold-rim)')
    expect(twelve!.querySelector('g.medal-mark__count')!.getAttribute('data-dev')).toBe('gold')
    expect([...many!.querySelectorAll('g.medal-mark__count use')].map((u) => u.getAttribute('href'))).toEqual(['#nx', '#n9', '#n9'])
    expect(row!.querySelector('rect')).toBeNull()
    expect(row!.getAttribute('aria-label')).toBe('Sakrash ×3')
    expect(one!.querySelector('rect')).toBeNull()
  })

  it('yangi medal sinfi va o‘lcham', () => {
    const { container } = render(<MedalMark code="jump" isNew size={32} />)
    const svg = container.querySelector('svg.medal-mark')!
    expect(svg.classList.contains('medal-mark--new')).toBe(true)
    expect(svg.getAttribute('height')).toBe('32')
  })
})

describe('RowMedals — qator medallari (spec §1.5)', () => {
  const seven = [
    medal({ code: 'month-gold', count: 2 }),
    medal({ code: 'streak-fire' }),
    medal({ code: 'conversion-master' }),
    medal({ code: 'day-record' }),
    medal({ code: 'clean-month' }),
    medal({ code: 'day-winner', count: 5 }),
    medal({ code: 'first-sale' }),
  ]

  it('first-sale yashirin, MEDAL_ORDER bo‘yicha eng ko‘pi 3 ta, 26–28 px; «+N» yo‘q, ×N yo‘q', () => {
    expect(ROW_MEDALS).toBe(3)
    expect(ROW_MEDAL_SIZE).toBeGreaterThanOrEqual(26)
    expect(ROW_MEDAL_SIZE).toBeLessThanOrEqual(28)
    const { container } = render(<RowMedals medals={[...seven].reverse()} />)
    const shown = [...container.querySelectorAll('.row-medals svg.medal-mark')]
    expect(shown.map((m) => m.getAttribute('data-medal'))).toEqual(['month-gold', 'streak-fire', 'conversion-master'])
    expect(shown.map((m) => m.getAttribute('width'))).toEqual(Array(3).fill(String(ROW_MEDAL_SIZE)))
    // Har medalga AYNAN bitta <use> — dafna yo'q, plastinka yo'q.
    for (const m of shown) {
      expect(m.querySelectorAll('use')).toHaveLength(1)
      expect(m.querySelector('rect')).toBeNull()
    }
    // Sanoq aria'da ham yo'q (count berilmaydi).
    expect(shown[0]!.getAttribute('aria-label')).toBe('Oy chempioni')
    expect(container.textContent).toBe('')
  })

  it('haqiqiy metall avval: kumush oy olov seriyasidan, gilt po‘latdan oldin', () => {
    const { container } = render(
      <RowMedals
        medals={[medal({ code: 'work-month' }), medal({ code: 'rookie' }), medal({ code: 'streak-fire' }), medal({ code: 'month-silver' })]}
      />,
    )
    expect([...container.querySelectorAll('svg.medal-mark')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'month-silver', 'streak-fire', 'rookie',
    ])
  })

  /*
    TELEVIZOR TABI DEPLOYLAR ORASIDA KUNLAB OCHIQ: server yangi medal kodini
    frontend nusxasidan oldin yuborsa, `MEDAL_METAL[code]` undefined edi va uni
    destrukturlash butun ustunni yiqitardi. Notanish kod chizilmaydi.
  */
  it('notanish medal kodi — qator ham, belgi ham yiqilmaydi, u chizilmaydi', () => {
    const future = medal({ code: 'future-medal' as unknown as 'rookie' })
    const { container } = render(
      <>
        <RowMedals medals={[future, medal({ code: 'rookie' })]} />
        <MedalMark code={'future-medal' as unknown as 'rookie'} size={48} seat />
      </>,
    )
    expect([...container.querySelectorAll('svg.medal-mark')].map((m) => m.getAttribute('data-medal'))).toEqual(['rookie'])
  })

  it('chizadigan medal yo‘q (bo‘sh, yoki faqat first-sale) — hech narsa chizilmaydi, quti ham', () => {
    const { container } = render(
      <>
        <RowMedals medals={[]} />
        <RowMedals medals={[medal({ code: 'first-sale' })]} />
      </>,
    )
    expect(container.innerHTML).toBe('')
  })

  it('yangi medal sinfi — faqat o‘sha medalda', () => {
    const { container } = render(<RowMedals medals={seven} newKeys={new Set(['streak-fire'])} />)
    expect(container.querySelector('svg.medal-mark--new[data-medal="streak-fire"]')).not.toBeNull()
    expect(container.querySelectorAll('.medal-mark--new')).toHaveLength(1)
  })
})

describe('globals.css — MEDALS bo‘limi', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  const title = css.indexOf(' * MEDALS — «ZARB»')
  const start = css.lastIndexOf('/* =====', title)
  const section = css.slice(start, css.indexOf('/* =====', title))
  const code = section.replace(/\/\*[\s\S]*?\*\//g, '')

  it('bo‘lim bor va faqat medal instance qoidalari: literal rang yo‘q, color-mix yo‘q', () => {
    expect(title).toBeGreaterThan(-1)
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/rgba?\(/)
    expect(code).not.toContain('color-mix')
    const selectors = [...code.matchAll(/(^|\n)\s*([.@][^{\n]+?)\s*[{,]/g)].map((m) => m[2]!.trim())
    // Medalning o'zi, va uning taxtadagi ikki joyi: o'rindiq tokchasi va qator katagi.
    for (const s of selectors) {
      expect(s, s).toMatch(
        /^(\.medal-defs|\.medal-mark|\.row-medals|\.seat-medals|\.tv-cell--medals|\.tv-cell--bare|\.tv-list--medals|@keyframes medal-mark-new|@media \(prefers-reduced-motion: no-preference\)|@media \(min-width: 1280px\) and \(max-width: (1799|1319)px\)|@media \(max-width: 639px\))/,
      )
    }
  })

  it('o‘rta ton FAQAT ikki joyda qayta bog‘lanadi: `.medal-defs` (gradientlar) va `.medal-mark` (instance)', () => {
    expect(code).toMatch(/\.medal-defs,\s*\.medal-mark \{\s*--medal-gold: var\(--zarb-gold\);\s*--medal-silver: var\(--zarb-silver\);\s*--medal-bronze: var\(--zarb-bronze\);\s*\}/)
    // Podium xromi o'z qiymatida qoladi — `:root` dagi uch qiymat eski taxtaniki.
    expect(css).toContain('--medal-gold: #b3860e;')
    expect((css.match(/--medal-gold: #e8c256;/g) ?? [])).toHaveLength(2)
    // …va `--zarb-*` uchala mavzu blokida.
    for (const token of ['--zarb-gold', '--zarb-silver', '--zarb-bronze', '--medal-plate-well']) {
      expect((css.match(new RegExp(`^\\s*${token}:`, 'gm')) ?? []).length, token).toBe(3)
    }
  })

  /*
    Po'lat medallar qatorlarning ~95% ini tashkil qiladi. Qorong'i mavzuda tana
    va qator foni orasidagi kontrast 1.6–2.4:1 edi (well tokeni deyarli qator
    rangi) — 26 px da uch metrdan faqat gilt belgi qolardi. Beshta token
    ko'tarildi, FAQAT qorong'i bloklarda, va ikki qorong'i blok bir xil bo'lishi
    shart: biri tizim mavzusi, ikkinchisi majburiy `data-theme="dark"`.
  */
  it('qorong‘i po‘lat ko‘tarilgan va ikki qorong‘i blokda bir xil; yorug‘ blok o‘z qiymatida', () => {
    const lifted: Record<string, string> = {
      '--medal-steel-hi': '#c6d4e4',
      '--medal-steel': '#8296ad',
      '--medal-steel-lo': '#4a5b70',
      '--medal-steel-patina': '#2a3f55',
      '--medal-steel-well': '#33414f',
    }
    for (const [token, value] of Object.entries(lifted)) {
      const values = [...css.matchAll(new RegExp(`^\\s*${token}: (#[0-9a-f]{6});`, 'gm'))].map((m) => m[1])
      expect(values, token).toHaveLength(3)
      expect(values.slice(1), token).toEqual([value, value])
      expect(values[0], token).not.toBe(value)
    }
  })

  it('×N plastinkasi tokenlardan bo‘yaladi; raqam belgi metallida', () => {
    expect(code).toMatch(/\.medal-mark__plate-rim \{[^}]*stroke: var\(--medal-key\);/)
    expect(code).toMatch(/\.medal-mark__plate-well \{[^}]*fill: var\(--medal-plate-well\);/)
    expect(code).toContain('.medal-mark__count use { stroke: var(--medal-gold-hi); }')
    for (const dev of ['gilt', 'steel', 'silver', 'bronze']) {
      expect(code).toContain(`.medal-mark__count[data-dev="${dev}"] use { stroke: var(--medal-${dev}-hi); }`)
    }
  })

  it('qator medallari o‘ngdan chapga; yangi medal animatsiyasi faqat `no-preference` ichida', () => {
    expect(code).toMatch(/\.row-medals \{[^}]*flex-flow: row-reverse wrap;/)
    const guarded = code.slice(code.indexOf('@media (prefers-reduced-motion: no-preference)'))
    expect(guarded).toMatch(/\.medal-mark--new \{[^}]*animation: medal-mark-new 400ms var\(--ease-out\) both;/)
    // Himoyadan tashqarida `animation` yo'q.
    const outside = code.slice(0, code.indexOf('@media (prefers-reduced-motion: no-preference)'))
    expect(outside.replace(/@keyframes[\s\S]*?\n\}/, '')).not.toContain('animation')
  })
})
