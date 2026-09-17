/**
 * Regenerate `src/features/sellers/medalDefs.ts` from the «ZARB» medal asset.
 *
 * THE ASSET IS THE SINGLE SOURCE. `final-defs.svg.html` is itself written by
 * `gen-final-defs.js` (same folder) — geometry, gradients, the metal baked into
 * every `m-<code>` symbol. This script lifts the MEDAL part of its `<defs>`
 * into a TypeScript string, so the board and the approved mock can never draw
 * two different medals. Change the drawing in the generator, re-run it, then
 * run this:
 *
 *   node scripts/genMedalDefs.mjs
 *
 * ONLY WHAT A MEDAL NEEDS (klassik taxta spec §1.4). The asset was drawn for a
 * board that also had level marks and minted rank coins; that board is gone
 * and the medals stayed. So the output is a CLOSURE, not a copy: it starts
 * from what `MedalMark` instantiates — every `m-*` symbol (the fourteen medals
 * and the three laurels), the path-digits of the ×N plate (`n0..n9`, `nx`) and
 * the four body rims the plate is filled with — and keeps exactly the
 * gradients, planchets and devices those reference, transitively, in the
 * asset's own order. Everything else in the asset is left behind, and a symbol
 * added to the asset for some other purpose stays out without anybody
 * remembering to exclude it.
 *
 * It refuses to write a string the page cannot mount safely: `color-mix()`,
 * `filter`, a per-instance `var(--m-…)` or `class="cut"` inside `<defs>` (a
 * document selector never reaches a `<use>` shadow tree), a reference to an id
 * the asset does not define, or a character that would end the template
 * literal.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ASSET = 'docs/superpowers/specs/assets/2026-09-17-efir-premium/final-defs.svg.html'
const OUT = 'src/features/sellers/medalDefs.ts'

/** What `MedalMark` points a `<use>` or a `fill` at directly. */
const isRoot = (id) => /^m-/.test(id) || /^n[0-9x]$/.test(id) || /^mg-(gold|silver|bronze|steel)-rim$/.test(id)

const html = readFileSync(join(ROOT, ASSET), 'utf8')
// The asset's header comment names `<defs>` in prose — start at the <svg>.
const open = html.indexOf('<defs>', html.indexOf('<svg'))
const close = html.lastIndexOf('</defs>')
if (open < 0 || close < open) throw new Error(`${ASSET}: <defs> topilmadi`)
const whole = html.slice(open + '<defs>'.length, close)

/** The top-level children of `<defs>`, in document order. */
function topLevel(source) {
  const elements = []
  const tag = /<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g
  let depth = 0
  let start = -1
  let end = 0
  for (let m = tag.exec(source); m !== null; m = tag.exec(source)) {
    const closing = m[1] === '/'
    const selfClosing = m[3] === '/'
    if (depth === 0) {
      if (closing) throw new Error(`${ASSET}: ochilmagan </${m[2]}>`)
      if (source.slice(end, m.index).trim() !== '') throw new Error(`${ASSET}: <defs> ichida elementdan tashqari matn`)
      start = m.index
    }
    if (closing) depth -= 1
    else if (!selfClosing) depth += 1
    if (depth === 0) {
      end = tag.lastIndex
      const text = source.slice(start, end)
      const id = / id="([^"]+)"/.exec(text)?.[1]
      if (!id) throw new Error(`${ASSET}: id siz element: ${text.slice(0, 60)}`)
      elements.push({ id, text })
    }
  }
  if (depth !== 0) throw new Error(`${ASSET}: yopilmagan element`)
  return elements
}

const refsOf = (text) => [...text.matchAll(/(?:href="#|url\(#)([^")]+)/g)].map((m) => m[1])

const elements = topLevel(whole)
const byId = new Map(elements.map((e) => [e.id, e]))
if (byId.size !== elements.length) throw new Error(`${ASSET}: takrorlangan id`)

const keep = new Set()
const queue = elements.filter((e) => isRoot(e.id)).map((e) => e.id)
while (queue.length > 0) {
  const id = queue.pop()
  if (keep.has(id)) continue
  const element = byId.get(id)
  if (!element) throw new Error(`${ASSET}: «#${id}» ga ishora bor, o'zi yo'q`)
  keep.add(id)
  queue.push(...refsOf(element.text))
}

const inner = elements
  .filter((e) => keep.has(e.id))
  .map((e) => e.text)
  .join('')

for (const bad of ['color-mix', 'filter', 'var(--m-', 'class="cut"', '`', '${']) {
  if (inner.includes(bad)) throw new Error(`${ASSET}: <defs> ichida taqiqlangan «${bad}»`)
}
const ids = (inner.match(/ id="/g) ?? []).length
const medals = [...keep].filter((id) => /^m-/.test(id) && !id.startsWith('m-laurel-')).length

const ts = `/**
 * «ZARB» medal belgilari — \`<defs>\` ichi, sahifaga BIR MARTA o'rnatiladi
 * (\`MedalDefs\`). ${ids} id: metall gradientlari \`mg-*\`, planchetlar \`pl-*\`,
 * qurilmalar \`dv-*\`, yo'l-raqamlar \`n0..n9\` va \`nx\` (×N plastinkasi),
 * \`m-<code>\` ×${medals} (metall belgining ICHIGA pishirilgan) va \`m-laurel-*\`.
 * Boshqa hech narsa: generator aktivdan faqat \`MedalMark\` chizadigan
 * belgilarni va ular ishora qilgan bo'laklarni oladi.
 *
 * Hammasi inline uslublangan: hujjat selektori \`<use>\` soya daraxtiga
 * yetmaydi. \`color-mix\`, \`filter\`, \`class="cut"\` va custom-property ichida
 * \`url()\` YO'Q — rang faqat \`--medal-*\`, \`--sheen-*\`, \`--bloom\` va
 * \`--ribbon-*\` tokenlaridan (globals.css, uchala mavzu bloki).
 *
 * GENERATSIYA QILINGAN. Manba: ${ASSET}
 * (uni \`gen-final-defs.js\` yozadi). Qo'lda tahrirlamang —
 * \`node scripts/genMedalDefs.mjs\`.
 */
export const MEDAL_DEFS = \`${inner}\`
`
writeFileSync(join(ROOT, OUT), ts)
console.log(JSON.stringify({ out: OUT, bytes: inner.length, ids, medals, dropped: elements.length - keep.size }))
