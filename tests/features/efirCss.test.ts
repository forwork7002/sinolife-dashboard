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

/**
 * Uchala token bloki: yorug' `:root`, tizim-qorong'i media bloki, majburiy
 * qorong'i. Har biri o'z `.tv-board-shell` (EFIR material) qoidasini ham
 * o'z ichiga oladi — ular shu tartibda, o'z mexanizmi yonida turadi.
 */
const LIGHT = CSS.slice(from(':root {\n  color-scheme: light;'), from('@media (prefers-color-scheme: dark)'))
const SYSTEM_DARK = CSS.slice(from('@media (prefers-color-scheme: dark)'), from(':root[data-theme="dark"] {'))
const FORCED_DARK = CSS.slice(from(':root[data-theme="dark"] {'), from('@theme inline'))

/** EFIR bo'limi — bannerdan TV BOARD bannerigacha. */
const EFIR = () => CSS.slice(from('* EFIR —'), from('* TV BOARD — the sellers board'))
/**
 * Izohlarsiz — bannerlar tokenlarni SO'Z bilan tilga oladi, qoida bilan emas.
 * Bo'lim BANNER ICHIDAN boshlanadi (marker banner ochilgandan KEYIN turadi),
 * shuning uchun avval o'sha yopilmagan izohning qolgani tashlanadi — aks holda
 * bannerning o'z matni qoida bo'lib o'qilardi.
 */
const strip = (s: string) => s.replace(/^[\s\S]*?\*\//, '').replace(/\/\*[\s\S]*?\*\//g, '')

/** WCAG 2.x nisbiy yorug'lik va kontrast — `#rrggbb` uchun. */
const luminance = (hex: string) => {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
/** Blokdagi token qiymati — birinchi e'lon; hex bo'lishi shart. */
const hexOf = (block: string, name: string): string => {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`))
  expect(m, `${name} blokda hex sifatida yo'q`).not.toBeNull()
  return m![1]!
}

const BLOCKS = { LIGHT, SYSTEM_DARK, FORCED_DARK } as const

describe('EFIR tokenlari — uchala blokda', () => {
  /*
    QOIDA: «yuqori daraja panelga nisbatan KO'PROQ kontrast» (spec §1). Qutbi
    mavzuga qarab teskari — qorong'ida xira → yorqin, yorug'da och → to'q
    ko'k — shuning uchun yorug'lik emas, KONTRAST tartibi pinlanadi.
  */
  const EXPECTED: Record<keyof typeof BLOCKS, readonly string[]> = {
    LIGHT: ['1.72', '2.57', '3.61', '4.96', '7.90', '13.23'],
    SYSTEM_DARK: ['2.44', '3.55', '5.26', '9.80', '14.34', '18.30'],
    FORCED_DARK: ['2.44', '3.55', '5.26', '9.80', '14.34', '18.30'],
  }

  for (const key of Object.keys(BLOCKS) as (keyof typeof BLOCKS)[]) {
    const block = BLOCKS[key]

    it(`${key}: \`--tier-1..6\` \`--efir-panel\` ga nisbatan qat’iy o‘suvchi kontrast — spec raqamlari`, () => {
      const panel = hexOf(block, '--efir-panel')
      const ratios = [1, 2, 3, 4, 5, 6].map((n) => contrast(hexOf(block, `--tier-${n}`), panel))
      for (let i = 1; i < ratios.length; i += 1) expect(ratios[i]!).toBeGreaterThan(ratios[i - 1]!)
      expect(ratios.map((r) => r.toFixed(2))).toEqual(EXPECTED[key])
    })

    it(`${key}: siyoh kontrastlari — \`--efir-ink-3\` ≥ 4.5:1, \`--efir-ink-2\` ≥ 6:1`, () => {
      const panel = hexOf(block, '--efir-panel')
      expect(contrast(hexOf(block, '--efir-ink-3'), panel)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(hexOf(block, '--efir-ink-2'), panel)).toBeGreaterThanOrEqual(6)
    })

    it(`${key}: daraja va metall oilasi to‘liq — -hi/-lo/-wash, po‘lat, gilt, zarb tokenlari; aralashma yo‘q`, () => {
      const names: string[] = []
      for (let n = 1; n <= 6; n += 1) names.push(`--tier-${n}`, `--tier-${n}-hi`, `--tier-${n}-lo`, `--tier-${n}-wash`)
      for (const m of ['gold', 'silver', 'bronze', 'steel']) {
        names.push(`--medal-${m}`, ...['hi', 'lo', 'sh', 'patina', 'well'].map((t) => `--medal-${m}-${t}`))
      }
      names.push(
        '--medal-gilt', '--medal-gilt-hi', '--medal-gold-wash', '--medal-silver-wash', '--medal-bronze-wash',
        '--medal-gold-wash-p1', '--medal-key', '--medal-cast', '--medal-glint', '--medal-edge',
        '--sheen-hi', '--sheen-lo', '--sheen-none-hi', '--sheen-none-lo', '--bloom', '--ribbon-a', '--ribbon-shade',
        '--recess-hi', '--recess-lo', '--recess-none', '--slot-field', '--slot-dash', '--slot-glyph',
        '--crest-plate', '--crest-off', '--crest-glint', '--crest-shade', '--halo-field-hi', '--halo-field-lo',
        '--efir-panel', '--efir-raised', '--efir-raised-hi', '--efir-sunken', '--efir-ink', '--efir-ink-name',
        '--efir-ink-4', '--efir-hairline', '--efir-track', '--efir-plate-well', '--efir-p1-keyline',
      )
      for (const token of names) expect(block, token).toMatch(new RegExp(`${token}:\\s`))
      // Metall va daraja tokenlari `<use>` soya daraxtida o'qiladi — eski TV
      // Chromium u yerda `color-mix()` to'xtashini tashlab yuborishi mumkin.
      for (const line of block.split('\n')) {
        if (/^\s*--(tier|medal|sheen|bloom|ribbon|recess|slot|crest|halo|efir)-?/.test(line)) {
          expect(line).not.toContain('color-mix')
        }
      }
    })
  }

  it('qorong‘i bloklar lockstep: ikkala mexanizmda bir xil qiymatlar, yorug‘dan boshqa', () => {
    for (let n = 1; n <= 6; n += 1) {
      expect(hexOf(SYSTEM_DARK, `--tier-${n}`)).toBe(hexOf(FORCED_DARK, `--tier-${n}`))
      expect(hexOf(LIGHT, `--tier-${n}`)).not.toBe(hexOf(SYSTEM_DARK, `--tier-${n}`))
    }
    for (const token of ['--medal-gold', '--medal-steel', '--efir-panel', '--efir-ink-2', '--crest-off']) {
      expect(hexOf(SYSTEM_DARK, token), token).toBe(hexOf(FORCED_DARK, token))
    }
  })

  it('`--efir-*` faqat `.tv-board-shell` ostida — uchala mavzu mexanizmi bilan, boshqa hech qayerda', () => {
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = code.match(/[^{}]+\{[^{}]*\}/g) ?? []
    const selectors: string[] = []
    for (const rule of rules) {
      if (!/--efir-[a-z0-9-]+\s*:/.test(rule)) continue
      const selector = rule.slice(0, rule.indexOf('{')).trim()
      expect(selector, rule.slice(0, 120)).toMatch(/\.tv-board-shell$/)
      selectors.push(selector)
    }
    expect(selectors).toEqual([
      '.tv-board-shell',
      ':root:where(:not([data-theme="light"])) .tv-board-shell',
      ':root[data-theme="dark"] .tv-board-shell',
    ])
  })

  it('oila ORDINAL deb hujjatlashtirilgan — `--seq` uslubida, seriya emas; qutb qoidasi yozilgan', () => {
    expect(LIGHT).toMatch(/ORDINAL/)
    expect(LIGHT).toMatch(/never a series/i)
    expect(LIGHT).toMatch(/MORE CONTRAST AGAINST THE PANEL/)
  })

  it('`--glow-rare` yo‘q — nodir medal soyasi ham, uning `filter` i ham ketdi', () => {
    expect(CSS).not.toContain('--glow-rare')
    expect(strip(EFIR())).not.toMatch(/\.medal\.rare|drop-shadow/)
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

/*
  METALL — YOZILGAN ISTISNO RO'YXATI (spec §1, §3; token blokidagi izoh):
  medal va uning ×N plastinkasi (`.medal`, `.medal__*`), rank tangasi
  (`.halo`), metall bog'lovchisi (`[data-metal="…"]` → `--metal`, o'rindiq
  keyline'i va yuvishi, komandalar 1–3 chizig'i shuni o'qiydi). Legenda toji
  endi `#crest-6` belgisining ICHIDA. `.trow__rank` ro'yxatdan chiqdi (komanda
  ranki endi tanga); `.record__k` — rekord devori qayta qurilganda o'chiriladi.
*/
const METAL_ALLOWED = /^(\.medal\b|\.medal__|\.halo\b|\[data-metal="(gold|silver|bronze)"\]|\.record__k\b)/

describe('EFIR bo‘limi — rang shartnomasi', () => {
  it('bo‘lim bor va TV BOARD dan oldin turadi; asosiy selektorlar', () => {
    for (const sel of [
      '[data-tier="0"]', '[data-tier="6"]', '[data-metal="gold"]', '.crest,', '.crest { color: var(--tier); }',
      '.medal__plate-rim', '.medal__plate-well', '.medal__count[data-dev="gilt"] use', '.halo-box {',
      '.tv-legend {', '.legend__rung',
    ]) {
      expect(EFIR(), sel).toContain(sel)
    }
  })

  it('eski selektorlar yo‘q: o‘lcham sinflari, CSS halqa, `.cut` gravyura, «+N», ×N guruhi', () => {
    const code = strip(CSS)
    for (const gone of [
      '.crest--row', '.crest--seat', '.crest--legend', '.crest .on', '.crest .off', '.crest__crown', '.halo--lg',
      '.halo[data-metal', '.medal .cut', '.medal__num', '.medal-group', '.medal-count', '.row__more', '--cut',
    ]) {
      expect(code, gone).not.toContain(gone)
    }
  })

  it('literal rang yo‘q — faqat var(--…); `color-mix()` ham yo‘q (aralashmalar tokenlarda)', () => {
    const code = strip(EFIR())
    expect(code).not.toContain('color-mix(')
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/\brgba?\(/)
    expect(code).not.toMatch(/\bhsla?\(/)
  })

  it('`--tier-N` faqat `[data-tier="N"]` orqali o‘qiladi; 0-daraja — shaffof; gerb `currentColor` = `--tier`', () => {
    const code = strip(EFIR())
    for (let n = 1; n <= 6; n += 1) {
      expect(code).toContain(
        `[data-tier="${n}"] { --tier: var(--tier-${n}); --tier-hi: var(--tier-${n}-hi); --tier-lo: var(--tier-${n}-lo); --tier-wash: var(--tier-${n}-wash); }`,
      )
    }
    expect(code).toContain('[data-tier="0"] { --tier: transparent; --tier-hi: transparent; --tier-lo: transparent; --tier-wash: transparent; }')
    // Boshqa hech qayerda `--tier-N` o'qilmaydi — komponent faqat `--tier` ni biladi.
    // Istisno: komandalar ulush chizig'i `--tier-3 → --tier-4` va faol yorliq belgisi `--tier-4`
    // (qatorga bog'lanmagan, rampaning o'zi — Premium §6).
    const tierReads = code.replace(/\.trow__bar i \{[^}]*\}/, '').replace(/\.tv-tcols \.on::after \{[^}]*\}/, '')
    expect(tierReads.match(/var\(--tier-\d(-hi|-lo|-wash)?\)/g) ?? []).toHaveLength(24)
    expect(code).toContain('.crest { color: var(--tier); }')
  })

  it('seriya rangi yo‘q — daraja ham, medal ham `--series-*` ni o‘qimaydi', () => {
    expect(strip(EFIR())).not.toContain('--series-')
  })

  it('metall faqat yozilgan istisnolarda', () => {
    const code = strip(EFIR())
    const rules = code.match(/[^{}]+\{[^{}]*\}/g) ?? []
    expect(rules.length).toBeGreaterThan(10)
    for (const rule of rules) {
      if (!rule.includes('--medal-')) continue
      const selector = rule.slice(0, rule.indexOf('{')).trim()
      expect(selector, rule.trim()).toMatch(METAL_ALLOWED)
    }
  })

  it('×N plastinkasi: rim `--medal-key` chizig‘i, quduq `--efir-plate-well`, raqam belgi metallida', () => {
    const code = strip(EFIR())
    expect(code).toMatch(/\.medal__plate-rim \{[^}]*stroke: var\(--medal-key\);/)
    expect(code).toMatch(/\.medal__plate-well \{[^}]*fill: var\(--efir-plate-well\);/)
    expect(code).toContain('.medal__count use { stroke: var(--medal-gold-hi); }')
    for (const dev of ['gilt', 'steel', 'silver', 'bronze']) {
      expect(code).toContain(`.medal__count[data-dev="${dev}"] use { stroke: var(--medal-${dev}-hi); }`)
    }
  })

  it('qator medallari o‘ngdan chapga, 28 px; legenda 36 px botiq tasma, `space-between`', () => {
    const code = strip(EFIR())
    expect(code).toMatch(/\.row__medals \{[^}]*flex-direction: row-reverse;[^}]*height: 28px;/)
    expect(code).toMatch(
      /\.tv-legend \{[^}]*justify-content: space-between;[^}]*min-height: 36px;[^}]*padding: 0 20px;[^}]*background: var\(--efir-sunken\);/,
    )
    expect(code).toMatch(/\.legend__rung b \{[^}]*font-size: 12px;[^}]*color: var\(--efir-ink-2\);/)
    expect(code).toMatch(/\.legend__rung i \{[^}]*font-size: 12px;[^}]*color: var\(--efir-ink-3\);/)
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
  it('uchta karta 2-1-3 tartibida, pastlari tekis; tasma va yo‘l `--tier` da; daraja so‘zi sokin siyohda', () => {
    const code = strip(EFIR())
    expect(code).toMatch(/\.tv-podium \{[^}]*align-items: flex-end;/)
    expect(code).toContain('.seat--1 {\n  flex: 1.48 1 0;\n  max-width: 456px;')
    expect(code).toContain('.seat--2 { order: 1; }')
    expect(code).toContain('.seat--3 { order: 3; }')
    expect(code).toMatch(/\.seat::before \{[^}]*width: 10px;[^}]*background: var\(--tier\);/)
    expect(code).toMatch(/\.seat\[data-tier="0"\]::before \{[^}]*box-shadow: inset 1px 0 0 var\(--tier\);/)
    expect(code).toMatch(/\.seat__bar i \{[^}]*background: var\(--tier\);/)
    // EFIR Premium §4: daraja so'zi `--efir-ink-2` da — `--tier` aralashmasi ketdi.
    expect(code).toMatch(/\.seat__level \{[^}]*color: var\(--efir-ink-2\);/)
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

  it('komandalar (Premium §6): grid, `--trow-h` qatori, 4 px `.trow__bar` metall 1–3 da, `footer.jami` plaketi', () => {
    const code = strip(EFIR())
    expect(code).toContain('.tv-tcols,\n.trow {\n  display: grid;\n  grid-template-columns: 36px minmax(0, 1fr) 136px 56px 92px 36px 56px;')
    expect(code).toMatch(/\.tv-trows \{[^}]*--trow-h: 50px;/)
    expect(code).toMatch(/\.trow \{[^}]*height: var\(--trow-h\);/)
    expect(code).toMatch(/\.tv-tslot \{[^}]*flex: 1;[^}]*min-height: 0;/)
    expect(code).toMatch(/\.trow__bar \{[^}]*left: 58px;[^}]*right: 296px;[^}]*bottom: 8px;[^}]*height: 4px;[^}]*background: var\(--efir-track\);/)
    expect(code).toContain('.trow[data-metal] .trow__bar i {\n  background: linear-gradient(90deg, var(--metal-lo), var(--metal) 70%, var(--metal-hi));')
    expect(code).toMatch(/\.jami \{[^}]*margin-top: auto;[^}]*height: 100px;[^}]*background: var\(--efir-sunken\);/)
    expect(code).toMatch(/\.jami \.jami__v \{[^}]*font-size: 30px;/)
    for (const gone of ['.trow::after', '.trow__rank[data-metal', '.trow__cnt', '.tv-tfoot']) expect(code, gone).not.toContain(gone)
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
    expect(code).toMatch(/@keyframes crest-fill \{\s*from \{ fill: var\(--crest-off\); \}\s*to \{ fill: var\(--tier\); \}\s*\}/)
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
  it('metall EFIR + TV BOARD bo‘ylab faqat yozilgan istisnolarda', () => {
    const code = strip(CSS.slice(from('* EFIR —'), from('* ORG CHART')))
    const rules = code.match(/[^{}]+\{[^{}]*\}/g) ?? []
    let metalRules = 0
    for (const rule of rules) {
      if (!rule.includes('--medal-')) continue
      metalRules += 1
      const selector = rule.slice(0, rule.indexOf('{')).trim()
      expect(selector, rule.trim()).toMatch(METAL_ALLOWED)
    }
    expect(metalRules).toBeGreaterThanOrEqual(7)
    expect(code).not.toContain('--series-')
    expect(code).not.toContain('--tv-tone')
  })
})
