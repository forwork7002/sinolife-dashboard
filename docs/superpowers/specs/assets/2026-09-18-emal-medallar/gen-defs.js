/*
 * «EMAL» FINAL — enamel-and-ring medal set, synthesised from the panel (EMAL base + SHISHA/ZARGAR grafts).
 *   node gen-defs.js   -> writes final/defs.svg.html   (inner content of svg.medal-defs)
 *                      -> writes final/final-defs.svg.html (the asset scripts/genMedalDefs.mjs reads: <svg><defs>…</defs></svg>)
 *
 * RULES THE OUTPUT KEEPS (checked at the bottom):
 *  - every paint is an inline `style` (no presentation-attribute var()), no filter, no color-mix(), no mask, no nested <use>;
 *  - no var() inside stop-opacity; the only per-instance custom property is --emal-seat-o (stroke-opacity of the seat-only
 *    jewellery: the rare tier's second hairline and the year champion's bead ring) — rows set it to 0;
 *  - every top-level child carries an id; no backtick, no ${.
 */
const fs = require('fs')
const path = require('path')
const HERE = __dirname + '/'

const f = (n) => Number(n.toFixed(2)).toString()
const C = 16
const st = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';')

/* ---------- gradients ---------------------------------------------------- */
const stop = (o, v) => `<stop offset="${o}" style="stop-color:var(--emal-${v})"/>`

// The rank disc's conic sweep, flattened onto the light's diagonal: lit top-left, shaded, one quiet return bottom-right.
const ringGrad = (m) =>
  `<linearGradient id="eg-${m}-ring" x1=".16" y1=".04" x2=".84" y2=".96">${stop(0, `${m}-hi`)}${stop(0.26, m)}${stop(0.6, `${m}-lo`)}${stop(0.84, m)}${stop(1, `${m}-hi`)}</linearGradient>`
// userSpaceOnUse: a straight horizontal stroke has a zero-height bbox and would lose an objectBoundingBox paint.
const devGrad = (m) =>
  `<linearGradient id="eg-${m}-dev" gradientUnits="userSpaceOnUse" x1="8" y1="6" x2="26" y2="28">${stop(0, `${m}-dhi`)}${stop(0.55, `${m}-d`)}${stop(1, `${m}-dlo`)}</linearGradient>`
// Enamel: the light sits top-left in the field itself — no gloss cap, no extra node.
const fieldGrad = (id, a, b) => `<linearGradient id="${id}" x1=".2" y1="0" x2=".8" y2="1">${stop(0, a)}${stop(1, b)}</linearGradient>`
// Solid satin metal for the four honours (the pedestals' own language).
const bodyGrad = (m) => `<linearGradient id="eg-${m}-body" x1=".18" y1=".02" x2=".82" y2=".98">${stop(0, `${m}-f1`)}${stop(0.5, `${m}-f2`)}${stop(1, `${m}-f3`)}</linearGradient>`

const GRADS = [
  ...['gold', 'silver', 'bronze', 'steel'].map(ringGrad),
  ...['gold', 'gilt', 'steel'].map(devGrad),
  ...['gold', 'silver', 'bronze'].map(bodyGrad),
  fieldGrad('eg-field', 'field-a', 'field-b'),
  fieldGrad('eg-field-rare', 'field-rare-a', 'field-rare-b'),
]

/* ---------- bodies -------------------------------------------------------- */
const RO = 15.5 // the ring's outer radius in the 32 box
const circ = (r, style) => `<circle cx="16" cy="16" r="${f(r)}" style="${st(style)}"/>`
const KEY = circ(15.7, { fill: 'none', stroke: 'var(--emal-key)', 'stroke-width': 0.5 })
const SEAT_ONLY = 'var(--emal-seat-o,1)' // rows: .row-medals { --emal-seat-o: 0 }

const TIER = {
  // TRUE-METAL HONOUR: a broad turned ring, a SOLID satin metal field, one hairline, a near-black enamel device.
  honour: (m) => {
    const w = 2.6
    return (
      KEY +
      circ(RO - w / 2, { fill: `url(#eg-${m}-body)`, stroke: `url(#eg-${m}-ring)`, 'stroke-width': w }) +
      // the turned groove in the broad ring (a 36px+ detail) and the step where ring meets field
      circ(RO - 1.55, { fill: 'none', stroke: `var(--emal-${m}-lo)`, 'stroke-width': 0.35, 'stroke-opacity': 0.55 }) +
      circ(RO - w - 0.2, { fill: 'none', stroke: `var(--emal-${m}-ink)`, 'stroke-width': 0.5, 'stroke-opacity': 0.5 }) +
      circ(10.95, { fill: 'none', stroke: `var(--emal-${m}-ink)`, 'stroke-width': 0.5, 'stroke-opacity': 0.36 })
    )
  },
  // RARE GOLD: a fine gold ring on dark enamel, a second hairline ring that only the seat shows.
  rare: () => {
    const w = 1.9
    return (
      KEY +
      circ(RO - w / 2, { fill: 'url(#eg-field-rare)', stroke: 'url(#eg-gold-ring)', 'stroke-width': w }) +
      circ(RO - w - 0.25, { fill: 'none', stroke: 'var(--emal-seat)', 'stroke-width': 0.5 }) +
      circ(12.05, { fill: 'none', stroke: 'url(#eg-gold-ring)', 'stroke-width': 0.65, 'stroke-opacity': SEAT_ONLY })
    )
  },
  // COMMON: one steel ring on the enamel field.
  steel: () => {
    const w = 2
    return KEY + circ(RO - w / 2, { fill: 'url(#eg-field)', stroke: 'url(#eg-steel-ring)', 'stroke-width': w }) + circ(RO - w - 0.25, { fill: 'none', stroke: 'var(--emal-seat)', 'stroke-width': 0.5 })
  },
}

/* ---------- devices: ONE optical weight (2u strokes, matching solids), ≤ 18u wide ---------------- */
const W = 2
const line = (d, paint, w = W) => `<path d="${d}" style="${st({ fill: 'none', stroke: paint, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })}"/>`
const solid = (d, paint, sw = 0.7, extra = {}) => `<path d="${d}" style="${st({ fill: paint, stroke: paint, 'stroke-width': sw, 'stroke-linejoin': 'round', ...extra })}"/>`
const polar = (cx, cy, r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]
const rrect = (x, y, w, h, r) =>
  `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}v${f(h - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}h${f(-(w - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}v${f(-(h - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}Z`
const ring = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`

// «oy» = moon AND month. A pure crescent, no star. (EMAL's two-circle crescent, nudged up-left to clear the ×N chip.)
function crescentPath() {
  const c0 = [14.9, 15.9], R = 8.1
  const c1 = [18.2, 13.5], r = 6.75
  const dx = c1[0] - c0[0], dy = c1[1] - c0[1], d = Math.hypot(dx, dy)
  const a = (R * R - r * r + d * d) / (2 * d), h = Math.sqrt(R * R - a * a)
  const mx = c0[0] + (a * dx) / d, my = c0[1] + (a * dy) / d
  const p1 = [mx + (h * dy) / d, my - (h * dx) / d]
  const p2 = [mx - (h * dy) / d, my + (h * dx) / d]
  return `M${f(p1[0])} ${f(p1[1])}A${R} ${R} 0 1 0 ${f(p2[0])} ${f(p2[1])}A${r} ${r} 0 1 1 ${f(p1[0])} ${f(p1[1])}Z`
}

// THE CROWN — one drawing for the whole board: this path is the seat crown's body (polish icon, 28×20 box:
// M5 15.3 2.9 6.2l6 4.2L14 3.2l5.1 7.2 6-4.2L23 15.3z + band 4.7,16.2 18.6×2.6) mapped ×0.66 about (14,11) → (16,16.1).
const CROWN_K = 0.66
const cx = (x) => f(16 + (x - 14) * CROWN_K)
const cy = (y) => f(16.1 + (y - 11) * CROWN_K)
const CROWN_BODY = `M${cx(5)} ${cy(15.3)}L${cx(2.9)} ${cy(6.2)}L${cx(8.9)} ${cy(10.4)}L${cx(14)} ${cy(3.2)}L${cx(19.1)} ${cy(10.4)}L${cx(25.1)} ${cy(6.2)}L${cx(23)} ${cy(15.3)}Z`
const CROWN_BAND = `M${cx(5.6)} ${cy(18.3)}H${cx(22.4)}`

// ENGRAVED (honours only): the cut is near-black enamel, its far wall catches one hairline of light.
function engraved(m, parts) {
  const hi = `var(--emal-${m}-f1)`
  const ink = `var(--emal-${m}-ink)`
  const draw = (paint) => parts.map((p) => (p.kind === 'solid' ? solid(p.d, paint, p.sw ?? 0.7) : line(p.d, paint, p.w))).join('')
  return `<g transform="translate(.26 .32)" style="opacity:.5">${draw(hi)}</g>` + draw(ink)
}

const DEVICE = {
  crescent: [{ kind: 'solid', d: crescentPath() }],
  crown: [{ kind: 'solid', d: CROWN_BODY, sw: 0.9 }, { kind: 'line', d: CROWN_BAND, w: 1.9 }],
}

// Fire streak: one flame, an enamel heart (EMAL).
const FLAME =
  'M16.3 6.6C16.9 10.4 22.6 12.6 22.6 18.3C22.6 22.4 19.7 25.2 16 25.2C12.3 25.2 9.4 22.4 9.4 18.6C9.4 15.9 10.8 14 12.2 12.6C12.5 14.4 13.2 15.4 14.3 15.9C13.9 12.6 14.7 9 16.3 6.6Z' +
  'M16 18.2C16.9 19.4 18.5 20.2 18.5 21.7C18.5 23 17.4 23.8 16 23.8C14.6 23.8 13.5 23 13.5 21.7C13.5 20.3 15.1 19.5 16 18.2Z'
const flame = (p) => solid(FLAME, p, 0.5, { 'fill-rule': 'evenodd' })

// Conversion master: the PERCENT itself (SHISHA) — it ties to the KONV. column and cannot be read as the chase target.
const percent = (p) => line(`${ring(11.5, 11.7, 2.45)}${ring(20.5, 20.3, 2.45)}M21.3 9.8 10.7 22.2`, p, 2.05)

// Day record: the bolt (SHISHA) — continuity with the shipped «Kun rekordi», the most legible glyph at 26px.
const bolt = (p) => solid('M17.8 6.7 9.8 17.4H15.1L14.1 25.3 22.2 14.4H16.9Z', p, 0.9)

// Steady: three EQUAL pillars on one plinth — three months held at one level (SHISHA/ZARGAR).
const pillars = (p) => line('M11 10.6V18.2M16 10.6V18.2M21 10.6V18.2', p, 2.2) + line('M8.6 22.4H23.4', p, 2.2)

// Clean month: one bold tick (EMAL).
const tick = (p) => line('M9.2 16.6L14 21.4L23 11.2', p, 2.5)

// Jump: the line that breaks upward — re-cut to the tick's optical weight, a larger arrowhead.
const jump = (p) => line('M8.4 21.4L13.6 15.9L17 19.2L23.2 12.5M18.1 11.6H23.7V17.2', p, 2.3)

// New star (EMAL).
function star(p) {
  const pts = []
  for (let i = 0; i < 10; i++) pts.push(polar(16, 16.7, i % 2 ? 3.9 : 9.2, i * 36 - 90))
  return solid('M' + pts.map((q) => `${f(q[0])} ${f(q[1])}`).join('L') + 'Z', p)
}

// Day winner: «kun» = sun AND day — the sun coming up over the horizon (EMAL). Rays + horizon are ONE path.
function sunrise(p) {
  const y = 19.2
  let d = ''
  for (const deg of [-162, -126, -90, -54, -18]) {
    const [x0, y0] = polar(16, y, 7.1, deg), [x1, y1] = polar(16, y, 9.6, deg)
    d += `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`
  }
  d += 'M7.6 23H24.4'
  return solid(`M${f(16 - 4.5)} ${y}A4.5 4.5 0 0 1 ${f(16 + 4.5)} ${y}Z`, p) + line(d, p, 1.9)
}

// Working month: the calendar leaf, one row of three days (EMAL, exactly) — leaf + rule + hangers ONE path, days ONE path.
const calendar = (p) => line(`${rrect(8.6, 9.6, 14.8, 13.8, 2.6)}M8.6 14H23.4M12.4 7.6V10.4M19.6 7.6V10.4`, p, 1.85) + line('M12.1 18.7h.01M16 18.7h.01M19.9 18.7h.01', p, 2.5)

// First sale: a sprout (EMAL) — stem, and both leaves as one solid.
const sprout = (p) =>
  line('M16 24.2V15.4', p) + solid('M16 18.6C12.2 18.9 9 16.6 8.6 12.4C12.6 12.1 15.8 14.4 16 18.6ZM16 15.6C16.1 11.8 18.9 9.2 23.2 9C23.2 12.9 20.4 15.7 16 15.6Z', p)

/* ---------- the fourteen --------------------------------------------------- */
const GOLD = 'url(#eg-gold-dev)', GILT = 'url(#eg-gilt-dev)', STEEL = 'url(#eg-steel-dev)'
// the year champion's bead ring — a jeweller's flourish the seat alone shows (ZARGAR)
const BEADS = circ(9.75, { fill: 'none', stroke: 'var(--emal-gold-ink)', 'stroke-width': 0.85, 'stroke-dasharray': '.1 1.6', 'stroke-linecap': 'round', 'stroke-opacity': SEAT_ONLY })

const MEDALS = {
  'year-champion': TIER.honour('gold') + engraved('gold', DEVICE.crown),
  'month-gold': TIER.honour('gold') + engraved('gold', DEVICE.crescent),
  'month-silver': TIER.honour('silver') + engraved('silver', DEVICE.crescent),
  'month-bronze': TIER.honour('bronze') + engraved('bronze', DEVICE.crescent),
  'streak-fire': TIER.rare() + flame(GOLD),
  'conversion-master': TIER.rare() + percent(GOLD),
  'day-record': TIER.rare() + bolt(GOLD),
  'streak-steady': TIER.steel() + pillars(GILT),
  'clean-month': TIER.steel() + tick(GILT),
  jump: TIER.steel() + jump(GILT),
  rookie: TIER.steel() + star(GILT),
  'day-winner': TIER.steel() + sunrise(GILT),
  'work-month': TIER.steel() + calendar(STEEL),
  'first-sale': TIER.steel() + sprout(STEEL),
}
if (process.env.BEADS !== '0') MEDALS['year-champion'] = TIER.honour('gold') + BEADS + engraved('gold', DEVICE.crown)

const out =
  GRADS.join('\n') +
  '\n' +
  Object.entries(MEDALS)
    .map(([code, inner]) => `<symbol id="m-${code}" viewBox="0 0 32 32">${inner}</symbol>`)
    .join('\n') +
  '\n'

/* ---------- refusals ------------------------------------------------------- */
for (const bad of ['color-mix', 'filter', 'mask', '`', '${', 'class=', 'var(--m-']) if (out.includes(bad)) throw new Error('forbidden in defs: ' + bad)
if (/\s(fill|stroke|stop-color)="/.test(out)) throw new Error('presentation-attribute paint found — every paint must be an inline style')
if (/stop-opacity/.test(out)) throw new Error('no stop-opacity at all in this set')
if (/<use/.test(out)) throw new Error('no nested <use>')

fs.writeFileSync(HERE + 'defs.svg.html', out)
fs.writeFileSync(
  HERE + 'final-defs.svg.html',
  `<!-- «EMAL» final medal asset. GENERATED by gen-defs.js — do not edit by hand. Feed to scripts/genMedalDefs.mjs. -->\n<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">\n<defs>\n${out}</defs>\n</svg>\n`,
)
const nodes = Object.fromEntries(Object.entries(MEDALS).map(([k, v]) => [k, (v.match(/<(circle|path|g)\b/g) || []).length]))
console.log('defs.svg.html', out.length, 'bytes ·', Object.keys(MEDALS).length, 'medals · ids', (out.match(/ id="/g) || []).length)
console.log('nodes per medal', JSON.stringify(nodes))
module.exports = { MEDALS, CROWN_K }
