import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MEDALS } from '@/features/sellers/medalCatalog'
import { EFIR_DEFS } from '@/features/sellers/medalDefs'
import type { MedalCode } from '@/lib/api'

/**
 * `medalDefs.ts` — «ZARB» `<defs>` (spec §3). Belgilar `<use>` soya daraxtida
 * chiziladi, u yerga hujjat selektori yetmaydi va eski TV Chromium
 * `color-mix()` to'xtashini tashlab yuborishi mumkin — shuning uchun satr
 * o'zi toza bo'lishi shart. Va u aktivdan generatsiya qilinadi: mock va
 * taxta ikki xil medal chizmasin.
 */
const ASSET = readFileSync(
  join(process.cwd(), 'docs/superpowers/specs/assets/2026-09-17-efir-premium/final-defs.svg.html'),
  'utf8',
)

const CODES = Object.keys(MEDALS) as MedalCode[]
const ids = (s: string) => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!)

describe('EFIR_DEFS — sahifaning yagona <defs> i', () => {
  it('taqiqlanganlar yo‘q: color-mix, filter, instance custom-property, `.cut` gravyura', () => {
    expect(EFIR_DEFS).not.toContain('color-mix')
    expect(EFIR_DEFS).not.toContain('filter')
    expect(EFIR_DEFS).not.toContain('var(--m-')
    expect(EFIR_DEFS).not.toContain('class="cut"')
    // Custom-property ichida url() yo'q — url faqat to'g'ridan-to'g'ri fill/stroke da.
    expect(EFIR_DEFS).not.toMatch(/--[a-z-]+:\s*url\(/)
    // O'zi <defs> ichi — o'rovchi MedalDefs da.
    expect(EFIR_DEFS).not.toMatch(/<\/?defs>|<svg/)
  })

  it('14 kodning har biriga metall pishirilgan `m-<code>` belgisi, 32 birlik quti', () => {
    expect(CODES).toHaveLength(14)
    for (const code of CODES) {
      expect(EFIR_DEFS, code).toContain(`<symbol id="m-${code}" viewBox="0 0 32 32">`)
    }
    const medalSymbols = ids(EFIR_DEFS).filter((id) => /^m-/.test(id) && !id.startsWith('m-laurel-'))
    expect(medalSymbols.sort()).toEqual(CODES.map((c) => `m-${c}`).sort())
  })

  it('87 id, har biri bir marta; dafna, gerb, tanga va yo‘l-raqamlar to‘liq', () => {
    const all = ids(EFIR_DEFS)
    expect(all).toHaveLength(87)
    expect(new Set(all).size).toBe(87)
    for (const id of [
      'ch', 'nx', 'n0', 'n9', 'm-laurel-gold', 'm-laurel-silver', 'm-laurel-bronze',
      'crest-0', 'crest-6', 'crest-plate', 'crest-plate-6', 'halo-1', 'halo-2', 'halo-3',
      'halo-sm-1', 'halo-sm-2', 'halo-sm-3', 'halo-laurel', 'halo-ghost',
      'mg-gold-rim', 'mg-silver-rim', 'mg-bronze-rim', 'mg-steel-rim', 'mg-gilt-dev',
    ]) {
      expect(all, id).toContain(id)
    }
  })

  it('aktivning <defs> i bilan AYNAN bir xil — generator (scripts/genMedalDefs.mjs) qayta ishga tushirilgan', () => {
    const svg = ASSET.indexOf('<svg')
    const inner = ASSET.slice(ASSET.indexOf('<defs>', svg) + '<defs>'.length, ASSET.lastIndexOf('</defs>'))
    expect(EFIR_DEFS).toBe(inner)
  })
})
