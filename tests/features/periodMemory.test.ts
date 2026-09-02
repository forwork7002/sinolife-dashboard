import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  forgetPeriod,
  periodMemoryServerSnapshot,
  periodMemorySnapshot,
  periodQuery,
  rememberPeriod,
  rememberedPeriod,
  subscribePeriodMemory,
} from '@/features/shared/periodMemory'

/**
 * THE reporting window, remembered per browser and shared by every screen.
 *
 * The cases that matter are the ones where storage misbehaves: it is the
 * thing here most likely to be missing or to throw, and a dashboard that
 * refuses to render because a date could not be recalled would be a worse bug
 * than the one this feature fixes.
 */

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage
}

function install(storage: Storage): void {
  vi.stubGlobal('window', {
    localStorage: storage,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
}

beforeEach(() => install(fakeStorage()))
afterEach(() => vi.unstubAllGlobals())

describe('remembering the window', () => {
  it('gives nothing back before anybody has chosen one', () => {
    expect(rememberedPeriod()).toBeNull()
    expect(periodQuery()).toBe('')
  })

  it('holds ONE window for the whole dashboard', () => {
    /*
      The property this replaced a per-route store to get. Two screens asking
      the same question of different days cannot be compared, and a reader
      should not have to remember which window each screen is sitting in.
    */
    rememberPeriod({ preset: 'today' })
    expect(rememberedPeriod()?.preset).toBe('today')

    rememberPeriod({ preset: 'previous_month' })
    expect(rememberedPeriod()?.preset).toBe('previous_month')
  })

  it('carries a custom range with both of its bounds', () => {
    rememberPeriod({ preset: 'custom', from: '2026-08-01', to: '2026-08-15' })

    expect(periodQuery()).toBe('?preset=custom&from=2026-08-01&to=2026-08-15')
  })

  it('refuses a custom range that lost a bound', () => {
    // Unresolvable, so it is treated as never chosen rather than rendered as
    // a window with one end.
    rememberPeriod({ preset: 'custom', from: '2026-08-01' })

    expect(rememberedPeriod()).toBeNull()
    expect(periodQuery()).toBe('')
  })

  it('forgets it, so "clear filters" really clears it', () => {
    rememberPeriod({ preset: 'this_week' })

    forgetPeriod()

    expect(rememberedPeriod()).toBeNull()
  })
})

describe('when storage will not cooperate', () => {
  it('reads nothing rather than throwing when getItem fails', () => {
    install({
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    } as unknown as Storage)

    expect(rememberedPeriod()).toBeNull()
  })

  it('carries on when the quota is full', () => {
    install({
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
    } as unknown as Storage)

    // The dates on screen are correct either way; they just will not be there
    // next time. Nothing may propagate to the render.
    expect(() => rememberPeriod({ preset: 'today' })).not.toThrow()
    expect(() => forgetPeriod()).not.toThrow()
  })

  it('ignores a stored value that is not an object', () => {
    install(fakeStorage({ 'sinolife.period.v2': '"kim yozdi buni"' }))

    expect(rememberedPeriod()).toBeNull()
  })

  it('ignores unparseable storage', () => {
    install(fakeStorage({ 'sinolife.period.v2': '{oops' }))

    expect(rememberedPeriod()).toBeNull()
  })
})

describe('the snapshot the sidebar renders from', () => {
  it('is empty on the server, so hydration has something to match', () => {
    expect(periodMemoryServerSnapshot()).toBe('{}')
  })

  it('returns the same value twice, or useSyncExternalStore would loop', () => {
    rememberPeriod({ preset: 'today' })

    expect(periodMemorySnapshot()).toBe(periodMemorySnapshot())
  })

  it('tells its subscribers when a window changes', () => {
    const seen = vi.fn()
    const stop = subscribePeriodMemory(seen)

    rememberPeriod({ preset: 'yesterday' })
    expect(seen).toHaveBeenCalled()

    stop()
    rememberPeriod({ preset: 'today' })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('answers from the snapshot without re-reading storage', () => {
    expect(periodQuery(JSON.stringify({ window: { preset: 'this_year' } }))).toBe('?preset=this_year')
    expect(periodQuery('{}')).toBe('')
  })
})
