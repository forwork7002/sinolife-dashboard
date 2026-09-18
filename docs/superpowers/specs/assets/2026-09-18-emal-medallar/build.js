/*
 * FINAL build.
 *   node build.js medals   → out/medals-<snap>.{html,png} + out/medals-crop-{podium,rows}-{dark,light}.png
 *   node build.js full     → out/full-<snap>.{html,png}   + out/full-crop-…            (medals + the kept polish items)
 *   node build.js          → both
 * Pages are opened as file://, fonts awaited, dpr 1 for full pages and 3 for crops.
 */
const { fs, HERE, BASE, OUT, SNAPS, injectMedals, chromium } = require('./lib.js')
require('./gen-defs.js')
require('./gen-css.js')

const which = process.argv[2] ? [process.argv[2]] : ['base', 'medals', 'full']
const polishCss = () => fs.readFileSync(HERE + 'polish.css', 'utf8')
const post = () => fs.readFileSync(HERE + 'postprocess.js', 'utf8')

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  for (const variant of which) {
    for (const s of SNAPS) {
      if (variant === 'base') continue // crops only — the frozen page itself is the reference
      let html = injectMedals(fs.readFileSync(BASE + s.name + '.html', 'utf8'))
      const file = OUT + `${variant}-${s.name}.html`
      fs.writeFileSync(file, html)
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      const page = await ctx.newPage()
      await page.goto('file://' + file)
      await page.evaluate(() => document.fonts.ready)
      if (variant === 'full') {
        await page.evaluate(([c]) => { document.getElementById('variant-css').textContent += '\n' + c }, [polishCss()])
        const n = await page.evaluate(post())
        if (s.name === 'month-dark-1920') console.log('icons placed:', n)
        html = '<!DOCTYPE html>\n' + (await page.evaluate(() => document.documentElement.outerHTML))
        fs.writeFileSync(file, html)
        await page.goto('file://' + file)
        await page.evaluate(() => document.fonts.ready)
      }
      await page.waitForTimeout(400)
      await page.screenshot({ path: OUT + `${variant}-${s.name}.png` })
      await ctx.close()
    }
    for (const [theme, name] of [['dark', 'month-dark-1920'], ['light', 'month-light-1920'], ['today', 'today-dark-1920']]) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 3, reducedMotion: 'reduce' })
      const page = await ctx.newPage()
      await page.goto('file://' + (variant === 'base' ? BASE + name + '.html' : OUT + `${variant}-${name}.html`))
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(400)
      const boxes = await page.evaluate(() => {
        const col = document.querySelector('#tv-sellers') || document.querySelector('.tv-col')
        const pod = col.querySelector('.tv-podium').getBoundingClientRect()
        const list = col.querySelector('.tv-list').getBoundingClientRect()
        const c = col.getBoundingClientRect()
        return { pod: { x: c.x, y: pod.y - 36, w: c.width, h: pod.height + 40 }, rows: { x: c.x, y: list.y - 2, w: c.width, h: Math.min(list.bottom, c.bottom) - list.y + 2 } }
      })
      const clip = (b) => ({ x: Math.max(0, b.x), y: Math.max(0, b.y), width: b.w, height: Math.min(b.h, 1080 - b.y) })
      await page.screenshot({ path: OUT + `${variant}-crop-podium-${theme}.png`, clip: clip(boxes.pod) })
      await page.screenshot({ path: OUT + `${variant}-crop-rows-${theme}.png`, clip: clip(boxes.rows) })
      await ctx.close()
    }
  }
  await browser.close()
  console.log('built', which.join(' + '))
})()
