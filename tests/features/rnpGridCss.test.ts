import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The «RNP» grid's stacking and focus rules, pinned the way
 * `recordWallCss.test.ts` pins the ticker's — jsdom lays nothing out, and
 * every symptom these prevent is silent: a label column covered by figures,
 * a refusal nobody can read, a focus ring nobody sees (2026-10-02).
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** One declaration block by selector, and where it sits in the file. */
function ruleFor(selector: string): { body: string; at: number } {
  const at = CSS.indexOf(`${selector} {`)
  expect(at, `${selector} is missing from globals.css`).toBeGreaterThan(-1)
  return { body: CSS.slice(at, CSS.indexOf('}', at)), at }
}

describe('the RNP grid, as the stylesheet stacks it', () => {
  it('lets the unpinned summary pass UNDER the frozen label on a narrow box, its header under the corner', () => {
    expect(ruleFor('[data-rnp-grid]:not([data-pin-wide]) td.rnp-pin').body).toMatch(/z-index:\s*0;/)
    expect(ruleFor('[data-rnp-grid]:not([data-pin-wide]) th.rnp-pin').body).toMatch(/z-index:\s*2;/)
    // The corner (sticky both ways) stays above both.
    expect(ruleFor('.thead-sticky.tcol-sticky').body).toMatch(/z-index:\s*3;/)
  })

  it('lifts a typed cell that holds a refusal over the rows below — after the narrow rule, so it wins there too', () => {
    const lift = ruleFor('[data-rnp-grid] td[data-cost-cell]:has([role="alert"])')
    expect(lift.body).toMatch(/z-index:\s*2;/)
    // Same specificity as the narrow rule: only the order decides.
    expect(lift.at).toBeGreaterThan(ruleFor('[data-rnp-grid]:not([data-pin-wide]) td.rnp-pin').at)
  })

  it('draws the grid’s keyboard ring on its card, which would clip the box’s own', () => {
    const ring = ruleFor('[data-rnp-cols] div:has(> [data-rnp-grid]:focus-visible)').body
    expect(ring).toContain('outline: 2px solid var(--accent)')
    expect(ring).toContain('outline-offset: 2px')
  })
})
