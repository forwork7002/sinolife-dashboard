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

const TARGETS = ':is(.card-hero, .card:has(table), .card:has(> header)):not(.no-dev-mark, .no-dev-mark *)'
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('developer mark', () => {
  it('is drawn on hero, table and chart cards', () => {
    expect(CSS).toContain(`${TARGETS}::after {\n  content: "developed by Yusuf" / "";`)
  })

  it('is off where the client said so, and moved where the corner is taken', () => {
    for (const page of ['sellers/SellersPage', 'roistat/RoistatPage', 'target/TargetPage', 'reklama/ReklamaPage']) {
      expect(read(`src/features/${page}.tsx`)).toContain('devMark={false}')
    }
    const confirmation = read('src/features/confirmation/ConfirmationPage.tsx')
    expect(confirmation).toContain('card-hero brackets no-dev-mark')
    expect(confirmation).toContain('aside={<DevMark')
    const rnp = read('src/features/rnp/RnpPage.tsx')
    expect(rnp).toContain('<DevMark />')
    expect(rnp).toContain('className="no-dev-mark')
  })

  it('makes those cards its containing block under the utilities layer', () => {
    expect(CSS).toMatch(/@layer components \{\s*:is\(\.card-hero, \.card:has\(table\), \.card:has\(> header\)\) \{\s*position: relative;/)
  })

  it('leaves ::after free on the bracketed hero bands', () => {
    expect(CSS).toContain('.brackets::before {')
    expect(CSS).not.toMatch(/\.brackets::after/)
  })
})
