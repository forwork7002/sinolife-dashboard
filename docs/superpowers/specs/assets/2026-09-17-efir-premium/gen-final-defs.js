/* FINAL — EFIR premium <defs>: ZARB minting grammar, hardened for production.
 *
 * What changed against gen-medals.js (ZARB):
 *  1. THE METAL IS BAKED INTO EACH SYMBOL. Every medal code has exactly one metal, so the symbol
 *     points straight at its gradients (style="fill:url(#mg-gold-rim)"). The per-instance
 *     `--m-rim:url(#…)` custom properties are gone — that was the pattern that rendered black
 *     for one designer and was only ever proven in Chromium.
 *  2. NO color-mix() AND NO var() IN stop-opacity. Patina, well, sheen and bloom are plain
 *     colour tokens (pre-mixed by gen_final.py), so an old TV Chromium cannot drop a stop.
 *  3. Crest cells paint with currentColor (the instance sets `color: var(--tier)`), the most
 *     portable way to colour a <use> shadow tree. Plate is its own symbol, not an opacity var.
 *  4. One light, from the top: rim/bevel gradients run near-vertical, shadows fall down.
 *     Bevel gloss reduced ~15 % (edge .62→.5, glint .6→.5, bloom .16→.12, bevel stroke .95→.85).
 *  5. Field bottoms out in a darker `well` so gold-on-gold devices (flame, target) keep contrast.
 *  6. m-lock / m-slot dropped (the product has no locked-medal semantics). ×N plate is drawn by
 *     the instance (light DOM), so it is styled by ordinary CSS.
 *  Everything inside <defs> is styled INLINE — a document selector never matches inside a <use>
 *  shadow tree (the live `.medal .cut` bug).
 */
const fs = require('fs')
const OUT = '/tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/premium/'
const r2 = (n) => Math.round(n * 100) / 100
const rad = (d) => (d * Math.PI) / 180
const P = (cx, cy, r, deg) => [r2(cx + r * Math.cos(rad(deg))), r2(cy + r * Math.sin(rad(deg)))]

function starPath(cx, cy, radii, n, rot = -90) {
  const total = n * radii.length
  let d = ''
  for (let i = 0; i < total; i++) {
    const [x, y] = P(cx, cy, radii[i % radii.length], rot + (i * 360) / total)
    d += (i ? 'L' : 'M') + x + ' ' + y
  }
  return d + 'Z'
}
function arc(cx, cy, r, a0, a1) {
  const [sx, sy] = P(cx, cy, r, a0)
  const [ex, ey] = P(cx, cy, r, a1)
  return `M${sx} ${sy}A${r} ${r} 0 0 1 ${ex} ${ey}`
}
function laurel(cx, cy, R, a0, a1, nodes, len, wid, { inner = true, outer = true, tilt = 34 } = {}) {
  let d = ''
  const leaf = (bx, by, dirDeg) => {
    const c = Math.cos(rad(dirDeg)), s = Math.sin(rad(dirDeg))
    const T = (x, y) => [r2(bx + x * c - y * s), r2(by + x * s + y * c)]
    const p = [T(0, 0), T(len * 0.3, -wid), T(len * 0.75, -wid * 0.8), T(len, 0), T(len * 0.75, wid * 0.8), T(len * 0.3, wid)]
    return `M${p[0]}C${p[1]} ${p[2]} ${p[3]}C${p[4]} ${p[5]} ${p[0]}Z`.replace(/,/g, ' ')
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < nodes; i++) {
      const t = nodes === 1 ? 0 : i / (nodes - 1)
      const a = a0 + (a1 - a0) * t
      let [bx, by] = P(cx, cy, R, a)
      let tang = a + 90
      if (side === 1) { bx = r2(2 * cx - bx); tang = 180 - tang }
      const sgn = side === -1 ? 1 : -1
      if (outer) d += leaf(bx, by, tang - sgn * tilt)
      if (inner) d += leaf(bx, by, tang + sgn * tilt)
      if (i === nodes - 1) d += leaf(bx, by, tang)
    }
  }
  return d
}

/* ---------------------------------------------------------------- devices (24-box), ≤3 masses */
const sunRays = (() => {
  const C = [12, 17.2]
  let d = ''
  for (const a of [-90, -138, -42]) {
    const tip = P(C[0], C[1], 15, a)
    const b = P(C[0], C[1], 9.6, a)
    const px = Math.cos(rad(a + 90)) * 2.5, py = Math.sin(rad(a + 90)) * 2.5
    d += `M${tip[0]} ${tip[1]}L${r2(b[0] + px)} ${r2(b[1] + py)}L${r2(b[0] - px)} ${r2(b[1] - py)}Z`
  }
  return d
})()
const DEV = {
  crown: 'M2.6 17.6 3.8 6.2 8.8 10.8 12 3 15.2 10.8 20.2 6.2 21.4 17.6ZM3.6 19.2H20.4V22H3.6Z',
  bolt: 'M14.2 1 3 14.2H10L8.8 23 21 9.6H13.4Z',
  fire: 'M12 1c1.2 4.5 7.2 6.6 7.2 13.1a7.2 7.2 0 0 1-14.4 0c0-2.7 1.1-4.5 2.4-6 .4 1.9 1.4 3 2.7 3.4C9.3 8 12.2 6 12 1zm0 11.4c-1.9 2-3.1 3.2-3.1 4.9a3.1 3.1 0 0 0 6.2 0c0-1.7-1.2-2.9-3.1-4.9z',
  steady: 'M2 14.5h5.6V22H2zM9.2 9h5.6v13H9.2zM16.4 3H22v19h-5.6z',
  sun: `M4.2 17.4a7.8 7.8 0 0 1 15.6 0z${sunRays}M1.5 19.2h21v3h-21z`,
  target: 'M12 1.2a10.8 10.8 0 1 0 0 21.6a10.8 10.8 0 1 0 0-21.6zM12 5.4a6.6 6.6 0 1 1 0 13.2a6.6 6.6 0 1 1 0-13.2zM12 8.6a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8z',
  check: 'M1.8 12.6 6 8.4 9.8 12.2 18 4 22.2 8.2 9.8 20.6Z',
  jump: 'M12 1 21.5 11.6H15.8V23H8.2V11.6H2.5Z',
  star: 'M12 1l3.3 7.3 7.9.8-5.9 5.4 1.7 7.8L12 18.2l-7 4.1 1.7-7.8L.8 9.1l7.9-.8z',
  sprout: 'M10.4 22.6h3.2V12h-3.2zM12 14.4C12 8 7.4 4.4 1 4.4c0 6.4 4.6 10 11 10zM12 12.2c0-5.8 4.2-9.4 10.8-9.4 0 6-4.2 9.4-10.8 9.4z',
  cal: 'M2 5.2h20V22.5H2zM4.6 10.4h14.8v2.2H4.6zM4.6 15h3.8v4.6H4.6zM10.1 15h3.8v4.6h-3.8zM15.6 15h3.8v4.6h-3.8zM6 1.2h3.4v6.2H6zM14.6 1.2H18v6.2h-3.4z',
}
/* Engraved numerals — monoline stroke paths centred on 0,0, cap height 11. No webfont dependency. */
const NUM = {
  0: 'M0 -5.5C4.5 -5.5 4.5 5.5 0 5.5C-4.5 5.5 -4.5 -5.5 0 -5.5Z',
  1: 'M-3.1 -2.8 0.3 -5.5V5.5M-3.3 5.5H3.7',
  2: 'M-3.5 -2.4C-3.5 -6.6 3.5 -6.6 3.5 -2.3C3.5 0.9 -3.5 2 -3.5 5.5H3.8',
  3: 'M-3.4 -5.5H3.2L-0.7 -1.2C4.8 -1.7 4.9 5.6 -0.2 5.6C-2 5.6 -3.3 4.7 -3.8 3.3',
  4: 'M1.7 5.5V-5.5L-3.9 2.3H4.1',
  5: 'M3.2 -5.5H-2.7L-3.3 -0.7C-0.9 -2.3 3.8 -1.4 3.8 2C3.8 6.4 -2.4 6.6 -3.8 3.4',
  6: 'M2.4 -5.6C-1.6 -4.4 -3.6 -1 -3.6 2.1A3.6 3.45 0 1 0 3.6 2.1A3.6 3.45 0 0 0 -3.6 2.1',
  7: 'M-3.6 -5.5H3.6L-0.9 5.5',
  8: 'M0 -0.5A2.9 2.5 0 1 1 0 -5.5A2.9 2.5 0 1 1 0 -0.5A3.5 3 0 1 1 0 5.5A3.5 3 0 1 1 0 -0.5Z',
  x: 'M-2.7 -2.7 2.7 2.7M2.7 -2.7-2.7 2.7',
}
const chev = (i) => { const x = i * 11; return `M${x} 0H${x + 7}L${x + 12} 10L${x + 7} 20H${x}L${x + 5} 10Z` }
const chevHi = (i) => { const x = i * 11; return `M${x + 0.5} 0.45H${x + 6.8}L${x + 11.4} 9.7` }
const chevLo = (i) => { const x = i * 11; return `M${x + 0.5} 19.55H${x + 6.8}L${x + 11.4} 10.3` }
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k)

function defs() {
  const METALS = ['gold', 'silver', 'bronze', 'steel']
  const tok = (m, t) => (t === 'mid' ? `var(--medal-${m})` : `var(--medal-${m}-${t})`)
  const stop = (o, c) => `<stop offset="${o}" style="stop-color:${c}"/>`
  // one light from the top: gradients lean 16° off vertical, just enough to read as brushed
  const LEAN = 'x1=".18" y1="0" x2=".82" y2="1"'
  let g = ''
  for (const m of METALS) {
    g += `<linearGradient id="mg-${m}-rim" ${LEAN}>${stop(0, tok(m, 'hi'))}${stop(0.3, tok(m, 'mid'))}${stop(0.58, tok(m, 'lo'))}${stop(0.82, tok(m, 'mid'))}${stop(1, tok(m, 'hi'))}</linearGradient>`
    g += `<linearGradient id="mg-${m}-bevel" ${LEAN}>${stop(0, tok(m, 'sh'))}${stop(0.5, tok(m, 'lo'))}${stop(1, tok(m, 'hi'))}</linearGradient>`
    g += `<linearGradient id="mg-${m}-field" x1="0" y1="0" x2="0" y2="1">${stop(0, tok(m, 'patina'))}${stop(1, tok(m, 'well'))}</linearGradient>`
    g += `<linearGradient id="mg-${m}-dev" x1="0" y1="0" x2="0" y2="1">${stop(0, tok(m, 'hi'))}${stop(1, tok(m, 'mid'))}</linearGradient>`
  }
  g += `<linearGradient id="mg-gilt-dev" x1="0" y1="0" x2="0" y2="1">${stop(0, 'var(--medal-gilt-hi)')}${stop(1, 'var(--medal-gilt)')}</linearGradient>`
  g += `<linearGradient id="mg-sheen" x1="0" y1="0" x2="0" y2="1">${stop(0, 'var(--sheen-hi)')}${stop(0.42, 'var(--sheen-none-hi)')}${stop(0.58, 'var(--sheen-none-lo)')}${stop(1, 'var(--sheen-lo)')}</linearGradient>`
  g += `<radialGradient id="mg-bloom" cx="0.42" cy="0.2" r="0.75">${stop(0, 'var(--bloom)')}${stop(1, 'var(--sheen-none-hi)')}</radialGradient>`
  g += `<linearGradient id="mg-recess" x1="0" y1="0" x2="0" y2="1">${stop(0, 'var(--recess-lo)')}${stop(0.55, 'var(--recess-none)')}${stop(1, 'var(--recess-hi)')}</linearGradient>`
  g += `<radialGradient id="hg-field" cx="0.42" cy="0.24" r="0.8">${stop(0, 'var(--halo-field-hi)')}${stop(1, 'var(--halo-field-lo)')}</radialGradient>`

  /* planchets — bare geometry, painted by whoever <use>s them */
  g += `<circle id="pl-coin" cx="16" cy="21" r="10.5"/>`
  g += `<circle id="pl-coin-f" cx="16" cy="21" r="7.9"/>`
  g += `<path id="pl-shield" d="M16 1.4 28.4 5.2V15.2C28.4 22.7 23.4 28.1 16 30.7 8.6 28.1 3.6 22.7 3.6 15.2V5.2Z"/>`
  g += `<path id="pl-hex" d="${starPath(16, 16, [15.2], 6, -90)}"/>`
  g += `<path id="pl-burst" d="${starPath(16, 16, [15.5, 12.3], 12, -90)}"/>`
  g += `<path id="pl-burst2" d="${starPath(16, 16, [14.2, 12.3], 12, -75)}"/>`
  g += `<path id="pl-year" d="${starPath(16, 16, [15.8, 10.6, 13.4, 10.6], 8, -90)}"/>`
  g += `<rect id="pl-tab" x="3" y="3" width="26" height="26" rx="6.2"/>`
  g += `<rect id="pl-tab-f" x="6" y="6" width="20" height="20" rx="3.7"/>`
  for (const [k, d] of Object.entries(DEV)) g += `<path id="dv-${k}" fill-rule="evenodd" d="${d}"/>`
  for (const [k, d] of Object.entries(NUM)) g += `<path id="n${k}" fill="none" stroke-width="2.35" stroke-linejoin="round" stroke-linecap="butt" d="${d}"/>`
  g += `<path id="n9" fill="none" stroke-width="2.35" stroke-linejoin="round" transform="rotate(180)" d="${NUM[6]}"/>`
  g += `<path id="ch" d="M0 0H7L12 10L7 20H0L5 10Z"/>`

  /* paint placeholders → the symbol's own metal (and its device metal) */
  const paint = (body, m, dev = m) =>
    body
      .replace(/\{rim\}/g, `url(#mg-${m}-rim)`).replace(/\{bevel\}/g, `url(#mg-${m}-bevel)`)
      .replace(/\{field\}/g, `url(#mg-${m}-field)`).replace(/\{dev\}/g, `url(#mg-${dev}-dev)`)
      .replace(/\{hi\}/g, tok(m, 'hi')).replace(/\{mid\}/g, tok(m, 'mid')).replace(/\{lo\}/g, tok(m, 'lo')).replace(/\{sh\}/g, tok(m, 'sh'))
  const S = {
    rim: 'fill:{rim};stroke:var(--medal-key);stroke-width:.55;stroke-linejoin:round',
    rim2: 'fill:{rim};stroke:{sh};stroke-width:.45',
    field: 'fill:{field};stroke:{bevel};stroke-width:.85;stroke-linejoin:round',
    bloom: 'fill:url(#mg-bloom)',
    cast: 'fill:var(--medal-cast)',
    glint: 'fill:none;stroke:var(--medal-glint);stroke-width:.8;stroke-linecap:round;stroke-linejoin:round',
    mill: 'fill:none;stroke:{sh};stroke-width:1.1;stroke-dasharray:.55 .75;opacity:.6',
  }
  const device = (name, cx, cy, s) => {
    const t = `translate(${r2(cx - 12 * s)} ${r2(cy - 12 * s)}) scale(${s})`
    const o = r2(0.62 / s)
    return `<g transform="${t}"><use href="#dv-${name}" style="fill:{sh}" x="${r2(o * 0.35)}" y="${o}"/><use href="#dv-${name}" style="fill:var(--medal-edge)" x="${r2(-o * 0.25)}" y="${r2(-o * 0.7)}"/><use href="#dv-${name}" style="fill:{dev}"/></g>`
  }
  const numeral = (n, cx, cy, s, o = 0.6) =>
    `<g transform="translate(${cx} ${cy}) scale(${s})"><use href="#n${n}" style="stroke:{sh}" x="${r2((o * 0.35) / s)}" y="${r2(o / s)}"/><use href="#n${n}" style="stroke:var(--medal-edge)" x="${r2((-o * 0.25) / s)}" y="${r2((-o * 0.7) / s)}"/><use href="#n${n}" style="stroke:{dev}"/></g>`
  const scaled = (href, cx, cy, s, style) =>
    `<use href="#${href}" style="${style}" transform="translate(${r2(cx * (1 - s))} ${r2(cy * (1 - s))}) scale(${s})"/>`
  const sym = (name, body) => `<symbol id="${name}" viewBox="0 0 32 32">${body}</symbol>`

  /* ribbon: cloth V from a suspension bar, back band shaded, one centre stripe in the medal's metal */
  const bandL = 'M6.2 1.4H12.8L18.8 11.4H12.2Z', bandR = 'M25.8 1.4H19.2L13.2 11.4H19.8Z'
  const strL = 'M8.5 1.4H10.5L16.5 11.4H14.5Z', strR = 'M23.5 1.4H21.5L15.5 11.4H17.5Z'
  const ribbon =
    `<path d="${bandR}" style="fill:var(--ribbon-a)"/><path d="${strR}" style="fill:{mid}"/><path d="${bandR}" style="fill:var(--ribbon-shade)"/>` +
    `<path d="${bandL}" style="fill:var(--ribbon-a)"/><path d="${strL}" style="fill:{mid}"/>` +
    `<path d="${bandL}${bandR}" style="fill:url(#mg-sheen)"/>` +
    `<rect x="5.2" y="0.3" width="21.6" height="2.1" rx=".7" style="${S.rim}"/>` +
    `<circle cx="16" cy="10.6" r="1.7" style="fill:none;stroke:{mid};stroke-width:1"/>`
  const coin = (n) =>
    `<use href="#pl-coin" style="${S.cast}" y="1"/>${ribbon}` +
    `<use href="#pl-coin" style="${S.rim}"/><circle cx="16" cy="21" r="9.75" style="${S.mill}"/>` +
    `<use href="#pl-coin-f" style="${S.field}"/><use href="#pl-coin-f" style="${S.bloom}"/>` +
    numeral(n, 16, 21.05, 0.93) +
    `<path d="${arc(16, 21, 9.1, 214, 300)}" style="${S.glint}"/>`
  let s = ''
  s += sym('m-month-gold', paint(coin(1), 'gold')) + sym('m-month-silver', paint(coin(2), 'silver')) + sym('m-month-bronze', paint(coin(3), 'bronze'))
  // laurel sprigs for the month family — a separate layer the component adds at SEAT size only
  const sprigs = `<path d="${laurel(16, 21, 10.9, 108, 238, 8, 4.8, 1.5, { inner: false, tilt: 26 })}" style="fill:{mid};stroke:{sh};stroke-width:.4;stroke-linejoin:round"/>`
  for (const m of ['gold', 'silver', 'bronze']) s += sym(`m-laurel-${m}`, paint(sprigs, m))
  s += sym('m-year-champion', paint(
    `<use href="#pl-year" style="${S.cast}" y="1"/><use href="#pl-year" style="${S.rim}"/>` +
    `<path d="${starPath(16, 16, [14.6, 10.6], 8, -90)}" style="fill:{dev};opacity:.55"/>` +
    `<circle cx="16" cy="16" r="10.2" style="${S.rim2}"/><circle cx="16" cy="16" r="9.5" style="${S.mill}"/>` +
    `<circle cx="16" cy="16" r="7.7" style="${S.field}"/><circle cx="16" cy="16" r="7.7" style="${S.bloom}"/>` +
    device('crown', 16, 15.9, 0.47) + `<path d="${arc(16, 16, 8.9, 214, 300)}" style="${S.glint}"/>`, 'gold'))
  const burstMedal = (dev, rich) =>
    `<use href="#pl-burst" style="${S.cast}" y="1"/>` +
    (rich ? `<use href="#pl-burst2" style="fill:{lo};stroke:var(--medal-key);stroke-width:.4"/>` : '') +
    `<use href="#pl-burst" style="${S.rim}"/>` +
    `<circle cx="16" cy="16" r="11.1" style="${S.rim2}"/><circle cx="16" cy="16" r="8.7" style="${S.field}"/><circle cx="16" cy="16" r="8.7" style="${S.bloom}"/>` +
    dev + `<path d="${arc(16, 16, 9.9, 214, 300)}" style="${S.glint}"/>`
  s += sym('m-day-record', paint(burstMedal(device('bolt', 16, 16, 0.55), true), 'gold'))
  s += sym('m-day-winner', paint(burstMedal(device('sun', 16, 15.6, 0.54), false), 'steel', 'gilt'))
  const hexMedal = (dev) =>
    `<use href="#pl-hex" style="${S.cast}" y="1"/><use href="#pl-hex" style="${S.rim}"/>` +
    scaled('pl-hex', 16, 16, 0.77, S.field) + scaled('pl-hex', 16, 16, 0.77, S.bloom) + dev +
    `<path d="M6.2 8.4 16 2.7 21.4 5.8" style="${S.glint}"/>`
  s += sym('m-streak-fire', paint(hexMedal(device('fire', 16, 15.8, 0.62)), 'gold'))
  s += sym('m-streak-steady', paint(hexMedal(device('steady', 16, 15.6, 0.56)), 'steel', 'gilt'))
  const shieldMedal = (dev) =>
    `<use href="#pl-shield" style="${S.cast}" y="1"/><use href="#pl-shield" style="${S.rim}"/>` +
    scaled('pl-shield', 16, 15.2, 0.77, S.field) + scaled('pl-shield', 16, 15.2, 0.77, S.bloom) + dev +
    `<path d="M6.2 6 16 3 22.4 5" style="${S.glint}"/>`
  s += sym('m-conversion-master', paint(shieldMedal(device('target', 16, 14.6, 0.6)), 'gold'))
  s += sym('m-clean-month', paint(shieldMedal(device('check', 16, 14.4, 0.58)), 'steel', 'gilt'))
  const tabMedal = (dev) =>
    `<use href="#pl-tab" style="${S.cast}" y="1"/><use href="#pl-tab" style="${S.rim}"/>` +
    `<use href="#pl-tab-f" style="${S.field}"/><use href="#pl-tab-f" style="${S.bloom}"/>` + dev +
    `<path d="M5.4 8.2A4.1 4.1 0 0 1 9 4.9H21" style="${S.glint}"/>`
  s += sym('m-jump', paint(tabMedal(device('jump', 16, 16, 0.6)), 'steel', 'gilt'))
  s += sym('m-rookie', paint(tabMedal(device('star', 16, 16.2, 0.64)), 'steel', 'gilt'))
  s += sym('m-first-sale', paint(tabMedal(device('sprout', 16, 16, 0.62)), 'steel'))
  s += sym('m-work-month', paint(tabMedal(device('cal', 16, 16, 0.6)), 'steel'))

  /* crest: ONE <use> per crest. Lit cells = currentColor + shared sheen; unlit = engraved slots
     with a dark upper lip and a light lower lip, so «4 of 6» reads as four of six. */
  let c = ''
  for (let lv = 0; lv <= 6; lv++) {
    const lit = range(0, lv).map(chev).join(''), off = range(lv, 6).map(chev).join('')
    const hi = range(0, lv).map(chevHi).join(''), lo = range(0, lv).map(chevLo).join('')
    const offLo = range(lv, 6).map(chevLo).join(''), offHi = range(lv, 6).map(chevHi).join('')
    const w = lv === 6 ? 88 : 72
    let b = ''
    if (off) b += `<path d="${off}" style="fill:var(--crest-off)"/><path d="${offHi}" style="fill:none;stroke:var(--recess-lo);stroke-width:.7"/><path d="${offLo}" style="fill:none;stroke:var(--recess-hi);stroke-width:.7"/>`
    if (lit) b += `<path d="${lit}" style="fill:currentColor"/><path d="${lit}" style="fill:url(#mg-sheen)"/><path d="${hi}" style="fill:none;stroke:var(--crest-glint);stroke-width:.8;stroke-linejoin:round"/><path d="${lo}" style="fill:none;stroke:var(--crest-shade);stroke-width:.8;stroke-linejoin:round"/>`
    if (lv === 6) {
      const crown = 'M68.6 15.2 69.8 4.2 73.8 8.8 76.4 1.6 79 8.8 83 4.2 84.2 15.2Z', band = 'M69.2 16.6H83.6V19.6H69.2Z'
      b += `<path d="${crown}${band}" style="fill:var(--medal-gold-sh)" transform="translate(.3 .8)"/><path d="${crown}${band}" style="fill:url(#mg-gold-rim);stroke:var(--medal-key);stroke-width:.5;stroke-linejoin:round"/><path d="M69.9 4.9 73.7 9.4 76.4 2.2" style="fill:none;stroke:var(--medal-glint);stroke-width:.7;stroke-linejoin:round"/>`
    }
    c += `<symbol id="crest-${lv}" viewBox="-3 -3 ${w} 26">${b}</symbol>`
  }
  for (const [name, w] of [['crest-plate', 72], ['crest-plate-6', 88]])
    c += `<symbol id="${name}" viewBox="-3 -3 ${w} 26"><rect x="-2.5" y="-2.5" width="${w - 1}" height="25" rx="4.5" style="fill:var(--crest-plate);stroke:url(#mg-recess);stroke-width:.9"/></symbol>`

  /* halo: the month medal's big brother. 64 box. */
  let h = ''
  const hRing = (rOuter, rField, mill) =>
    `<circle cx="32" cy="33.4" r="${rOuter}" style="${S.cast}"/>` +
    `<circle cx="32" cy="32" r="${rOuter}" style="fill:{rim};stroke:var(--medal-key);stroke-width:1"/>` +
    (mill ? `<circle cx="32" cy="32" r="${rOuter - 1.6}" style="fill:none;stroke:{sh};stroke-width:2.2;stroke-dasharray:1.05 1.35;opacity:.55"/>` : '') +
    `<circle cx="32" cy="32" r="${rField}" style="fill:url(#hg-field);stroke:{bevel};stroke-width:1.7"/>` +
    (mill ? `<circle cx="32" cy="32" r="${rField - 3}" style="fill:none;stroke:{lo};stroke-width:.6;opacity:.8"/>` : '') +
    `<path d="${arc(32, 32, (rOuter + rField) / 2, 212, 302)}" style="fill:none;stroke:var(--medal-glint);stroke-width:1.4;stroke-linecap:round"/>`
  const hSym = (name, body) => `<symbol id="${name}" viewBox="0 0 64 64">${body}</symbol>`
  const metalOf = { 1: 'gold', 2: 'silver', 3: 'bronze' }
  for (const n of [1, 2, 3]) {
    const m = metalOf[n]
    h += hSym(`halo-${n}`, paint(hRing(30.5, 24, true) + numeral(n, n === 1 ? 32.6 : 32, 32.2, 2.45, 1.1), m))
    h += hSym(`halo-sm-${n}`, paint(hRing(30.5, 22.5, false) + numeral(n, n === 1 ? 32.8 : 32, 32.2, 2.5, 1.3), m))
  }
  // P1 alone: a struck laurel outside the rim, in its own 84 box (the instance draws it under halo-1)
  h += `<symbol id="halo-laurel" viewBox="-10 -10 84 84">${paint(`<path d="${laurel(32, 32, 33.6, 98, 236, 9, 8.6, 2.5, { inner: false, tilt: 30 })}" style="fill:{mid};stroke:{sh};stroke-width:.5;stroke-linejoin:round"/><path d="${laurel(32, 32, 33.6, 98, 236, 9, 8.6, 2.5, { inner: false, tilt: 30 })}" style="fill:url(#mg-sheen)"/>`, 'gold')}</symbol>`
  h += hSym('halo-ghost',
    `<circle cx="32" cy="32" r="30" style="fill:var(--slot-field);stroke:url(#mg-recess);stroke-width:1.6"/>` +
    `<circle cx="32" cy="32" r="24" style="fill:none;stroke:var(--slot-dash);stroke-width:1.2;stroke-dasharray:2.6 3.2;stroke-linecap:round"/>` +
    `<g transform="translate(32.6 32.2) scale(2.3)"><use href="#n1" style="stroke:var(--recess-hi)" y=".5"/><use href="#n1" style="stroke:var(--slot-glyph)"/></g>`)
  return `<defs>${g}${s}${c}${h}</defs>`
}

const d = defs()
const ids = (d.match(/ id="/g) || []).length
fs.writeFileSync(OUT + 'final-defs.svg.html',
  `<!-- EFIR FINAL <defs> — generated by gen-final-defs.js. Mount ONCE under the themed root (MedalDefs). ${ids} ids.\n     m-<code> x14 (metal baked in), m-laurel-{gold,silver,bronze} (seat only), n0..n9 + nx, crest-0..6, crest-plate(-6),\n     halo-1..3, halo-sm-1..3, halo-laurel, halo-ghost. No filter, no mask, no color-mix, no url() in custom properties. -->\n<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">${d}</svg>\n`)
const bad = ['color-mix', 'filter', 'var(--m-'].filter((k) => d.includes(k))
console.log(JSON.stringify({ bytes: d.length, ids, forbidden: bad }))
