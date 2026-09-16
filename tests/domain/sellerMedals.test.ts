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

const build = (months: SellerMonthFact[], days: SellerDayFact[] = [], runningDay = '2026-09-01') =>
  buildSellerMedals({ months, days, runningMonth: '2026-09', runningDay })

const rowOf = <T extends { employeeId: string }>(rows: readonly T[], id: string) =>
  rows.find((r) => r.employeeId === id)!

const codes = (row: { medals: readonly { code: string }[] }) => row.medals.map((m) => m.code)

describe('oylik medallar faqat YOPILGAN oyda beriladi', () => {
  it('joriy oy podium medali bermaydi — o‘rni har kuni o‘zgaradi', () => {
    // Eshik: 2-daraja — 10 mln, ya'ni medalni to'sayotgani DARAJA emas, joriy oy.
    const rows = build([
      month({ employeeId: 'a', month: '2026-09-01', place: 1, deliveredOrders: 1, deliveredMinor: 10n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('month-gold')
  })

  it('yopilgan oyning 1-2-3 o‘rni oltin, kumush, bronza beradi', () => {
    // Eshik: 2-daraja — to'rtalasi ham 10 mln dan oshgan, ya'ni faqat O'RIN hal qiladi.
    const rows = build([
      month({ employeeId: 'a', place: 1, deliveredOrders: 1, deliveredMinor: 30n * MLN }),
      month({ employeeId: 'b', place: 2, deliveredOrders: 1, deliveredMinor: 20n * MLN }),
      month({ employeeId: 'c', place: 3, deliveredOrders: 1, deliveredMinor: 10n * MLN }),
      month({ employeeId: 'd', place: 4, deliveredOrders: 1, deliveredMinor: 10n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('month-gold')
    expect(codes(rowOf(rows, 'b'))).toContain('month-silver')
    expect(codes(rowOf(rows, 'c'))).toContain('month-bronze')
    expect(codes(rowOf(rows, 'd')).some((c) => c.startsWith('month-'))).toBe(false)
  })

  it('oltin takrorlanadi va sanaladi', () => {
    // Eshik: 2-daraja — ikki oyda jami 10 mln.
    const rows = build([
      month({ employeeId: 'a', month: '2026-08-01', place: 1, deliveredOrders: 1, deliveredMinor: 5n * MLN }),
      month({ employeeId: 'a', month: '2026-07-01', place: 1, deliveredOrders: 1, deliveredMinor: 5n * MLN }),
    ])
    const gold = rowOf(rows, 'a').medals.find((m) => m.code === 'month-gold')!
    expect(gold.count).toBe(2)
    // Sabab — ENG OXIRGI oy, chunki lavha «qachon oldi» deganda oxirgisini
    // ko'rsatadi; eskisi hikoya, yangisi yangilik.
    expect(gold.at).toBe('2026-08-01')
  })
})

describe('sifat medallari', () => {
  it('🎯 oyda eng yuqori konversiyaga, faqat bittasiga', () => {
    // Eshik: 3-daraja — ikkalasi ham 30 mln, ya'ni faqat KONVERSIYA hal qiladi.
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 40, deliveredOrders: 30, deliveredMinor: 30n * MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 20, deliveredMinor: 30n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('conversion-master')
    expect(codes(rowOf(rows, 'b'))).not.toContain('conversion-master')
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'conversion-master')!.percent).toBe(75)
  })

  it('20 buyurtmadan kam bo‘lsa 🎯 ham, 💯 ham bermaydi', () => {
    // 19 ta buyurtmada 100% konversiya — statistik shovqin, medal emas.
    // Eshik: 3-daraja — ikkalasi ham 30 mln, ya'ni to'sayotgani buyurtma soni.
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 19, deliveredOrders: 19, deliveredMinor: 30n * MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 10, deliveredMinor: 30n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('conversion-master')
    expect(codes(rowOf(rows, 'a'))).not.toContain('clean-month')
    expect(codes(rowOf(rows, 'b'))).toContain('conversion-master')
  })

  it('💯 konversiya 80% va undan yuqori bo‘lganlarning HAMMASIGA', () => {
    // Eshik: 2-daraja — uchalasi ham 10 mln, ya'ni faqat FOIZ hal qiladi.
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 40, deliveredOrders: 32, deliveredMinor: 10n * MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 36, deliveredMinor: 10n * MLN }),
      month({ employeeId: 'c', confirmedOrders: 40, deliveredOrders: 31, deliveredMinor: 10n * MLN }),
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

/* Eshik: 🔥 4-daraja — oyiga 40 mln, jami 120 mln, ya'ni faqat O'RIN hal qiladi. */
const threeMonths = (id: string, places: [number, number, number]) => [
  month({ employeeId: id, month: '2026-06-01', place: places[0], deliveredOrders: 1, deliveredMinor: 40n * MLN }),
  month({ employeeId: id, month: '2026-07-01', place: places[1], deliveredOrders: 1, deliveredMinor: 40n * MLN }),
  month({ employeeId: id, month: '2026-08-01', place: places[2], deliveredOrders: 1, deliveredMinor: 40n * MLN }),
]

describe('seriya medallari', () => {
  it('🔥 3 oy ketma-ket top-3 da', () => {
    const rows = build(threeMonths('a', [1, 3, 2]))
    expect(codes(rowOf(rows, 'a'))).toContain('streak-fire')
  })

  it('2 oy yetarli emas — tarix qisqa bo‘lsa medal yo‘q', () => {
    // Eshik: 4-daraja — jami 100 mln, ya'ni to'sayotgani seriyaning UZUNLIGI.
    const rows = build([
      month({ employeeId: 'a', month: '2026-07-01', place: 1, deliveredOrders: 1, deliveredMinor: 50n * MLN }),
      month({ employeeId: 'a', month: '2026-08-01', place: 1, deliveredOrders: 1, deliveredMinor: 50n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('streak-fire')
  })

  it('uzilgan seriya noldan sanaladi', () => {
    const rows = build([
      ...threeMonths('a', [1, 9, 2]),
      month({ employeeId: 'a', month: '2026-05-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('streak-fire')
    expect(codes(rowOf(rows, 'a'))).toContain('streak-steady') // 4 oy top-10
  })

  it('oy TUSHIB QOLSA ham seriya uziladi — qatnashmagan oy ketma-ketlik emas', () => {
    /*
      DISKRIMINATSIYA QILADIGAN HOLAT. `a` ning UCHTA saralanadigan oyi bor —
      06, 08, 09 — ya‘ni «sotuvchining O‘Z oylarini ketma-ket sana» degan
      soddalashtirilgan implementatsiya uchga yetib medal berardi. To‘g‘ri
      implementatsiya butun floorning yopilgan oylari bo‘ylab yuradi va 07 da
      `a` ni topolmay sanoqni nolga tushiradi. `b` 07 ni ataylab qoplaydi:
      aks holda 07 umuman `closedMonths` ga tushmasdi va bo‘shliqning o‘zi
      ko‘rinmasdi.
    */
    // Eshik: `a` uchun 4-daraja — jami 120 mln, ya'ni to'sayotgani BO'SHLIQ.
    const rows = buildSellerMedals({
      months: [
        month({ employeeId: 'a', month: '2026-06-01', place: 1, deliveredOrders: 1, deliveredMinor: 40n * MLN }),
        // 2026-07 — `a` qatnashmagan
        month({ employeeId: 'b', month: '2026-07-01', place: 1, deliveredOrders: 1, deliveredMinor: 40n * MLN }),
        month({ employeeId: 'a', month: '2026-08-01', place: 1, deliveredOrders: 1, deliveredMinor: 40n * MLN }),
        month({ employeeId: 'a', month: '2026-09-01', place: 1, deliveredOrders: 1, deliveredMinor: 40n * MLN }),
      ],
      days: [],
      runningMonth: '2026-10',
      runningDay: '2026-10-01',
    })
    expect(codes(rowOf(rows, 'a'))).not.toContain('streak-fire')
    expect(codes(rowOf(rows, 'a'))).not.toContain('streak-steady')
  })

  it('6 oy ketma-ket ikkita 🔥 beradi — seriya tugagach qaytadan boshlanadi', () => {
    // Eshik: 4-daraja — oyiga 20 mln, jami 120 mln.
    const months = Array.from({ length: 6 }, (_, i) =>
      month({
        employeeId: 'a',
        month: `2026-0${i + 3}-01`,
        place: 1,
        deliveredOrders: 1,
        deliveredMinor: 20n * MLN,
      }),
    )
    const rows = build(months)
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'streak-fire')!.count).toBe(2)
  })
})

describe('kun medallari', () => {
  it('🌅 kunning 1-o‘rni, takrorlanadi', () => {
    const rows = build(
      [month({ employeeId: 'a', deliveredOrders: 2, deliveredMinor: 2n * MLN })],
      [
        day({ employeeId: 'a', day: '2026-08-01', place: 1, deliveredMinor: MLN }),
        day({ employeeId: 'a', day: '2026-08-02', place: 1, deliveredMinor: MLN }),
        day({ employeeId: 'a', day: '2026-08-03', place: 2, deliveredMinor: MLN }),
      ],
    )
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'day-winner')!.count).toBe(2)
  })

  it('puli yo‘q kun 1-o‘rin bo‘lsa ham medal bermaydi', () => {
    // Eshik: 1-daraja — 5 mln, ya'ni to'sayotgani KUNNING pulsizligi.
    const rows = build(
      [month({ employeeId: 'a', confirmedOrders: 1, deliveredOrders: 1, deliveredMinor: 5n * MLN })],
      [day({ employeeId: 'a', place: 1, deliveredMinor: 0n })],
    )
    expect(codes(rowOf(rows, 'a'))).not.toContain('day-winner')
  })

  it('⚡ butun tarixdagi eng katta kunga, faqat BITTA kishiga', () => {
    // Eshik: 2-daraja — ikkalasi ham 10 mln dan oshgan, ya'ni faqat KUN hal qiladi.
    const rows = build(
      [
        month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 30n * MLN }),
        month({ employeeId: 'b', deliveredOrders: 1, deliveredMinor: 20n * MLN }),
      ],
      [
        day({ employeeId: 'a', day: '2026-08-01', place: 1, deliveredMinor: 30n * MLN }),
        day({ employeeId: 'b', day: '2026-08-02', place: 1, deliveredMinor: 20n * MLN }),
      ],
    )
    expect(codes(rowOf(rows, 'a'))).toContain('day-record')
    expect(codes(rowOf(rows, 'b'))).not.toContain('day-record')
  })

  it('JORIY KUN na ⚡ na 🌅 beradi — o‘rni kun tugamaguncha o‘zgarib turadi', () => {
    // Eshik: 2-daraja — 10 mln, ya'ni to'sayotgani KUNNING tugamagani.
    const rows = build(
      [month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 10n * MLN })],
      [day({ employeeId: 'a', day: '2026-09-10', place: 1, deliveredMinor: MLN })],
      '2026-09-10',
    )
    const row = rows.find((r) => r.employeeId === 'a')
    expect(row?.medals.some((m) => m.code === 'day-winner')).toBeFalsy()
    expect(row?.medals.some((m) => m.code === 'day-record')).toBeFalsy()
  })

  it('xuddi shu fixture, lekin kun runningDay dan ERTAROQ bo‘lsa — ikkalasi ham beriladi', () => {
    const rows = build(
      [month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 10n * MLN })],
      [day({ employeeId: 'a', day: '2026-09-09', place: 1, deliveredMinor: MLN })],
      '2026-09-10',
    )
    expect(codes(rowOf(rows, 'a'))).toContain('day-winner')
    expect(codes(rowOf(rows, 'a'))).toContain('day-record')
  })
})

describe('yil chempioni va yangi yulduz', () => {
  it('🏆 faqat YOPILGAN kalendar yil uchun', () => {
    // 2026 hali tugamagan — joriy oy 2026-09.
    // Eshik: 5-daraja — 300 mln, ya'ni to'sayotgani YILNING tugamagani.
    const rows = build([
      month({ employeeId: 'a', place: 1, deliveredOrders: 1, deliveredMinor: 300n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('year-champion')
  })

  it('🚀 devor ochilgan oyda berilmaydi — u yerda hamma «yangi» ko‘rinadi', () => {
    // 2026-08 — RECORDS_FROM. Atributsiya nuqsoni butun floorni yangi qiladi.
    const rows = build([
      month({ employeeId: 'a', month: '2026-08-01', place: 2, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('rookie')
  })

  it('🚀 2026-09 dan keyin boshlagan va birinchi to‘liq oyida top-10 ga kirganga', () => {
    const rows = buildSellerMedals({
      months: [
        month({ employeeId: 'a', month: '2026-10-01', place: 7, deliveredOrders: 1, deliveredMinor: MLN }),
      ],
      days: [],
      runningMonth: '2026-11',
      runningDay: '2026-11-01',
    })
    expect(codes(rowOf(rows, 'a'))).toContain('rookie')
  })

  it('🚀 birinchi oyi 11-o‘rin bo‘lsa berilmaydi va keyin ham qaytmaydi', () => {
    const rows = buildSellerMedals({
      months: [
        month({ employeeId: 'a', month: '2026-10-01', place: 11, deliveredOrders: 1, deliveredMinor: MLN }),
        month({ employeeId: 'a', month: '2026-11-01', place: 2, deliveredOrders: 1, deliveredMinor: MLN }),
      ],
      days: [],
      runningMonth: '2026-12',
      runningDay: '2026-12-01',
    })
    expect(codes(rowOf(rows, 'a'))).not.toContain('rookie')
  })
})

describe('daraja — jami yetkazilgan puldan', () => {
  it('oylar qo‘shiladi, joriy oy ham; daraja shundan', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 10, deliveredMinor: 60n * MLN }),
      month({ employeeId: 'a', month: '2026-09-01', deliveredOrders: 5, deliveredMinor: 50n * MLN }),
    ])
    const a = rowOf(rows, 'a')
    expect(a.deliveredMinor).toBe(110n * MLN)
    expect(a.level).toBe(4)
    expect(a.rankTitle).toBe('Usta')
    expect(a.levelFloorMinor).toBe(100n * MLN)
    expect(a.nextLevelAtMinor).toBe(300n * MLN)
    expect(a.nextTitle).toBe('Ustoz')
  })

  it('yetkazilgan savdosi yo‘q sotuvchi 0-darajada, unvonsiz, 🌱 siz', () => {
    const rows = build([month({ employeeId: 'a', confirmedOrders: 5 })])
    const a = rowOf(rows, 'a')
    expect(a.level).toBe(0)
    expect(a.rankTitle).toBeNull()
    expect(a.nextTitle).toBe('Yangi')
    expect(codes(a)).not.toContain('first-sale')
  })

  it('qatorlar jami pul bo‘yicha kamayib', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 5n * MLN }),
      month({ employeeId: 'b', deliveredOrders: 1, deliveredMinor: 50n * MLN }),
    ])
    expect(rows.map((r) => r.employeeId)).toEqual(['b', 'a'])
  })
})

describe('promotedOn — joriy darajaga chiqqan kun', () => {
  it('kunlik yig‘ma ostonadan oshgan BIRINCHI kun', () => {
    const rows = build(
      [month({ employeeId: 'a', deliveredOrders: 3, deliveredMinor: 12n * MLN })],
      [
        day({ employeeId: 'a', day: '2026-08-03', deliveredMinor: 4n * MLN }),
        day({ employeeId: 'a', day: '2026-08-05', deliveredMinor: 7n * MLN }), // yig‘ma 11 ≥ 10 → Sotuvchi
        day({ employeeId: 'a', day: '2026-08-09', deliveredMinor: 1n * MLN }),
      ],
    )
    expect(rowOf(rows, 'a').level).toBe(2)
    expect(rowOf(rows, 'a').promotedOn).toBe('2026-08-05')
  })

  it('kunlar tartibsiz kelsa ham sana bo‘yicha sanaladi', () => {
    const rows = build(
      [month({ employeeId: 'a', deliveredOrders: 2, deliveredMinor: 12n * MLN })],
      [
        day({ employeeId: 'a', day: '2026-08-09', deliveredMinor: 7n * MLN }),
        day({ employeeId: 'a', day: '2026-08-03', deliveredMinor: 5n * MLN }),
      ],
    )
    // 08-03: 5; 08-09: 12 ≥ 10 → 08-09 (tartibsiz berilsa ham).
    expect(rowOf(rows, 'a').promotedOn).toBe('2026-08-09')
  })

  it('0-darajada va kunlik fakt bo‘lmaganda null', () => {
    const rows = build([month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 5n * MLN })])
    expect(rowOf(rows, 'a').promotedOn).toBeNull()
    const zero = build([month({ employeeId: 'z', confirmedOrders: 1 })])
    expect(rowOf(zero, 'z').promotedOn).toBeNull()
  })
})

describe('daraja medallarni ochadi', () => {
  it('Yangi‘da 🔥 uzatilmaydi, Usta‘da uzatiladi — qoida bir xil, eshik boshqa', () => {
    const streak = (id: string, perMonth: bigint) => [
      month({ employeeId: id, month: '2026-05-01', deliveredOrders: 1, deliveredMinor: perMonth, place: 1 }),
      month({ employeeId: id, month: '2026-06-01', deliveredOrders: 1, deliveredMinor: perMonth, place: 1 }),
      month({ employeeId: id, month: '2026-07-01', deliveredOrders: 1, deliveredMinor: perMonth, place: 1 }),
    ]
    // 3 × 1 mln = 3 mln → Yangi (1-daraja): 🔥 qoidasi bajarilgan, lekin eshik 4.
    const low = rowOf(build(streak('a', 1n * MLN)), 'a')
    expect(low.level).toBe(1)
    expect(codes(low)).not.toContain('streak-fire')
    // 3 × 40 mln = 120 mln → Usta (4-daraja): ochiq.
    const high = rowOf(build(streak('b', 40n * MLN)), 'b')
    expect(high.level).toBe(4)
    expect(codes(high)).toContain('streak-fire')
  })

  it('Yangi‘da ochiq bo‘lganlar: 🌱, 📅, 🌅, 🚀; Sotuvchi‘da oy podiumi', () => {
    // 5 mln → Yangi: oltin oy QOIDASI bajariladi (place 1), lekin eshik 2.
    const rows = build([month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 5n * MLN, place: 1 })])
    expect(codes(rowOf(rows, 'a'))).toEqual(['first-sale'])
    const rich = build([month({ employeeId: 'b', deliveredOrders: 1, deliveredMinor: 15n * MLN, place: 1 })])
    expect(codes(rowOf(rich, 'b'))).toEqual(['month-gold', 'first-sale'])
  })
})

describe('medal tartibi', () => {
  it('MEDAL_ORDER bo‘yicha: oltin oy 🌱 dan oldin, 🌅 📅 dan oldin', () => {
    const rows = build(
      [
        month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 20, confirmedOrders: 20, deliveredMinor: 40n * MLN, place: 1 }),
      ],
      [
        day({ employeeId: 'a', day: '2026-08-04', confirmedOrders: 1, deliveredMinor: 2n * MLN, place: 1 }),
      ],
    )
    const got = codes(rowOf(rows, 'a'))
    // 40 mln → Katta sotuvchi (3): 🥇 (2), 🎯 (3), ⚡ (2), 💯 (2), 🌅 (1), 📅 (1 — floor 1 kun ishlagan, u ham), 🌱 (1) hammasi ochiq.
    expect(got).toEqual(['month-gold', 'conversion-master', 'day-record', 'clean-month', 'day-winner', 'work-month', 'first-sale'])
  })
})
