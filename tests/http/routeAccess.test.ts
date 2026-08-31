import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SECTION_IDS } from '@/lib/sections'

/**
 * Every endpoint declares who reaches it — checked by reading the routes.
 *
 * `getHandler` takes an `Access` with a required `section`, so TypeScript
 * already refuses a handler that omits it. What TypeScript cannot see is a
 * route that goes around the wrapper: two of them hand-roll their response and
 * call `requirePermission` directly, and a third could be added tomorrow by
 * copying one of those two. That is exactly the path by which an unguarded
 * endpoint ships.
 *
 * So this reads the files. It is a blunt instrument on purpose — it does not
 * parse, it looks for the decision being made — and its value is that the
 * omission fails here rather than in production, where the symptom is data
 * reaching somebody it was never granted to.
 */

const API_ROOT = join(process.cwd(), 'src/app/api/v1')

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return routeFiles(path)
    return entry === 'route.ts' ? [path] : []
  })
}

const routes = routeFiles(API_ROOT).map((path) => ({
  path,
  relative: path.slice(process.cwd().length + 1),
  source: readFileSync(path, 'utf8'),
}))

describe('every v1 endpoint declares its access', () => {
  it('finds the routes at all', () => {
    // A glob that silently matches nothing would make every case below pass.
    expect(routes.length).toBeGreaterThan(20)
  })

  it.each(routes.map((r) => [r.relative, r.source] as const))(
    '%s states a section',
    (_relative, source) => {
      const viaWrapper = /section:\s*(null|'[a-z]+'|\[)/.test(source)
      const handRolled = /assertSection\(/.test(source)
      expect(viaWrapper || handRolled).toBe(true)
    },
  )

  it.each(routes.map((r) => [r.relative, r.source] as const))(
    '%s names only sections that exist',
    (_relative, source) => {
      const named = [...source.matchAll(/section:\s*(?:'([a-z]+)'|\[([^\]]*)\])/g)].flatMap(
        (match) =>
          match[1]
            ? [match[1]]
            : (match[2] ?? '').split(',').map((s) => s.trim().replace(/'/g, '')),
      )

      for (const id of named.filter(Boolean)) {
        expect(SECTION_IDS).toContain(id)
      }
    },
  )

  it('leaves only the shared and administrative endpoints ungated by section', () => {
    /*
      `section: null` is the escape hatch, so the list of routes using it is
      the list worth reviewing. Pinned here rather than counted: adding one
      should require saying which, out loud, in a diff.

        meta/filters  the roster and period options every page loads. It is
                      already narrowed to the caller's own employee when the
                      account is OWN-scoped.
        users         account administration, which is a permission and
                      deliberately not a section — see `pageGuard`.
    */
    const ungated = routes
      .filter((r) => /section:\s*null/.test(r.source))
      .map((r) => r.relative.replace('src/app/api/v1/', '').replace('/route.ts', ''))
      .sort()

    expect(ungated).toEqual(['meta/filters', 'users', 'users/[id]'])
  })
})
