// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNewBuildAvailable } from '@/lib/buildVersion'

/**
 * THE BUILD-ID POLL ASKS ONLY WHILE SOMEBODY CAN SEE THE ANSWER (2026-10-24).
 *
 * It read `/build-id.json` every minute in hidden tabs too, and went on
 * reading after it had already found a new version. What has to survive the
 * change: the read on mount (what THIS tab runs), a read the moment the tab is
 * looked at again, and — the old rule — a failed read is never a new version.
 */

let visibility: DocumentVisibilityState = 'visible'
let served: unknown = { id: 'build-a' }
let failing: 'no' | 'throw' | 'not-ok' = 'no'

const fetchMock = vi.fn(async () => {
  if (failing === 'throw') throw new TypeError('Failed to fetch')
  return {
    ok: failing !== 'not-ok',
    json: async () => served,
  }
})

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  served = { id: 'build-a' }
  failing = 'no'
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function minutes(n: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(n * 60_000)
  })
}

async function becomes(state: DocumentVisibilityState) {
  visibility = state
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('useNewBuildAvailable', () => {
  it('reads on mount and every minute while the tab is shown', async () => {
    const { result } = renderHook(() => useNewBuildAvailable())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await minutes(3)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.current).toBe(false)
  })

  it('still takes its first read in a tab opened in the background', async () => {
    visibility = 'hidden'
    renderHook(() => useNewBuildAvailable())
    await settle()
    // Without it, a deploy before the tab is first shown would become «this tab's» build.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('skips the minute while the tab is hidden and reads at once when it is shown again', async () => {
    const { result } = renderHook(() => useNewBuildAvailable())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await becomes('hidden')
    await minutes(10)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    served = { id: 'build-b' }
    await becomes('visible')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(true)
  })

  it('stops asking once a new version is up', async () => {
    const { result } = renderHook(() => useNewBuildAvailable())
    await settle()

    served = { id: 'build-b' }
    await minutes(1)
    expect(result.current).toBe(true)
    const asked = fetchMock.mock.calls.length

    await minutes(10)
    await becomes('hidden')
    await becomes('visible')
    expect(fetchMock).toHaveBeenCalledTimes(asked)
    // A BUTTON, never a reload, and it never goes back down.
    expect(result.current).toBe(true)
  })

  it('never takes a failed read for a new version', async () => {
    const { result } = renderHook(() => useNewBuildAvailable())
    await settle()

    failing = 'throw'
    await minutes(1)
    failing = 'not-ok'
    await minutes(1)
    failing = 'no'
    served = '<html>login</html>'
    await minutes(1)
    served = { id: 'build-a' }
    await minutes(1)

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(result.current).toBe(false)
  })
})
