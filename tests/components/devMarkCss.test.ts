import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * «developed by Yusuf» in the top-right corner of every hero band, table card
 * and titled chart card.
 *
 * One ::after rule draws it. `.brackets` — on most hero bands — used to own
 * both pseudos for its two corners; it now paints both from ::before, and a
 * second `.brackets::after` would overwrite the mark on every hero. Pinned
 * here because nothing in TypeScript can see a pseudo's content.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

const TARGETS = ':is(.card-hero, .card:has(table), .card:has(> header))'

describe('developer mark', () => {
  it('is drawn on hero, table and chart cards', () => {
    expect(CSS).toContain(`${TARGETS}::after {\n  content: "developed by Yusuf" / "";`)
  })

  it('makes those cards its containing block under the utilities layer', () => {
    expect(CSS).toMatch(/@layer components \{\s*:is\(\.card-hero, \.card:has\(table\), \.card:has\(> header\)\) \{\s*position: relative;/)
  })

  it('leaves ::after free on the bracketed hero bands', () => {
    expect(CSS).toContain('.brackets::before {')
    expect(CSS).not.toMatch(/\.brackets::after/)
  })
})
