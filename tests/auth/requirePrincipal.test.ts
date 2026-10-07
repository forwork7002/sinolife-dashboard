import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A REVOKED SESSION STOPS WORKING ON THE NEXT REQUEST, NOT FIVE MINUTES LATER.
 *
 * auth.ts turns on better-auth's `cookieCache` (five minutes): `getSession`
 * answers from the signed `session_data` cookie unless asked with
 * `disableCookieCache`. `requirePrincipal` re-read the user row but trusted
 * the cached SESSION, so a session row deleted by a password change, an
 * administrator's reset or a deactivation kept passing every /api/v1 check.
 *
 * The fake `getSession` behaves like better-auth on exactly that switch: with
 * the cache allowed it answers from the cookie; with it disabled it reads the
 * session table.
 */

const store = vi.hoisted(() => ({
  sessions: new Map<string, { id: string; userId: string }>(),
  calls: [] as unknown[],
}))

vi.mock('@/server/auth/auth', () => ({
  auth: {
    api: {
      getSession: async (input: { headers: Headers; query?: { disableCookieCache?: boolean } }) => {
        store.calls.push(input.query)
        const token = input.headers.get('cookie')?.match(/token=([^;]+)/)?.[1]
        if (!token) return null
        const cached = { session: { id: `sid-${token}`, token }, user: { id: 'u-1' } }
        if (!input.query?.disableCookieCache) return cached // the 5-minute cookie cache
        const row = store.sessions.get(token)
        return row ? { session: { id: row.id, token }, user: { id: row.userId } } : null
      },
    },
  },
}))

vi.mock('@/server/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        role: 'SALES',
        isActive: true,
        employeeId: null,
        dataScope: 'ALL',
        sections: [],
        wideSections: [],
      }),
    },
  },
}))

const { requirePrincipal } = await import('@/server/auth/session')

const request = () => new Request('https://dash.example/api/v1/x', { headers: { cookie: 'token=abc' } })

beforeEach(() => {
  store.sessions.clear()
  store.calls.length = 0
  store.sessions.set('abc', { id: 'sid-abc', userId: 'u-1' })
})

describe('requirePrincipal', () => {
  it('admits a live session and carries its id', async () => {
    const principal = await requirePrincipal(request())
    expect(principal.userId).toBe('u-1')
    expect(principal.sessionId).toBe('sid-abc')
  })

  it('refuses a session deleted a moment ago, cookie cache or not', async () => {
    await requirePrincipal(request())
    store.sessions.delete('abc') // «boshqa qurilmalardan chiqish», a reset, a deactivation

    await expect(requirePrincipal(request())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('always asks better-auth to bypass the cookie cache', async () => {
    await requirePrincipal(request())
    expect(store.calls).toEqual([{ disableCookieCache: true }])
  })
})
