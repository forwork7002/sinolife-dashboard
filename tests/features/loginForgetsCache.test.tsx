// @vitest-environment jsdom
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * THE NEXT ACCOUNT ON A TAB NEVER STARTS FROM THE LAST ONE'S ANSWERS.
 *
 * «Chiqish» clears the query cache, but a session also ends by being revoked
 * or by expiring, and then the middleware or the page guard sends the tab to
 * /login and the form comes back with `router.push` — soft navigations, so the
 * one client survives, holding half an hour of answers (`gcTime`). Whoever
 * signed in next was painted the previous account's figures under the same
 * key until their own refetch landed. Rendered under the REAL `Providers`:
 * the clearing is the application's, and a client built here would be the
 * test checking its own fixture.
 */

const route = vi.hoisted(() => ({ pathname: '/sellers' }))

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
}))

const { Providers } = await import('@/app/providers')

afterEach(cleanup)

/** The client every screen reads, caught by the screen that reads it. */
let client: QueryClient | undefined

function Board({ read }: { read: () => Promise<string> }) {
  client = useQueryClient()
  const board = useQuery({ queryKey: ['sellers', 'board'], queryFn: read })
  return <p>{board.data ?? 'skeleton'}</p>
}

/** One tab: the board, another screen, or the login form, under the one client. */
function Tab({ at, read }: { at: string; read: () => Promise<string> }) {
  return <Providers>{at === '/sellers' ? <Board read={read} /> : <p>{at}</p>}</Providers>
}

function go(at: string, read: () => Promise<string>, rerender: (ui: ReactElement) => void) {
  route.pathname = at
  rerender(<Tab at={at} read={read} />)
}

const adminBoard = async () => 'Butun kompaniya · 234 950 000'
const neverAnswers = () => new Promise<string>(() => {})

describe('the query cache across accounts', () => {
  it('is emptied when the tab reaches /login, so the next account sees its own skeleton, not the last one’s figures', async () => {
    route.pathname = '/sellers'
    const { rerender } = render(<Tab at="/sellers" read={adminBoard} />)
    expect(await screen.findByText('Butun kompaniya · 234 950 000')).toBeTruthy()

    // The session was revoked: the guard sends the tab to /login.
    go('/login', adminBoard, rerender)
    expect(client!.getQueryCache().getAll()).toHaveLength(0)

    // A ROP signs in on the same tab; their own answer has not landed yet.
    go('/sellers', neverAnswers, rerender)
    expect(screen.getByText('skeleton')).toBeTruthy()
    expect(screen.queryByText('Butun kompaniya · 234 950 000')).toBeNull()
  })

  it('keeps it between the dashboard’s own screens — that is what `gcTime` is for', async () => {
    route.pathname = '/sellers'
    const { rerender } = render(<Tab at="/sellers" read={adminBoard} />)
    expect(await screen.findByText('Butun kompaniya · 234 950 000')).toBeTruthy()

    go('/logistics', adminBoard, rerender)
    go('/sellers', neverAnswers, rerender)

    expect(screen.getByText('Butun kompaniya · 234 950 000')).toBeTruthy()
  })
})
