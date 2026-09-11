// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * THE RAIL'S FIRST PAINT IS THE SERVER'S ANSWER, NOT "EVERYTHING".
 *
 * What the client saw, and reported: an account opened for a salesperson
 * signed in and the sidebar showed the ADMINISTRATOR'S menu — «Foydalanuvchilar»
 * included — sat there for about a second, then collapsed to the four links the
 * account actually holds. «chap panelda … adminga koʻrinadigan panellar
 * koʻrinadi … 1 skund keyin yoʻqoladi».
 *
 * The cause was a pair of permissive fallbacks. `useSession()` resolves from
 * /api/auth/get-session, which cannot have answered during the server render or
 * on the first client one, and the rail treated "nobody known yet" as "show the
 * lot": `!user || canOpen(item)` on the groups, `if (!role) return true` inside
 * it. So the HTML Next.js shipped carried all eleven destinations, for every
 * viewer, including the admin-only one — and a link that a SALES account's own
 * page guard would bounce it straight back out of.
 *
 * The fix is to stop guessing. Every page is `force-dynamic` and server-rendered
 * behind a guard that has already resolved the principal, so the root layout
 * hands the viewer down (`ViewerProvider`) and the rail renders from it. The
 * `/meta/filters` payload still overrides it the moment it lands — that is what
 * makes an administrator's edit to your own account move your sidebar — but it
 * no longer has to arrive before the menu is honest.
 *
 * Both directions are pinned here: the menu a handed-down viewer gets, and the
 * fail-closed default when nothing is known at all.
 */

const filters = vi.hoisted(() => ({ viewer: null as unknown }))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: async (path: string) =>
    path === '/meta/filters'
      ? { data: { employees: [], departments: [], sources: [], viewer: filters.viewer } }
      : { data: {} },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(''),
}))

// The state the bug lives in: the session request has not answered yet.
vi.mock('@/lib/authClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authClient')>()),
  useSession: () => ({ data: undefined, isPending: true }),
  signOut: async () => {},
}))

const { Shell } = await import('@/components/layout/Shell')
const { ViewerProvider } = await import('@/lib/viewer')
const { t } = await import('@/lib/messages')

/** The rail's destinations, in order. Scoped to the nav so the skip link and
    the account block stay out of it. */
function railLinks(): string[] {
  return screen
    .getAllByRole('navigation')
    .flatMap((nav) => Array.from(nav.querySelectorAll('a')))
    .map((a) => a.textContent?.trim() ?? '')
}

function renderRail(viewer: Parameters<typeof ViewerProvider>[0]['value']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ViewerProvider value={viewer}>
        <Shell>ignored</Shell>
      </ViewerProvider>
    </QueryClientProvider>,
  )
}

describe('the sidebar before the session has answered', () => {
  it('offers a ROP exactly the sections the server handed down', () => {
    renderRail({
      userId: 'u-rop',
      role: 'SALES',
      sections: ['confirmation', 'sellers'],
      dataScope: 'TEAM',
      canManageUsers: false,
    })

    expect(railLinks()).toEqual([t.nav.confirmation, t.nav.sellers])
  })

  /*
    THE ONE LINK THAT IS NOT A SECTION. Account administration is a permission,
    so it is the entry a ticked-sections list can never explain away — and the
    one the client actually named.
  */
  it('never shows Foydalanuvchilar to an account that cannot manage users', () => {
    renderRail({
      userId: 'u-rop',
      role: 'SALES',
      sections: ['confirmation', 'sellers'],
      dataScope: 'TEAM',
      canManageUsers: false,
    })

    expect(screen.queryByRole('link', { name: t.nav.users })).toBeNull()
  })

  /*
    NOTHING KNOWN IS NOT EVERYTHING ALLOWED.

    There is no page that renders the shell without a session — the middleware
    redirects first — so this state is unreachable by design. It is pinned
    anyway, because it was reachable for a second on every cold load, and a
    fallback that fails open is how it was.
  */
  it('offers nothing at all when neither the server nor the session has said', () => {
    renderRail(null)

    expect(railLinks()).toEqual([])
  })

  it('still gives an administrator the whole menu', () => {
    renderRail({
      userId: 'u-admin',
      role: 'ADMIN',
      sections: [
        'cohort',
        'sales',
        'margin',
        'confirmation',
        'logistics',
        'warehouse',
        'kpi',
        'structure',
        'sellers',
        'marketing',
      ],
      dataScope: 'ALL',
      canManageUsers: true,
    })

    expect(railLinks()).toContain(t.nav.users)
    expect(railLinks()).toHaveLength(11)
  })
})

/*
  WHICH ANSWER WINS WHEN BOTH ARRIVE.

  The handed-down viewer is a first frame, not a source of truth: an
  administrator who ticks a section on your own account invalidates `['filters']`
  and your sidebar has to follow within the second — that is what
  `UsersPage.refresh()` is for. So the payload overrides the layout's copy, never
  the other way round, and this is the assertion that notices if the `??` is ever
  written the other way.
*/
describe('when the filters payload lands', () => {
  it('follows the fetched viewer over the one the layout handed down', async () => {
    filters.viewer = {
      userId: 'u-rop',
      role: 'SALES',
      sections: ['confirmation', 'sellers', 'kpi'],
      dataScope: 'TEAM',
      canManageUsers: false,
    }

    renderRail({
      userId: 'u-rop',
      role: 'SALES',
      sections: ['confirmation'],
      dataScope: 'TEAM',
      canManageUsers: false,
    })

    expect(railLinks()).toEqual([t.nav.confirmation])

    await waitFor(() =>
      expect(railLinks()).toEqual([t.nav.confirmation, t.nav.kpi, t.nav.sellers]),
    )
  })
})
