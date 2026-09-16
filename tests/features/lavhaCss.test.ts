import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Lavha va medal bo'limlarining stylesheet faktlari — `recordWallCss.test.ts`
 * naqshi. Hech biri TypeScript'dan ko'rinmaydi va buzilishi jim.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

const from = (marker: string) => {
  const i = CSS.indexOf(marker)
  expect(i, `${marker} yo'q`).toBeGreaterThan(-1)
  return i
}
const REGION = CSS.slice(from('* LAVHA —'), from('* TV BOARD — the sellers board'))
/** Izohlarsiz — bannerlar `--medal-*` ni SO'Z bilan tilga oladi, qoida bilan emas. */
const CODE = REGION.replace(/\/\*[\s\S]*?\*\//g, '')

describe('lavha va medal — stylesheet', () => {
  it('eski PAGON bo‘limi yo‘q, yangi bo‘limlar TV BOARD dan oldin', () => {
    expect(CSS).not.toMatch(/^\.pagon\b/m)
    expect(CSS).not.toContain('* PAGON —')
    for (const sel of ['.lavha {', '.lavha--row', '.lavha--seat', '.medal {', '.medal--row', '.medal--speaking', '.lv-block', '.medal-rail', '.narvon {', '.tv-namecell', '.tv-promo']) {
      expect(REGION, sel).toContain(sel)
    }
  })

  it('literal rang yo‘q — faqat var(--…) va color-mix', () => {
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(CODE).not.toMatch(/\brgba?\(/)
    expect(CODE).not.toMatch(/\bhsla?\(/)
  })

  /*
    LAVHA SAHIFA RANGINI O'QIMAYDI. `--accent` ni PageShell har sahifada
    o'zgartiradi va `/sellers` uni `--series-5` qiladi, shuning uchun
    narvonning eng tepasi — Legenda — ustunning o'z pushtisida chizilardi.
    Spec jadvali «ko'k (apex)» deydi, PageShell sharhi esa: «Nothing that
    encodes a value does». Lavha qiymat kodlaydi. Jim buziladi: rang
    to'g'ri ko'rinadi, faqat noto'g'ri narsani anglatadi.
  */
  it('apex lavha — sahifa `--accent` i emas, barqaror `--series-1`', () => {
    const rule = CODE.slice(CODE.indexOf('.lavha[data-level="6"]'))
    const body = rule.slice(0, rule.indexOf('}') + 1)
    expect(body).toContain('--lavha-field: var(--series-1)')
    expect(body).toContain('--lavha-rim: var(--series-1)')
    expect(body).not.toContain('var(--accent)')
  })

  it('podium metallari faqat Oy oilasi medallarida — lavha ularga tegmaydi', () => {
    const lines = CODE.split('\n')
    let inMonthRule = false
    for (const line of lines) {
      if (/\.medal\[data-medal="(month-gold|month-silver|month-bronze|year-champion)"\]/.test(line)) inMonthRule = true
      if (line.includes('}')) { if (line.includes('--medal-') && !inMonthRule) throw new Error(line); inMonthRule = false; continue }
      if (line.includes('--medal-') && !inMonthRule) throw new Error(`--medal-* Oy qoidasidan tashqarida: ${line.trim()}`)
    }
    const lavhaPart = CODE.slice(0, CODE.indexOf('.medal {'))
    expect(lavhaPart).not.toContain('--medal-')
  })

  /*
    E'LON USTUNNI SURMAYDI. Oqimda turgan banner paydo bo'lganda podiumni
    ~50px pastga surar, sakkiz soniyadan keyin qaytarardi. Endi sarlavha
    USTIDA suzadi — va kirish animatsiyasi `transform` ga TEGMASLIGI kerak,
    chunki markazlashtirish ham o'sha xususiyatda: `transform` li keyframe
    180 ms davomida uni bosib turib, keyin sakrardi.
  */
  it('e‘lon oqimdan tashqarida va kirishi `transform` ni bosmaydi', () => {
    const rule = REGION.slice(REGION.indexOf('.tv-promo {'))
    expect(rule.slice(0, rule.indexOf('\n}') + 2)).toContain('position: absolute')

    const kf = REGION.slice(REGION.indexOf('@keyframes tv-promo-in'))
    expect(kf.slice(0, kf.indexOf('\n}') + 2)).not.toContain('transform:')
  })

  it('kamaytirilgan harakatda hech narsa qimirlamaydi', () => {
    const reduced = REGION.slice(REGION.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    for (const sel of ['.lavha__star--drop', '.lv-sheen', '.medal-slot--new', '.medal-speak', '.tv-promo']) expect(reduced, sel).toContain(sel)
    expect(reduced).toContain('animation: none')
  })
})
