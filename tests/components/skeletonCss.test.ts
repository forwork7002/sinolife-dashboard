import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A skeleton takes the radius its call site asks for.
 *
 * `globals.css` is unlayered and Tailwind's utilities are layered, and an
 * unlayered declaration beats any layered one whatever the specificity. So
 * `.skeleton { border-radius }` won over `rounded-full`: the ring placeholders
 * (StatTile's 68px gauge, Yalpi marja's 116px one) drew as rounded squares and
 * popped into circles when the data arrived. The radius is now a default in
 * `@layer components`, which sits under `utilities`.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** Every top-level block: its prelude and its body, at-rules included. */
function blocks(css: string): { prelude: string; body: string }[] {
  const out: { prelude: string; body: string }[] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let j = open + 1
    while (depth > 0 && j < css.length) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    out.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1) })
    i = j
  }
  return out
}

const skeletonRadius = /(?:^|[\s,}])\.skeleton\s*\{[^}]*border-radius\s*:/

describe('the skeleton radius', () => {
  it('is never declared unlayered, where it would beat a call site’s rounded-*', () => {
    const unlayered = blocks(CSS).filter((b) => !b.prelude.startsWith('@') && b.prelude.split(',').some((s) => s.trim() === '.skeleton'))
    expect(unlayered.length).toBeGreaterThan(0)
    for (const block of unlayered) expect(block.body).not.toMatch(/border-radius\s*:/)
  })

  it('is the house default inside @layer components', () => {
    const layered = blocks(CSS).filter((b) => b.prelude === '@layer components')
    expect(layered.some((b) => skeletonRadius.test(b.body) && b.body.includes('var(--radius-panel-sm)'))).toBe(true)
  })

  it('is asked for as a circle by the two ring placeholders', () => {
    for (const file of ['src/components/ui/Stat.tsx', 'src/features/margin/MarginPage.tsx']) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, file).toMatch(/className="skeleton [^"]*rounded-full/)
    }
  })
})
