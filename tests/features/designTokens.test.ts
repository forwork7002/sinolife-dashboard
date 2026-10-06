import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The design system, read the way the browser reads it: as `globals.css`.
 *
 * Nothing in TypeScript can see a token, a keyframe or a theme block, and
 * every failure pinned here is silent on screen — an animation nothing runs
 * ships on every page, a token one dark block forgot paints the light value at
 * night for half the readers, a colour pair below its floor still renders.
 */

/** The stylesheet with its comments taken out: a name quoted in prose is not a rule. */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** `name` as a whole CSS identifier — `pulse` must not be found inside `palette-busy-pulse`. */
const ident = (name: string) => `(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`

describe('the stylesheet ships no animation that nothing runs', () => {
  /*
    `@keyframes pulse` outlived the header dot that used it by five weeks and
    `@keyframes draw` the sparkline by one, each still in the built CSS of
    every page. An animation is only ever started by an `animation` (or
    `animation-name`) declaration, and every one of them lives in this file.
  */
  it('names every @keyframes in an animation declaration', () => {
    const names = [...new Set([...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!))]
    expect(names.length).toBeGreaterThan(10)
    for (const name of names) {
      expect(CSS, name).toMatch(new RegExp(`animation(?:-name)?\\s*:[^;{}]*${ident(name)}`))
    }
  })
})
