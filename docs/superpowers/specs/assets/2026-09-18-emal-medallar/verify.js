/* Geometry parity: base snapshot vs out/medals-* and out/full-* — getBoundingClientRect probes, max |Δ| per group. */
const { fs, BASE, OUT, SNAPS, chromium } = require('./lib.js')

const GEO = () => {
  const pick = (sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })
  const out = {}
  for (const s of ['.tv-col', '.tv-col-head', '.tv-podium', '.tv-seat-card', '.tv-pedestal', '.tv-seat-name', '.tv-seat-figure', '.seat-medals', '.chase-chip', '.podium-plaque',
    '.tv-list', '.tv-table th', '.tv-row', '.tv-row > td', '.tv-name', '.tv-money', '.tv-chase', '.tv-bar', '.row-medals', '.medal-mark', '.tv-fakt', '.tv-col-glyph', '.medal-ring', '.record-entry', 'h1'])
    out[s] = pick(s)
  out.__scroll = [document.documentElement.scrollWidth, document.documentElement.scrollHeight]
  out.__listScroll = [...document.querySelectorAll('.tv-list')].map((l) => l.scrollHeight)
  out.__truncated = [...document.querySelectorAll('.tv-name, .tv-seat-name')].filter((e) => e.scrollWidth > e.clientWidth + 0.5).length
  out.__rowMedalsPainted = [...document.querySelectorAll('.row-medals')].map((h) => [...h.children].filter((m) => m.getBoundingClientRect().top < h.getBoundingClientRect().bottom - 1).length).join('')
  out.__rowMedalMaxPx = Math.max(0, ...[...document.querySelectorAll('.row-medals > .medal-mark')].map((m) => m.getBoundingClientRect().height))
  // nothing may clip the ×N chip: walk from each chip up to the seat card
  out.__chipClipped = [...document.querySelectorAll('.medal-mark__n')].filter((g) => { let e = g.ownerSVGElement; const b = g.getBoundingClientRect(); for (; e && !e.classList.contains('tv-seat-card'); e = e.parentElement) { const cs = getComputedStyle(e); if (cs.overflow !== 'visible' && e.tagName !== 'svg') { const r = e.getBoundingClientRect(); if (b.right > r.right + 0.5 || b.bottom > r.bottom + 0.5) return true } if (e.tagName === 'svg' && cs.overflow !== 'visible') return true } return false }).length
  return out
}

function diff(a, b) {
  const lines = []
  let worst = 0
  for (const k of Object.keys(a)) {
    if (k.startsWith('__')) { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) lines.push(`${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`); continue }
    if (a[k].length !== b[k].length) { lines.push(`${k}: count ${a[k].length} → ${b[k].length}`); continue }
    let m = 0, at = -1, which = '', signed = 0
    a[k].forEach((r, i) => r.forEach((v, j) => { const d = Math.abs(v - b[k][i][j]); if (d > m) { m = d; at = i; which = 'xywh'[j]; signed = b[k][i][j] - v } }))
    if (m > 0.05) lines.push(`${k}: max Δ ${signed.toFixed(2)}px (${which}, #${at})`)
    if (m > worst) worst = m
  }
  return { worst, lines }
}

;(async () => {
  const b = await chromium.launch()
  let report = ''
  for (const s of SNAPS) {
    const geo = {}
    for (const [key, file] of [['base', BASE + s.name + '.html'], ['medals', OUT + 'medals-' + s.name + '.html'], ['full', OUT + 'full-' + s.name + '.html']]) {
      const ctx = await b.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      const p = await ctx.newPage()
      await p.goto('file://' + file); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300)
      geo[key] = await p.evaluate(GEO)
      await ctx.close()
    }
    const pod = (g) => g['.tv-podium'][0][3].toFixed(2), row = (g) => g['.tv-row'][0][3].toFixed(2)
    report += `\n## ${s.name}\n  podium h: base ${pod(geo.base)} · medals ${pod(geo.medals)} · full ${pod(geo.full)}   |  row#0 h: base ${row(geo.base)} · medals ${row(geo.medals)} · full ${row(geo.full)}   |  row medal max: ${geo.medals.__rowMedalMaxPx}px  |  truncated names: ${geo.base.__truncated} / ${geo.medals.__truncated} / ${geo.full.__truncated}  |  chips clipped: ${geo.medals.__chipClipped} / ${geo.full.__chipClipped}\n`
    for (const v of ['medals', 'full']) {
      const d = diff(geo.base, geo[v])
      report += `  ${v} vs base — worst Δ ${d.worst.toFixed(2)}px${d.lines.length ? '' : '  (IDENTICAL)'}\n` + d.lines.map((l) => '      ' + l + '\n').join('')
    }
  }
  await b.close()
  fs.writeFileSync(OUT + 'geometry.txt', report)
  console.log(report)
})()
