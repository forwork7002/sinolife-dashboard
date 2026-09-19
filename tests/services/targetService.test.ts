import { beforeEach, describe, expect, it } from 'vitest'

import type { Period } from '@/server/domain/period/period'
import { TARGET_SOURCE_IDS } from '@/server/integrations/crm/bitrix24/mapping'
import type { MarketingRepository } from '@/server/repositories/marketingRepository'
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
const { TargetService, countersDto, fillDays, metaBlock, resetTargetCaches } = await import(
  '@/server/services/targetService'
)

const ZERO: TargetCountersRow = {
  leads: 0,
  leadCustomers: 0,
  leadWon: 0,
  sales: 0,
  orders: 0,
  orderedMinor: 0n,
  delivered: 0,
  deliveredMinor: 0n,
  returned: 0,
  returnedMinor: 0n,
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
      targetSources: async () => [
        { externalId: 'UC_1X1J24', name: 'sinolifeuz' },
        { externalId: 'UC_A8LE21', name: 'zextrauzb' },
      ],
      metaSpend: async () => [],
      metaImportedAt: async () => null,
    } as unknown as TargetRepository
    const marketing = { snapshot: async () => null } as unknown as MarketingRepository
    service = new TargetService(repository, marketing)
  })

  it('counts the seven target pages by default and every source when asked', async () => {
    await service.overview(PERIOD, 'target', 'Asia/Tashkent')
    await service.overview(PERIOD, 'all', 'Asia/Tashkent')
    expect(asked.map((w) => w.sourceIds)).toEqual([TARGET_SOURCE_IDS, null])
  })

  it('keys the memo on the scope — «all» never serves the target answer', async () => {
    await service.overview(PERIOD, 'target', 'Asia/Tashkent')
    await service.overview(PERIOD, 'target', 'Asia/Tashkent')
    await service.overview(PERIOD, 'all', 'Asia/Tashkent')
    expect(asked).toHaveLength(2)
  })

  it('says «never imported» for Meta rather than printing zero spend', async () => {
    const dto = await service.overview(PERIOD, 'target', 'Asia/Tashkent')
    expect(dto.meta.importedAt).toBeNull()
    expect(dto.meta.window).toEqual({ from: '2026-09-01', to: '2026-09-03' })
    expect(dto.targetSources).toEqual(['sinolifeuz', 'zextrauzb'])
    expect(dto.days).toHaveLength(3)
  })
})

describe('metaBlock — the «Лид база» sheet', () => {
  const row = (accountId: string, accountName: string, date: string, micro: bigint, leads = 0) => ({
    accountId,
    accountName,
    date,
    spendMicroUsd: micro,
    impressions: 1000,
    clicks: 10,
    leads,
  })

  // 1 August 2026, as Meta reported it and as the sheet shows it.
  const rows = [
    row('1383613729264521', 'Collagen marine Eldor', '2026-08-01', 78_340_000n, 9),
    row('714191238260025', 'Sinolife family Eldor', '2026-08-01', 117_780_000n, 86),
    row('990016692137088', 'Umar - 64', '2026-08-01', 217_970_000n, 199),
    row('1312865112943517', 'Umar 63', '2026-08-01', 38_540_000n, 45),
    row('926218346480236', 'Zextra Kamron 1', '2026-08-01', 221_930_000n, 81),
    row('999', 'Yangi akkaunt', '2026-08-02', 5_000_000n),
  ]

  const block = metaBlock({
    rows,
    importedAt: new Date('2026-09-19T06:00:00Z'),
    window: { from: '2026-08-01', to: '2026-08-02' },
    sources: [
      { key: 'sinolifeuz', ...ZERO, leads: 400, deliveredMinor: 1_000_000_000n },
      { key: 'zextrauzb', ...ZERO, leads: 100 },
      { key: 'Входящий', ...ZERO, leads: 900 },
    ],
    productOfSource: new Map([
      ['sinolifeuz', 'Collagen' as const],
      ['zextrauzb', 'Zextra' as const],
    ]),
    usdRate: 12_000,
    usdRateDate: '19.09.2026',
  })

  it('sums two accounts into one targetolog column, as the sheet does', () => {
    const cols = block.columns.map((c) => `${c.product}:${c.targetolog}`)
    expect(cols).toEqual(['Collagen:Umar', 'Collagen:Элдор', 'Zextra:Kamron', 'Boshqa:Yangi akkaunt'])
    const day = block.days[0]!
    expect(day.cells[cols.indexOf('Collagen:Элдор')]).toBe(196.12)
    expect(day.cells[cols.indexOf('Collagen:Umar')]).toBe(256.51)
    expect(day.total).toBe(674.56)
  })

  it('never drops an unmapped account — it is «Boshqa», still in the total', () => {
    expect(block.total.spendUsd).toBe(679.56)
    expect(block.days[1]!.cells.at(-1)).toBe(5)
  })

  it('pairs a product with its own pages only, never with other sources', () => {
    const collagen = block.products.find((p) => p.product === 'Collagen')!
    expect(collagen.bitrixLeads).toBe(400)
    expect(collagen.costPerBitrixLeadUsd).toBeCloseTo(452.63 / 400, 6)
    // 10 mln soʻm ÷ (452.63 $ × 12 000)
    expect(collagen.roas).toBeCloseTo(10_000_000 / (452.63 * 12_000), 6)
    // «Входящий» is not a target page and is in no product.
    expect(block.total.bitrixLeads).toBe(500)
  })

  it('prints no ROAS without a rate rather than a wrong one', () => {
    const noRate = metaBlock({
      rows,
      importedAt: null,
      window: { from: '2026-08-01', to: '2026-08-02' },
      sources: [],
      productOfSource: new Map(),
      usdRate: null,
      usdRateDate: null,
    })
    expect(noRate.total.roas).toBeNull()
    expect(noRate.total.costPerBitrixLeadUsd).toBeNull()
  })
})
