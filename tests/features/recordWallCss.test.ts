import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The record wall's stylesheet facts, pinned the way `theme.test.ts` pins
 * the theme guard — nothing in TypeScript can see them and every symptom
 * they prevent is silent: the metal on the label, the width under which the
 * wall is not drawn, and the ABSENCE of the crawl it replaced.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** One declaration block by selector, without the rules that follow it. */
function ruleFor(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `${selector} is missing from globals.css`).toBeGreaterThan(-1)
  return CSS.slice(start, CSS.indexOf('}', start))
}

describe('the record wall, as the stylesheet defines it', () => {
  it('takes its metal from the same token the champion’s halo does — on the label only', () => {
    expect(ruleFor('.record__k')).toContain('color: var(--medal-gold)')
    expect(ruleFor('.record__n,\n.record__v')).not.toContain('--medal-')
    expect(ruleFor('.record__note')).not.toContain('--medal-')
  })

  it('is not drawn under 1280px, the same line the board itself draws', () => {
    expect(ruleFor('.record-wall')).toMatch(/display:\s*none/)
    const after = CSS.slice(CSS.indexOf('.record-wall {'))
    const media = after.slice(0, after.indexOf('.record {'))
    expect(media).toContain('@media (min-width: 1280px)')
    expect(media).toMatch(/\.record-wall\s*\{[^}]*display:\s*flex/)
  })

  it('does not crawl, mask or loop — nothing on this page moves at rest', () => {
    expect(CSS).not.toContain('@keyframes record-crawl')
    expect(CSS).not.toContain('.record-track')
    expect(CSS).not.toContain('--record-travel')
    expect(ruleFor('.record-wall')).not.toContain('mask-image')
    expect(ruleFor('.record-wall')).not.toContain('animation')
  })

  it('separates the two bands with a hairline, never a box', () => {
    expect(ruleFor('.record + .record')).toContain('border-left: 1px solid var(--border-strong)')
    expect(ruleFor('.record-wall')).not.toMatch(/background:/)
  })

  it('reads the television scale rather than a ramp of its own', () => {
    expect(ruleFor('.record-wall')).toContain('font-size: var(--tv-m)')
    expect(ruleFor('.record__k')).toContain('font-size: var(--tv-s)')
    expect(CSS).not.toContain('--record-name')
  })
})
