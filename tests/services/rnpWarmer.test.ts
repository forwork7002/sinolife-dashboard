import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { OFF_HOURS, RNP_WARM_EVERY_MS, WARM_HOURS, firstWarmPending, startRnpWarmer, startWarmer, withinHours } = await import(
  '@/server/services/rnpWarmer'
)
const { logger } = await import('@/server/logging/logger')

function fakeTimers() {
  const scheduled: { fn: () => void; ms: number; unref: ReturnType<typeof vi.fn> }[] = []
  return {
    scheduled,
    timers: {
      setInterval(fn: () => void, ms: number) {
        const handle = { fn, ms, unref: vi.fn() }
        scheduled.push(handle)
        return handle
      },
    },
  }
}

describe('startRnpWarmer', () => {
  it('builds at once, then every four minutes, without holding the process open', async () => {
    const warm = vi.fn(async () => {})
    const { scheduled, timers } = fakeTimers()
    const tick = startRnpWarmer(warm, timers)
    await tick()
    expect(warm).toHaveBeenCalledTimes(1)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.ms).toBe(RNP_WARM_EVERY_MS)
    expect(scheduled[0]!.unref).toHaveBeenCalled()
    scheduled[0]!.fn()
    await tick()
    expect(warm).toHaveBeenCalledTimes(2)
  })

  it('never stacks a second build on a slow one', async () => {
    let finish!: () => void
    const warm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const { scheduled, timers } = fakeTimers()
    startRnpWarmer(warm, timers)
    scheduled[0]!.fn()
    scheduled[0]!.fn()
    expect(warm).toHaveBeenCalledTimes(1)
    finish()
  })

  it('survives a failed build and tries again on the next tick', async () => {
    const warm = vi.fn().mockRejectedValueOnce(new Error('statement timeout')).mockResolvedValue(undefined)
    const { scheduled, timers } = fakeTimers()
    const tick = startRnpWarmer(warm, timers)
    await tick()
    scheduled[0]!.fn()
    await tick()
    expect(warm).toHaveBeenCalledTimes(2)
  })

  it('logs the time of the build it waited for, and a failed build at warn (2026-10-02)', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const timeout = new Error('canceling statement due to statement timeout')
    const warm = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 40)))
      .mockRejectedValueOnce(timeout)
    const { scheduled, timers } = fakeTimers()
    const tick = startRnpWarmer(warm, timers)
    await tick()
    expect(info).toHaveBeenCalledWith({ ms: expect.any(Number) }, 'rnp warmed')
    expect((info.mock.calls[0]![0] as unknown as { ms: number }).ms).toBeGreaterThanOrEqual(35)
    scheduled[0]!.fn()
    await tick()
    expect(warn).toHaveBeenCalledWith({ err: timeout }, 'rnp warm-up failed; the next tick tries again')
    info.mockRestore()
    warn.mockRestore()
  })

  it('holds the first-build flag until that build is done, well or not — /api/health reads it', async () => {
    let fail!: (e: Error) => void
    const warm = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)))
    const { timers } = fakeTimers()
    const tick = startRnpWarmer(warm, timers)
    expect(firstWarmPending()).toBe(true)
    // The first build starts on the next microtask; asking for it starts it now.
    const first = tick()
    fail(new Error('statement timeout'))
    await first
    expect(firstWarmPending()).toBe(false)
  })

  it('stays pending until EVERY warmer has finished its first build', async () => {
    let finishRnp!: () => void
    let finishLeads!: () => void
    const { timers } = fakeTimers()
    const rnp = startRnpWarmer(() => new Promise<void>((resolve) => (finishRnp = resolve)), timers)
    const rnpFirst = rnp()
    // The second waits for the first, as instrumentation.ts starts them — pending from the start all the same.
    const leads = startWarmer('leads', () => new Promise<void>((resolve) => (finishLeads = resolve)), 60_000, timers, rnpFirst)
    finishRnp()
    await rnpFirst
    expect(firstWarmPending()).toBe(true)
    const leadsFirst = leads()
    finishLeads()
    await leadsFirst
    expect(firstWarmPending()).toBe(false)
  })
})

/*
  A night tick builds nothing (`WARM_HOURS`), and said so as «rnp warmed»
  with 0 ms every four minutes until the morning — the log 2026-10-02 had
  taken away. It is a skip now, at debug, and the first-build flag clears.
*/
describe('startWarmer — a tick outside working hours (2026-10-06)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs a skip at debug, not «warmed», and still lets /api/health stop waiting', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined)
    const { timers } = fakeTimers()
    const tick = startRnpWarmer(async () => OFF_HOURS, timers)
    await tick()
    expect(debug).toHaveBeenCalledWith('rnp warm skipped — outside working hours')
    expect(info).not.toHaveBeenCalled()
    expect(firstWarmPending()).toBe(false)
  })
})

describe('withinHours — the warmers’ working day (2026-10-06)', () => {
  it('opens at 07:00 and closes at 23:00 in Tashkent, whatever the server’s own zone', () => {
    const at = (iso: string) => withinHours(new Date(iso), 'Asia/Tashkent', WARM_HOURS)
    expect(at('2026-10-06T01:59:59Z')).toBe(false) // 06:59:59
    expect(at('2026-10-06T02:00:00Z')).toBe(true) // 07:00
    expect(at('2026-10-06T17:59:59Z')).toBe(true) // 22:59:59
    expect(at('2026-10-06T18:00:00Z')).toBe(false) // 23:00
    expect(at('2026-10-06T21:00:00Z')).toBe(false) // 02:00
  })
})
