/*
 * Two probes the judges asked for:
 *  1. the medals no production row carries tonight (year-champion, streak-fire, streak-steady, jump, rookie, + month-gold,
 *     conversion-master, first-sale) on REAL rows and REAL seats of the frozen page, dark and light, dpr 1 + 3x crops;
 *  2. the THIRD theme block: data-theme removed + prefers-color-scheme: dark must paint the same medals as [data-theme="dark"].
 */
const { fs, OUT, BODY, chip, chromium } = require('./lib.js')

const mark = (code, size, count) =>
  `<svg class="medal-mark" data-medal="${code}" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-label="${code}"><use href="#m-${code}"></use>${count ? chip(count, BODY[code] || 'steel') : ''}</svg>`

const ROWS = [['streak-steady', 'streak-fire', 'year-champion'], ['rookie', 'jump', 'month-gold'], ['first-sale', 'work-month', 'conversion-master'], ['day-winner', 'clean-month', 'day-record'], ['jump', 'streak-steady', 'month-bronze']]
const SEATS = { 1: [['year-champion'], ['month-gold', 3], ['streak-fire'], ['conversion-master', 2]], 2: [['month-silver', 12], ['streak-steady'], ['rookie']], 3: [['day-record'], ['jump'], ['first-sale']] }

;(async () => {
  const b = await chromium.launch()
  for (const theme of ['dark', 'light']) {
    for (const dpr of [1, 3]) {
      const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr, reducedMotion: 'reduce' })
      const p = await ctx.newPage()
      await p.goto('file://' + OUT + `medals-month-${theme}-1920.html`); await p.evaluate(() => document.fonts.ready)
      const rowsHtml = ROWS.map((r) => r.map((c) => mark(c, 26)).join(''))
      const seatsHtml = Object.fromEntries(Object.entries(SEATS).map(([k, v]) => [k, v]))
      const before = await p.evaluate(() => [document.querySelector('#tv-sellers .tv-podium').getBoundingClientRect().height, ...[...document.querySelectorAll('#tv-sellers .tv-row')].slice(0, 5).map((r) => r.getBoundingClientRect().height)])
      await p.evaluate(([rowsHtml]) => { [...document.querySelectorAll('#tv-sellers .row-medals')].slice(0, 5).forEach((h, i) => { h.innerHTML = rowsHtml[i] }) }, [rowsHtml])
      for (const [k, list] of Object.entries(seatsHtml)) {
        const size = k === '1' ? 40 : 36
        await p.evaluate(([k, html]) => { const s = document.querySelector(`#tv-sellers .tv-seat--${k} .seat-medals`); if (s) s.innerHTML = html }, [k, list.map(([c, n]) => mark(c, size, n)).join('')])
      }
      const after = await p.evaluate(() => [document.querySelector('#tv-sellers .tv-podium').getBoundingClientRect().height, ...[...document.querySelectorAll('#tv-sellers .tv-row')].slice(0, 5).map((r) => r.getBoundingClientRect().height)])
      if (dpr === 1) { console.log(theme, 'podium+rows heights same with the unseen medals:', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after)); await p.screenshot({ path: OUT + `probe-unseen-${theme}.png` }) }
      else {
        const box = await p.evaluate(() => { const c = document.querySelector('#tv-sellers').getBoundingClientRect(); return { x: c.x, y: c.y + 40, width: c.width, height: 1080 - c.y - 40 - 50 } })
        await p.screenshot({ path: OUT + `probe-unseen-${theme}-3x.png`, clip: box })
      }
      await ctx.close()
    }
  }
  // 2. third theme block
  const shots = {}
  for (const mode of ['attr', 'media']) {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'dark' })
    const p = await ctx.newPage()
    await p.goto('file://' + OUT + 'medals-month-dark-1920.html'); await p.evaluate(() => document.fonts.ready)
    if (mode === 'media') await p.evaluate(() => document.documentElement.removeAttribute('data-theme'))
    await p.waitForTimeout(200)
    shots[mode] = await p.evaluate(() => { const cs = getComputedStyle(document.documentElement); return ['--emal-gold', '--emal-steel', '--emal-field-a', '--emal-gilt-d', '--emal-silver-f2', '--emal-glow-bronze', '--surface-raised'].map((k) => k + '=' + cs.getPropertyValue(k).trim()).join(' ') })
    const clip = await p.evaluate(() => { const r = document.querySelector('#tv-sellers .tv-podium').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
    shots[mode + 'png'] = (await p.screenshot({ clip })).toString('base64')
    await ctx.close()
  }
  console.log('third block tokens equal:', shots.attr === shots.media, '| podium pixels equal:', shots.attrpng === shots.mediapng)
  console.log(shots.media)
  await b.close()
})()
