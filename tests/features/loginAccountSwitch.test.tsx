// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A SIGN-IN EMPTIES THE QUERY CACHE AND STAYS ON OUR ORIGIN.
 *
 * The QueryClient lives in the root layout for the life of the tab. A session
 * that ended without the sidebar's sign-out — cookie expiry, deactivation,
 * revocation — soft-navigates to /login with the previous account's cached
 * rows, roster and viewer still in it, and no query key names a user. So the
 * next account to sign in on that tab was served them until each went stale.
 *
 * And `?next=` decides where that sign-in lands: a value the WHATWG parser
 * reads as another host (`/\evil.example`) must send the reader home.
 */

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  search: '',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/login',
}))

const signInUsername = vi.hoisted(() => vi.fn())
vi.mock('@/lib/authClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authClient')>()
  return {
    ...actual,
    authClient: { ...actual.authClient, signIn: { ...actual.authClient.signIn, username: signInUsername } },
  }
})

const { default: LoginPage } = await import('@/app/login/page')
const { t } = await import('@/lib/messages')

function seededClient(): QueryClient {
  const client = new QueryClient()
  // What the previous account left behind: its viewer and a confirmation page.
  client.setQueryData(['filters'], { data: { viewer: { userId: 'u-previous', role: 'ADMIN' } } })
  client.setQueryData(['confirmation', 'orders', { page: 1 }], { data: { rows: [{ phone: '+998…' }] } })
  return client
}

async function signIn(client: QueryClient) {
  render(
    <QueryClientProvider client={client}>
      <LoginPage />
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByLabelText(t.auth.signIn.email), { target: { value: 'dilnoza' } })
  fireEvent.change(screen.getByLabelText(t.auth.signIn.password), { target: { value: 'parol-12345' } })
  fireEvent.click(screen.getByRole('button', { name: t.auth.signIn.submit }))
  await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1))
}

beforeEach(() => {
  nav.push.mockReset()
  nav.refresh.mockReset()
  nav.search = ''
  signInUsername.mockReset()
  signInUsername.mockResolvedValue({ data: { token: 'x', user: { id: 'u-next' } }, error: null })
})

describe('signing in on a tab another account used', () => {
  it('empties the query cache before navigating', async () => {
    const client = seededClient()
    expect(client.getQueryCache().getAll()).toHaveLength(2)

    await signIn(client)

    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(nav.refresh).toHaveBeenCalled()
  })

  it('returns to a same-origin ?next= path', async () => {
    nav.search = 'next=%2Frnp%3Fpreset%3Dtoday'
    await signIn(seededClient())
    expect(nav.push).toHaveBeenCalledWith('/rnp?preset=today')
  })

  for (const [label, search] of [
    ['backslash', 'next=%2F%5Cevil.example'],
    ['tab', 'next=%2F%09%2Fevil.example'],
    ['protocol-relative', 'next=%2F%2Fevil.example'],
    ['absolute', 'next=https%3A%2F%2Fevil.example'],
  ] as const) {
    it(`sends a ${label} ?next= home instead of off-site`, async () => {
      nav.search = search
      await signIn(seededClient())
      expect(nav.push).toHaveBeenCalledWith('/')
    })
  }
})
