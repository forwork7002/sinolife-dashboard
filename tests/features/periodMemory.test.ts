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
 * The window each section is read in, remembered per browser.
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

describe('remembering a section window', () => {
  it('gives nothing back for a section nobody has chosen one for', () => {
    expect(rememberedPeriod('/confirmation')).toBeNull()
    expect(periodQuery('/confirmation')).toBe('')
  })

  it('keeps each section apart', () => {
    rememberPeriod('/confirmation', { preset: 'today' })
    rememberPeriod('/analytics/sales', { preset: 'previous_month' })

    expect(rememberedPeriod('/confirmation')?.preset).toBe('today')
    expect(rememberedPeriod('/analytics/sales')?.preset).toBe('previous_month')
    // The whole point: one screen's window is not the other's.
    expect(rememberedPeriod('/margin')).toBeNull()
  })

  it('carries a custom range with both of its bounds', () => {
    rememberPeriod('/margin', { preset: 'custom', from: '2026-08-01', to: '2026-08-15' })

    expect(periodQuery('/margin')).toBe('?preset=custom&from=2026-08-01&to=2026-08-15')
  })

  it('refuses a custom range that lost a bound', () => {
    // Unresolvable, so it is treated as never chosen rather than rendered as
    // a window with one end.
    rememberPeriod('/margin', { preset: 'custom', from: '2026-08-01' })

    expect(rememberedPeriod('/margin')).toBeNull()
    expect(periodQuery('/margin')).toBe('')
  })

  it('forgets one section without touching the others', () => {
    rememberPeriod('/confirmation', { preset: 'today' })
    rememberPeriod('/logistics', { preset: 'this_week' })

    forgetPeriod('/confirmation')

    expect(rememberedPeriod('/confirmation')).toBeNull()
    expect(rememberedPeriod('/logistics')?.preset).toBe('this_week')
  })
})

describe('when storage will not cooperate', () => {
  it('reads nothing rather than throwing when getItem fails', () => {
    install({
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    } as unknown as Storage)

    expect(rememberedPeriod('/confirmation')).toBeNull()
  })

  it('carries on when the quota is full', () => {
    install({
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
    } as unknown as Storage)

    // The dates on screen are correct either way; they just will not be there
    // next time. Nothing may propagate to the render.
    expect(() => rememberPeriod('/confirmation', { preset: 'today' })).not.toThrow()
    expect(() => forgetPeriod('/confirmation')).not.toThrow()
  })

  it('ignores a stored value that is not an object', () => {
    install(fakeStorage({ 'sinolife.section-period.v1': '"kim yozdi buni"' }))

    expect(rememberedPeriod('/confirmation')).toBeNull()
  })

  it('ignores unparseable storage', () => {
    install(fakeStorage({ 'sinolife.section-period.v1': '{oops' }))

    expect(rememberedPeriod('/confirmation')).toBeNull()
  })
})

describe('the snapshot the sidebar renders from', () => {
  it('is empty on the server, so hydration has something to match', () => {
    expect(periodMemoryServerSnapshot()).toBe('{}')
  })

  it('returns the same value twice, or useSyncExternalStore would loop', () => {
    rememberPeriod('/confirmation', { preset: 'today' })

    expect(periodMemorySnapshot()).toBe(periodMemorySnapshot())
  })

  it('tells its subscribers when a window changes', () => {
    const seen = vi.fn()
    const stop = subscribePeriodMemory(seen)

    rememberPeriod('/confirmation', { preset: 'yesterday' })
    expect(seen).toHaveBeenCalled()

    stop()
    rememberPeriod('/logistics', { preset: 'today' })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('answers a section from the snapshot without re-reading storage', () => {
    const memory = JSON.stringify({ '/kpi': { preset: 'this_year' } })

    expect(periodQuery('/kpi', memory)).toBe('?preset=this_year')
    expect(periodQuery('/margin', memory)).toBe('')
  })
})
