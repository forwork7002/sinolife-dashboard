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
