import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MEDALS, MEDAL_METAL } from '@/features/sellers/medalCatalog'
import { MEDAL_DEFS } from '@/features/sellers/medalDefs'
import type { MedalCode } from '@/lib/api'

/**
 * `medalDefs.ts` — «ZARB» medal `<defs>` i (klassik taxta spec §1.4). Belgilar
 * `<use>` soya daraxtida chiziladi, u yerga hujjat selektori yetmaydi va eski
 * TV Chromium `color-mix()` to'xtashini tashlab yuborishi mumkin — shuning
 * uchun satr o'zi toza bo'lishi shart. Va u aktivdan generatsiya qilinadi:
 * tasdiqlangan mock va taxta ikki xil medal chizmasin.
 *
 * FAQAT MEDAL. Aktiv medaldan boshqa belgilarni ham tashiydi; generator
 * (`scripts/genMedalDefs.mjs`) ulardan hech birini olmaydi — `MedalMark`
 * chizadigan belgilar va ular ishora qilgan bo'laklar, boshqa hech narsa.
 */
const ASSET = readFileSync(
  join(process.cwd(), 'docs/superpowers/specs/assets/2026-09-17-efir-premium/final-defs.svg.html'),
  'utf8',
)
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

const CODES = Object.keys(MEDALS) as MedalCode[]
const ids = (s: string) => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!)
const refs = (s: string) => [...s.matchAll(/(?:href="#|url\(#)([^")]+)/g)].map((m) => m[1]!)

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
  it('taqiqlanganlar yo‘q: color-mix, filter, instance custom-property, `.cut` gravyura', () => {
    expect(MEDAL_DEFS).not.toContain('color-mix')
    expect(MEDAL_DEFS).not.toContain('filter')
    expect(MEDAL_DEFS).not.toContain('var(--m-')
    expect(MEDAL_DEFS).not.toContain('class="cut"')
    // Custom-property ichida url() yo'q — url faqat to'g'ridan-to'g'ri fill/stroke da.
    expect(MEDAL_DEFS).not.toMatch(/--[a-z-]+:\s*url\(/)
    // O'zi <defs> ichi — o'rovchi MedalDefs da.
    expect(MEDAL_DEFS).not.toMatch(/<\/?defs>|<svg/)
  })

  it('14 kodning har biriga metall pishirilgan `m-<code>` belgisi, 32 birlik quti', () => {
    expect(CODES).toHaveLength(14)
    for (const code of CODES) {
      expect(MEDAL_DEFS, code).toContain(`<symbol id="m-${code}" viewBox="0 0 32 32">`)
    }
    const medalSymbols = ids(MEDAL_DEFS).filter((id) => /^m-/.test(id) && !id.startsWith('m-laurel-'))
    expect(medalSymbols.sort()).toEqual(CODES.map((c) => `m-${c}`).sort())
  })

  it('67 id, har biri bir marta, va FAQAT medal oilalari: mg- · pl- · dv- · n · m-', () => {
    const all = ids(MEDAL_DEFS)
    expect(all).toHaveLength(67)
    expect(new Set(all).size).toBe(67)
    for (const id of all) expect(id, id).toMatch(/^(mg-|pl-|dv-|m-|n[0-9x]$)/)
    // Medaldan boshqa hech qanday belgi: har `<symbol>` — `m-*`.
    const symbols = [...MEDAL_DEFS.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]!)
    expect(symbols).toHaveLength(17)
    for (const id of symbols) expect(id, id).toMatch(/^m-/)
  })

  it('`MedalMark` to‘g‘ridan-to‘g‘ri ishora qiladigan hamma narsa bor: dafnalar, ×N raqamlari, tana rimlari', () => {
    const all = new Set(ids(MEDAL_DEFS))
    for (const metal of ['gold', 'silver', 'bronze']) expect(all.has(`m-laurel-${metal}`), metal).toBe(true)
    for (const glyph of ['x', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) expect(all.has(`n${glyph}`), glyph).toBe(true)
    // ×N plastinkasi tana metallining rimi bilan to'ldiriladi — katalogdagi har tana uchun.
    for (const code of CODES) {
      const { body } = MEDAL_METAL[code]
      expect(all.has(`mg-${body}-rim`), `${code} → mg-${body}-rim`).toBe(true)
    }
  })

  it('yopiq to‘plam: satr ichidagi har `href`/`url(#…)` shu satrda aniqlangan, ortiqcha bo‘lak yo‘q', () => {
    const all = new Set(ids(MEDAL_DEFS))
    const used = new Set(refs(MEDAL_DEFS))
    for (const id of used) expect(all.has(id), `#${id}`).toBe(true)
    // Hech kim ishora qilmaydigan id — faqat `MedalMark` o'zi chizadiganlar.
    const direct = (id: string) => /^m-/.test(id) || /^n[0-9x]$/.test(id) || /^mg-(gold|silver|bronze|steel)-rim$/.test(id)
    for (const id of all) expect(used.has(id) || direct(id), id).toBe(true)
  })

  it('har bo‘lak aktivdagi bilan AYNAN bir xil, aktiv tartibida — generator qayta ishga tushirilgan', () => {
    const kept = ids(MEDAL_DEFS)
    expect(MEDAL_DEFS).toBe(kept.map(assetElement).join(''))
    const order = ids(ASSET.slice(ASSET.indexOf('<defs>', ASSET.indexOf('<svg'))))
    expect(kept).toEqual(order.filter((id) => kept.includes(id)))
  })

  it('satrdagi har token globals.css ning UCHALA mavzu blokida aniqlangan', () => {
    const tokens = [...new Set([...MEDAL_DEFS.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!))]
    expect(tokens.length).toBeGreaterThan(30)
    for (const token of tokens) {
      const declared = CSS.match(new RegExp(`^\\s*${token}:`, 'gm')) ?? []
      // O'rta tonlar (`--medal-gold/silver/bronze`) to'rtinchi marta MEDALS bo'limida qayta bog'lanadi.
      expect(declared.length, token).toBeGreaterThanOrEqual(3)
    }
  })
})
