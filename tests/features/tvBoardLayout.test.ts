import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * THE BOARD'S TWO LAYOUTS SWITCH ON ONE WIDTH, AND NOTHING IN TYPESCRIPT CAN
 * SEE IT. `/sellers` is two columns from 1280px — 60 / 40, each a
 * viewport-high card whose ROWS scroll inside it — and one column at a time
 * below it. The label strip above the rows is a sibling of the scroll box,
 * never inside it, so the fourth rank is never hidden under a sticky header.
 */

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')

/** The width of the `@media (min-width: <px>)` block that encloses `selector`, or null. */
function queryFor(selector: string): number | null {
  const at = css.indexOf(selector)
  if (at < 0) return null
  const before = css.slice(0, at)
  const opens = [...before.matchAll(/@media\s*\(min-width:\s*(\d+)px\)\s*\{/g)]
  if (opens.length === 0) return null
  const last = opens[opens.length - 1]!
  const between = before.slice(last.index! + last[0].length)
  let depth = 1
  for (const ch of between) {
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    if (depth === 0) return null
  }
  return Number(last[1])
}

describe('the television board switches layout on one width', () => {
  it('turns the board into two columns — 60 / 40 — from 1280px', () => {
    expect(queryFor('.tv-board {\n    display: grid')).toBe(1280)
    expect(css).toMatch(/\.tv-board \{\s*display: grid;\s*grid-template-columns: minmax\(0, 60fr\) minmax\(0, 40fr\);/)
  })

  it('gives the page its viewport-height column on the same query', () => {
    // `.tv-board-shell {` alone is the EFIR material token block (light theme,
    // top of the file); the layout rule is the one that sets a height.
    expect(queryFor('.tv-board-shell {\n    height: 100%;')).toBe(1280)
  })

  it('draws the switch and parks a column on the same width', () => {
    expect(css).toMatch(/@media \(min-width: 1280px\) \{\s*\.tv-switch \{\s*display: none;/)
    expect(css).toMatch(/@media \(max-width: 1279px\) \{\s*\.tv-col--parked \{\s*display: none;/)
  })

  it('makes ONLY the rows a scroll box, from the two-column width — the label strip stays put', () => {
    expect(queryFor('.tv-rows {\n    overflow: auto')).toBe(1280)
    expect(queryFor('.tv-trows {\n    overflow: auto')).toBe(1280)
    expect(css).not.toMatch(/\.tv-cols \{[^}]*overflow: auto/)
    expect(css).not.toMatch(/^\.tv-list \{/m)
    expect(css).not.toContain('.tv-table')
  })

  it('wears no column tone, no pedestal and no podium chrome any more', () => {
    for (const gone of [
      '--tv-tone', '.tv-pedestal', '.podium-card', '.podium-col--', '.medal-ring', '.chase-chip', '.rank-row',
      '.tv-seat-card', '.tv-chase', '.tv-namecell', '.lavha', '.narvon', '.lv-block', '.medal-rail', '.medal-speak',
      '.tv-col-optional', '.tv-col-glyph',
    ]) {
      expect(css, gone).not.toContain(gone)
    }
  })

  it('steps the television scale down under 1600', () => {
    expect(css).toMatch(/@media \(max-width: 1599px\) \{\s*:root \{\s*--tv-xl: 36px;/)
  })

  it('lights the pressed fact in ink, never in a hue', () => {
    expect(css).toMatch(/\.tv-fakt-tab\[aria-pressed='true'\] \{\s*background: var\(--ink-primary\);\s*color: var\(--surface\);/)
  })

  /*
    1366 — 720p televizor yoki zoom qilingan panel: ikki ustun saqlanadi, hamma
    narsa 0.8× (spec §9). Shrift shkalasi `:root` da, bitta 1599 chegarasida.
    EFIR Premium: gerb, medal va tanga o'lchami ATRIBUTDA (`height`/`size`),
    shuning uchun bu blok ularni kichraytirmaydi — va kichraytirmasligi shart,
    aks holda atribut bilan CSS ikki xil o'lcham aytadi.
  */
  it('scales the seats and rows down under 1600 (spec §9); the minted marks keep their attribute sizes', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1599px) {\n  .seat {'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n') + 3)
    expect(block).not.toMatch(/\.crest|\.halo|\.medal \{/)
    expect(block).toContain('.row { height: 44px; }')
    expect(block).toMatch(/\.seat--1 \{[^}]*max-width: 365px;/)
    expect(block).toMatch(/\.seat \{[^}]*max-width: 246px;/)
  })

  /*
    Telefon — televizor emas (spec §9): ustunlar bittadan (`.tv-switch`),
    qator tasma · rank · gerb · ism · FAKT 2; FAKT 1, buyurtma, konv. va
    medallar yashirin. Markup o'zgarmaydi — uyalar `nth-child` bilan yopiladi.
  */
  it('collapses a phone row to band · rank · crest · name · FAKT 2 and hides the desk columns', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 1279px) {\n  .tv-podium'))
    const block = phone.slice(0, phone.indexOf('\n}\n') + 3)
    expect(block).toMatch(/\.tv-cols,\s*\.row \{\s*grid-template-columns: 8px 44px 58px minmax\(0, 1fr\) 132px;/)
    expect(block).toMatch(/\.tv-cols > span:nth-child\(5\),\s*\.tv-cols > span:nth-child\(7\),\s*\.tv-cols > span:nth-child\(8\),\s*\.tv-cols > span:nth-child\(9\),\s*\.row > \*:nth-child\(5\),\s*\.row > \*:nth-child\(7\),\s*\.row > \*:nth-child\(8\),\s*\.row > \*:nth-child\(9\) \{\s*display: none;/)
    expect(block).toMatch(/\.tv-tcols,\s*\.trow \{\s*grid-template-columns: 32px minmax\(0, 1fr\) 124px 52px;/)
    expect(block).toMatch(/\.trow > \*:nth-child\(5\),\s*\.trow > \*:nth-child\(6\),\s*\.trow > \*:nth-child\(7\) \{\s*display: none;/)
    expect(block).toMatch(/\.seat,\s*\.seat--1 \{\s*flex: 1 1 100%;/)
  })

  /*
    JONLI TEKSHIRUVDA TOPILDI (2026-09-16, 1920 va 1366, yon panel ochiq).
    Mock 1920 da ustunni to'liq oladi; haqiqiy sahifada rail va sahifa
    to'ldirmasi ustunni torroq qiladi (1920 da ~977 px, 1366 da ~645 px) va
    IKKI narsa indamay kesilardi.

    1. O'RINDIQ RAQAMI. `.seat` da `overflow: hidden` (tasma + radius) va
       raqam `nowrap`: 2- va 3-o'rindiqda «696 098 504» ning oxirgi raqami
       yo'q edi. O'rindiq o'z konteyneri — `min()` mock kengligida 44 px ni
       saqlaydi, torida kesish o'rniga kichraytiradi.
    2. LEGENDA. Qat'iy 28 px + `overflow: hidden` narvon CHO'QQISINI
       («Legenda 1 000 000 000») kesardi. Endi o'raladi.
  */
  it('never clips the seat figure or the legend when the column is narrower than the mock', () => {
    expect(css).toMatch(/\.seat \{ container-type: inline-size; \}/)
    expect(css).toMatch(/\.seat__figure \{[^}]*font-size: min\(var\(--tv-xl\), 14cqi\);/)
    // O'rindiqning uch nowrap satri ham o'raladi, kesilmaydi.
    expect(css).toMatch(/\.seat__sub \{[^}]*flex-wrap: wrap;/)
    expect(css).toMatch(/\.seat__facts \{[^}]*flex-wrap: wrap;/)
    expect(css).not.toMatch(/\.seat__next \{[^}]*white-space: nowrap;/)
    expect(css).toMatch(/\.seat__name span \{[^}]*text-overflow: ellipsis;/)
    const legend = css.slice(css.indexOf('.tv-legend {'))
    const block = legend.slice(0, legend.indexOf('\n}\n') + 3)
    expect(block).toContain('flex-wrap: wrap;')
    expect(block).toContain('min-height: 36px;')
    // Pog'onaning O'Z matni bo'linmaydi — o'raladigan narsa pog'onalar.
    expect(block).toContain('white-space: nowrap;')
    expect(block).not.toContain('overflow: hidden')
    expect(block).not.toMatch(/\n  height: 36px;/)
  })

  /*
    390 px da 40 px ustun sarlavhasi — nom · soni · FAKT kaliti 383 px so'raydi,
    356 px bor: kalit o'ng chetdan chiqib ketardi va sahifa skroll qilmaydi.
    Qoida `.tv-col-head` TA'RIFIDAN KEYIN turishi shart — media so'rovi
    og'irlik qo'shmaydi, oldinda tursa keyingi ta'rif uni bekor qiladi.
  */
  it('tightens the column head on a phone, after the rule it overrides', () => {
    const base = css.indexOf('.tv-col-head {')
    const phone = css.indexOf('@media (max-width: 1279px) {\n  .tv-col-head')
    expect(base).toBeGreaterThan(-1)
    expect(phone).toBeGreaterThan(base)
    expect(css.slice(phone, phone + 200)).toMatch(/\.tv-col-head \{\s*gap: 8px;\s*padding: 0 10px;/)
  })

  /*
    Ustma-ust turgan o'rindiqlar 1-2-3 o'qiladi: `order` 2-1-3 podium
    kompozitsiyasi uchun, bitta ustunda u chempionni ikkinchi qatorga tushiradi.
  */
  it('resets the seat order on a phone so the champion is first', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 1279px) {\n  .tv-podium'))
    const block = phone.slice(0, phone.indexOf('\n}\n') + 3)
    expect(block).toMatch(/\.seat--1,\s*\.seat--2,\s*\.seat--3 \{\s*order: 0;/)
  })
})
