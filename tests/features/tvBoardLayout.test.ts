import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * THE BOARD'S TWO LAYOUTS SWITCH ON ONE WIDTH, AND NOTHING IN TYPESCRIPT CAN
 * SEE IT.
 *
 * `/sellers` is two columns of three seats on the floor's television and one
 * column at a time on anything smaller, because a seat is a third of half the
 * content width and the figures in it are full-digit sums that may not wrap:
 * 145px per seat at 1280 against a «🎯 Liderga +108,000,000» pill of about
 * 160px, which left the card sideways and overlapped the next seat. Stacked,
 * the same seat is 344px at 1366.
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
  it('turns the board into two columns only from 1600px', () => {
    expect(queryFor('.tv-board {\n    display: grid')).toBe(1600)
  })

  it('gives the page its viewport-height column on the same query', () => {
    expect(queryFor('.tv-board-shell {')).toBe(1600)
  })

  it('keeps the seats stacked on a phone', () => {
    // The seats are placed by class rather than an inline style precisely so
    // this rule can win; an inline `grid-column` would beat any media query.
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*?\.tv-seat \{\s*grid-row: auto;\s*grid-column: 1;/)
  })

  it('lets a seat chase pill wrap rather than leave the card', () => {
    expect(css).toMatch(/\.tv-seat-card \.chase-chip \{[\s\S]*?flex-wrap: wrap;/)
  })
})
