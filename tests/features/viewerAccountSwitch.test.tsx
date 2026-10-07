// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { pickViewer, type Viewer } from '@/lib/viewer'

/**
 * THE CACHED VIEWER DRAWS THE MENU ONLY FOR THE ACCOUNT THE SERVER SEES.
 *
 * `/meta/filters` carries a viewer and its cache key carries no user. Shell
 * used to prefer that cached copy unconditionally (`fetched ?? server`), so an
 * account switched on the tab without a sign-out kept the previous account's
 * menu — «Foydalanuvchilar» included — for the five minutes the filters stay
 * fresh. Now the fetched viewer is used only while its userId is the server
 * viewer's; otherwise the server's answer is drawn and the layout refreshed.
 */

const ADMIN: Viewer = {
  userId: 'u-admin',
  role: 'ADMIN',
  sections: ['confirmation', 'sellers', 'kpi', 'logistics'],
  dataScope: 'ALL',
  canManageUsers: true,
}
const ROP: Viewer = {
  userId: 'u-rop',
  role: 'SALES',
  sections: ['confirmation'],
  dataScope: 'TEAM',
  canManageUsers: false,
}

describe('pickViewer', () => {
  it('uses the fetched viewer for the same account (an admin edit moves your sidebar)', () => {
    const edited = { ...ROP, sections: ['confirmation', 'kpi'] as Viewer['sections'] }
    expect(pickViewer(edited, ROP)).toBe(edited)
  })

  it('ignores a fetched viewer that belongs to another account', () => {
    expect(pickViewer(ADMIN, ROP)).toBe(ROP)
  })

  it('falls back to the server viewer while nothing is fetched', () => {
    expect(pickViewer(undefined, ROP)).toBe(ROP)
    expect(pickViewer(null, ROP)).toBe(ROP)
  })

  it('stays fail-closed when the server knows nobody', () => {
    expect(pickViewer(ADMIN, null)).toBeNull()
    expect(pickViewer(undefined, null)).toBeNull()
  })
})

const filters = vi.hoisted(() => ({ viewer: null as unknown }))
const refresh = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: async (path: string) =>
    path === '/meta/filters'
      ? { data: { employees: [], departments: [], sources: [], viewer: filters.viewer } }
      : { data: {} },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh }),
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/lib/authClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authClient')>()),
  useSession: () => ({ data: undefined, isPending: true }),
  signOut: async () => {},
}))

const { Shell } = await import('@/components/layout/Shell')
const { ViewerProvider } = await import('@/lib/viewer')
const { t } = await import('@/lib/messages')

function railLinks(): string[] {
  return screen
    .getAllByRole('navigation')
    .flatMap((nav) => Array.from(nav.querySelectorAll('a')))
    .map((a) => a.textContent?.trim() ?? '')
}

describe('Shell after an account switch on the same tab', () => {
  it("never draws the previous account's cached menu over the signed-in one", async () => {
    // The cache still answers for the administrator who used the tab before.
    filters.viewer = ADMIN
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <ViewerProvider value={ROP}>
          <Shell>ignored</Shell>
        </ViewerProvider>
      </QueryClientProvider>,
    )

    // The mismatch is noticed (the filters answered) and the layout refreshed.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(railLinks()).toEqual([t.nav.confirmation])
    expect(screen.queryByRole('link', { name: t.nav.users })).toBeNull()
  })
})
