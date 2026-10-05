import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { keyPart, ttlCache } from '@/server/services/ttlCache'

/**
 * The memo in front of the company-wide answers.
 *
 * Four properties matter, and each of them is a production failure if it goes:
 * concurrent readers must SHARE one build (that is the whole reason the module
 * exists — six people opening a screen inside a second is what put ninety-six
 * queries into a pool eight wide), an entry must expire on the tick the data
 * behind it moves, a REJECTION must never be stored, and the key must be taken
 * literally so that two different questions cannot collide.
 */
describe('ttlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the build once for concurrent callers on the same key', async () => {
    const cache = ttlCache<number>(60_000)
    let builds = 0

    // Deliberately NOT awaited between calls: this is the arrival pattern the
    // cache exists for — everyone lands while the first build is in flight, so
    // a cache that stored resolved values would let all of them miss.
    const results = await Promise.all([
      cache.get('k', async () => ++builds),
      cache.get('k', async () => ++builds),
      cache.get('k', async () => ++builds),
    ])

    expect(builds).toBe(1)
    expect(results).toEqual([1, 1, 1])
  })

  it('serves the same answer inside the TTL and rebuilds after it', async () => {
    const cache = ttlCache<number>(60_000)
    let builds = 0
    const build = async () => ++builds

    expect(await cache.get('k', build)).toBe(1)

    vi.advanceTimersByTime(59_999)
    expect(await cache.get('k', build)).toBe(1)

    vi.advanceTimersByTime(2)
    expect(await cache.get('k', build)).toBe(2)
  })

  it('does not cache a rejection', async () => {
    const cache = ttlCache<number>(60_000)
    let calls = 0

    const flaky = async () => {
      calls += 1
      if (calls === 1) throw new Error('statement timeout')
      return 42
    }

    await expect(cache.get('k', flaky)).rejects.toThrow('statement timeout')

    // Same key, same instant. A cached rejection would turn one timeout into a
    // whole TTL of them for every reader on the screen.
    expect(await cache.get('k', flaky)).toBe(42)
    expect(calls).toBe(2)
  })

  it('keeps different keys apart', async () => {
    const cache = ttlCache<string>(60_000)

    expect(await cache.get('a', async () => 'A')).toBe('A')
    expect(await cache.get('b', async () => 'B')).toBe('B')
    expect(await cache.get('a', async () => 'other')).toBe('A')
  })

  it('sweeps expired entries rather than growing without bound', async () => {
    const cache = ttlCache<number>(60_000)

    for (let i = 0; i < 10; i += 1) await cache.get(`k${i}`, async () => i)
    expect(cache.size()).toBe(10)

    vi.advanceTimersByTime(60_001)
    // The sweep runs on the next miss, so one build collects the other ten.
    await cache.get('fresh', async () => 0)
    expect(cache.size()).toBe(1)
  })
})

/**
 * The key fragments.
 *
 * `keyPart` exists because a key assembled by hand is where this kind of cache
 * goes wrong: two callers asking one question in two orders must share an
 * entry, and — the dangerous one — an EMPTY filter list must never key the
 * same as an ABSENT one. Across this codebase `[]` reads as "no filter" and
 * widens to the whole company (hence the `NO_EMPLOYEE_IN_SCOPE` sentinel), so
 * collapsing the two here would let a narrowed question read a wide answer.
 */
describe('keyPart', () => {
  it('is order-independent for lists', () => {
    expect(keyPart(['b', 'a', 'c'])).toBe(keyPart(['c', 'b', 'a']))
  })

  it('separates absent, null and empty', () => {
    const parts = [keyPart(undefined), keyPart(null), keyPart([])]
    expect(new Set(parts).size).toBe(3)
  })

  it('does not let one list impersonate another', () => {
    // 'a,b' as a single id must not key the same as ['a', 'b'].
    expect(keyPart('a,b')).not.toBe(keyPart(['a', 'b']))
  })
})

describe('ttlCache with staleMs (stale-while-revalidate)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands out the expired answer at once and rebuilds once behind it', async () => {
    const cache = ttlCache<number>(60_000, { staleMs: 600_000 })
    let builds = 0
    const build = async () => ++builds

    expect(await cache.get('k', build)).toBe(1)
    vi.advanceTimersByTime(61_000)

    // Two readers past the TTL: both get the old answer, one rebuild runs.
    expect(await Promise.all([cache.get('k', build), cache.get('k', build)])).toEqual([1, 1])
    await vi.runAllTimersAsync()
    expect(builds).toBe(2)
    expect(await cache.get('k', build)).toBe(2)
  })

  it('keeps the old answer when the rebuild fails, and tries again later', async () => {
    const cache = ttlCache<number>(60_000, { staleMs: 600_000 })
    expect(await cache.get('k', async () => 1)).toBe(1)
    vi.advanceTimersByTime(61_000)

    expect(await cache.get('k', async () => Promise.reject(new Error('timeout')))).toBe(1)
    await vi.runAllTimersAsync()
    expect(await cache.get('k', async () => 3)).toBe(1)
    await vi.runAllTimersAsync()
    expect(await cache.get('k', async () => 4)).toBe(3)
  })

  it('makes the reader wait once the answer is older than ttl + staleMs', async () => {
    const cache = ttlCache<number>(60_000, { staleMs: 60_000 })
    expect(await cache.get('k', async () => 1)).toBe(1)
    vi.advanceTimersByTime(121_000)
    expect(await cache.get('k', async () => 2)).toBe(2)
  })

  it('reports a rebuild that failed behind its readers', async () => {
    const errors: unknown[] = []
    const cache = ttlCache<number>(60_000, { staleMs: 600_000, onError: (_key, error) => errors.push(error) })
    await cache.get('k', async () => 1)
    vi.advanceTimersByTime(61_000)
    const timeout = new Error('timeout')
    expect(await cache.get('k', async () => Promise.reject(timeout))).toBe(1)
    await vi.runAllTimersAsync()
    expect(errors).toEqual([timeout])
  })

  it('does not start a second build beside a first one still running past the TTL', async () => {
    const cache = ttlCache<number>(60_000, { staleMs: 600_000 })
    let builds = 0
    let release!: (n: number) => void
    const first = cache.get('k', () => {
      builds++
      return new Promise<number>((resolve) => (release = resolve))
    })
    vi.advanceTimersByTime(61_000)
    const second = cache.get('k', async () => ++builds)
    release(1)
    expect(await Promise.all([first, second])).toEqual([1, 1])
    expect(builds).toBe(1)
  })
})
