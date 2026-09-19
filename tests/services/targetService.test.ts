import { beforeEach, describe, expect, it } from 'vitest'

import type { Period } from '@/server/domain/period/period'
import { TARGET_SOURCE_IDS } from '@/server/integrations/crm/bitrix24/mapping'
import type { MarketingService } from '@/server/services/marketingService'
import type {
  TargetCountersRow,
  TargetRepository,
  TargetWindow,
} from '@/server/repositories/targetRepository'

/*
  The repository reads `env` at module scope for APP_TIMEZONE, and `env`
  refuses to load without a complete configuration. A unit test has no
  database and no secrets, so it supplies the four required names first and
  imports afterwards — the preamble `cohortsSql.test.ts` explains.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { NOT_STATED } = await import('@/server/repositories/targetRepository')
const { TargetService, countersDto, fillDays, resetTargetCaches } = await import(
  '@/server/services/targetService'
)

const ZERO: TargetCountersRow = {
  leads: 0,
  leadCustomers: 0,
  leadWon: 0,
  leadLost: 0,
  sales: 0,
  orders: 0,
  orderedMinor: 0n,
  delivered: 0,
  deliveredMinor: 0n,
  returned: 0,
  returnedMinor: 0n,
  inTransit: 0,
  confirming: 0,
  sellerLost: 0,
}

const PERIOD: Period = {
  // 1–3 September in Tashkent (UTC+5).
  start: new Date('2026-08-31T19:00:00Z'),
  end: new Date('2026-09-03T19:00:00Z'),
  timeZone: 'Asia/Tashkent',
  preset: 'custom',
}

describe('countersDto', () => {
  it('prints no rate over an empty denominator — a source with no leads has no pass rate', () => {
    const dto = countersDto(ZERO)
    expect(dto.passPercent).toBeNull()
    expect(dto.orderPercent).toBeNull()
    expect(dto.buyoutPercent).toBeNull()
    expect(dto.averageCheque).toBeNull()
    expect(dto.revenuePerLead).toBeNull()
  })

  it('divides orders by LEADS and the buyout by the parcels that resolved', () => {
    const dto = countersDto({
      ...ZERO,
      leads: 200,
      leadWon: 80,
      orders: 50,
      delivered: 30,
      deliveredMinor: 30n * 69_000_000n,
      returned: 10,
    })
    expect(dto.passPercent).toBe(40)
    expect(dto.orderPercent).toBe(25)
    // 30 of the 40 that came back one way or the other — not of the 50 ordered.
    expect(dto.buyoutPercent).toBe(75)
    expect(dto.averageCheque?.amount).toBe(690_000)
    expect(dto.revenuePerLead?.amount).toBe(103_500)
  })
})

describe('fillDays', () => {
  it('draws a quiet day as a zero, not as a gap', () => {
    const days = fillDays(PERIOD, [{ key: '2026-09-02', ...ZERO, leads: 5 }])
    expect(days.map((d) => d.key)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(days.map((d) => d.leads)).toEqual([0, 5, 0])
  })
})

describe('TargetService.overview', () => {
  let asked: TargetWindow[]
  let service: InstanceType<typeof TargetService>

  beforeEach(() => {
    resetTargetCaches()
    asked = []
    const repository = {
      summary: async (window: TargetWindow) => {
        asked.push(window)
        return {
          total: { ...ZERO, leads: 3 },
          sources: [],
          targetologs: [{ key: NOT_STATED, ...ZERO, leads: 3 }],
          creatives: [],
          days: [],
          stages: [],
        }
      },
      sources: async () => [
        { externalId: 'UC_1X1J24', name: 'sinolifeuz', isTarget: true },
        { externalId: 'CALL', name: 'Входящий', isTarget: false },
      ],
    } as unknown as TargetRepository
    const marketing = {
      overview: async () => ({ snapshot: null }),
    } as unknown as MarketingService
    service = new TargetService(repository, marketing)
  })

  it('counts the seven target pages by default and every source when asked', async () => {
    await service.overview(PERIOD, 'target', 'Asia/Tashkent', new Date())
    await service.overview(PERIOD, 'all', 'Asia/Tashkent', new Date())
    expect(asked.map((w) => w.sourceIds)).toEqual([TARGET_SOURCE_IDS, null])
  })

  it('keys the memo on the scope — «all» never serves the target answer', async () => {
    await service.overview(PERIOD, 'target', 'Asia/Tashkent', new Date())
    await service.overview(PERIOD, 'target', 'Asia/Tashkent', new Date())
    await service.overview(PERIOD, 'all', 'Asia/Tashkent', new Date())
    expect(asked).toHaveLength(2)
  })

  it('says «not imported» for the ad ledger rather than printing zero spend', async () => {
    const dto = await service.overview(PERIOD, 'target', 'Asia/Tashkent', new Date())
    expect(dto.ads).toBeNull()
    expect(dto.sources).toEqual([
      { name: 'sinolifeuz', isTarget: true },
      { name: 'Входящий', isTarget: false },
    ])
    expect(dto.days).toHaveLength(3)
  })
})
