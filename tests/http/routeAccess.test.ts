import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SECTION_IDS } from '@/lib/sections'

/**
 * Every endpoint declares who reaches it — checked by reading the routes.
 *
 * `getHandler` takes an `Access` with a required `section`, so TypeScript
 * already refuses a handler that omits it. What TypeScript cannot see is a
 * route that goes around the wrapper: `users/[id]` hand-rolls its response and
 * calls `requirePermission` directly, and a second could be added tomorrow by
 * copying it. (`deals/[id]` and `employees/[id]` did the same until they were
 * deleted on 2026-09-10 as endpoints no screen called.) That is exactly the
 * path by which an unguarded endpoint ships.
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
    /*
      A glob that silently matches nothing would make every case below pass.

      The floor was 20 while `/api/v1` held 35 routes. Fifteen of them were
      deleted on 2026-09-10 — every endpoint no screen in `src/features` had
      called since the product narrowed to the sections the client asked for —
      so the floor moves with them rather than pinning a count that says
      nothing. It is a smoke test for the reader, not a budget.
    */
    expect(routes.length).toBeGreaterThan(15)
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
    'analytics/sellers': 'COMPANY-WIDE ON PURPOSE — see COMPANY_WIDE below',
    'insights/confirmations/orders': 'the queue cohort narrows in classified',
    'insights/confirmations/regions':
      'the same cohort, so the РЕГИОН filter offers a narrowed caller only the regions their own rows are in',
    'insights/delivery': 'spreads scope; the kanban columns are the caller\'s own orders',
    'insights/structure': 'nothing on it to narrow: who reports to whom, and no figures',
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
    /*
      `finance:read` was filtered out here too, for `/finance/overview`. That
      route was deleted on 2026-09-10 with the rest of the endpoints no screen
      had called since the product narrowed — the `payment` table holds 0 rows,
      so it had been answering 501 for its whole life. Restore the filter with
      the route if settlement data ever arrives.
    */
    const reachable = routes
      .filter((r) => !/permission:\s*'analytics:read:all'/.test(r.source))
      .map((r) => name(r.relative))
      .sort()

    expect(reachable).toEqual(Object.keys(NARROWS).sort())
  })

  /*
    THE TWO THAT HAVE NOTHING TO NARROW.

    Kadrlar tuzilmasi is the one company-wide page a salesperson is meant to
    open — the client asked for it so the floor can see who reports to whom —
    so it serves the whole TREE to anyone holding the section. Narrowing it
    would leave a reader unable to see that another department exists at all,
    which is the opposite of what the screen is for.

    Both routes used to gate the MONEY on `analytics:read:all` and hand a
    narrowed caller nulls. There is no money on that screen any more — the
    client asked for it to be stated on «Boshqaruv markazi» and nowhere else,
    and when that screen was removed on 2026-09-10 the instruction stood: this
    page still states none. So there is nothing left to withhold and nothing
    dated to withhold it over. The assertion below pins that absence: three
    strings whose reappearance, gated or not, means a window or a figure has
    come back to the screen, and that has to be argued for in a diff rather
    than slipped into a route.
  */
  const NOTHING_TO_NARROW = ['insights/structure', 'insights/structure/roster']

  /*
    THE ONE ROUTE THAT COULD NARROW AND DELIBERATELY DOES NOT.

    Sotuvchilar reytingi is the floor's television, and the client asked on
    2026-09-08 for it to read the same for everyone: «sotuvchilar reytingi
    bo'limi hammaga bir xil ko'rinishi kerak… hamma bir-birini natijasini ko'ra
    olishi uchun». A leaderboard whose readers each see a different league is
    not a leaderboard — the instrument exists so a seller can find their own
    row among all the others and know what the number ahead of them is.

    It WAS scoped for six weeks, and that was a defensible reading of a
    different question: `leaderboard:read` is held by every active account, so
    the scope was the only thing between a salesperson and the firm's figures.
    What it cost was the screen's whole purpose, so the trade is made the other
    way — and recorded here, by name, rather than left as a missing line in a
    route.

    What is disclosed, so the decision can be judged rather than assumed: per
    seller and per team, FAKT 1 / FAKT 2 money, order counts, conversion and
    rank. No deal rows, no customers, no phone numbers, no costs, no salaries.

    Everything else in NARROWS still has to be seen reading `ctx.scope`, which
    is the point of keeping this a LIST of one rather than loosening the rule.
  */
  const COMPANY_WIDE = ['analytics/sellers']

  it.each(
    Object.keys(NARROWS)
      .filter((id) => !['users', 'users/[id]', ...NOTHING_TO_NARROW, ...COMPANY_WIDE].includes(id))
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

  it.each(COMPANY_WIDE.map((id) => [id] as const))(
    '%s answers every caller the same board, and says so where it is read',
    (id) => {
      const route = routes.find((r) => name(r.relative) === id)
      expect(route).toBeDefined()

      /*
        The absence has to be DELIBERATE and visible. A route that simply
        forgot the scope looks identical to this one from the outside, so the
        exemption is only honest while the source says out loud that it is
        company-wide — and while it is genuinely not spreading the scope.
      */
      expect(route!.source).toMatch(/COMPANY-WIDE FOR EVERY CALLER/)
      expect(route!.source).not.toMatch(/\.\.\.ctx\.scope/)
    },
  )

  it.each(NOTHING_TO_NARROW.map((id) => [id] as const))(
    '%s serves the structure whole, with no figure and no window',
    (id) => {
      const route = routes.find((r) => name(r.relative) === id)
      expect(route).toBeDefined()

      /*
        A `currency`, a `periodFrom` or the money permission reappearing in
        either of these routes means a figure or a reporting window has come
        back to a screen whose whole audience is OWN-scoped. That is not
        forbidden — it is a decision, and this is where it gets noticed: the
        page would need a gate and a window control again, and this test would
        need rewriting to say so.

        Read with the prose stripped, the way the SQL-shape tests do: both
        routes explain in a comment what they no longer do, and those comments
        name the very things these three checks forbid.
      */
      const code = route!.source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      expect(code).not.toContain('periodFrom')
      expect(code).not.toContain('ctx.currency')
      expect(code).not.toContain('analytics:read:all')
    },
  )
})
