import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The record wall's stylesheet facts (EFIR Premium spec §7), pinned the way
 * `theme.test.ts` pins the theme guard — nothing in TypeScript can see them
 * and every symptom they prevent is silent: a gold label, an amount that
 * truncates, a code that outlives the count, the width under which the wall
 * is not drawn, and the ABSENCE of the crawl it replaced.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** One declaration block by selector, without the rules that follow it. */
function ruleFor(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `${selector} is missing from globals.css`).toBeGreaterThan(-1)
  return CSS.slice(start, CSS.indexOf('}', start))
}

/** The record wall block, banner to the next section's banner. */
const WALL = (() => {
  const start = CSS.indexOf('* THE RECORD WALL')
  expect(start).toBeGreaterThan(-1)
  return CSS.slice(start, CSS.indexOf('/* ====', start))
})()

describe('the record wall, as the stylesheet defines it', () => {
  it('is a grid of two equal plaques, one when the header holds one', () => {
    expect(ruleFor('.record-wall')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/)
    expect(ruleFor('.record-wall')).toContain('gap: 12px')
    expect(ruleFor('.record-wall')).toContain('min-width: 0')
    expect(ruleFor('.record-wall[data-bands="1"]')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/)
  })

  it('draws each plaque 58px tall, radius 8, as its own inline-size container', () => {
    const plaque = ruleFor('.plaque')
    expect(plaque).toContain('height: 58px')
    expect(plaque).toContain('border-radius: 8px')
    expect(plaque).toContain('container-type: inline-size')
  })

  it('labels in neutral ink — the medal is the only metal', () => {
    expect(ruleFor('.plaque__k')).toContain('text-transform: uppercase')
    expect(WALL).not.toContain('--medal-')
    expect(CSS).not.toMatch(/\.record__k[^\n]*\{/)
  })

  it('never truncates the amount; drops the count under 400px, then the code under 320px', () => {
    const amount = ruleFor('.plaque__amount')
    expect(amount).toContain('flex: none')
    expect(amount).toContain('margin-left: auto')
    expect(amount).not.toMatch(/overflow|text-overflow/)
    expect(ruleFor('.plaque__v .nm')).toContain('text-overflow: ellipsis')
    expect(WALL).toMatch(/@container \(max-width: 400px\)\s*\{\s*\.plaque__count\s*\{\s*display: none;/)
    expect(WALL).toMatch(/@container \(max-width: 320px\)\s*\{\s*\.plaque__v \.code\s*\{\s*display: none;/)
  })

  it('colours only through tokens — no literal colour, no color-mix()', () => {
    const code = WALL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\s\S]*?\*\//, '')
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/\brgba?\(|\bhsla?\(/)
    expect(code).not.toContain('color-mix(')
  })

  it('is not drawn under 1280px, the same line the board itself draws', () => {
    expect(ruleFor('.record-wall')).toMatch(/display:\s*none/)
    const after = CSS.slice(CSS.indexOf('.record-wall {'))
    const media = after.slice(0, after.indexOf('.plaque {'))
    expect(media).toContain('@media (min-width: 1280px)')
    expect(media).toMatch(/\.record-wall\s*\{[^}]*display:\s*grid/)
  })

  it('does not crawl, mask or loop — nothing on this page moves at rest', () => {
    expect(CSS).not.toContain('@keyframes record-crawl')
    expect(CSS).not.toContain('.record-track')
    expect(CSS).not.toContain('--record-travel')
    expect(WALL).not.toContain('mask-image')
    expect(WALL).not.toContain('animation')
  })
})
