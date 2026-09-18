/* Shared pieces of the final build: the ×N chip, the injection into a frozen snapshot, the snapshot list. */
const fs = require('fs')
const path = require('path')
const HERE = __dirname + '/'
const ROOT = path.join(__dirname, '..') + '/'
const BASE = ROOT + 'base/'
const OUT = HERE + 'out/'

const SNAPS = [
  { name: 'month-dark-1920', w: 1920, h: 1080 },
  { name: 'month-light-1920', w: 1920, h: 1080 },
  { name: 'today-dark-1920', w: 1920, h: 1080 },
  { name: 'month-dark-1366', w: 1366, h: 768 },
]

/** MEDAL_METAL[code].body — the chip's hairline takes the medal's own metal. */
const BODY = { 'year-champion': 'gold', 'month-gold': 'gold', 'month-silver': 'silver', 'month-bronze': 'bronze', 'day-record': 'gold', 'conversion-master': 'gold', 'streak-fire': 'gold' }

/**
 * The ×N chip — what MedalMark's CountPlate becomes. Geometry in the 32 box:
 *   height 10.4, width 15.4 (one digit) / 20.2 (two), right edge x = 34.4, top y = 23.6 → it sits ON the ring's lower
 *   right and leaves the box by 2.4u right and 2u below (3px / 2.5px on a 40px medal; the shelf gap is 6px).
 */
function chip(count, metal) {
  const n = String(Math.min(count, 99))
  const w = n.length === 1 ? 15.4 : 20.2
  const h = 10.4
  const x0 = 34.4 - w
  const y0 = 23.6
  const g = 1 // the knock-out gap, in the card's colour
  const r = (v) => Number(v.toFixed(2))
  return (
    `<g class="medal-mark__n" data-metal="${metal}">` +
    `<rect class="medal-mark__n-gap" x="${r(x0 - g)}" y="${r(y0 - g)}" width="${r(w + 2 * g)}" height="${r(h + 2 * g)}" rx="${r(h / 2 + g)}"></rect>` +
    `<rect class="medal-mark__n-pill" x="${r(x0)}" y="${r(y0)}" width="${w}" height="${h}" rx="${r(h / 2)}"></rect>` +
    `<text class="medal-mark__n-text" x="${r(x0 + w / 2 - 0.15)}" y="${r(y0 + h / 2 + 3.05)}"><tspan class="medal-mark__n-x">×</tspan>${n}</text>` +
    `</g>`
  )
}

function injectMedals(html) {
  const defs = fs.readFileSync(HERE + 'defs.svg.html', 'utf8')
  const css = fs.readFileSync(HERE + 'medals.css', 'utf8')
  html = html.replace(/(<svg class="medal-defs"[^>]*>)[\s\S]*?<\/svg>/, (_, open) => `${open}<defs>${defs}</defs></svg>`)
  html = html.replace(/(<style id="variant-css">)[\s\S]*?(<\/style>)/, (_, a, b) => a + '\n' + css + b)
  html = html.replace(/<svg class="medal-mark[^"]*"[^>]*>[\s\S]*?<\/svg>/g, (svg) => {
    const code = /data-medal="([^"]+)"/.exec(svg)[1]
    svg = svg.replace(/<use href="#m-laurel-[a-z]+"><\/use>/g, '') // 1. no laurel
    const count = /aria-label="[^"]*×(\d+)"/.exec(svg)
    svg = svg.replace(/<rect class="medal-mark__plate-rim"[\s\S]*?<\/g>/, '') // 2. the ZARB plate goes …
    if (count) svg = svg.replace('</svg>', chip(Number(count[1]), BODY[code] || 'steel') + '</svg>') // … the chip comes
    return svg
  })
  return html
}

const { chromium } = require('/home/smack/.npm/_npx/705bc6b22212b352/node_modules/playwright')
module.exports = { fs, path, HERE, ROOT, BASE, OUT, SNAPS, BODY, chip, injectMedals, chromium }
