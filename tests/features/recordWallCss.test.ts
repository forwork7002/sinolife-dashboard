import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The record ticker's stylesheet facts, pinned the way `theme.test.ts` pins
 * the theme guard — because nothing in TypeScript can see them and every
 * symptom they prevent is silent.
 *
 * The strip crawls through the page header above the board. Four of the rules
 * that make it work live only in CSS: the metal it borrows from the podium,
 * the height that keeps it inside the title line, the breakpoint below which
 * it is not drawn at all, and the seamless-loop mechanism itself.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** One declaration block by selector, without the rules that follow it. */
function ruleFor(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `${selector} is missing from globals.css`).toBeGreaterThan(-1)
  return CSS.slice(start, CSS.indexOf('}', start))
}

describe('the record ticker, as the stylesheet defines it', () => {
  it('takes its metal from the same token the champion’s seat does', () => {
    /*
      Gold on the month is the one thing tying the strip to the podium below
      at a glance. It is chrome and never a value: the PODIUM block licenses
      metal to carry elevation and tint only, so a running month may not be
      given a different metal — the WORD «Yetakchi» carries that instead.
    */
    expect(ruleFor('.record-wall')).toContain('--metal: var(--medal-gold)')
    expect(ruleFor('.record-month')).toContain('color: var(--metal)')
  })

  it('is bounded to the title block’s height, so it cannot grow the header', () => {
    // Measured before the bound existed: the title block is 59px and an
    // earlier plaque was 88, so the strip set the header's height and
    // everything else in the row sat in space it had claimed.
    expect(ruleFor('.record-wall')).toMatch(/height:\s*59px/)
  })

  it('is not drawn under 1280px, the same line the board itself draws', () => {
    // Under 1280 this page stops being a television — the columns stack and
    // the tv-switch appears. A crawl on a phone is moving text in the
    // tightest part of the page, which is a cost with no reader.
    expect(ruleFor('.record-wall')).toMatch(/display:\s*none/)

    const after = CSS.slice(CSS.indexOf('.record-wall {'))
    const media = after.slice(0, after.indexOf('.record-track {'))
    expect(media).toContain('@media (min-width: 1280px)')
    expect(media).toMatch(/\.record-wall\s*\{[^}]*display:\s*flex/)
  })

  it('loops by sliding exactly one copy of the run', () => {
    /*
      THE SEAM IS THE WHOLE MECHANISM. The component renders the list twice
      and this animation travels one copy's width, so at the instant it
      restarts the second copy is sitting where the first began. Travelling
      any other distance puts a visible jump in a strip that never stops.
    */
    const frames = CSS.slice(CSS.indexOf('@keyframes record-crawl'))
    const block = frames.slice(0, frames.indexOf('\n}\n') + 2)
    expect(block).toContain('var(--record-travel)')
    expect(block).toMatch(/translate3d\(calc\(-1 \* var\(--record-travel\)\)/)

    expect(ruleFor('.record-track--crawling')).toContain('animation-timing-function: linear')
    expect(ruleFor('.record-track--crawling')).toContain('animation-iteration-count: infinite')
  })

  it('fades at both ends instead of cutting the text off', () => {
    // A crawl that vanishes at a hard edge reads as text being clipped.
    expect(ruleFor('.record-wall')).toContain('mask-image')
  })

  it('stops under a hand, and under a reduced-motion preference', () => {
    expect(CSS).toMatch(/\.record-wall:hover \.record-track--crawling/)
    expect(CSS).toMatch(/animation-play-state:\s*paused/)

    // Reduced motion must leave the months REACHABLE, not merely frozen —
    // a stopped crawl shows whatever happened to fit and hides the rest.
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)', CSS.indexOf('.record-wall {')))
    expect(reduced.slice(0, 400)).toContain('overflow-x: auto')
  })
})
