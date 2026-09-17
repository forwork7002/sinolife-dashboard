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

  it('sinks the FAKT track and raises the lit tab with a 2 px tier-4 underline — never a white or ink fill', () => {
    expect(css).toMatch(/\.tv-fakt \{[^}]*background: var\(--efir-sunken\);\s*box-shadow: var\(--efir-seg-well\);/)
    expect(css).toMatch(
      /\.tv-fakt-tab\[aria-pressed='true'\] \{\s*background: linear-gradient\(180deg, var\(--efir-raised-hi\), var\(--efir-raised\)\);\s*box-shadow: var\(--efir-seg-on\);\s*color: var\(--efir-ink\);/,
    )
    expect(css).toMatch(/\.tv-fakt-tab\[aria-pressed='true'\]::after,\s*\.tv-cols \.on::after \{[^}]*height: 2px;[^}]*background: var\(--tier-4\);/)
    expect(css).toMatch(/\.tv-cols \.on::after \{[^}]*bottom: -6px;\s*width: 22px;/)
    expect(css).not.toMatch(/\.tv-fakt-tab\[aria-pressed='true'\] \{[^}]*var\(--ink-primary\)/)
  })

  it('draws the column as a lifted panel — no border, radius 14, sheen, inset edge and ring, long shadow; the page glows', () => {
    const rule = css.slice(css.indexOf('.tv-col {\n  position: relative;'))
    const block = rule.slice(0, rule.indexOf('\n}\n') + 3)
    expect(block).not.toContain('border:')
    expect(block).toContain('border-radius: 14px;')
    expect(block).toContain('overflow: hidden;')
    expect(block).toContain('background: linear-gradient(180deg, var(--efir-panel-sheen), transparent 150px), var(--efir-panel);')
    expect(block).toMatch(/box-shadow:\s*inset 0 1px 0 var\(--efir-edge-hi\),\s*inset 0 0 0 1px var\(--efir-edge-ring\),\s*var\(--efir-shadow-panel\);/)
    expect(css).toContain('.tv-board-shell {\n  background: radial-gradient(1100px 420px at 46% -120px, var(--efir-page-glow), transparent 70%);\n}')
  })

  it('heads the column at 42 px with a hint that leaves a narrow head on its own', () => {
    expect(css).toMatch(/\.tv-col-head \{[^}]*height: 42px;[^}]*container: tv-head \/ inline-size;/)
    expect(css).toMatch(/\.tv-col-head__title \{[^}]*font-size: 15px;[^}]*font-weight: 600;/)
    expect(css).toMatch(/\.tv-col-head__count \{[^}]*font-size: 13px;[^}]*color: var\(--efir-ink-3\);/)
    expect(css).toMatch(/@container tv-head \(max-width: 559px\) \{\s*\.tv-col-head__hint \{ display: none; \}/)
  })

  it('sizes the rows from their slot, from the two-column width only', () => {
    expect(queryFor('.tv-rows-slot {\n    flex: 1;\n    min-height: 0;')).toBe(1280)
    expect(queryFor('height: var(--rows-h, 100%);')).toBe(1280)
    expect(css.match(/var\(--rows-h/g)).toHaveLength(1)
  })

  /*
    1366 — 720p televizor yoki zoom qilingan panel: ikki ustun saqlanadi, hamma
    narsa 0.8× (spec §9). Shrift shkalasi `:root` da, bitta 1599 chegarasida.
    EFIR Premium: gerb, medal va tanga o'lchami ATRIBUTDA (`height`/`size`),
    shuning uchun bu blok ularni kichraytirmaydi — va kichraytirmasligi shart,
    aks holda atribut bilan CSS ikki xil o'lcham aytadi.
  */
  it('scales the seats and rows down under 1600 (spec §9); the minted marks keep their attribute sizes', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1599px) {\n  /* Qator 43 px'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n') + 3)
    expect(block).not.toMatch(/\.crest|\.halo|\.medal \{/)
    // Qator 43 px QOLADI — `ROW_H` karrasi hamma kenglikda bir raqam.
    expect(block).not.toMatch(/\.row \{[^}]*height:/)
    expect(block).toMatch(/\.tv-cols,\s*\.row \{\s*grid-template-columns: 5px 28px 58px minmax\(0, 1fr\) 62px 108px 88px 34px 48px;/)
    expect(block).toMatch(/\.tv-cols > span:nth-child\(5\),\s*\.row > \*:nth-child\(5\) \{\s*display: none;/)
    // O'rindiq o'z blokida: balandlik mazmunga ergashadi, satrlar o'raladi.
    const seats = css.slice(css.indexOf('@media (max-width: 1599px) {\n  .tv-podium {'))
    const seatBlock = seats.slice(0, seats.indexOf('\n}\n') + 3)
    expect(seatBlock).not.toMatch(/\.crest|\.halo|\.medal \{/)
    expect(seatBlock).toMatch(/\.tv-podium \{[^}]*height: auto;/)
    expect(seatBlock).toMatch(/\.seat \{[^}]*height: auto;[^}]*min-height: 216px;/)
    expect(seatBlock).toMatch(/\.seat--1 \{ min-height: 236px; \}/)
    expect(seatBlock).toMatch(/\.seat__fakt \{[^}]*flex-wrap: wrap;/)
  })

  /*
    Telefon — televizor emas (spec §9): ustunlar bittadan (`.tv-switch`),
    qator tasma · rank · gerb · ism · FAKT 2; FAKT 1, buyurtma, konv. va
    medallar yashirin. Markup o'zgarmaydi — uyalar `nth-child` bilan yopiladi.
  */
  it('collapses a phone row to band · rank · crest · name · hero and hides the desk columns', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 1279px) {\n  .tv-cols,'))
    const block = phone.slice(0, phone.indexOf('\n}\n') + 3)
    expect(block).toMatch(/\.tv-cols,\s*\.row \{\s*grid-template-columns: 5px 26px 58px minmax\(0, 1fr\) 104px;/)
    // 5 komanda, 6 medallar, 8 boshqa fakt, 9 buyurt., 10 konv. — 7 qahramon qoladi.
    expect(block).toMatch(/\.tv-cols > span:nth-child\(5\),\s*\.tv-cols > span:nth-child\(6\),\s*\.tv-cols > span:nth-child\(8\),\s*\.tv-cols > span:nth-child\(9\),\s*\.tv-cols > span:nth-child\(10\),\s*\.row > \*:nth-child\(5\),\s*\.row > \*:nth-child\(6\),\s*\.row > \*:nth-child\(8\),\s*\.row > \*:nth-child\(9\),\s*\.row > \*:nth-child\(10\) \{\s*display: none;/)
    expect(block).toMatch(/\.tv-tcols,\s*\.trow \{\s*grid-template-columns: 32px minmax\(0, 1fr\) 124px 52px;/)
    expect(block).toMatch(/\.trow > \*:nth-child\(5\),\s*\.trow > \*:nth-child\(6\),\s*\.trow > \*:nth-child\(7\) \{\s*display: none;/)
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
    expect(css).toMatch(/\n\.seat \{[^}]*container-type: inline-size;/)
    expect(css).toMatch(/\.seat__money \{[^}]*font-size: min\(40px, 17\.5cqi\);/)
    // Milliard (o'n xona) — torroq `cqi`, kesilmaydi.
    expect(css).toMatch(/\.seat__money\[data-digits="9"\] \{ font-size: min\(40px, 16cqi\); \}/)
    expect(css).toMatch(/\.seat__money\[data-digits="10"\] \{ font-size: min\(40px, 14cqi\); \}/)
    // Meta va tokcha: sig'magan komanda / izoh butunlay tushadi, ellipsis emas.
    expect(css).toMatch(/\.seat__meta \{[^}]*flex-wrap: wrap;/)
    expect(css).toMatch(/\.seat__rack \{[^}]*flex-wrap: wrap;/)
    expect(css).toMatch(/\.seat__name > span \{[^}]*text-overflow: ellipsis;/)
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
    expect(css.slice(phone, phone + 200)).toMatch(
      /\.tv-col-head \{\s*flex-wrap: wrap;\s*gap: 2px 8px;\s*height: auto;\s*min-height: 42px;\s*padding: 6px 10px;/,
    )
    // Telefonda sanoq o'z qatorida, butun kenglikda (390 auditi: «bugun 1 sotu…»).
    expect(css.slice(phone, phone + 700)).toMatch(/\.tv-col-head__count \{\s*order: 5;\s*flex-basis: 100%;/)
  })

  /*
    Ustma-ust turgan o'rindiqlar 1-2-3 o'qiladi: `grid-area` 2-1-3 podium
    kompozitsiyasi uchun, bitta ustunda u chempionni ikkinchi qatorga tushiradi.
  */
  it('resets the seat order on a phone so the champion is first', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 1279px) {\n  .tv-podium'))
    const block = phone.slice(0, phone.indexOf('\n}\n') + 3)
    expect(block).toMatch(/\.tv-podium \{\s*grid-template-columns: minmax\(0, 1fr\);/)
    expect(block).toMatch(/\.seat--1,\s*\.seat--2,\s*\.seat--3 \{\s*grid-area: auto;/)
  })
})

/*
  EFIR PREMIUM — MOSLASHUV VA JONLI AUDIT (spec §10, delta 24–24a; 2026-09-17).
  Har bir ustun o'lchami HAQIQIY sahifada headless chromium bilan o'lchangan
  (production payloadlari, dpr 1): 1920 rail ochiq 979 / 653, rail yopiq
  1085 / 723, 1366 rail ochiq 647 / 431, telefon 358. Grid satrlari shu
  kengliklarga qayta yig'iladi: yashirin uyalar sanog'i trek sanog'iga teng,
  ism treki esa eng uzun o'lchangan mazmunni sig'diradi.
*/
describe('EFIR Premium — the grids re-summed for every frame the board is read in', () => {
  const px = (v: string) => Number(v.replace('px', ''))

  /** The rule body of `selector` inside the media block starting at `blockStart` (or at top level). */
  function ruleIn(block: string, selector: string): string {
    const at = block.indexOf(selector)
    expect(at, selector).toBeGreaterThan(-1)
    return block.slice(at, block.indexOf('}', at))
  }
  function mediaBlock(head: string): string {
    const at = css.indexOf(head)
    expect(at, head).toBeGreaterThan(-1)
    let depth = 0
    for (let i = css.indexOf('{', at); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') {
        depth -= 1
        if (depth === 0) return css.slice(at, i + 1)
      }
    }
    throw new Error('unterminated ' + head)
  }
  /** The width left to the one `minmax(0, 1fr)` track. */
  function nameTrack(columns: string, gap: number, padding: number, width: number): { name: number; tracks: number } {
    const tracks = columns.replace('minmax(0, 1fr)', 'FR').trim().split(/\s+/)
    const fixed = tracks.filter((t) => t !== 'FR').reduce((sum, t) => sum + px(t), 0)
    return { name: width - padding - fixed - gap * (tracks.length - 1), tracks: tracks.length }
  }
  const columnsOf = (rule: string) => rule.match(/grid-template-columns: ([^;]+);/)![1]!

  const base = css.slice(css.indexOf('.tv-cols,\n.row {'))
  const rowsBase = columnsOf(base)
  const teamsBase = columnsOf(css.slice(css.indexOf('.tv-tcols,\n.trow {')))
  const narrow = mediaBlock('@media (max-width: 1599px) {\n  /* Qator 43 px')
  const phone = mediaBlock('@media (max-width: 1279px) {\n  .tv-cols,')

  it('1920, rail open and closed: the spec grids, the name track only grows', () => {
    expect(rowsBase).toBe('6px 38px 68px minmax(0, 1fr) 80px 96px 148px 104px 40px 60px')
    expect(teamsBase).toBe('36px minmax(0, 1fr) 136px 56px 92px 36px 56px')
    // Qator: 8 + 16 to'ldirma, 9 × 8 oraliq. Eng uzun ism «Muxtoraliyevna Zulfira 210» ~222 px.
    for (const width of [979, 1085]) {
      const { name, tracks } = nameTrack(rowsBase, 8, 24, width)
      expect(tracks).toBe(10)
      expect(name).toBeGreaterThanOrEqual(222)
    }
    // Komanda: 12 + 16 to'ldirma, 6 × 10 oraliq. «Kompaniya 1» 20 px da 116 px.
    for (const width of [653, 723]) expect(nameTrack(teamsBase, 10, 28, width).name).toBeGreaterThanOrEqual(116)
  })

  it('1366: seller rows drop the team (5); teams drop the other fact (5) and orders (6) — every visible cell has a track', () => {
    const rows = columnsOf(ruleIn(narrow, '.tv-cols,\n  .row {'))
    expect(rows).toBe('5px 28px 58px minmax(0, 1fr) 62px 108px 88px 34px 48px')
    const r = nameTrack(rows, 6, 16, 647)
    expect(r.tracks).toBe(10 - 1)
    expect(r.name).toBeGreaterThanOrEqual(140)

    const teams = columnsOf(ruleIn(narrow, '.tv-tcols,\n  .trow {'))
    expect(teams).toBe('30px minmax(0, 1fr) 118px 46px 46px')
    expect(narrow).toMatch(
      /\.tv-tcols > span:nth-child\(5\),\s*\.tv-tcols > span:nth-child\(6\),\s*\.trow > \*:nth-child\(5\),\s*\.trow > \*:nth-child\(6\) \{\s*display: none;/,
    )
    const t = nameTrack(teams, 8, 28, 431)
    expect(t.tracks).toBe(7 - 2)
    // «Kompaniya 1» 18 px da 106 px. Eski 7 trekli satrda bu raqam 0 edi — nom ko'rinmas edi.
    expect(t.name).toBeGreaterThanOrEqual(106)
    // Qahramon 19 px da «247 200 000» — 22 px da 136 px o'lchangan → 118.
    expect(Math.ceil((136 * 19) / 22)).toBeLessThanOrEqual(118)
    // Ulush chizig'i nom + qahramon ostida: 12 + 30 + 8 va 16 + 46 + 46 + 2 × 8.
    expect(narrow).toMatch(/\.trow__bar \{ left: 50px; right: 94px; \}/)
  })

  it('1366: the team plaque wraps rather than overprinting; the lists rest on whole rows', () => {
    const jami = ruleIn(narrow, '  .jami {')
    expect(jami).toContain('flex-wrap: wrap;')
    expect(jami).toContain('height: auto;')
    expect(narrow).toMatch(/\.jami \.jami__v \{\s*font-size: 22px;/)
    expect(css).toMatch(/\.tv-trows\.tv-trows--whole \{\s*flex: none;\s*height: var\(--trows-h\);/)
    expect(queryFor('.tv-trows.tv-trows--whole {')).toBe(1280)
  })

  it('1366: every seat line stays one line — the «Avgustdan beri» word gives way to the foot', () => {
    const seats = mediaBlock("@media (max-width: 1599px) {\n  .tv-podium {")
    expect(seats).toMatch(/\.seat \{[^}]*padding: 10px 10px 10px 16px;/)
    expect(seats).toMatch(/\.seat__life > span:first-child \{ display: none; \}/)
    expect(seats).toMatch(/\.seat__money,\s*\.seat--1 \.seat__money \{ line-height: 40px; \}/)
    // Asos sahifa tagida aytilgan — so'z tushishi mumkin, chunki ma'no yo'qolmaydi.
    const page = readFileSync(new URL('../../src/features/sellers/SellersPage.tsx', import.meta.url), 'utf8')
    expect(page).toContain('avgustdan beri yetkazilgan pul boʻyicha')
  })

  it('phone: rows hide team, medals, other fact, orders, conv.; teams hide other fact, orders, conv.', () => {
    const rows = columnsOf(ruleIn(phone, '.tv-cols,\n  .row {'))
    const r = nameTrack(rows, 6, 16, 358)
    expect(r.tracks).toBe(10 - 5)
    expect(r.name).toBeGreaterThanOrEqual(110)
    const teams = columnsOf(ruleIn(phone, '.tv-tcols,\n  .trow {'))
    const t = nameTrack(teams, 8, 24, 358)
    expect(t.tracks).toBe(7 - 3)
    // «Kompaniya 1» 17 px da 88,4 + 6 + 8 = 102,4 px o'lchangan — 0,4 px ellipsis; 16 px da ~97.
    expect(t.name).toBeGreaterThanOrEqual(102)
    expect(phone).toMatch(/\.tv-tcols__cnt \{ display: none; \}/)
    expect(phone).toMatch(/\.trow__name \.nm \{ font-size: 16px; \}/)
    // Queue rows: 1599 da 6 trek (komanda yashirin), telefonda 5 (komanda, medallar yashirin).
    expect(css).toMatch(/\.row--queue \{\s*grid-template-columns: 5px 28px 58px minmax\(0, 1fr\) 62px max-content;/)
    expect(css).toMatch(/\.row--queue \{\s*grid-template-columns: 5px 26px 58px minmax\(0, 1fr\) 112px;/)
  })

  it('phone: the page foot stacks its definitions flush left; the stage wraps', () => {
    expect(css).toMatch(/\.tv-foot__defs span \{\s*display: block;\s*\}\s*\.tv-foot__defs span \+ span \{\s*margin-left: 0;/)
    expect(css).toMatch(/\.stage__money \{\s*grid-column: 1 \/ -1;/)
  })

  it('the column-head count wraps to two lines before it ellipsizes', () => {
    const count = css.slice(css.indexOf('.tv-col-head__count {'))
    const rule = count.slice(0, count.indexOf('}'))
    expect(rule).toContain('-webkit-line-clamp: 2;')
    expect(rule).toContain('line-height: 15px;')
    expect(rule).not.toContain('white-space: nowrap')
  })

  /*
    1920×1080 DA 11 QATOR (spec §5: 473 = 11 × 43). Jonli o'lchov: sahifa
    sarlavhasi 159 gacha, taxta + 8 px + 17 px sahifa tagi 1056 gacha → taxta
    872, ro'yxat uyasi 872 − 42 − 291 − 28 − 36 = 475 → 473. `gap-3` (12 px)
    bilan uya 471 bo'lib O'N qator va legenda ustida 41 px bo'sh tasma qolardi.
  */
  it('the shell gap is 8 px, which is what leaves eleven 43 px rows at 1920×1080', () => {
    const page = readFileSync(new URL('../../src/features/sellers/SellersPage.tsx', import.meta.url), 'utf8')
    expect(page).toContain('className="tv-board-shell flex min-h-0 flex-col gap-2"')
    const board = 1056 - 159 - 8 - 17
    expect(Math.floor((board - 42 - 291 - 28 - 36) / 43)).toBe(11)
    expect(Math.floor((board + 8 - 12 - 42 - 291 - 28 - 36) / 43)).toBe(10)
  })

  it('the seat life line fits the live font at 1920 and wraps rather than running into the padding', () => {
    const life = css.slice(css.indexOf('.seat__life {'))
    const rule = life.slice(0, life.indexOf('}'))
    expect(rule).toContain('flex-wrap: wrap;')
    expect(rule).toContain('font-size: 10.5px;')
    expect(css).toMatch(/\.seat__life > span:last-child \{ margin-left: auto; \}/)
    // O'rindiq ismining ikkinchi qatori: kod ismdan oldin tushadi.
    expect(css).toMatch(/\.seat__name > \.seat__name2 \{\s*display: flex;\s*flex-wrap: wrap;\s*align-items: baseline;\s*height: 1\.16em;/)
    expect(css).toMatch(/\.seat__name2 \.nm \{[^}]*text-overflow: ellipsis;/)
    expect(css).toMatch(/\.seat__name2 \.code \{ flex: none; \}/)
  })
})
