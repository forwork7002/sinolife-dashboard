import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The record wall's stylesheet facts, pinned the way `theme.test.ts` pins the
 * theme guard — because nothing in TypeScript can see them and every symptom
 * they prevent is silent.
 *
 * The strip is drawn in the page header, above the board, and it borrows the
 * podium's ceremony language so it reads as part of the screen rather than a
 * box placed on top of it. Three of the rules that make that true live only in
 * CSS: the metal it inherits, the height that keeps it inside the title line,
 * and the breakpoint below which it is not drawn at all.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** The `.record-wall` declaration block, without the media query below it. */
const block = (() => {
  const start = CSS.indexOf('.record-wall {')
  expect(start, '.record-wall rule is missing from globals.css').toBeGreaterThan(-1)
  return CSS.slice(start, CSS.indexOf('}', start))
})()

const plaque = (() => {
  const start = CSS.indexOf('.record-plaque {')
  expect(start, '.record-plaque rule is missing from globals.css').toBeGreaterThan(-1)
  return CSS.slice(start, CSS.indexOf('}', start))
})()

describe('the record wall, as the stylesheet defines it', () => {
  it('takes its metal from the same token the champion’s seat does', () => {
    /*
      Gold is what ties the strip to the podium below it at a glance. It is
      also chrome and never a value: the PODIUM block licenses metal to carry
      elevation and tint only, so a running month may not be given a different
      metal — the WORD «Yetakchi» carries that distinction instead.
    */
    expect(block).toContain('--metal: var(--medal-gold)')
  })

  it('is bounded to the title block’s height, so it cannot grow the header', () => {
    // Measured before the bound existed: the title block is 59px and the
    // plaque was 88, so the strip set the header's height and everything else
    // in the row sat in space it had claimed.
    expect(plaque).toMatch(/height:\s*59px/)
  })

  it('is not drawn under 1280px, the same line the board itself draws', () => {
    // Under 1280 this page stops being a television — the columns stack and
    // the tv-switch appears. At 390px the plaque collapsed to 128px with the
    // seller's name entirely truncated: a gold box saying nothing.
    expect(block).toMatch(/display:\s*none/)

    const shown = CSS.slice(CSS.indexOf('.record-wall {'))
    const media = shown.slice(0, shown.indexOf('.record-plaque {'))
    expect(media).toContain('@media (min-width: 1280px)')
    expect(media).toMatch(/\.record-wall\s*\{\s*display:\s*block/)
  })

  it('clips the ghost numeral itself rather than letting the header do it', () => {
    // The numeral is absolutely positioned and taller than the strip; without
    // these two the bleed escapes the plaque and lands in the header.
    expect(plaque).toMatch(/position:\s*relative/)
    expect(plaque).toMatch(/overflow:\s*hidden/)
  })
})
