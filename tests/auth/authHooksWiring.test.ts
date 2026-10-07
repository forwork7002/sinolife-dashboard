import { describe, expect, it, vi } from 'vitest'

/**
 * The refusals are WIRED into the real better-auth instance, not only
 * written down in signInHooks.ts.
 *
 * The before hook runs ahead of /update-user's session middleware, so the
 * refusal needs neither a session nor a database: the request is answered
 * 404 before anything is read. The Prisma client is a stub that fails the
 * test if anything reaches it.
 */

vi.mock('@/server/config/env', () => ({
  env: {
    NODE_ENV: 'test',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  },
}))

const touched = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/server/db/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return undefined
        touched.count += 1
        throw new Error(`database touched: prisma.${String(prop)}`)
      },
    },
  ),
}))

const { auth } = await import('@/server/auth/auth')

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  })
}

describe('auth before hook, as mounted', () => {
  it('answers /update-user with 404 before any session or database work', async () => {
    const response = await auth.handler(post('/update-user', { name: 'Dilnoza Karimova', displayUsername: 'dilnoza' }))
    expect(response.status).toBe(404)
    expect(touched.count).toBe(0)
  })

  it('answers /is-username-available with 404', async () => {
    const response = await auth.handler(post('/is-username-available', { username: 'ali' }))
    expect(response.status).toBe(404)
  })
})
