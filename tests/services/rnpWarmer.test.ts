import { describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { RNP_WARM_EVERY_MS, startRnpWarmer } = await import('@/server/services/rnpWarmer')
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
})
