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
      ANIQ QIYMAT, «noldan katta» EMAS. `toBeGreaterThan(1)` motorni
      servisga noto‘g‘ri ulagan holatda ham o‘tardi — bu test aynan
      ulanishni tekshirish uchun bor. Hisob, qadam-baqadam:

        kundalik ish  40·10 + 30·25 + 30·5   = 1 300
        🥇 oy chempioni (place 1)            =   500
        🎯 konversiya ustasi (75%, 40 ≥ 20)  =   400
        🌱 birinchi savdo                    =   100
        💎 klub: 30 mln → I va II bosqich    =   250
                                               -----
                                               2 550

      💯 tushmaydi (75% < 80), 📅 tushmaydi (kun fakti yo‘q), 📈/🔥/⭐/🏆
      tushmaydi (bitta yopilgan oy), 🚀 tushmaydi (2026-08 < 2026-09).
      7-daraja 2 100 ballda, 8-daraja 2 800 da.
    */
    expect(row.points).toBe(2_550)
    expect(row.level).toBe(7)
    expect(row.rankTitle).toBe('Sotuvchi')
    expect(row.nextLevelAt).toBe(2_800)
    expect(row.nextTitle).toBe('Katta sotuvchi')
    expect(row.medals.map((m) => m.code).sort()).toEqual([
      'club',
      'conversion-master',
      'first-sale',
      'month-gold',
    ])
    const gold = row.medals.find((m) => m.code === 'month-gold')!
    expect(gold.amount).not.toBeNull()
    expect(gold.amount!.currency).toBe('UZS')
    expect(gold.amount!.amount).toBe(30_000_000)
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
})
