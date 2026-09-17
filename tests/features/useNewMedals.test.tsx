// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type MedalHolder, NEW_MEDAL_MS, useNewMedals } from '@/features/sellers/useNewMedals'
import type { MedalCode } from '@/lib/api'

/*
  Hook faqat kalit va medal kodlarini o'qiydi (`MedalHolder`), shuning uchun
  fixture ham faqat shuni tashiydi — payload'ning qolgan maydonlari bu testga
  kirmaydi.
*/
const row = (employeeId: string, ...codes: MedalCode[]): MedalHolder => ({
  employeeId,
  medals: codes.map((code) => ({ code })),
})
const map = (...rows: MedalHolder[]) => new Map(rows.map((r) => [r.employeeId, r]))

describe('useNewMedals — oldingi payload bilan farq', () => {
  it('birinchi payload hech narsani «yangi» demaydi; ikkinchisida qo‘shilgan medal yangi', () => {
    const first = map(row('a', 'first-sale'))
    const { result, rerender } = renderHook(({ r }) => useNewMedals(r), { initialProps: { r: first } })
    expect(result.current.size).toBe(0)
    rerender({ r: map(row('a', 'first-sale', 'day-winner')) })
    expect(result.current.get('a')?.has('day-winner')).toBe(true)
    expect(result.current.get('a')?.has('first-sale')).toBe(false)
  })

  it('bo‘sh xaritadan keyingi birinchi to‘liq payload ham yangi emas', () => {
    const { result, rerender } = renderHook(({ r }) => useNewMedals(r), {
      initialProps: { r: new Map<string, MedalHolder>() },
    })
    rerender({ r: map(row('a', 'first-sale')) })
    expect(result.current.size).toBe(0)
  })

  it('o‘sha xarita qayta berilsa — «yangi» saqlanadi; keyingi payloadda so‘nadi', () => {
    const second = map(row('a', 'first-sale', 'jump'), row('b', 'rookie'))
    const { result, rerender } = renderHook(({ r }) => useNewMedals(r), {
      initialProps: { r: map(row('a', 'first-sale')) },
    })
    rerender({ r: second })
    expect([...result.current.keys()].sort()).toEqual(['a', 'b'])
    rerender({ r: second })
    expect(result.current.get('b')?.has('rookie')).toBe(true)
    rerender({ r: map(row('a', 'first-sale', 'jump'), row('b', 'rookie')) })
    expect(result.current.size).toBe(0)
  })

  /*
    «Bir marta» (spec §1.5): belgi keyingi payload'gacha — o'n daqiqa — turganida,
    shu oraliqda qayta mount bo'lgan medal (FAKT 1/FAKT 2, reyting almashishi,
    telefon tabi) animatsiyani qaytadan o'ynardi. Belgi o'zi o'chadi.
  */
  describe('belgi o‘zi o‘chadi', () => {
    afterEach(() => vi.useRealTimers())

    it('animatsiya tugagach «yangi» bo‘shaydi va o‘sha xarita bilan qaytib kelmaydi', () => {
      vi.useFakeTimers()
      const second = map(row('a', 'first-sale', 'jump'))
      const { result, rerender } = renderHook(({ r }) => useNewMedals(r), {
        initialProps: { r: map(row('a', 'first-sale')) },
      })
      rerender({ r: second })
      expect(result.current.get('a')?.has('jump')).toBe(true)
      act(() => void vi.advanceTimersByTime(NEW_MEDAL_MS - 1))
      expect(result.current.get('a')?.has('jump')).toBe(true)
      act(() => void vi.advanceTimersByTime(1))
      expect(result.current.size).toBe(0)
      rerender({ r: second })
      expect(result.current.size).toBe(0)
    })

    it('muddat ichida kelgan yangi payload o‘z belgisini to‘liq muddatga oladi', () => {
      vi.useFakeTimers()
      const { result, rerender } = renderHook(({ r }) => useNewMedals(r), {
        initialProps: { r: map(row('a', 'first-sale')) },
      })
      rerender({ r: map(row('a', 'first-sale', 'jump')) })
      act(() => void vi.advanceTimersByTime(NEW_MEDAL_MS - 100))
      rerender({ r: map(row('a', 'first-sale', 'jump', 'rookie')) })
      expect([...(result.current.get('a') ?? [])]).toEqual(['rookie'])
      act(() => void vi.advanceTimersByTime(NEW_MEDAL_MS - 1))
      expect(result.current.get('a')?.has('rookie')).toBe(true)
      act(() => void vi.advanceTimersByTime(1))
      expect(result.current.size).toBe(0)
    })
  })
})
