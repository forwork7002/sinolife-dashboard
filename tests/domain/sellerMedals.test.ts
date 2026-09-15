import { describe, expect, it } from 'vitest'

import {
  type SellerDayFact,
  type SellerMonthFact,
  buildSellerMedals,
} from '@/server/domain/analytics/sellerMedals'

/** 1 so'm = 100 minor; 1 mln so'm = 100_000_000n. */
const MLN = 100_000_000n

function month(over: Partial<SellerMonthFact> & { employeeId: string }): SellerMonthFact {
  return {
    month: '2026-08-01',
    confirmedOrders: 0,
    confirmedMinor: 0n,
    deliveredOrders: 0,
    deliveredMinor: 0n,
    place: 99,
    ...over,
  }
}

function day(over: Partial<SellerDayFact> & { employeeId: string }): SellerDayFact {
  return {
    day: '2026-08-03',
    confirmedOrders: 0,
    deliveredMinor: 0n,
    place: 99,
    ...over,
  }
}

const build = (months: SellerMonthFact[], days: SellerDayFact[] = []) =>
  buildSellerMedals({ months, days, runningMonth: '2026-09' })

const rowOf = <T extends { employeeId: string }>(rows: readonly T[], id: string) =>
  rows.find((r) => r.employeeId === id)!

const codes = (row: { medals: readonly { code: string }[] }) => row.medals.map((m) => m.code)

describe('kundalik ish balli', () => {
  it('tasdiq 10, yetkazish 25, har to‘liq 1 mln FAKT 2 uchun 5', () => {
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 3, deliveredOrders: 2, deliveredMinor: 7n * MLN }),
    ])
    // 3·10 + 2·25 + 7·5 = 115, ustiga 🌱 birinchi savdo 100 = 215
    expect(rowOf(rows, 'a').points).toBe(215)
  })

  it('to‘liq bo‘lmagan million ball bermaydi — pastga yaxlitlanadi', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 1n * MLN + 99_999_999n }),
    ])
    // 1·25 + 1·5 + 100 = 130 — ikkinchi million to‘lmagan
    expect(rowOf(rows, 'a').points).toBe(130)
  })

  it('yetkazilgan buyurtmasi yo‘q sotuvchi 🌱 olmaydi va 1-darajada qoladi', () => {
    const rows = build([month({ employeeId: 'a', confirmedOrders: 5 })])
    expect(codes(rowOf(rows, 'a'))).not.toContain('first-sale')
    expect(rowOf(rows, 'a').level).toBe(1)
    expect(rowOf(rows, 'a').points).toBe(50)
  })
})

describe('klub — bitta medal, yetti bosqich', () => {
  it('faqat eng yuqori bosqich CHIZILADI', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 60n * MLN }),
    ])
    const club = rowOf(rows, 'a').medals.filter((m) => m.code === 'club')
    expect(club).toHaveLength(1)
    expect(club[0]!.tier).toBe(3) // 50 mln bosqichi
  })

  it('ball esa o‘tilgan bosqichlar YIG‘INDISI', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 60n * MLN }),
    ])
    const club = rowOf(rows, 'a').medals.find((m) => m.code === 'club')!
    expect(club.points).toBe(100 + 150 + 250) // I + II + III
  })

  it('10 mln dan pastda klub yo‘q', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 9n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('club')
  })

  it('klub JAMI bo‘yicha — oylar qo‘shiladi', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 1, deliveredMinor: 6n * MLN }),
      month({ employeeId: 'a', month: '2026-09-01', deliveredOrders: 1, deliveredMinor: 6n * MLN }),
    ])
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'club')!.tier).toBe(1)
  })

  it('eng yuqori bosqich 1 mlrd', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 1200n * MLN }),
    ])
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'club')!.tier).toBe(7)
  })
})

describe('oylik medallar faqat YOPILGAN oyda beriladi', () => {
  it('joriy oy podium medali bermaydi — o‘rni har kuni o‘zgaradi', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-09-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('month-gold')
  })

  it('yopilgan oyning 1-2-3 o‘rni oltin, kumush, bronza beradi', () => {
    const rows = build([
      month({ employeeId: 'a', place: 1, deliveredOrders: 1, deliveredMinor: 3n * MLN }),
      month({ employeeId: 'b', place: 2, deliveredOrders: 1, deliveredMinor: 2n * MLN }),
      month({ employeeId: 'c', place: 3, deliveredOrders: 1, deliveredMinor: MLN }),
      month({ employeeId: 'd', place: 4, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('month-gold')
    expect(codes(rowOf(rows, 'b'))).toContain('month-silver')
    expect(codes(rowOf(rows, 'c'))).toContain('month-bronze')
    expect(codes(rowOf(rows, 'd')).some((c) => c.startsWith('month-'))).toBe(false)
  })

  it('oltin takrorlanadi va sanaladi', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-08-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
      month({ employeeId: 'a', month: '2026-07-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    const gold = rowOf(rows, 'a').medals.find((m) => m.code === 'month-gold')!
    expect(gold.count).toBe(2)
    expect(gold.points).toBe(1000)
    // Sabab — ENG OXIRGI oy, chunki pagon «qachon oldi» deganda oxirgisini
    // ko'rsatadi; eskisi hikoya, yangisi yangilik.
    expect(gold.at).toBe('2026-08-01')
  })
})

describe('sifat medallari', () => {
  it('🎯 oyda eng yuqori konversiyaga, faqat bittasiga', () => {
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 40, deliveredOrders: 30, deliveredMinor: MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 20, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('conversion-master')
    expect(codes(rowOf(rows, 'b'))).not.toContain('conversion-master')
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'conversion-master')!.percent).toBe(75)
  })

  it('20 buyurtmadan kam bo‘lsa 🎯 ham, 💯 ham bermaydi', () => {
    // 19 ta buyurtmada 100% konversiya — statistik shovqin, medal emas.
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 19, deliveredOrders: 19, deliveredMinor: MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 10, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('conversion-master')
    expect(codes(rowOf(rows, 'a'))).not.toContain('clean-month')
    expect(codes(rowOf(rows, 'b'))).toContain('conversion-master')
  })

  it('💯 konversiya 80% va undan yuqori bo‘lganlarning HAMMASIGA', () => {
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 40, deliveredOrders: 32, deliveredMinor: MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 36, deliveredMinor: MLN }),
      month({ employeeId: 'c', confirmedOrders: 40, deliveredOrders: 31, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('clean-month') // aynan 80%
    expect(codes(rowOf(rows, 'b'))).toContain('clean-month')
    expect(codes(rowOf(rows, 'c'))).not.toContain('clean-month') // 77.5%
  })

  it('📅 floor ishlagan kunlarning 60% ida ishlaganga — 100% talab qilinmaydi', () => {
    // Floor 5 kun ishladi (har kuni kimdir tasdiqladi).
    const days = [
      day({ employeeId: 'a', day: '2026-08-01', confirmedOrders: 1 }),
      day({ employeeId: 'a', day: '2026-08-02', confirmedOrders: 1 }),
      day({ employeeId: 'a', day: '2026-08-03', confirmedOrders: 1 }),
      day({ employeeId: 'b', day: '2026-08-04', confirmedOrders: 1 }),
      day({ employeeId: 'b', day: '2026-08-05', confirmedOrders: 1 }),
    ]
    const rows = build(
      [
        month({ employeeId: 'a', confirmedOrders: 3, deliveredOrders: 1, deliveredMinor: MLN }),
        month({ employeeId: 'b', confirmedOrders: 2, deliveredOrders: 1, deliveredMinor: MLN }),
      ],
      days,
    )
    expect(codes(rowOf(rows, 'a'))).toContain('work-month') // 3/5 = 60%
    expect(codes(rowOf(rows, 'b'))).not.toContain('work-month') // 2/5 = 40%
  })

  it('📈 o‘tgan oydan FAKT 2 kamida 50% oshganda', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-07-01', deliveredOrders: 1, deliveredMinor: 10n * MLN }),
      month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 1, deliveredMinor: 15n * MLN }),
      month({ employeeId: 'b', month: '2026-07-01', deliveredOrders: 1, deliveredMinor: 10n * MLN }),
      month({ employeeId: 'b', month: '2026-08-01', deliveredOrders: 1, deliveredMinor: 14n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('jump') // aynan +50%
    expect(codes(rowOf(rows, 'b'))).not.toContain('jump') // +40%
  })

  it('📈 noldan boshlaganga berilmaydi — nolning 50% i ham nol', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-07-01', confirmedOrders: 2 }),
      month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 1, deliveredMinor: 90n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('jump')
  })
})
