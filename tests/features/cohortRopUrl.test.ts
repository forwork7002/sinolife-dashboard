// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useCohortRop } from '@/features/cohort/useCohortRop'

/**
 * The team cut is a link, not a preference.
 *
 * It rides in the URL so «bu bizning jamoa» is one paste, and it is written
 * with `replaceState` rather than a router push because a push re-runs the
 * server component — 521ms of frozen UI per click, measured on this product.
 *
 * This file replaced `cohortMode.test.ts` when «Oddiy» was removed on
 * 2026-09-16. The mode hook it covered is gone; the MECHANISM it was really
 * testing — the same store, the same `replaceState`, the same
 * default-stripped-from-the-query-string rule — is now carried by this hook
 * alone, and it had no unit test of its own.
 */
describe('the cohort team cut, in the URL', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/analytics/cohort')
  })

  it('opens on the whole company', () => {
    const { result } = renderHook(() => useCohortRop())
    expect(result.current.rop).toBeNull()
  })

  it('reads the team the URL already carries', () => {
    window.history.replaceState(null, '', '/analytics/cohort?rop=Sevinch')
    const { result } = renderHook(() => useCohortRop())
    expect(result.current.rop).toBe('Sevinch')
  })

  it('writes the team into the URL without navigating', () => {
    // A local mock wired to nothing proves nothing about the hook: it would
    // read "not called" even if the hook navigated. Spying on the real
    // history methods is what tells replaceState apart from a router push.
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    try {
      const { result } = renderHook(() => useCohortRop())
      act(() => result.current.setRop('Sevinch'))
      expect(new URL(window.location.href).searchParams.get('rop')).toBe('Sevinch')
      expect(replaceSpy).toHaveBeenCalled()
      expect(pushSpy).not.toHaveBeenCalled()
    } finally {
      replaceSpy.mockRestore()
      pushSpy.mockRestore()
    }
  })

  it('drops the parameter again when it returns to the whole company', () => {
    // A default in the query string is noise in every link that gets shared.
    window.history.replaceState(null, '', '/analytics/cohort?rop=Sevinch')
    const { result } = renderHook(() => useCohortRop())
    act(() => result.current.setRop(null))
    expect(new URL(window.location.href).searchParams.has('rop')).toBe(false)
  })

  /*
    AN EMPTY `?rop=` IS THE WHOLE COMPANY, NOT A TEAM WITH NO NAME.

    The route's schema refuses an empty string, so passing one through would
    turn a hand-tidied URL into a 400 where the reader expected the default
    view. It is the one value this hook normalises — every OTHER unknown name
    rides through on purpose, because the hook has no roster to check against
    and answering a link about a renamed team with the company's numbers under
    that team's name would be worse than an empty state.
  */
  it('reads an empty parameter as the whole company', () => {
    window.history.replaceState(null, '', '/analytics/cohort?rop=')
    const { result } = renderHook(() => useCohortRop())
    expect(result.current.rop).toBeNull()
  })

  it('passes an unknown team through rather than inventing a fallback', () => {
    window.history.replaceState(null, '', '/analytics/cohort?rop=Nomalum')
    const { result } = renderHook(() => useCohortRop())
    expect(result.current.rop).toBe('Nomalum')
  })
})
