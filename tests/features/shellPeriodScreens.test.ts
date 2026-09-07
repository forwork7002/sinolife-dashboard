import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * THE SHELL RECOGNISES DATELESS SCREENS BY THEIR ADDRESS, so the address list
 * and the screens have to agree — and nothing in the types makes them.
 *
 * `SCREENS_WITHOUT_A_PERIOD` in Shell.tsx names the screens with no reporting
 * window of their own. It used to be a prop each page passed about itself; the
 * shell now mounts once in the root layout, above every page, so the fact was
 * lifted out of the pages and stated once, by pathname.
 *
 * SINCE THE ⌘K PALETTE WAS REMOVED THE LIST HAS NO RUNTIME READER, and the
 * surviving statement of the rule is what this file actually pins: the period
 * row is `PageShell`'s, and a dateless screen opts out by passing
 * `period={false}` or by not rendering `PageShell` at all. Two places now say
 * which screens are dateless — Shell.tsx's list and each page's own side — and
 * nothing but this test makes them agree. Let them drift and a dateless page
 * gets a window nothing on it reads, pinned into the address and into the
 * sidebar link, with no control anywhere to clear it again.
 *
 * (That is also why the list must not be swept as dead code: deleting it
 * deletes the only written statement of the agreement, and this file — which
 * reads Shell.tsx's source text — goes red rather than silently passing.)
 *
 * Three pins, weakest to strongest:
 *  - the list says exactly the screens we know are dateless;
 *  - each of those screens visibly opts out on its own side too;
 *  - the set of routes under src/app is the one this file audited, so a NEW
 *    screen fails here and forces the person adding it to decide which side
 *    of the list it belongs on.
 */

/** Assertions about source read the code, never the prose explaining it. */
const bare = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

const shell = bare('src/components/layout/Shell.tsx')

const listed = /SCREENS_WITHOUT_A_PERIOD[^=]*=\s*\[([^\]]*)\]/
  .exec(shell)?.[1]
  .split(',')
  .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
  .filter(Boolean)

describe('the screens without a reporting window', () => {
  it('are exactly the four known dateless screens', () => {
    expect(listed).toBeDefined()
    expect([...listed!].sort()).toEqual(['/account', '/marketing', '/structure', '/users'])
  })

  it('each opts out of the window on its own side too', () => {
    // /users keeps PageShell for its header and filters, so it must say
    // period={false} — the one prop PageShell still owns about the window.
    expect(bare('src/features/users/UsersPage.tsx')).toContain('period={false}')

    /*
      /structure is the same case and the newest one. It renders PageShell for
      its title and its view toggle, and says `period={false}` because nothing
      left on it reads a window: the card's revenue moved to Boshqaruv markazi
      and the period-scoped «Ishlagan» count went with it.
    */
    expect(bare('src/features/structure/StructurePage.tsx')).toContain('period={false}')

    // /marketing resolves its own dates and /account has none: neither may
    // render PageShell, whose whole point is the shared window row.
    expect(bare('src/features/marketing/MarketingPage.tsx')).not.toContain('PageShell')
    expect(bare('src/features/account/AccountPage.tsx')).not.toContain('PageShell')
  })

  /*
    THE DATELESS PAGE MUST NOT ASK A DATED QUESTION EITHER.

    `period={false}` removes the CONTROL; it does nothing about what the page
    sends. `useDashboardFilters`' `apiParams` always carries `preset`, read
    straight off the URL — and every sidebar link carries the reader's
    remembered window — so a page that kept passing it would key its cache on a
    window it does not read and refetch the same tree per preset. /structure
    passes no filter object at all, to either of its two endpoints.
  */
  it('the structure screen asks its endpoints for no window at all', () => {
    const page = bare('src/features/structure/StructurePage.tsx')
    expect(page).not.toContain('apiParams')

    const panel = bare('src/features/structure/DepartmentPanel.tsx')
    expect(panel).not.toContain('apiParams')
  })
})

describe('the shell mounts once, in the root layout', () => {
  it('is imported by AppFrame and nothing else in src/', () => {
    const files = (readdirSync('src', { recursive: true }) as string[])
      .filter((name) => /\.(ts|tsx)$/.test(name))
      .map((name) => `src/${name}`)
    const importers = files.filter((file) => {
      if (file === 'src/components/layout/Shell.tsx') return false
      const source = bare(file)
      return source.includes("'@/components/layout/Shell'") || source.includes("from './Shell'")
    })
    expect(importers).toEqual(['src/components/layout/AppFrame.tsx'])
  })

  it('audited every screen that exists — a new one must pick a side', () => {
    const routes = (readdirSync('src/app', { recursive: true }) as string[])
      .filter((name) => name.endsWith('page.tsx'))
      .map((name) => '/' + name.replace(/\/?page\.tsx$/, ''))
      .sort()
    expect(routes).toEqual([
      '/',
      '/account',
      '/analytics/cohort',
      '/analytics/sales',
      '/confirmation',
      '/kpi',
      '/login',
      '/logistics',
      '/margin',
      '/marketing',
      '/sellers',
      '/structure',
      '/users',
      '/warehouse',
    ])
  })
})
