// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PROMOTION_MS, resetCelebrations, useNewMedals, usePromotions } from '@/features/sellers/usePromotions'
import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'

const uzs = (amount: number) => ({ amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount })
const medal = (code: SellerMedalDto['code']): SellerMedalDto => ({ code, count: 1, at: '2026-09-01', amount: null, orders: null, percent: null })
const row = (employeeId: string, over: Partial<SellerMedalRowDto> = {}): SellerMedalRowDto => ({
  employeeId,
  level: 4,
  legendaTier: 0,
  rankTitle: 'Usta',
  delivered: uzs(101_000_000),
  levelFloor: uzs(100_000_000),
  nextLevelAt: uzs(300_000_000),
  nextTitle: 'Ustoz',
  promotedOn: '2026-09-16',
  medals: [medal('first-sale')],
  ...over,
})
const map = (...rows: SellerMedalRowDto[]) => new Map(rows.map((r) => [r.employeeId, r]))

describe('usePromotions — e‘lon navbati', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCelebrations()
  })
  afterEach(() => vi.useRealTimers())

  it('bugun ko‘tarilgan sotuvchi e‘lon qilinadi, 8 soniyadan keyin jim', () => {
    const rows = map(row('a'))
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16'))
    expect(result.current).toEqual({ employeeId: 'a', level: 4, legendaTier: 0, rankTitle: 'Usta', thresholdLabel: '100 mln' })
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).toBeNull()
  })

  it('bir xil ko‘tarilish sessiyada IKKI MARTA e‘lon qilinmaydi', () => {
    const rows = map(row('a'))
    const { result, rerender } = renderHook(({ r }) => usePromotions(r, '2026-09-16'), { initialProps: { r: rows } })
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    rerender({ r: map(row('a')) }) // yangi payload, o‘sha daraja
    expect(result.current).toBeNull()
  })

  it('ikki ko‘tarilish navbat bilan, har biri 8 soniya', () => {
    const rows = map(row('a'), row('b', { level: 2, rankTitle: 'Sotuvchi', levelFloor: uzs(10_000_000), nextLevelAt: uzs(30_000_000), nextTitle: 'Katta sotuvchi' }))
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16'))
    const first = result.current!.employeeId
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).not.toBeNull()
    expect(result.current!.employeeId).not.toBe(first)
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).toBeNull()
  })

  it('kecha ko‘tarilgan yoki sana noma‘lum — e‘lon yo‘q', () => {
    expect(renderHook(() => usePromotions(map(row('a', { promotedOn: '2026-09-15' })), '2026-09-16')).result.current).toBeNull()
    expect(renderHook(() => usePromotions(map(row('a')), null)).result.current).toBeNull()
  })

  it('Legenda II ostonasi — «2 mlrd»', () => {
    const rows = map(row('a', { level: 6, legendaTier: 2, rankTitle: 'Legenda II' }))
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16'))
    expect(result.current!.thresholdLabel).toBe('2 mlrd')
  })
})

describe('useNewMedals — oldingi payload bilan farq', () => {
  it('birinchi payload hech narsani «yangi» demaydi; ikkinchisida qo‘shilgan medal yangi', () => {
    const first = map(row('a', { medals: [medal('first-sale')] }))
    const { result, rerender } = renderHook(({ r }) => useNewMedals(r), { initialProps: { r: first } })
    expect(result.current.size).toBe(0)
    rerender({ r: map(row('a', { medals: [medal('first-sale'), medal('day-winner')] })) })
    expect(result.current.get('a')?.has('day-winner')).toBe(true)
    expect(result.current.get('a')?.has('first-sale')).toBe(false)
  })

  it('bo‘sh xaritadan keyingi birinchi to‘liq payload ham yangi emas', () => {
    const { result, rerender } = renderHook(({ r }) => useNewMedals(r), { initialProps: { r: new Map<string, SellerMedalRowDto>() } })
    rerender({ r: map(row('a')) })
    expect(result.current.size).toBe(0)
  })
})
