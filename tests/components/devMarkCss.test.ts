import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * «developed by Yusuf» in the top-right corner of every table card.
 *
 * One CSS rule draws it on every `.card` / `.card-hero` holding a table; the
 * two `.brackets` cards (whose pseudos are the corners) carry `<DevMark />`
 * instead. Pinned here because nothing in TypeScript can see a pseudo's
 * content, and losing the `:not(.brackets)` would overwrite a bracket corner.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const CSS = read('src/app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('developer mark', () => {
  it('is drawn on every table card except the bracketed ones', () => {
    expect(CSS).toMatch(
      /:is\(\.card, \.card-hero\):not\(\.brackets\):has\(table\)::after \{\s*content: "developed by Yusuf" \/ "";/,
    )
  })

  it('makes the table card its containing block under the utilities layer', () => {
    expect(CSS).toMatch(
      /@layer components \{\s*:is\(\.card, \.card-hero\):not\(\.brackets\):has\(table\) \{\s*position: relative;/,
    )
  })

  it('is placed on both bracketed table cards by hand', () => {
    expect(read('src/features/confirmation/ConfirmationPage.tsx')).toContain('<DevMark />')
    expect(read('src/features/cohort/CohortPage.tsx')).toContain('<DevMark />')
  })
})
