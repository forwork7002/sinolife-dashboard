import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

vi.mock('@/server/db/prisma', () => ({ prisma: { $queryRaw: async () => [{ '?column?': 1 }] } }))

const { GET } = await import('@/app/api/health/route')

/*
  A new server is not ready until «RNP jadvali» is warm, for at most 75 s
  after it starts — so a deploy is delayed behind the first build, never
  failed by it (rnpWarmer.ts).
*/
const FLAG = Symbol.for('sinolife.rnp.firstWarmPending')
const setPending = (v: boolean | undefined) => ((globalThis as Record<symbol, unknown>)[FLAG] = v)

describe('/api/health while the first RNP build runs', () => {
  afterEach(() => {
    setPending(undefined)
    vi.restoreAllMocks()
  })

  it('answers «warming» early in the server\'s life', async () => {
    setPending(true)
    vi.spyOn(process, 'uptime').mockReturnValue(40)
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'warming' })
  })

  it('answers ok past the grace, whatever the build is doing', async () => {
    setPending(true)
    vi.spyOn(process, 'uptime').mockReturnValue(80)
    expect((await GET()).status).toBe(200)
  })

  it('answers ok once warm, and where no warmer runs', async () => {
    vi.spyOn(process, 'uptime').mockReturnValue(10)
    setPending(false)
    expect((await GET()).status).toBe(200)
    setPending(undefined)
    expect((await GET()).status).toBe(200)
  })
})
