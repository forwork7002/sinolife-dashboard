/**
 * Regenerate `src/features/sellers/medalDefs.ts` from the EFIR Premium asset.
 *
 * THE ASSET IS THE SINGLE SOURCE. `final-defs.svg.html` is itself written by
 * `gen-final-defs.js` (same folder) — geometry, gradients, the metal baked into
 * every `m-<code>` symbol. This script only lifts the inside of its `<defs>`
 * into a TypeScript string, so the board and the mock can never draw two
 * different medals. Change the drawing in the generator, re-run it, then run
 * this:
 *
 *   node scripts/genMedalDefs.mjs
 *
 * It refuses to write a string the page cannot mount safely: `color-mix()`,
 * `filter`, a per-instance `var(--m-…)` or `class="cut"` inside `<defs>` (a
 * document selector never reaches a `<use>` shadow tree), or a character that
 * would end the template literal.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ASSET = 'docs/superpowers/specs/assets/2026-09-17-efir-premium/final-defs.svg.html'
const OUT = 'src/features/sellers/medalDefs.ts'

const html = readFileSync(join(ROOT, ASSET), 'utf8')
// The asset's header comment names `<defs>` in prose — start at the <svg>.
const open = html.indexOf('<defs>', html.indexOf('<svg'))
const close = html.lastIndexOf('</defs>')
if (open < 0 || close < open) throw new Error(`${ASSET}: <defs> topilmadi`)
const inner = html.slice(open + '<defs>'.length, close)

for (const bad of ['color-mix', 'filter', 'var(--m-', 'class="cut"', '`', '${']) {
  if (inner.includes(bad)) throw new Error(`${ASSET}: <defs> ichida taqiqlangan «${bad}»`)
}
const ids = (inner.match(/ id="/g) ?? []).length

const ts = `/**
 * EFIR Premium belgilari — \`<defs>\` ichi, sahifaga BIR MARTA o'rnatiladi
 * (\`MedalDefs\`). ${ids} id: metall gradientlari \`mg-*\`, planchetlar \`pl-*\`,
 * qurilmalar \`dv-*\`, yo'l-raqamlar \`n0..n9\` va \`nx\`, \`#ch\`, \`m-<code>\` ×14
 * (metall belgining ICHIGA pishirilgan), \`m-laurel-*\`, \`crest-0..6\`,
 * \`crest-plate(-6)\`, \`halo-1..3\`, \`halo-sm-1..3\`, \`halo-laurel\`, \`halo-ghost\`.
 *
 * Hammasi inline uslublangan: hujjat selektori \`<use>\` soya daraxtiga
 * yetmaydi. \`color-mix\`, \`filter\`, \`class="cut"\` va custom-property ichida
 * \`url()\` YO'Q — rang faqat \`--medal-*\`/\`--tier\`/\`--crest-*\` tokenlaridan.
 *
 * GENERATSIYA QILINGAN. Manba: ${ASSET}
 * (uni \`gen-final-defs.js\` yozadi). Qo'lda tahrirlamang —
 * \`node scripts/genMedalDefs.mjs\`.
 */
export const EFIR_DEFS = \`${inner}\`
`
writeFileSync(join(ROOT, OUT), ts)
console.log(JSON.stringify({ out: OUT, bytes: inner.length, ids }))
