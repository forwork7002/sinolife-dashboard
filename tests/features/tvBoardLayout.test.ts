import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * THE BOARD'S TWO LAYOUTS SWITCH ON ONE WIDTH, AND NOTHING IN TYPESCRIPT CAN
 * SEE IT.
 *
 * `/sellers` is two columns of three seats from 1280px — a 720p television or
 * a zoomed one, the narrowest width the client's «chap tarafda sotuvchilar,
 * oʻng tomonda komandalar» can still be drawn at — and one column at a time
 * below it. It holds there on TYPE: a seat is 145px at 1280 and the house
 * 17px sum «126,950,000 soʻm» needs 134px inside 119px of card, so the seat
 * type steps down over the narrow band and the two least-read table columns
 * are dropped rather than pushed behind a scrollbar no television can move.
 *
 * TWO RULES LIVE ON THAT ONE QUERY and they are in different files' idioms —
 * the grid in `globals.css`, the page's own viewport-height column reached
 * from a class the page puts on itself. This pins them to the same query.
 * The failure it prevents is silent: with the page column switching at
 * Tailwind's `lg` (1024) and the grid at 1600, a 1366 laptop got a
 * viewport-height wrapper around a board that no longer scrolled inside it.
 */

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')

/** The body of the first `@media (min-width: <px>)` block naming a selector. */
function queryFor(selector: string): number | null {
  const at = css.indexOf(selector)
  if (at < 0) return null
  const before = css.slice(0, at)
  const opens = [...before.matchAll(/@media\s*\(min-width:\s*(\d+)px\)\s*\{/g)]
  if (opens.length === 0) return null
  // The nearest opening query that has not been closed before `selector`.
  const last = opens[opens.length - 1]!
  const between = before.slice(last.index! + last[0].length)
  let depth = 1
  for (const ch of between) {
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    if (depth === 0) return null
  }
  return Number(last[1])
}

describe('the television board switches layout on one width', () => {
  it('turns the board into two columns from 1280px', () => {
    expect(queryFor('.tv-board {\n    display: grid')).toBe(1280)
  })

  it('gives the page its viewport-height column on the same query', () => {
    expect(queryFor('.tv-board-shell {')).toBe(1280)
  })

  /*
    The band exists so the two columns survive a 1280px television. If its
    upper bound ever drifted past the width where the seat type returns to
    the house size, the seats would spill sideways again — silently, since
    nothing clips them.
  */
  it('steps the seat type down over the narrow two-column band only', () => {
    expect(css).toMatch(
      /@media \(min-width: 1280px\) and \(max-width: 1599px\) \{[\s\S]*?--tv-seat-figure: clamp\(13px/,
    )
    expect(css).toMatch(
      /@media \(min-width: 1280px\) and \(max-width: 1599px\) \{[\s\S]*?\.tv-col-optional \{\s*display: none;/,
    )
  })

  it('seats the champion across the top of a phone, the other two beneath', () => {
    // The seats are placed by class rather than an inline style precisely so
    // these rules can win; an inline `grid-column` would beat any media query.
    const phone = css.slice(css.indexOf('@media (max-width: 639px)'))
    expect(phone).toMatch(/\.tv-seat--1 \{\s*grid-row: 1;\s*grid-column: 1 \/ -1;/)
    expect(phone).toMatch(/\.tv-seat--2 \{\s*grid-row: 2;\s*grid-column: 1;/)
    expect(phone).toMatch(/\.tv-seat--3 \{\s*grid-row: 2;\s*grid-column: 2;/)
  })

  /*
    The two boards are told apart by colour on the frame and the heading —
    two categorical hues, one each — and the rule that puts the hue there
    must never reach a figure. Pinned as tokens: if either column lost its
    own `--tv-tone`, both would fall back to the sellers' pink and the halves
    would read as one board again.
  */
  it('gives the sellers and the teams columns two different tones', () => {
    const sellers = css.match(/\.tv-col--sellers \{ --tv-tone: (var\(--series-\d\)); \}/)
    const teams = css.match(/\.tv-col--teams \{ --tv-tone: (var\(--series-\d\)); \}/)
    expect(sellers?.[1]).toBeDefined()
    expect(teams?.[1]).toBeDefined()
    expect(sellers?.[1]).not.toBe(teams?.[1])
  })

  it('steps the pedestals 1 : 1.6 : 2.4 with bronze as the unit', () => {
    expect(css).toMatch(/\.tv-seat--1 \{ --tv-pedestal: calc\(var\(--tv-step\) \* 2\.4\); \}/)
    expect(css).toMatch(/\.tv-seat--2 \{ --tv-pedestal: calc\(var\(--tv-step\) \* 1\.6\); \}/)
  })

  /*
    Under 1280 a phone sees one board through a switch; the switch must be
    gone exactly where both boards are on screen, and a parked column must
    be hidden exactly where the switch is drawn — one width for both, or a
    desktop reader loses a column to state they cannot see.
  */
  it('draws the switch and parks a column on the same width', () => {
    expect(css).toMatch(/@media \(min-width: 1280px\) \{\s*\.tv-switch \{\s*display: none;/)
    expect(css).toMatch(/@media \(max-width: 1279px\) \{\s*\.tv-col--parked \{\s*display: none;/)
  })

  it('makes the list a two-axis scroll box only from the two-column width', () => {
    expect(queryFor('.tv-list {\n    overflow: auto')).toBe(1280)
    expect(css).not.toMatch(/^\.tv-list \{[^}]*overscroll-behavior/m)
  })

  /*
    Under 1280 the list scrolls sideways so every column stays reachable on
    a phone — and contains ONLY that axis. The shorthand `overscroll-behavior:
    contain` contains both, and a box that cannot scroll vertically is always
    at its vertical edge, so a thumb swiping down on it never reaches the
    page. That is the bug this test exists to keep out.
  */
  it('scrolls the phone list sideways without swallowing the page scroll', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1279px) {\n  .tv-list {'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(block).toMatch(/\.tv-list \{\s*overflow-x: auto;\s*overscroll-behavior-x: contain;\s*\}/)
    expect(block).not.toMatch(/overscroll-behavior: contain/)
    expect(block).not.toMatch(/overscroll-behavior-y/)
    // And the name stays on screen while the sums slide under it.
    expect(block).toMatch(/\.tv-row > td:nth-child\(2\) \{\s*position: sticky;\s*left: 40px;/)
  })

  it('lets a seat chase pill wrap rather than leave the card', () => {
    expect(css).toMatch(/\.tv-seat-card \.chase-chip \{[\s\S]*?flex-wrap: wrap;/)
  })
})
