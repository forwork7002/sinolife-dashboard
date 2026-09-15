// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useCohortMode } from '@/features/cohort/useCohortMode'

/**
 * The mode is a link, not a preference.
 *
 * It rides in the URL so «look at this» is one paste, and it is written with
 * replaceState rather than a router push because a push re-runs the server
 * component -- 521ms of frozen UI per click, measured on this product.
 */
describe('the cohort mode', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/analytics/cohort')
  })

  it('opens on the manager’s view', () => {
    const { result } = renderHook(() => useCohortMode())
    expect(result.current.mode).toBe('simple')
  })

  it('reads the mode the URL already carries', () => {
    window.history.replaceState(null, '', '/analytics/cohort?mode=detail')
    const { result } = renderHook(() => useCohortMode())
    expect(result.current.mode).toBe('detail')
  })

  it('writes the mode into the URL without navigating', () => {
    // A local mock wired to nothing proves nothing about the hook: it would
    // read "not called" even if the hook navigated. Spying on the real
    // history methods is what tells replaceState apart from a router push.
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    try {
      const { result } = renderHook(() => useCohortMode())
      act(() => result.current.setMode('detail'))
      expect(new URL(window.location.href).searchParams.get('mode')).toBe('detail')
      expect(replaceSpy).toHaveBeenCalled()
      expect(pushSpy).not.toHaveBeenCalled()
    } finally {
      replaceSpy.mockRestore()
      pushSpy.mockRestore()
    }
  })

  it('drops the parameter again when it returns to the default', () => {
    // A default in the query string is noise in every link that gets shared.
    window.history.replaceState(null, '', '/analytics/cohort?mode=detail')
    const { result } = renderHook(() => useCohortMode())
    act(() => result.current.setMode('simple'))
    expect(new URL(window.location.href).searchParams.has('mode')).toBe(false)
  })

  it('falls back to the default on a value it does not know', () => {
    window.history.replaceState(null, '', '/analytics/cohort?mode=nonsense')
    const { result } = renderHook(() => useCohortMode())
    expect(result.current.mode).toBe('simple')
  })
})
