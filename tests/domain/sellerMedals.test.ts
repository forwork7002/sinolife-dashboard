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
