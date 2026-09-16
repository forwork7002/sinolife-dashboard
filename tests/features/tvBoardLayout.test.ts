import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * THE BOARD'S TWO LAYOUTS SWITCH ON ONE WIDTH, AND NOTHING IN TYPESCRIPT CAN
 * SEE IT. `/sellers` is two columns from 1280px — 60 / 40, each a
 * viewport-high card whose ROWS scroll inside it — and one column at a time
 * below it. The label strip above the rows is a sibling of the scroll box,
 * never inside it, so the fourth rank is never hidden under a sticky header.
 */

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')

/** The width of the `@media (min-width: <px>)` block that encloses `selector`, or null. */
function queryFor(selector: string): number | null {
  const at = css.indexOf(selector)
  if (at < 0) return null
  const before = css.slice(0, at)
  const opens = [...before.matchAll(/@media\s*\(min-width:\s*(\d+)px\)\s*\{/g)]
  if (opens.length === 0) return null
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
  it('turns the board into two columns — 60 / 40 — from 1280px', () => {
    expect(queryFor('.tv-board {\n    display: grid')).toBe(1280)
    expect(css).toMatch(/\.tv-board \{\s*display: grid;\s*grid-template-columns: minmax\(0, 60fr\) minmax\(0, 40fr\);/)
  })

  it('gives the page its viewport-height column on the same query', () => {
    expect(queryFor('.tv-board-shell {')).toBe(1280)
  })

  it('draws the switch and parks a column on the same width', () => {
    expect(css).toMatch(/@media \(min-width: 1280px\) \{\s*\.tv-switch \{\s*display: none;/)
    expect(css).toMatch(/@media \(max-width: 1279px\) \{\s*\.tv-col--parked \{\s*display: none;/)
  })

  it('makes ONLY the rows a scroll box, from the two-column width — the label strip stays put', () => {
    expect(queryFor('.tv-rows {\n    overflow: auto')).toBe(1280)
    expect(queryFor('.tv-trows {\n    overflow: auto')).toBe(1280)
    expect(css).not.toMatch(/\.tv-cols \{[^}]*overflow: auto/)
    expect(css).not.toMatch(/^\.tv-list \{/m)
    expect(css).not.toContain('.tv-table')
  })

  it('wears no column tone, no pedestal and no podium chrome any more', () => {
    for (const gone of [
      '--tv-tone', '.tv-pedestal', '.podium-card', '.podium-col--', '.medal-ring', '.chase-chip', '.rank-row',
      '.tv-seat-card', '.tv-chase', '.tv-namecell', '.lavha', '.narvon', '.lv-block', '.medal-rail', '.medal-speak',
      '.tv-col-optional', '.tv-col-glyph',
    ]) {
      expect(css, gone).not.toContain(gone)
    }
  })

  it('steps the television scale down under 1600', () => {
    expect(css).toMatch(/@media \(max-width: 1599px\) \{\s*:root \{\s*--tv-xl: 36px;/)
  })

  it('lights the pressed fact in ink, never in a hue', () => {
    expect(css).toMatch(/\.tv-fakt-tab\[aria-pressed='true'\] \{\s*background: var\(--ink-primary\);\s*color: var\(--surface\);/)
  })
})
