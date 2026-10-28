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

const KEYS = ['__sinolifePrisma', '__sinolifeAuthPrisma', '__sinolifeWarmPrisma']

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
    // Three lanes — the main pool, the auth lane and the warm lane — each opened once.
    expect(poolCtor).toHaveBeenCalledTimes(3)
    expect(clientCtor).toHaveBeenCalledTimes(3)
  })

  it('splits the long-lived eight into five for the screens, two for the auth lane and one for the warm-ups', async () => {
    const { prisma, authPrisma, warmPrisma } = await import('@/server/db/prisma')
    expect(authPrisma).not.toBe(prisma)
    expect(warmPrisma).not.toBe(prisma)
    expect(poolCtor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000, statement_timeout: 20_000 }),
    )
    expect(poolCtor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ max: 2, min: 1, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000, statement_timeout: 5_000 }),
    )
    // One connection, a minute's limit, and a wait for it as long as two builds: the warm-ups queue behind themselves.
    expect(poolCtor).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ max: 1, application_name: 'web-warm', connectionTimeoutMillis: 120_000, statement_timeout: 60_000 }),
    )
    const sizes = poolCtor.mock.calls.map(([config]) => (config as { max: number }).max)
    // 2 × 8 + the worker's 6 + the deploy's 2 = 24 of max_connections 25 (prisma.ts).
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(8)
  })
})
