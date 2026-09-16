import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * EFIR taxtasining stylesheet faktlari — `theme.test.ts` naqshi: hech biri
 * TypeScript'dan ko'rinmaydi va buzilishi jim. Fayl vazifalar bo'ylab o'sadi.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

const from = (marker: string) => {
  const i = CSS.indexOf(marker)
  expect(i, `${marker} yo'q`).toBeGreaterThan(-1)
  return i
}

/** Uchala token bloki: yorug' `:root`, tizim-qorong'i media bloki, majburiy qorong'i. */
const LIGHT = CSS.slice(from(':root {\n  color-scheme: light;'), from('@media (prefers-color-scheme: dark)'))
const SYSTEM_DARK = CSS.slice(from('@media (prefers-color-scheme: dark)'), from(':root[data-theme="dark"]'))
const FORCED_DARK = CSS.slice(from(':root[data-theme="dark"]'), from('@theme inline'))

describe('EFIR tokenlari — uchala blokda', () => {
  it('`--tier-1..6` yorug‘ blokda, yorug‘lik tartibida', () => {
    const light = ['#3a4557', '#4a6085', '#2b86c2', '#2bb1ee', '#8ed3f5', '#c9ecff']
    light.forEach((hex, i) => expect(LIGHT).toContain(`--tier-${i + 1}: ${hex};`))
  })

  it('`--tier-1..6` ikkala qorong‘i blokda bir xil va yorug‘ blokdan boshqa', () => {
    const dark = ['#3f4a5c', '#506480', '#3e8fc4', '#7fd0ff', '#bde8ff', '#f2fbff']
    dark.forEach((hex, i) => {
      expect(SYSTEM_DARK).toContain(`--tier-${i + 1}: ${hex};`)
      expect(FORCED_DARK).toContain(`--tier-${i + 1}: ${hex};`)
      expect(LIGHT).not.toContain(`--tier-${i + 1}: ${hex};`)
    })
  })

  it('oila ORDINAL deb hujjatlashtirilgan — `--seq` uslubida, seriya emas', () => {
    expect(LIGHT).toMatch(/ORDINAL/)
    expect(LIGHT).toMatch(/never a series/i)
  })

  it('nodir medal soyasi: yorug‘da shaffof, qorong‘ida oltin aralashmasi', () => {
    expect(LIGHT).toContain('--glow-rare: transparent;')
    expect(SYSTEM_DARK).toContain('--glow-rare: color-mix(in oklab, var(--medal-gold) 55%, transparent);')
    expect(FORCED_DARK).toContain('--glow-rare: color-mix(in oklab, var(--medal-gold) 55%, transparent);')
  })
})

describe('EFIR shrift shkalasi', () => {
  it('`--tv-xl/l/m/s` 44/24/16/13 `:root` da, 1600 dan tor ekranda 36/20/14/12', () => {
    expect(LIGHT).toContain('--tv-xl: 44px;')
    expect(LIGHT).toContain('--tv-l: 24px;')
    expect(LIGHT).toContain('--tv-m: 16px;')
    expect(LIGHT).toContain('--tv-s: 13px;')
    const narrow = CSS.slice(from('@media (max-width: 1599px) {\n  :root {'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n') + 3)
    for (const line of ['--tv-xl: 36px;', '--tv-l: 20px;', '--tv-m: 14px;', '--tv-s: 12px;']) {
      expect(block).toContain(line)
    }
  })

  it('eski `--tv-name/--tv-money/--tv-small/--tv-seat-*` clamplari yo‘q', () => {
    for (const token of ['--tv-name', '--tv-money', '--tv-small', '--tv-seat-scale', '--tv-seat-name', '--tv-seat-figure']) {
      expect(CSS, token).not.toContain(`${token}:`)
      expect(CSS, token).not.toContain(`var(${token})`)
    }
  })
})

/** EFIR bo'limi — bannerdan TV BOARD bannerigacha. */
const EFIR = () => CSS.slice(from('* EFIR —'), from('* TV BOARD — the sellers board'))
/**
 * Izohlarsiz — bannerlar tokenlarni SO'Z bilan tilga oladi, qoida bilan emas.
 * Bo'lim BANNER ICHIDAN boshlanadi (marker banner ochilgandan KEYIN turadi),
 * shuning uchun avval o'sha yopilmagan izohning qolgani tashlanadi — aks holda
 * bannerning o'z matni qoida bo'lib o'qilardi.
 */
const strip = (s: string) => s.replace(/^[\s\S]*?\*\//, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('EFIR bo‘limi — rang shartnomasi', () => {
  it('bo‘lim bor va TV BOARD dan oldin turadi; asosiy selektorlar', () => {
    for (const sel of [
      '[data-tier="0"]', '[data-tier="6"]', '.crest {', '.crest--row', '.crest--seat', '.crest--legend',
      '.crest__crown', '.medal {', '.medal.rare', '.medal-count', '.halo {', '.halo--lg', '.tv-legend {',
      '.legend__rung',
    ]) {
      expect(EFIR(), sel).toContain(sel)
    }
  })

  it('literal rang yo‘q — faqat var(--…) va color-mix', () => {
    const code = strip(EFIR())
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/\brgba?\(/)
    expect(code).not.toMatch(/\bhsla?\(/)
  })

  it('`--tier-N` faqat `[data-tier="N"]` orqali o‘qiladi; 0-daraja — kontur', () => {
    const code = strip(EFIR())
    for (let n = 1; n <= 6; n += 1) expect(code).toContain(`[data-tier="${n}"] { --tier: var(--tier-${n}); }`)
    expect(code).toContain('[data-tier="0"] { --tier: var(--border-strong); }')
    // Boshqa hech qayerda `--tier-N` o'qilmaydi — komponent faqat `--tier` ni biladi.
    expect(code.match(/var\(--tier-\d\)/g) ?? []).toHaveLength(6)
  })

  it('seriya rangi yo‘q — daraja ham, medal ham `--series-*` ni o‘qimaydi', () => {
    expect(strip(EFIR())).not.toContain('--series-')
  })

  /*
    PODIUM METALLARI — YOZILGAN ISTISNO RO'YXATI (spec §1, §3): Oy oilasi
    maydoni va barcha medallarning asosiy oltini (`.medal`), rank halqasi
    (`.halo`), Legenda toji (`.crest__crown`), komandalar ustunidagi metall
    raqam (`.trow__rank`), rekord yorlig'i (`.record__k`). Boshqa hech qanday
    selektor `--medal-*` ni o'qimaydi — tasma, gerb katakchasi, ism, raqam.
  */
  it('podium metallari faqat yozilgan istisnolarda', () => {
    const code = strip(EFIR())
    const allowed = /^(\.medal\b|\.halo\b|\.crest__crown\b|\.trow__rank\b|\.record__k\b)/
    const rules = code.match(/[^{}]+\{[^{}]*\}/g) ?? []
    expect(rules.length).toBeGreaterThan(10)
    for (const rule of rules) {
      if (!rule.includes('--medal-')) continue
      const selector = rule.slice(0, rule.indexOf('{')).trim()
      expect(selector, rule.trim()).toMatch(allowed)
    }
  })

  it('kamaytirilgan harakatda hech narsa qimirlamaydi — blok bo‘limning oxirida', () => {
    const efir = EFIR()
    const reduced = efir.slice(efir.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    for (const sel of ['.crest__cell--fill', '.medal--new', '.tv-promo', '.row__band', '.seat::before', '.seat__bar i']) {
      expect(reduced, sel).toContain(sel)
    }
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('transition: none')
    expect(efir.indexOf('/* EFIR — kamaytirilgan harakat')).toBeGreaterThan(efir.indexOf('.legend__rung'))
  })
})

describe('EFIR — o‘rindiq', () => {
  it('uchta karta 2-1-3 tartibida, pastlari tekis; tasma va yo‘l `--tier` da; o‘rindiq medali ko‘tarilgan sirtga o‘yiladi', () => {
    const code = strip(EFIR())
    expect(code).toMatch(/\.tv-podium \{[^}]*align-items: flex-end;/)
    expect(code).toContain('.seat--1 {\n  flex: 1.48 1 0;\n  max-width: 456px;')
    expect(code).toContain('.seat--2 { order: 1; }')
    expect(code).toContain('.seat--3 { order: 3; }')
    expect(code).toMatch(/\.seat::before \{[^}]*width: 10px;[^}]*background: var\(--tier\);/)
    expect(code).toMatch(/\.seat\[data-tier="0"\]::before \{[^}]*box-shadow: inset 1px 0 0 var\(--tier\);/)
    expect(code).toMatch(/\.seat__bar i \{[^}]*background: var\(--tier\);/)
    expect(code).toMatch(/\.seat__level \{[^}]*color: var\(--tier\);/)
    expect(code).toContain('.seat .medal { --cut: var(--surface-raised); }')
    // Pedestal, bevel, xrom, sharpa, shtamp — hech biri yo'q.
    for (const gone of ['pedestal', 'lv-stamps', 'lv-ghost', 'lv-sheen', 'podium-shine']) expect(code).not.toContain(gone)
  })
})

describe('EFIR — qator, komandalar, e‘lon', () => {
  it('eski bo‘limlar yo‘q: PODIUM, LAVHA, MEDAL, DARAJA BLOKI', () => {
    for (const banner of ['* PODIUM —', '* LAVHA —', '* MEDAL —', '* DARAJA BLOKI']) expect(CSS, banner).not.toContain(banner)
    expect(CSS).not.toContain('--tv-tone')
  })

  it('qator gridi spec §5 bo‘yicha, yorliq qatori bilan bir xil; tasma `--tier`; o‘qilayotgan fakt qalin', () => {
    const code = strip(EFIR())
    expect(code).toContain('.tv-cols,\n.row {\n  display: grid;\n  grid-template-columns: 10px 52px 70px minmax(0, 1fr) 84px 160px 146px 60px 68px;')
    expect(code).toMatch(/\.row \{[^}]*height: 50px;/)
    expect(code).toMatch(/\.row__band \{[^}]*background: var\(--tier\);/)
    expect(code).toMatch(/\.row\[data-tier="0"\] \.row__band \{[^}]*box-shadow: inset 1px 0 0 var\(--tier\);/)
    expect(code).toContain('.tv-rows[data-read="fakt2"] .row__f2,\n.tv-rows[data-read="fakt1"] .row__f1 {')
    expect(code).toMatch(/\.row__name \{[^}]*text-overflow: ellipsis;/)
  })

  it('komandalar: 62 px qatorlar, ulush chizig‘i `--share`, metall raqamlar faqat 1–3', () => {
    const code = strip(EFIR())
    expect(code).toContain('.tv-tcols,\n.trow {\n  display: grid;\n  grid-template-columns: 36px minmax(0, 1fr) 40px 146px 58px 104px 48px 58px;')
    expect(code).toMatch(/\.trow \{[^}]*height: 62px;/)
    expect(code).toMatch(/\.trow::after \{[^}]*width: calc\(\(100% - 56px\) \* var\(--share, 0\)\);/)
    expect(code).toContain('.trow__rank[data-metal="gold"] { color: var(--medal-gold); font-weight: 700; }')
    expect(code).toContain('.trow__rank[data-metal="silver"] { color: var(--medal-silver); font-weight: 700; }')
    expect(code).toContain('.trow__rank[data-metal="bronze"] { color: var(--medal-bronze); font-weight: 700; }')
  })

  /*
    E'LON USTUNNI SURMAYDI: sarlavha USTIDA absolyut, kirishi `translate` da
    (`transform` markazlashtirishga ketgan — keyframe uni bosmasin).
  */
  it('e‘lon oqimdan tashqarida, tasma va gerb bilan; kirishi `transform` ni bosmaydi', () => {
    const code = strip(EFIR())
    const rule = code.slice(code.indexOf('.tv-promo {'))
    expect(rule.slice(0, rule.indexOf('\n}') + 2)).toContain('position: absolute')
    expect(code).toMatch(/\.tv-promo__band \{[^}]*background: var\(--tier\);/)
    const kf = code.slice(code.indexOf('@keyframes tv-promo-in'))
    expect(kf.slice(0, kf.indexOf('\n}') + 2)).not.toContain('transform:')
    expect(kf.slice(0, kf.indexOf('\n}') + 2)).toContain('translate:')
  })

  it('voqea harakati: gerb katakchasi 400 ms to‘ladi, yangi medal 0,6 → 1; yaltirash, marquee, pulsatsiya yo‘q', () => {
    const code = strip(EFIR())
    expect(code).toMatch(/@keyframes crest-fill \{\s*from \{ fill: var\(--track\); \}\s*to \{ fill: var\(--tier\); \}\s*\}/)
    expect(code).toMatch(/\.crest__cell--fill \{ animation: crest-fill 400ms var\(--ease-out\) both; \}/)
    expect(code).toMatch(/@keyframes medal-new \{\s*from \{ transform: scale\(0\.6\); opacity: 0; \}/)
    expect(code).not.toMatch(/shine|sheen|marquee|pulse|infinite/)
  })
})

/*
  Rekord devori TV BOARD bo'limida turadi; metall shartnomasi unga ham
  tegishli — mintaqa EFIR bannerdan ORG CHART bannerigacha kengaytiriladi.
*/
describe('EFIR — sahifa sarlavhasi va rekord devori', () => {
  it('podium metallari EFIR + TV BOARD bo‘ylab faqat yozilgan istisnolarda; `.record__k` shulardan biri', () => {
    const code = strip(CSS.slice(from('* EFIR —'), from('* ORG CHART')))
    const allowed = /^(\.medal\b|\.halo\b|\.crest__crown\b|\.trow__rank\b|\.record__k\b)/
    const rules = code.match(/[^{}]+\{[^{}]*\}/g) ?? []
    let metalRules = 0
    for (const rule of rules) {
      if (!rule.includes('--medal-')) continue
      metalRules += 1
      const selector = rule.slice(0, rule.indexOf('{')).trim()
      expect(selector, rule.trim()).toMatch(allowed)
    }
    expect(metalRules).toBeGreaterThanOrEqual(7)
    expect(code).not.toContain('--series-')
    expect(code).not.toContain('--tv-tone')
  })
})
