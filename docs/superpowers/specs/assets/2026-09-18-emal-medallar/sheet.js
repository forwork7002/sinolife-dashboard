/* FINAL sheet — all 14 medals in MEDAL_ORDER at 64 / 40 / 26 on the board's own surfaces, both themes. */
const { fs, OUT, BODY, chip, chromium } = require('./lib.js')

const ORDER = ['year-champion', 'month-gold', 'month-silver', 'month-bronze', 'streak-fire', 'conversion-master', 'day-record', 'streak-steady', 'clean-month', 'jump', 'rookie', 'day-winner', 'work-month', 'first-sale']
const NAME = {
  'month-gold': 'Oy chempioni', 'month-silver': 'Kumush oy', 'month-bronze': 'Bronza oy', 'year-champion': 'Yil chempioni',
  'streak-fire': 'Olov seriyasi', 'streak-steady': 'Barqaror', 'day-record': 'Kun rekordi', 'day-winner': 'Kun gʻolibi',
  'conversion-master': 'Konversiya ustasi', 'clean-month': 'Toza oy', jump: 'Sakrash', rookie: 'Yangi yulduz',
  'first-sale': 'Birinchi savdo', 'work-month': 'Ishchan oy',
}
const WHY = {
  'year-champion': 'yil yakunida 1-oʻrin', 'month-gold': 'oy yakunida 1-oʻrin', 'month-silver': 'oy yakunida 2-oʻrin', 'month-bronze': 'oy yakunida 3-oʻrin',
  'streak-fire': '3 oy ketma-ket top-3', 'conversion-master': 'oyning eng yuqori konversiyasi', 'day-record': 'eng katta kunlik savdo',
  'streak-steady': '3 oy ketma-ket top-10', 'clean-month': 'oyda ≥ 80 % yetkazilgan', jump: 'oʻtgan oydan ×1,5', rookie: 'birinchi oyida top-10',
  'day-winner': 'kun gʻolibi', 'work-month': 'oy davomida ishda', 'first-sale': 'birinchi yetkazilgan savdo',
}
const TIER = { 'year-champion': 'haqiqiy metall', 'month-gold': 'haqiqiy metall', 'month-silver': 'haqiqiy metall', 'month-bronze': 'haqiqiy metall', 'streak-fire': 'nodir oltin', 'conversion-master': 'nodir oltin', 'day-record': 'nodir oltin', 'work-month': 'poʻlat', 'first-sale': 'poʻlat' }

const medal = (code, size, count) =>
  `<svg class="medal-mark" data-medal="${code}" viewBox="0 0 32 32" width="${size}" height="${size}"><use href="#m-${code}"></use>${count ? chip(count, BODY[code] || 'steel') : ''}</svg>`
const teamChip = (t) => `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-[1.3] font-medium whitespace-nowrap" style="background: var(--surface-sunken); color: var(--ink-secondary); border: 1px solid var(--border);">${t}</span>`

function row(rank, name, team, codes, pct) {
  return `<div class="sh-row"><span class="sh-rank">${rank}</span><div class="sh-cell"><div class="sh-nameline"><span class="sh-name">${name}</span>${teamChip(team)}</div>
  <div class="sh-bar"><i style="width:${pct}%"></i></div><p class="sh-chase">Oldingiga +4,150,000 soʻm</p>
  <span class="sh-medals row-medals">${codes.map((c) => medal(c, 26)).join('')}</span></div><span class="sh-money">56,450,000</span></div>`
}

function body() {
  const cells = ORDER.map(
    (c) => `<div class="sh-card podium-card"><div class="sh-big seat-medals">${medal(c, 64)}</div>
      <div class="sh-sizes"><span class="seat-medals" style="width:auto;margin:0">${medal(c, 40)}</span><span class="row-medals sh-one">${medal(c, 26)}</span></div>
      <p class="sh-title">${NAME[c]}</p><p class="sh-why">${WHY[c]}</p><p class="sh-tier">${TIER[c] || 'poʻlat · zarhal belgi'}</p></div>`,
  ).join('')
  const rows = [
    row(4, 'Umidovna 117 Bonu', 'Sevinch', ['work-month', 'day-winner', 'clean-month'], 59),
    row(5, 'Muxtoraliyevna 210 Zulfira', 'Sadriddin', ['first-sale', 'rookie', 'jump'], 55),
    row(6, 'Ashurova 123 Malika', 'Gulzora', ['streak-steady', 'day-record', 'month-gold'], 47),
    row(7, 'Saparboyeva 110 Farida', 'Sevinch', ['conversion-master', 'streak-fire', 'month-silver'], 46),
    row(8, 'Egamberdiyev 158 Elbek', 'Azizbek', ['day-winner', 'month-bronze', 'year-champion'], 41),
  ].join('')
  const seat = (codes, size, metal) => `<div class="podium-col--${metal}" style="flex:1"><div class="podium-card sh-seat"><p class="sh-tier" style="margin:0 0 8px">tokcha · ${size}px</p><div class="seat-medals">${codes.map(([c, n]) => medal(c, size, n)).join('')}</div></div></div>`
  return `<div class="sh">
    <h1 class="sh-h">Yangi medallar — 14 ta, tartib boʻyicha</h1>
    <p class="sh-sub">Har biri uch oʻlchamda: 64 · 40 (podium) · 26 (qator). Toʻliq metall disk — faqat oy/yil sovrinlari; oltin halqa — nodir; poʻlat halqa — kundalik.</p>
    <div class="sh-grid">${cells}</div>
    <div class="sh-two">
      <div class="sh-panel tv-col tv-col--sellers"><p class="sh-tier" style="margin:0 0 4px 8px">qator sirti · 26px</p>${rows}</div>
      <div class="sh-panel tv-col tv-col--sellers" style="display:flex;flex-direction:column;gap:14px;padding:16px">
        <div style="display:flex;gap:14px">${seat([['day-record'], ['clean-month'], ['day-winner', 4], ['month-gold', 12]], 40, 'gold')}${seat([['month-bronze', 2], ['day-winner', 12], ['work-month']], 36, 'bronze')}</div>
        <div style="display:flex;gap:14px">${seat([['year-champion'], ['month-gold', 3], ['streak-fire'], ['conversion-master', 2]], 40, 'gold')}${seat([['month-silver', 4], ['streak-steady'], ['rookie'], ['jump']], 36, 'silver')}</div>
      </div>
    </div>
  </div>`
}

const CSS = `
body{margin:0;background:var(--page);}
.sh{padding:28px 32px 36px;width:1600px;box-sizing:border-box;font-family:var(--font-inter),Inter,system-ui,sans-serif}
.sh-h{font-size:20px;font-weight:600;color:var(--ink-primary);margin:0 0 4px;letter-spacing:-.01em}
.sh-sub{font-size:13px;color:var(--ink-secondary);margin:0 0 18px}
.sh-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:14px}
.sh-card{--metal:var(--medal-silver);padding:18px 10px 12px;display:flex;flex-direction:column;align-items:center}
.sh-big{margin:0 !important;width:auto !important}
.sh-sizes{display:flex;align-items:center;gap:14px;margin-top:14px;height:40px}
.sh-one{width:26px !important;max-width:none !important;contain:none !important;display:block !important;overflow:visible !important}
.sh-one::before{display:none !important}
.sh-title{font-size:13.5px;font-weight:600;color:var(--ink-primary);margin:12px 0 0}
.sh-why{font-size:11.5px;color:var(--ink-secondary);margin:2px 0 0;text-align:center}
.sh-tier{font-size:10.5px;color:var(--ink-muted);margin:4px 0 0;letter-spacing:.04em;text-transform:uppercase}
.sh-two{display:grid;grid-template-columns:1.15fr 1fr;gap:18px;margin-top:18px}
.sh-panel{padding:12px 10px;border-width:1px;border-style:solid;border-radius:var(--radius-panel)}
.sh-row{display:flex;align-items:flex-start;gap:12px;padding:6.2px 8px;border-bottom:1px solid var(--grid)}
.sh-row:last-child{border-bottom:0}
.sh-rank{width:28px;text-align:right;color:var(--ink-muted);font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
.sh-cell{flex:1;display:grid;grid-template-columns:auto 1fr;align-items:center}
.sh-nameline{grid-area:1/1/2/-1;display:flex;gap:8px;align-items:center}
.sh-name{font-size:17px;font-weight:600;color:var(--ink-primary);letter-spacing:-.01em}
.sh-bar{grid-area:2/1/3/-1;height:4px;border-radius:9px;background:var(--track);max-width:calc(100% - 96px);width:260px;margin-top:4px;overflow:hidden}
.sh-bar i{display:block;height:100%;border-radius:9px;background:var(--seq-550)}
.sh-chase{grid-area:3/1/4/2;font-size:13px;font-weight:600;color:var(--ink-primary);margin:2px 0 0}
.sh-medals{grid-area:2/2/4/3;--row-medals-room:96px}
.sh-money{font-size:17px;font-weight:700;color:var(--ink-primary);font-variant-numeric:tabular-nums;width:130px;text-align:right}
.sh-seat{padding:12px 12px 16px;display:flex;flex-direction:column;align-items:center}
`

;(async () => {
  const browser = await chromium.launch()
  for (const theme of ['dark', 'light']) {
    const src = fs.readFileSync(OUT + `medals-month-${theme}-1920.html`, 'utf8')
    const head = src.slice(0, src.indexOf('<body'))
    const defs = /<svg class="medal-defs"[\s\S]*?<\/svg>/.exec(src)[0]
    const html = head.replace('</head>', `<style>${CSS}</style></head>`) + `<body>${defs}${body()}</body></html>`
    const file = OUT + `sheet-${theme}.html`
    fs.writeFileSync(file, html)
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await page.goto('file://' + file)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(300)
    const el = await page.$('.sh')
    await el.screenshot({ path: OUT + `sheet-${theme}.png` })
    await ctx.close()
  }
  await browser.close()
  console.log('sheets done')
})()
