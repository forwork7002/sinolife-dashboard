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
        meta/alerts   the header's freshness and its bell. The service gates
                      the queue count on the section the caller holds.
        search        the one box that looks across every screen. It gates each
                      GROUP it returns on a section the caller holds and
                      narrows the rows to their data scope, so it can reach
                      nothing navigation could not.
        users         account administration, which is a permission and
                      deliberately not a section — see `pageGuard`.
    */
    const ungated = routes
      .filter((r) => /section:\s*null/.test(r.source))
      .map((r) => r.relative.replace('src/app/api/v1/', '').replace('/route.ts', ''))
      .sort()

    expect(ungated).toEqual(['meta/alerts', 'meta/filters', 'search', 'users', 'users/[id]'])
  })
})

/**
 * WHICH ENDPOINTS A NARROWED ACCOUNT MAY REACH — the list, pinned.
 *
 * `analytics:read:all` is the permission only an ALL-scoped account holds, so
 * declaring it is how an endpoint says "I cannot narrow my rows; refuse a ROP
 * rather than answer them with the company's". Declaring the any-of pair — or
 * `leaderboard:read`, or `employees:read`, which every active account holds —
 * is how it says the opposite, and every endpoint that says the opposite MUST
 * apply `ctx.scope`.
 *
 * That is the whole safety property of team scoping, and it is one grep away
 * from being broken by a route that widens its permission without threading
 * the scope. So it is enumerated: adding a route to this list should require
 * saying so out loud in a diff, next to the SQL that narrows it.
 */
describe('what a TEAM- or OWN-scoped caller can reach', () => {
  /** Route → why it is safe to answer an account that is not company-wide. */
  const NARROWS: Readonly<Record<string, string>> = {
    'analytics/employees': 'spreads scope; the roster is filtered to it as well',
    'analytics/funnel': 'spreads scope',
    'analytics/leaderboard': 'spreads scope; narrowEmployeeIds folds it into the roster',
    'analytics/products': 'spreads scope',
    'analytics/sales': 'spreads scope',
    'analytics/sellers': 'spreads scope; both bases restrict in SQL',
    'analytics/sources': 'spreads scope',
    'dashboard/overview': 'spreads scope',
    deals: 'spreads scope',
    'deals/[id]': 'hand-rolled: the scope is in the WHERE clause, so a stranger 404s',
    'employees/[id]': 'hand-rolled: canViewEmployee is asked with the resolved scope',
    'insights/confirmations/orders': 'the queue cohort narrows in classified',
    'insights/flow': 'spreads scope',
    'insights/pulse': 'spreads scope',
    'insights/structure': 'the TREE is for everyone with the section; the MONEY is gated',
    'insights/structure/roster': 'same as the tree above',
    kpi: 'spreads scope; plans and roster both narrowed',
    'meta/alerts': 'the bell counts the caller\'s own backlog',
    'meta/filters': 'the roster it offers is filtered to the scope',
    search: 'every group is section-gated and the rows are scope-narrowed',
    users: 'account administration; users:manage, not an analytics read',
    'users/[id]': 'as above',
  }

  const name = (relative: string) =>
    relative.replace('src/app/api/v1/', '').replace('/route.ts', '')

  it('lets exactly the endpoints that narrow their rows admit a narrowed caller', () => {
    const reachable = routes
      .filter((r) => !/permission:\s*'analytics:read:all'/.test(r.source))
      .filter((r) => !/permission:\s*'finance:read'/.test(r.source))
      .map((r) => name(r.relative))
      .sort()

    expect(reachable).toEqual(Object.keys(NARROWS).sort())
  })

  /*
    THE TWO THAT WITHHOLD A COLUMN INSTEAD OF NARROWING A ROW.

    Kadrlar tuzilmasi is the one company-wide page a salesperson is meant to
    open — the client asked for it so the floor can see who reports to whom —
    so it serves the whole TREE to anyone holding the section and gates the
    MONEY on `analytics:read:all`, which turns into nulls rather than zeros for
    everybody else. Narrowing the tree instead would leave a reader unable to
    see that another department exists at all, which is the opposite of what
    the screen is for. Neither route may quietly start narrowing rows, and
    neither may stop gating the figures.
  */
  const GATES_THE_MONEY = ['insights/structure', 'insights/structure/roster']

  it.each(
    Object.keys(NARROWS)
      .filter((id) => !['users', 'users/[id]', ...GATES_THE_MONEY].includes(id))
      .map((id) => [id] as const),
  )('%s actually reads the scope it is allowed to be asked for', (id) => {
    /*
      A route may reach the scope three ways and all three are honest: spread
      into the filters, passed as an argument, or handed to a service that
      does. What is NOT honest is admitting a narrowed caller and never
      mentioning the scope at all — that is a company-wide answer under a
      narrowed account, which is the exact bug this file exists to catch.
    */
    const route = routes.find((r) => name(r.relative) === id)
    expect(route).toBeDefined()
    expect(route!.source).toMatch(/ctx\.scope|scopeService\.resolve/)
  })

  it.each(GATES_THE_MONEY.map((id) => [id] as const))(
    '%s withholds the figures from a narrowed caller instead',
    (id) => {
      const route = routes.find((r) => name(r.relative) === id)
      expect(route).toBeDefined()
      expect(route!.source).toContain("can(ctx.principal, 'analytics:read:all')")
    },
  )
})
