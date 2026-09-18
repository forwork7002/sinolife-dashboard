import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MEDALS } from '@/features/sellers/medalCatalog'
import { MEDAL_DEFS } from '@/features/sellers/medalDefs'
import type { MedalCode } from '@/lib/api'

/**
 * `medalDefs.ts` — «EMAL» medal `<defs>` i (klassik taxta spec §1.4; EMAL spec
 * 2026-09-18, IMPLEMENT.md §1). Belgilar `<use>` soya daraxtida chiziladi, u
 * yerga hujjat selektori yetmaydi va eski TV Chromium `color-mix()`
 * to'xtashini yoki atribut ichidagi `var()` ni tashlab yuborishi mumkin —
 * shuning uchun satr o'zi toza bo'lishi shart. Va u aktivdan generatsiya
 * qilinadi: tasdiqlangan mock va taxta ikki xil medal chizmasin.
 *
 * FAQAT MEDAL. Generator (`scripts/genMedalDefs.mjs`) aktivdan `MedalMark`
 * chizadigan o'n to'rt belgini va ular ishora qilgan gradientlarni oladi,
 * boshqa hech narsa: dafna yo'q, yo'l-raqam yo'q, rim yo'q — ×N taxtaning o'z
 * chipi.
 */
const ASSET = readFileSync(
  join(process.cwd(), 'docs/superpowers/specs/assets/2026-09-18-emal-medallar/final-defs.svg.html'),
  'utf8',
)
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

const CODES = Object.keys(MEDALS) as MedalCode[]
const ids = (s: string) => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!)
const refs = (s: string) => [...s.matchAll(/(?:href="#|url\(#)([^")]+)/g)].map((m) => m[1]!)
/** Har `--token:` deklaratsiyasining qiymatlari, globals.css dagi tartibda (yorug', tizim-qorong'i, majburiy-qorong'i). */
const declared = (token: string) =>
  [...CSS.matchAll(new RegExp(`^\\s*${token}: ([^;]+);`, 'gm'))].map((m) => m[1]!.trim())

/** `id` li element (`<defs>` ning bevosita bolasi) — aktivdagi AYNAN matni. */
function assetElement(id: string): string {
  const at = ASSET.indexOf(` id="${id}"`)
  expect(at, id).toBeGreaterThan(-1)
  const start = ASSET.lastIndexOf('<', at)
  const tag = /^<([a-zA-Z]+)/.exec(ASSET.slice(start))![1]!
  const selfClose = ASSET.indexOf('/>', at)
  const open = ASSET.indexOf('>', at)
  if (selfClose !== -1 && selfClose < open) return ASSET.slice(start, selfClose + 2)
  const end = ASSET.indexOf(`</${tag}>`, at) + tag.length + 3
  return ASSET.slice(start, end)
}

describe('MEDAL_DEFS — sahifaning yagona medal <defs> i', () => {
  it('taqiqlanganlar yo‘q: color-mix, filter, mask, stop-opacity, ichma-ich <use>, instance custom-property, `.cut` gravyura', () => {
    for (const bad of ['color-mix', 'filter', 'mask', 'stop-opacity', '<use', 'var(--m-', 'class="cut"']) {
      expect(MEDAL_DEFS, bad).not.toContain(bad)
    }
    // Custom-property ichida url() yo'q — url faqat to'g'ridan-to'g'ri fill/stroke da.
    expect(MEDAL_DEFS).not.toMatch(/--[a-z-]+:\s*url\(/)
    // O'zi <defs> ichi — o'rovchi MedalDefs da.
    expect(MEDAL_DEFS).not.toMatch(/<\/?defs>|<svg/)
  })

  /*
    Atribut bo'yoq (`fill="var(--…)"`) va inline `style` bir narsa emas: eski
    Chromium prezentatsiya atributi ichidagi `var()` ni tashlab yuboradi, va
    `<use>` soya daraxtida buni hech qanday CSS tuzata olmaydi. Aktiv
    generatori (`gen-defs.js`) har bo'yoqni `style` ga yozadi — bu yerda
    satrning o'zi tekshiriladi, chunki aktiv qo'lda ham almashtirilishi mumkin.
  */
  it('har bo‘yoq inline `style` — prezentatsiya-atribut bo‘yoq yo‘q', () => {
    expect(MEDAL_DEFS).not.toMatch(/\s(?:fill|stroke|stop-color|fill-opacity|stroke-opacity|opacity)="/)
    // Har chizilgan bo'lak (circle/path/stop) o'z style'ini ko'taradi.
    for (const piece of MEDAL_DEFS.match(/<(?:circle|path|stop)\b[^>]*>/g) ?? []) expect(piece, piece).toMatch(/ style="/)
  })

  it('14 kodning har biriga halqa, maydon va belgi pishirilgan `m-<code>` belgisi, 32 birlik quti', () => {
    expect(CODES).toHaveLength(14)
    for (const code of CODES) {
      expect(MEDAL_DEFS, code).toContain(`<symbol id="m-${code}" viewBox="0 0 32 32">`)
    }
    const medalSymbols = ids(MEDAL_DEFS).filter((id) => /^m-/.test(id))
    expect(medalSymbols.sort()).toEqual(CODES.map((c) => `m-${c}`).sort())
  })

  it('26 id, har biri bir marta, va FAQAT ikki oila: eg- (gradientlar) · m- (medallar); dafna, yo‘l-raqam, rim yo‘q', () => {
    const all = ids(MEDAL_DEFS)
    expect(all).toHaveLength(26)
    expect(new Set(all).size).toBe(26)
    for (const id of all) expect(id, id).toMatch(/^(eg-|m-)/)
    // ZARB davridan hech narsa: dafna belgisi, ×N yo'l-raqamlari, plastinka rimlari.
    for (const id of all) expect(id, id).not.toMatch(/^(m-laurel-|n[0-9x]$|mg-|pl-|dv-)/)
    // Medaldan boshqa hech qanday belgi: har `<symbol>` — `m-*`, o'n to'rtta.
    const symbols = [...MEDAL_DEFS.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]!)
    expect(symbols).toHaveLength(14)
    for (const id of symbols) expect(id, id).toMatch(/^m-/)
    // Va o'n ikki gradient: to'rt halqa, uch belgi, uch tana, ikki emal maydon.
    const gradients = [...MEDAL_DEFS.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]!)
    expect(gradients.sort()).toEqual(
      [
        'eg-gold-ring', 'eg-silver-ring', 'eg-bronze-ring', 'eg-steel-ring',
        'eg-gold-dev', 'eg-gilt-dev', 'eg-steel-dev',
        'eg-gold-body', 'eg-silver-body', 'eg-bronze-body',
        'eg-field', 'eg-field-rare',
      ].sort(),
    )
  })

  it('yopiq to‘plam: satr ichidagi har `url(#…)` shu satrda aniqlangan, ortiqcha bo‘lak yo‘q', () => {
    const all = new Set(ids(MEDAL_DEFS))
    const used = new Set(refs(MEDAL_DEFS))
    for (const id of used) expect(all.has(id), `#${id}`).toBe(true)
    // Hech kim ishora qilmaydigan id — faqat `MedalMark` o'zi chizadigan `m-*` belgilar.
    for (const id of all) expect(used.has(id) || /^m-/.test(id), id).toBe(true)
  })

  it('har bo‘lak aktivdagi bilan AYNAN bir xil, aktiv tartibida — generator qayta ishga tushirilgan', () => {
    const kept = ids(MEDAL_DEFS)
    expect(MEDAL_DEFS).toBe(kept.map(assetElement).join(''))
    const order = ids(ASSET.slice(ASSET.indexOf('<defs>', ASSET.indexOf('<svg'))))
    expect(kept).toEqual(order.filter((id) => kept.includes(id)))
  })

  /*
    O'rindiqdagina ko'rinadigan bezak — nodir oltinlarning ikkinchi hairline
    halqasi va yil chempionining marjon halqasi — `--emal-seat-o` ga osilgan:
    standart 1, `.row-medals` uni 0 qiladi, custom property `<use>` soya
    daraxtiga meros bo'lib o'tadi. AYNAN to'rtta joy, boshqa hech narsa.
  */
  it('yagona instance xususiyati `--emal-seat-o` — to‘rt bezakda, standart 1, qatorda va tasnif lentasida 0', () => {
    expect(MEDAL_DEFS.match(/var\(--emal-seat-o,1\)/g)).toHaveLength(4)
    for (const code of ['year-champion', 'streak-fire', 'conversion-master', 'day-record']) {
      const symbol = MEDAL_DEFS.slice(MEDAL_DEFS.indexOf(`<symbol id="m-${code}"`), MEDAL_DEFS.indexOf('</symbol>', MEDAL_DEFS.indexOf(`<symbol id="m-${code}"`)))
      expect(symbol, code).toContain('stroke-opacity:var(--emal-seat-o,1)')
    }
    // Tokenlar orasida emas — faqat medal qator o'lchamida chiziladigan ikki joyda
    // (`.row-medals` va pastdagi tasnif lentasi `.medal-tasnif`), va faqat 0.
    expect(declared('--emal-seat-o')).toEqual(['0', '0'])
    expect(CSS).toMatch(/\.row-medals \{\s*--emal-seat-o: 0;/)
    expect(CSS).toMatch(/\.medal-tasnif \{[^}]*--emal-seat-o: 0;/)
  })

  it('satrdagi har token `--emal-*` va globals.css ning UCHALA mavzu blokida aniqlangan; oila 42 ta, ikki qorong‘i blok bir xil', () => {
    const tokens = [...new Set([...MEDAL_DEFS.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!))]
    expect(tokens.length).toBeGreaterThan(30)
    for (const token of tokens) expect(token, token).toMatch(/^--emal-/)
    for (const token of tokens.filter((t) => t !== '--emal-seat-o')) {
      expect(declared(token), token).toHaveLength(3)
    }
    // Butun oila (IMPLEMENT.md §2 jadvali): 42 nom, har biri uch marta, qorong'i qiymat ikki blokda so'zma-so'z.
    const family = [...new Set([...CSS.matchAll(/^\s*(--emal-[\w-]+):/gm)].map((m) => m[1]!))].filter((t) => t !== '--emal-seat-o')
    expect(family).toHaveLength(42)
    for (const token of family) {
      const values = declared(token)
      expect(values, token).toHaveLength(3)
      expect(values[1], token).toBe(values[2])
    }
    // Halo ranglari defs'da emas, o'rindiq CSS ida — lekin oilaning bir qismi.
    for (const glow of ['--emal-glow-gold', '--emal-glow-silver', '--emal-glow-bronze']) expect(family).toContain(glow)
  })

  it('taxta ikonkalarining taxalluslari medal oltinidan: `--bi-crown-hi/-edge`, `--bi-ember` uchala blokda, `--bi-chase` faqat :root da — va HAR BIRI o‘qiladi', () => {
    const aliases: Record<string, string> = {
      '--bi-crown-hi': 'var(--emal-gold-f1)',
      '--bi-crown-edge': 'var(--emal-gold-ink)',
      '--bi-ember': 'var(--emal-gilt-d)',
    }
    for (const [token, value] of Object.entries(aliases)) expect(declared(token), token).toEqual([value, value, value])
    expect(declared('--bi-chase')).toEqual(['var(--seq-550)'])
    // O'qilmaydigan taxallus — o'lik kod: `--bi-*` oilasidagi har nom CSS da yoki ikonkada `var()` bilan o'qiladi.
    const icons = readFileSync(join(process.cwd(), 'src/features/sellers/BoardIcon.tsx'), 'utf8')
    const family = [...new Set([...CSS.matchAll(/^\s*(--bi-[\w-]+):/gm)].map((m) => m[1]!))]
    expect(family.sort()).toEqual(['--bi-chase', '--bi-crown-edge', '--bi-crown-hi', '--bi-ember'])
    for (const token of family) expect(CSS + icons, token).toContain(`var(${token})`)
  })

  it('«ZARB» oilasi o‘lik va o‘chirilgan; podiumning o‘z xromi `--medal-gold/silver/bronze` qoladi', () => {
    expect(CSS).not.toMatch(
      /^\s*--(zarb-|medal-(gold|silver|bronze|steel)-(hi|lo|sh|patina|well)|medal-steel|medal-gilt|medal-key|medal-cast|medal-glint|medal-edge|sheen-|bloom|ribbon-|medal-plate-well)/m,
    )
    for (const chrome of ['--medal-gold', '--medal-silver', '--medal-bronze']) expect(declared(chrome), chrome).toHaveLength(3)
    expect(MEDAL_DEFS).not.toContain('--medal-')
  })
})
