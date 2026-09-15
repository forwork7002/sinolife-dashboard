// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MEDAL_ROTATION_MS, useMedalRotation } from '@/features/sellers/useMedalRotation'
import type { SellerMedalDto } from '@/lib/api'

/*
  jsdom has no `matchMedia`, and `useReducedMotion` asks it whether the
  reader wants motion — calling it unstubbed throws. Every other file in
  this repo answers "yes, reduced" (`matches: query.includes(...)`), which
  is the honest answer when a component only needs to skip a tween. This
  hook is the opposite case: with reduced motion true the rotation timer
  never starts, and `result.current` would sit on the first medal forever
  — no test below would ever see a timer fire. So this stub answers "no,
  motion is fine" (`matches: false`), which is the precondition the brief's
  own tests assume (advancing fake timers must move the speaking seat).
*/
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const medal = (code: SellerMedalDto['code']): SellerMedalDto => ({
  code,
  count: 1,
  tier: null,
  points: 100,
  at: '2026-08-01',
  amount: null,
  orders: null,
  percent: null,
})

describe('medal aylanishi', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('bir vaqtda faqat BITTA medal gapiradi', () => {
    const { result } = renderHook(() =>
      useMedalRotation([
        { employeeId: 'a', medals: [medal('month-gold'), medal('club')] },
        { employeeId: 'b', medals: [medal('clean-month')] },
      ]),
    )
    expect(result.current).not.toBeNull()
    expect(result.current!.employeeId).toBe('a')
    expect(result.current!.medal.code).toBe('month-gold')
  })

  it('soat urganda keyingisiga o‘tadi va seatdan seatga aylanadi', () => {
    const { result } = renderHook(() =>
      useMedalRotation([
        { employeeId: 'a', medals: [medal('month-gold')] },
        { employeeId: 'b', medals: [medal('clean-month')] },
      ]),
    )
    act(() => void vi.advanceTimersByTime(MEDAL_ROTATION_MS))
    expect(result.current!.employeeId).toBe('b')
    act(() => void vi.advanceTimersByTime(MEDAL_ROTATION_MS))
    expect(result.current!.employeeId).toBe('a')
  })

  it('medal yo‘q bo‘lsa null — bo‘sh quti chizilmaydi', () => {
    const { result } = renderHook(() => useMedalRotation([{ employeeId: 'a', medals: [] }]))
    expect(result.current).toBeNull()
  })

  it('ro‘yxat qisqarganda indeks chegaradan chiqmaydi', () => {
    const { result, rerender } = renderHook(
      ({ slots }) => useMedalRotation(slots),
      {
        initialProps: {
          slots: [
            { employeeId: 'a', medals: [medal('month-gold')] },
            { employeeId: 'b', medals: [medal('clean-month')] },
          ],
        },
      },
    )
    act(() => void vi.advanceTimersByTime(MEDAL_ROTATION_MS))
    expect(result.current!.employeeId).toBe('b')
    rerender({ slots: [{ employeeId: 'a', medals: [medal('month-gold')] }] })
    expect(result.current!.employeeId).toBe('a')
  })
})
