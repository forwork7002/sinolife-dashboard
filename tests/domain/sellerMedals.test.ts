import { describe, expect, it } from 'vitest'

import {
  MEDAL_CODES,
  MEDAL_ORDER,
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
    const rows = build([
      month({ employeeId: 'a', month: '2026-09-01', place: 1, deliveredOrders: 1, deliveredMinor: 10n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('month-gold')
  })

  it('yopilgan oyning 1-2-3 o‘rni oltin, kumush, bronza beradi', () => {
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
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 19, deliveredOrders: 19, deliveredMinor: 30n * MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 10, deliveredMinor: 30n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('conversion-master')
    expect(codes(rowOf(rows, 'a'))).not.toContain('clean-month')
    expect(codes(rowOf(rows, 'b'))).toContain('conversion-master')
  })

  it('💯 konversiya 80% va undan yuqori bo‘lganlarning HAMMASIGA', () => {
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
    const rows = build(
      [month({ employeeId: 'a', confirmedOrders: 1, deliveredOrders: 1, deliveredMinor: 5n * MLN })],
      [day({ employeeId: 'a', place: 1, deliveredMinor: 0n })],
    )
    expect(codes(rowOf(rows, 'a'))).not.toContain('day-winner')
  })

  it('⚡ butun tarixdagi eng katta kunga, faqat BITTA kishiga', () => {
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

describe('qatorlar — kim ro‘yxatda va qaysi tartibda', () => {
  it('yetkazilgan savdosi yo‘q sotuvchi ham qator oladi — medalsiz, 🌱 siz', () => {
    // SHARTNOMA: oynada oy fakti bor har sotuvchi ro‘yxatda, `medals: []` bilan ham.
    const rows = build([month({ employeeId: 'a', confirmedOrders: 5 })])
    expect(rows).toHaveLength(1)
    expect(rowOf(rows, 'a').medals).toEqual([])
  })

  it('🌱 joriy oydagi birinchi yetkazishdan ham beriladi — u JAMI bo‘yicha', () => {
    const rows = build([month({ employeeId: 'a', month: '2026-09-01', deliveredOrders: 1, deliveredMinor: MLN })])
    expect(codes(rowOf(rows, 'a'))).toEqual(['first-sale'])
    expect(rowOf(rows, 'a').medals[0]!.at).toBe('2026-09-01')
  })

  it('qatorlar `employeeId` bo‘yicha — Map tartibi ham, pul ham emas', () => {
    /*
      IKKI SO‘ROV BIR XIL JAVOB BERISHI KERAK. Tartibni `drafts` Map‘ining
      kiritilish tartibi hal qilsa — ya‘ni SQL qatorlarining kelish tartibi —
      javob o‘n daqiqada bir o‘zgarib turardi. Fixture ATAYLAB teskari
      kiritilgan, va `b` ning puli ko‘p: daraja bilan birga «jami pul
      bo‘yicha» tartib ham ketdi.
    */
    const rows = build([
      month({ employeeId: 'b', deliveredOrders: 1, deliveredMinor: 50n * MLN }),
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 5n * MLN }),
    ])
    expect(rows.map((r) => r.employeeId)).toEqual(['a', 'b'])
  })

  it('qatorda FAQAT `employeeId` va `medals` — daraja maydonlari yo‘q', () => {
    const rows = build([month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 120n * MLN, place: 1 })])
    expect(Object.keys(rowOf(rows, 'a')).sort()).toEqual(['employeeId', 'medals'])
  })
})

describe('medallar ESHIKSIZ — jami pul medalni yashira olmaydi', () => {
  /*
    2026-09-17 gacha har medalning «ochilish darajasi» bor edi: 🔥 4-darajada
    (jami 100 mln), 🏆 5-darajada (300 mln), oy podiumi 2-darajada (10 mln).
    Daraja olib tashlandi — mijoz: «uroven kerak emas, medallar qolsin» — va
    ko‘rinmaydigan daraja medalni yashira olmaydi. Quyidagi har bir fixture
    ESKI ESHIKDAN ATAYLAB PAST: eshik qaytsa, shu testlar yiqiladi.
  */
  const streak = (id: string, perMonth: bigint) => [
    month({ employeeId: id, month: '2026-05-01', deliveredOrders: 1, deliveredMinor: perMonth, place: 1 }),
    month({ employeeId: id, month: '2026-06-01', deliveredOrders: 1, deliveredMinor: perMonth, place: 1 }),
    month({ employeeId: id, month: '2026-07-01', deliveredOrders: 1, deliveredMinor: perMonth, place: 1 }),
  ]

  it('🔥 jami 3 mln bilan ham uzatiladi — ilgari 100 mln kerak edi', () => {
    const low = rowOf(build(streak('a', 1n * MLN)), 'a')
    expect(codes(low)).toContain('streak-fire')
    expect(codes(low)).toContain('streak-steady')
    // Pul ko‘p bo‘lganda ham AYNAN shu medallar: qoida bitta, eshik yo‘q.
    const high = rowOf(build(streak('b', 40n * MLN)), 'b')
    expect(codes(high)).toEqual(codes(low))
  })

  it('🏆 yopilgan yilning chempioni 2 mln bilan ham uzatiladi — ilgari 300 mln kerak edi', () => {
    const rows = buildSellerMedals({
      months: [
        month({ employeeId: 'a', month: '2025-11-01', place: 1, deliveredOrders: 1, deliveredMinor: 2n * MLN }),
        month({ employeeId: 'b', month: '2025-11-01', place: 2, deliveredOrders: 1, deliveredMinor: 1n * MLN }),
      ],
      days: [],
      runningMonth: '2026-09',
      runningDay: '2026-09-01',
    })
    const champion = rowOf(rows, 'a').medals.find((m) => m.code === 'year-champion')!
    expect(champion).toBeDefined()
    expect(champion.at).toBe('2025-12-01')
    expect(champion.amountMinor).toBe(2n * MLN)
    expect(codes(rowOf(rows, 'b'))).not.toContain('year-champion')
  })

  it('oy podiumi va 🎯 5 mln bilan ham uzatiladi — ilgari 10 va 30 mln kerak edi', () => {
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 40, deliveredOrders: 30, deliveredMinor: 5n * MLN, place: 1 }),
    ])
    expect(codes(rowOf(rows, 'a'))).toEqual(['month-gold', 'conversion-master', 'first-sale'])
  })
})

describe('medal tartibi', () => {
  it('MEDAL_ORDER har kodni AYNAN bir marta tashiydi', () => {
    /*
      `orderIndex.get(code)!` ro‘yxatda yo‘q kod uchun `undefined` beradi,
      ayirmasi esa NaN — `sort` uni 0 deb o‘qiydi va medallar jim
      aralashib chiqadi. Yangi kod qo‘shilib bu ro‘yxatga yozilmasa,
      xato shu yerda ko‘rinadi, taxtada emas.
    */
    expect([...MEDAL_ORDER].sort()).toEqual([...MEDAL_CODES].sort())
    expect(MEDAL_ORDER).toHaveLength(MEDAL_CODES.length)
  })

  it('MEDAL_ORDER — haqiqiy metall avval, keyin gilt, keyin po‘lat (mijoz qarori, 2026-09-17)', () => {
    expect(MEDAL_ORDER).toEqual([
      'year-champion',
      'month-gold',
      'month-silver',
      'month-bronze',
      'streak-fire',
      'conversion-master',
      'day-record',
      'streak-steady',
      'clean-month',
      'jump',
      'rookie',
      'day-winner',
      'work-month',
      'first-sale',
    ])
  })

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
    // 🥇, 🎯 (100%, 20 ≥ 20), ⚡, 💯, 🌅, 📅 (floor 1 kun ishlagan, u ham) va 🌱 — hammasi, shu tartibda.
    expect(got).toEqual(['month-gold', 'conversion-master', 'day-record', 'clean-month', 'day-winner', 'work-month', 'first-sale'])
  })
})
