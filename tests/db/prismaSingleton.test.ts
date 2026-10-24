import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * One pg Pool per process, in production too.
 *
 * Production's build carries src/server/db/prisma.ts in several bundles (API
 * routes, app pages, the instrumentation chunk the warmers run in). Each copy
 * is a separate module evaluation. The client used to be cached on
 * `globalThis` only outside production, so every copy opened its own
 * Pool(max 8) and one container could hold three pools against a budget sized
 * for one. `vi.resetModules()` + a fresh import is exactly "another bundle
 * evaluates the module again".
 */

const poolCtor = vi.fn()
const clientCtor = vi.fn()

vi.mock('pg', () => ({
  Pool: class {
    constructor(config: unknown) {
      poolCtor(config)
    }
  },
}))
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(public pool: unknown) {}
  },
}))
vi.mock('@/generated/prisma/client', () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      clientCtor(options)
    }
  },
}))
vi.mock('@/server/config/env', () => ({
  env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' },
}))

const KEYS = ['__sinolifePrisma', '__sinolifeAuthPrisma']

afterEach(() => {
  for (const key of KEYS) delete (globalThis as Record<string, unknown>)[key]
  poolCtor.mockClear()
  clientCtor.mockClear()
  vi.resetModules()
})

describe('prisma singleton', () => {
  it('re-evaluating the module in production reuses the same client and pool', async () => {
    const first = (await import('@/server/db/prisma')).prisma
    vi.resetModules()
    const second = (await import('@/server/db/prisma')).prisma
    vi.resetModules()
    const third = (await import('@/server/db/prisma')).prisma

    expect(second).toBe(first)
    expect(third).toBe(first)
    // Two lanes — the main pool and the auth lane — each opened once.
    expect(poolCtor).toHaveBeenCalledTimes(2)
    expect(clientCtor).toHaveBeenCalledTimes(2)
  })

  it('splits the long-lived eight into six for the screens and two for the auth lane', async () => {
    const { prisma, authPrisma } = await import('@/server/db/prisma')
    expect(authPrisma).not.toBe(prisma)
    expect(poolCtor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ max: 6, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000, statement_timeout: 20_000 }),
    )
    expect(poolCtor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ max: 2, min: 1, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000, statement_timeout: 5_000 }),
    )
  })
})
