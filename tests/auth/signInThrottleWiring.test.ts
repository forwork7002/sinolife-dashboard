import { getIP } from 'better-auth/api'
import { describe, expect, it, vi } from 'vitest'

import { KNOWN_IP_MIN_USERS, KNOWN_IP_SIGN_IN_MAX, SIGN_IN_MAX } from '@/server/auth/signInThrottle'

/**
 * The known-address rule is WIRED into the real better-auth instance, on the
 * path the login form posts to, and it judges the address the limiter keys on
 * — not one a client wrote into X-Forwarded-For. The database answers «three
 * people signed in from 203.0.113.9 this week» and nothing else; anything
 * else it is asked (the lockout, the password check) throws, so a request
 * that passes the limiter ends in a 500 here and only a 429 is the limiter.
 */

vi.mock('@/server/config/env', () => ({
  env: {
    NODE_ENV: 'test',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  },
}))

const OFFICE = '203.0.113.9'

const groupBy = vi.hoisted(() =>
  vi.fn(async ({ where }: { where: { ipAddress: string } }) =>
    where.ipAddress === '203.0.113.9' ? [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }] : [],
  ),
)
vi.mock('@/server/db/prisma', () => ({
  prisma: new Proxy({ session: { groupBy } } as Record<string, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop as string]
      if (prop === 'then') return undefined
      throw new Error(`database touched: prisma.${String(prop)}`)
    },
  }),
}))

const { auth } = await import('@/server/auth/auth')

function signIn(path: string, forwardedFor: string): Request {
  return new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      'x-forwarded-for': forwardedFor,
    },
    body: JSON.stringify({ username: 'ali', email: 'ali@sinolife.local', password: 'xxxxxxxxxx' }),
  })
}

async function maxFor(forwardedFor: string): Promise<number> {
  const rule = auth.options.rateLimit?.customRules?.['/sign-in/username']
  if (typeof rule !== 'function') throw new Error('/sign-in/username has no function rule')
  return (await rule(signIn('/sign-in/username', forwardedFor))).max
}

/** `n` sign-in attempts in a row through the mounted handler; their statuses. */
async function statuses(path: string, forwardedFor: string, n: number): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < n; i += 1) out.push((await auth.handler(signIn(path, forwardedFor))).status)
  return out
}

describe('sign-in throttle, as mounted', () => {
  it('gives a known address thirty on /sign-in/username', async () => {
    expect(await maxFor(`${OFFICE}, 10.0.0.2`)).toBe(KNOWN_IP_SIGN_IN_MAX)
  })

  it('leaves /sign-in/email at five for everybody — the limiter counts each path apart', () => {
    expect(auth.options.rateLimit?.customRules?.['/sign-in/email']).toEqual({ window: 60, max: SIGN_IN_MAX })
  })

  it('judges the hop the proxy appended, not an address the client prepended', async () => {
    expect(await maxFor(`${OFFICE}, 198.51.100.7, 10.0.0.2`)).toBe(SIGN_IN_MAX)
  })

  it('counts different people who signed in from that address, and stops at three', async () => {
    groupBy.mockClear()
    await maxFor('192.0.2.44, 10.0.0.2')
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['userId'],
        where: expect.objectContaining({ ipAddress: '192.0.2.44' }),
        take: KNOWN_IP_MIN_USERS,
      }),
    )
  })

  it('looks up the address exactly as better-auth stores it — an IPv6 /64 too', async () => {
    groupBy.mockClear()
    await maxFor('2001:db8::1, 10.0.0.2')
    const stored = getIP(signIn('/sign-in/username', '2001:db8::1, 10.0.0.2'), auth.options)
    expect(stored).not.toBeNull()
    expect(groupBy.mock.calls[0][0].where.ipAddress).toBe(stored)
  })

  // The limiter's counters live in this process and outlive a test, so each
  // case below speaks from an address no other case uses.

  it('refuses the sixth attempt a minute from an unknown address', async () => {
    const seen = await statuses('/sign-in/username', '198.51.100.20, 10.0.0.2', 6)
    expect(seen.slice(0, 5)).not.toContain(429)
    expect(seen[5]).toBe(429)
  })

  it('lets thirty through from a known address and refuses the thirty-first', async () => {
    const seen = await statuses('/sign-in/username', `${OFFICE}, 10.0.0.2`, 31)
    expect(seen.slice(0, 30)).not.toContain(429)
    expect(seen[30]).toBe(429)
  })

  it('keeps a known address at five on /sign-in/email', async () => {
    const seen = await statuses('/sign-in/email', `${OFFICE}, 10.0.0.3`, 6)
    expect(seen[5]).toBe(429)
  })
})
