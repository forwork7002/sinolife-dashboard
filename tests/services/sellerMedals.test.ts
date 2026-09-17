import { beforeEach, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { SellerBoardService, resetSellerMedalsCache } = await import(
  '@/server/services/sellerBoardService'
)
const { AnalyticsService } = await import('@/server/services/analyticsService')

const MLN = 100_000_000n

/** Faqat `sellerMedalFacts` ni javob beradigan qo'g'irchoq. */
function repoWith(months: unknown[], days: unknown[], calls: { n: number }) {
  return {
    sellerMedalFacts: async () => {
      calls.n++
      return { months, days }
    },
  }
}

const contextAt = (now: Date) =>
  AnalyticsService.context(
    { start: new Date('2026-08-01T00:00:00Z'), end: now, timeZone: 'Asia/Tashkent', preset: 'custom' },
    'UZS',
    {},
    now,
  )

describe('medal servisi', () => {
  beforeEach(() => resetSellerMedalsCache())

  const months = [
    {
      month: '2026-08-01',
      employeeId: 'e1',
      fullName: 'Marjona Xayrullayeva',
      confirmedOrders: 40,
      confirmedMinor: 50n * MLN,
      deliveredOrders: 30,
      deliveredMinor: 30n * MLN,
      place: 1,
    },
  ]

  it('DTO sotuvchi id si bo‘yicha, pul MoneyDto sifatida chiqadi', async () => {
    const calls = { n: 0 }
    const service = new SellerBoardService(
      {} as never,
      repoWith(months, [], calls) as never,
      {} as never,
    )
    const dto = await service.medals(contextAt(new Date('2026-09-15T06:00:00Z')))
    const row = dto.sellers.find((s) => s.employeeId === 'e1')!

    /*
      ANIQ QIYMAT. e1 avgustda 1-o‘rin, 40 tasdiqlangandan 30 tasi yetkazilgan.
      Medallar: 🥇 (place 1), 🎯 (75%, 40 ≥ 20), 🌱. 💯 tushmaydi (75% < 80),
      📅 tushmaydi (kun fakti yo‘q), 📈/🔥/⭐/🏆/🚀 tushmaydi.

      PAYLOAD DARAJASIZ — `{ sellers: [{ employeeId, medals }], from }` va
      boshqa hech narsa (2026-09-17, mijoz: «uroven kerak emas»). Kalitlar
      AYNAN sanab o‘tilgan: daraja maydonlaridan biri qaytsa, shu yerda yiqiladi.
    */
    expect(Object.keys(dto).sort()).toEqual(['from', 'sellers'])
    expect(Object.keys(row).sort()).toEqual(['employeeId', 'medals'])
    expect(row.medals.map((m) => m.code)).toEqual(['month-gold', 'conversion-master', 'first-sale'])
    const gold = row.medals.find((m) => m.code === 'month-gold')!
    expect(gold.amount).not.toBeNull()
    expect(gold.amount!.currency).toBe('UZS')
    expect(gold.amount!.amount).toBe(30_000_000)
    expect('points' in gold).toBe(false)
    expect('tier' in gold).toBe(false)
  })

  it('ESHIK YO‘Q: jami 3 mln yetkazgan sotuvchi 🔥 ni oladi — ilgari 100 mln kerak edi', async () => {
    const tiny = ['2026-06-01', '2026-07-01', '2026-08-01'].map((month) => ({
      month,
      employeeId: 'e2',
      fullName: 'Kichik Pul',
      confirmedOrders: 1,
      confirmedMinor: 1n * MLN,
      deliveredOrders: 1,
      deliveredMinor: 1n * MLN,
      place: 2,
    }))
    const service = new SellerBoardService(
      {} as never,
      repoWith(tiny, [], { n: 0 }) as never,
      {} as never,
    )
    const dto = await service.medals(contextAt(new Date('2026-09-15T06:00:00Z')))
    const row = dto.sellers.find((s) => s.employeeId === 'e2')!
    expect(row.medals.map((m) => m.code)).toEqual([
      'month-silver',
      'streak-fire',
      'streak-steady',
      'first-sale',
    ])
    expect(row.medals.find((m) => m.code === 'month-silver')!.count).toBe(3)
  })

  it('medalsiz sotuvchi ham ro‘yxatda — `medals: []` bilan', async () => {
    // SHARTNOMA: oynada oy fakti bor har sotuvchi qator oladi. Ekran javobni
    // `employeeId` bo‘yicha xaritaga yig‘adi, shuning uchun bo‘sh qator zararsiz.
    const idle = [{ ...months[0]!, employeeId: 'e3', confirmedOrders: 3, deliveredOrders: 0, deliveredMinor: 0n, place: 40 }]
    const service = new SellerBoardService(
      {} as never,
      repoWith(idle, [], { n: 0 }) as never,
      {} as never,
    )
    const dto = await service.medals(contextAt(new Date('2026-09-15T06:00:00Z')))
    expect(dto.sellers).toEqual([{ employeeId: 'e3', medals: [] }])
  })

  it('devorning o‘zi bilan bir oynani o‘qiydi — RECORDS_FROM dan', async () => {
    const calls = { n: 0 }
    const service = new SellerBoardService(
      {} as never,
      repoWith(months, [], calls) as never,
      {} as never,
    )
    const dto = await service.medals(contextAt(new Date('2026-09-15T06:00:00Z')))
    expect(dto.from).toBe(new Date('2026-07-31T19:00:00.000Z').toISOString())
  })

  it('kesh ikkinchi chaqiriqda bazaga bormaydi', async () => {
    const calls = { n: 0 }
    const service = new SellerBoardService(
      {} as never,
      repoWith(months, [], calls) as never,
      {} as never,
    )
    const ctx = contextAt(new Date('2026-09-15T06:00:00Z'))
    await service.medals(ctx)
    await service.medals(ctx)
    expect(calls.n).toBe(1)
  })

  it('kesh HIT bo‘ladi — ctx.now ikki chaqiriq orasida millisekundlarga farq qilsa ham', async () => {
    /*
      Yuqoridagi test BITTA `ctx`ni ikki marta chaqiradi, ya'ni `period.end`
      kalitda bo‘lsa ham har doim hit bo‘lardi va nuqsonni ushlamas edi. Bu
      yerda ikkita ALOHIDA `ctx.now` beriladi — xuddi ikkita alohida so‘rov
      bir necha millisekund orada kelganidek — aynan `medals()`ning kaliti
      `period.end.toISOString()`ni ushlaganida sindirgan holat. `period.start`
      RECORDS_FROM'dan qurilgani uchun ikkalasida ham bir xil qoladi, shuning
      uchun to‘g‘rilangan kalit bittasiga tushishi kerak.
    */
    const calls = { n: 0 }
    const service = new SellerBoardService(
      {} as never,
      repoWith(months, [], calls) as never,
      {} as never,
    )
    await service.medals(contextAt(new Date('2026-09-15T06:00:00.000Z')))
    await service.medals(contextAt(new Date('2026-09-15T06:00:00.037Z')))
    expect(calls.n).toBe(1)
  })
})
