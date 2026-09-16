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
      ANIQ QIYMAT. e1 avgustda 30 mln yetkazgan → 3-daraja (30 mln ostonasi
      AYNAN), keyingi ostona 100 mln (Usta). Medallar: 🥇 (place 1, eshik 2),
      🎯 (75%, 40 ≥ 20, eshik 3), 🌱 — uchalasi 3-darajada ochiq. 💯 tushmaydi
      (75% < 80), 📅 tushmaydi (kun fakti yo‘q), 📈/🔥/⭐/🏆/🚀 tushmaydi.
      Kunlik fakt yo‘q → promotedOn null. today — 2026-09-15T06:00Z Toshkentda
      2026-09-15.
    */
    expect(row.level).toBe(3)
    expect(row.legendaTier).toBe(0)
    expect(row.rankTitle).toBe('Katta sotuvchi')
    expect(row.delivered.amount).toBe(30_000_000)
    expect(row.delivered.currency).toBe('UZS')
    expect(row.levelFloor.amount).toBe(30_000_000)
    expect(row.nextLevelAt.amount).toBe(100_000_000)
    expect(row.nextTitle).toBe('Usta')
    expect(row.promotedOn).toBeNull()
    expect(dto.today).toBe('2026-09-15')
    expect(row.medals.map((m) => m.code)).toEqual(['month-gold', 'conversion-master', 'first-sale'])
    const gold = row.medals.find((m) => m.code === 'month-gold')!
    expect(gold.amount).not.toBeNull()
    expect(gold.amount!.currency).toBe('UZS')
    expect(gold.amount!.amount).toBe(30_000_000)
    expect('points' in gold).toBe(false)
    expect('tier' in gold).toBe(false)
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
