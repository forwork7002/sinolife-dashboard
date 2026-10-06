import { describe, expect, it, vi } from 'vitest'

import { processWide } from '@/server/processWide'

/*
  `instrumentation.ts` and the route handlers are separate bundles, each with
  its own copy of every module (2026-10-06): what is kept with `processWide`
  is the process's — the RNP memos, the bank rates, the warmers' first-build
  flag.
*/
describe('processWide', () => {
  it('makes a value once, and hands another copy of the module — another bundle’s — the same one', async () => {
    const make = vi.fn(() => new Set<string>())
    const first = processWide('sinolife.test.value', make)
    expect(processWide('sinolife.test.value', make)).toBe(first)

    vi.resetModules()
    const copy = await import('@/server/processWide')
    expect(copy.processWide).not.toBe(processWide)
    expect(copy.processWide('sinolife.test.value', make)).toBe(first)
    expect(make).toHaveBeenCalledTimes(1)
    expect(processWide('sinolife.test.other', () => 'its own')).toBe('its own')
  })
})
