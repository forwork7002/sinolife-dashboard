// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { type MedalHolder, useNewMedals } from '@/features/sellers/useNewMedals'
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
})
