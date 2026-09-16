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
/* Taxtada chizilgan kalitlar. Har testda BIR MARTA yasaladi: to'plam
   effektning bog'liqliklarida, ya'ni identifikatori barqaror bo'lishi kerak. */
const ON_A = new Set(['a'])
const ON_AB = new Set(['a', 'b'])

describe('usePromotions — e‘lon navbati', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCelebrations()
  })
  afterEach(() => vi.useRealTimers())

  it('bugun ko‘tarilgan sotuvchi e‘lon qilinadi, 8 soniyadan keyin jim', () => {
    const rows = map(row('a'))
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16', ON_A))
    expect(result.current).toEqual({ employeeId: 'a', level: 4, legendaTier: 0, rankTitle: 'Usta', thresholdLabel: '100 mln' })
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).toBeNull()
  })

  it('bir xil ko‘tarilish sessiyada IKKI MARTA e‘lon qilinmaydi', () => {
    const rows = map(row('a'))
    const { result, rerender } = renderHook(({ r }) => usePromotions(r, '2026-09-16', ON_A), { initialProps: { r: rows } })
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    rerender({ r: map(row('a')) }) // yangi payload, o‘sha daraja
    expect(result.current).toBeNull()
  })

  it('ikki ko‘tarilish navbat bilan, har biri 8 soniya', () => {
    const rows = map(row('a'), row('b', { level: 2, rankTitle: 'Sotuvchi', levelFloor: uzs(10_000_000), nextLevelAt: uzs(30_000_000), nextTitle: 'Katta sotuvchi' }))
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16', ON_AB))
    const first = result.current!.employeeId
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).not.toBeNull()
    expect(result.current!.employeeId).not.toBe(first)
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).toBeNull()
  })

  it('kecha ko‘tarilgan yoki sana noma‘lum — e‘lon yo‘q', () => {
    expect(renderHook(() => usePromotions(map(row('a', { promotedOn: '2026-09-15' })), '2026-09-16', ON_A)).result.current).toBeNull()
    expect(renderHook(() => usePromotions(map(row('a')), null, ON_A)).result.current).toBeNull()
  })

  it('Legenda II ostonasi — «2 mlrd»', () => {
    const rows = map(row('a', { level: 6, legendaTier: 2, rankTitle: 'Legenda II' }))
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16', ON_A))
    expect(result.current!.thresholdLabel).toBe('2 mlrd')
  })

  /*
    MEDAL OYNASI TAXTA OYNASI EMAS. Daraja 2026-avgustdan beri yig'ilgan
    puldan, taxta esa tanlangan davrdan — ya'ni bugun ko'tarilgan odam
    «Bugun» taxtasida umuman bo'lmasligi mumkin. Agar shunday e'lon
    «nishonlangan» deb belgilansa, o'sha odam taxtaga chiqqanda hech qachon
    tabriklanmasdi: bir marta ko'rinmay yonib ketardi.
  */
  it('taxtada yo‘q ko‘tarilish sarflanmaydi — odam chizilganda e‘lon qilinadi', () => {
    const rows = map(row('a'))
    const { result, rerender } = renderHook(({ on }) => usePromotions(rows, '2026-09-16', on), {
      initialProps: { on: new Set<string>() },
    })
    expect(result.current).toBeNull()

    rerender({ on: ON_A })
    expect(result.current!.employeeId).toBe('a')
  })

  /*
    IKKINCHI TETIK — OLDINGI PAYLOAD BILAN FARQ, va production'da e'lon
    aynan shundan chiqadi. `promotedOn` NAVBAT kuni (kunlik faktlar
    `c.queued_at` bo'yicha guruhlanadi), FAKT 2 esa bir necha kundan keyin
    yopiladi — ya'ni `promotedOn === bugun` deyarli hech qachon rost emas.
    Shuning uchun bu testlarda `promotedOn` ataylab o'tgan kun: birinchi
    tetik jim, ikkinchisi gapiradi.
  */
  const TODAY = '2026-09-16'
  const NAVBAT_KUNI = '2026-09-10'
  const at = (level: number, rankTitle: string, over: Partial<SellerMedalRowDto> = {}) =>
    map(row('a', { level, rankTitle, promotedOn: NAVBAT_KUNI, ...over }))

  it('daraja OSHDI — birinchi payload jim, ikkinchisi e‘lon qiladi', () => {
    const { result, rerender } = renderHook(({ r }) => usePromotions(r, TODAY, ON_A), {
      initialProps: { r: at(3, 'Katta sotuvchi') },
    })
    expect(result.current).toBeNull()

    rerender({ r: at(4, 'Usta') })
    expect(result.current).toEqual({
      employeeId: 'a',
      level: 4,
      legendaTier: 0,
      rankTitle: 'Usta',
      thresholdLabel: '100 mln',
    })
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).toBeNull()

    // O'sha daraja yana kelsa — `celebrated` ushlaydi.
    rerender({ r: at(4, 'Usta') })
    expect(result.current).toBeNull()
  })

  it('e‘lon ko‘rinib turganda yangi ko‘tarilish orqasida navbatga turadi', () => {
    const b = (level: number, rankTitle: string) => row('b', { level, rankTitle, promotedOn: NAVBAT_KUNI })
    const a = (level: number, rankTitle: string) => row('a', { level, rankTitle, promotedOn: NAVBAT_KUNI })
    const { result, rerender } = renderHook(({ r }) => usePromotions(r, TODAY, ON_AB), {
      initialProps: { r: map(a(3, 'Katta sotuvchi'), b(2, 'Sotuvchi')) },
    })
    expect(result.current).toBeNull()

    rerender({ r: map(a(4, 'Usta'), b(2, 'Sotuvchi')) })
    expect(result.current!.employeeId).toBe('a')

    rerender({ r: map(a(4, 'Usta'), b(3, 'Katta sotuvchi')) })
    expect(result.current!.employeeId).toBe('a') // hali birinchisi ekranda
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current!.employeeId).toBe('b')
  })

  it('orqaga qaytgan daraja qayta ko‘tarilsa — ikkinchi marta e‘lon yo‘q', () => {
    const { result, rerender } = renderHook(({ r }) => usePromotions(r, TODAY, ON_A), {
      initialProps: { r: at(3, 'Katta sotuvchi') },
    })
    rerender({ r: at(4, 'Usta') })
    expect(result.current!.level).toBe(4)
    act(() => vi.advanceTimersByTime(PROMOTION_MS))

    rerender({ r: at(3, 'Katta sotuvchi') }) // pasayish e'lon emas
    expect(result.current).toBeNull()
    rerender({ r: at(4, 'Usta') })
    expect(result.current).toBeNull()
  })

  /*
    TAXTADA YO'Q KO'TARILISH — SURAT HAM SURILMAYDI. Farq faqat ikki payload
    orasida ko'rinadi, ya'ni surat yangi darajani yozib qo'ysa, o'sha odam
    taxtaga chiqqanda taqqoslashda hech qanday farq qolmasdi.
  */
  it('taxtada yo‘q daraja o‘sishi sarflanmaydi — odam chizilganda e‘lon qilinadi', () => {
    const OFF = new Set<string>()
    const { result, rerender } = renderHook(({ r, on }) => usePromotions(r, TODAY, on), {
      initialProps: { r: at(3, 'Katta sotuvchi'), on: OFF },
    })
    rerender({ r: at(4, 'Usta'), on: OFF })
    expect(result.current).toBeNull()

    rerender({ r: at(4, 'Usta'), on: ON_A })
    expect(result.current).toEqual({
      employeeId: 'a',
      level: 4,
      legendaTier: 0,
      rankTitle: 'Usta',
      thresholdLabel: '100 mln',
    })
  })

  it('Legenda bosqichi oshdi — 6/I dan 6/II ga «Legenda II»', () => {
    const { result, rerender } = renderHook(({ r }) => usePromotions(r, TODAY, ON_A), {
      initialProps: { r: at(6, 'Legenda', { legendaTier: 1 }) },
    })
    expect(result.current).toBeNull()

    rerender({ r: at(6, 'Legenda II', { legendaTier: 2 }) })
    expect(result.current).toEqual({
      employeeId: 'a',
      level: 6,
      legendaTier: 2,
      rankTitle: 'Legenda II',
      thresholdLabel: '2 mlrd',
    })
  })

  it('taxtada yo‘q ko‘tarilish 8 soniyalik navbatni band qilmaydi', () => {
    // 'a' xaritada birinchi, lekin chizilmagan — 'b' DARHOL gapiradi.
    const rows = map(row('a'), row('b', { level: 2, rankTitle: 'Sotuvchi', levelFloor: uzs(10_000_000), nextLevelAt: uzs(30_000_000), nextTitle: 'Katta sotuvchi' }))
    const onlyB = new Set(['b'])
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16', onlyB))
    expect(result.current!.employeeId).toBe('b')
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).toBeNull()
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
