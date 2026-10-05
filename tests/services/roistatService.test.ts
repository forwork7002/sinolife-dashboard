import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import type { Period } from '@/server/domain/period/period'
import type { CampaignDayRow } from '@/server/repositories/reklamaRepository'
import type { RoistatBitrixRow, RoistatMetaRow } from '@/server/repositories/roistatRepository'

/*
  The service reaches `env` through RNP's brand rule; a unit test supplies the
  required names first and imports afterwards — see cohortsSql.test.ts.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { RoistatService } = await import('@/server/services/roistatService')
const { RoistatRepository } = await import('@/server/repositories/roistatRepository')

const PERIOD: Period = {
  // 01.10–05.10.2026, Tashkent.
  start: new Date('2026-09-30T19:00:00Z'),
  end: new Date('2026-10-05T19:00:00Z'),
  timeZone: 'Asia/Tashkent',
  preset: 'custom',
}
const NOW = new Date('2026-10-05T07:00:00Z')

function bitrixRow(set: RoistatBitrixRow['set'], fields: Partial<RoistatBitrixRow> = {}): RoistatBitrixRow {
  return {
    set,
    day: null,
    sourceId: null,
    sourceName: null,
    formTitle: null,
    targetolog: null,
    productLine: null,
    region: null,
    rop: null,
    seller: null,
    registrar: null,
    leads: 0,
    clean: 0,
    kval: 0,
    orders: 0,
    orderedMinor: 0n,
    sold: 0,
    soldMinor: 0n,
    newCustomers: 0,
    dealDaysSum: 0,
    dealCount: 0,
    ...fields,
  }
}

function campaignDay(fields: Partial<CampaignDayRow>): CampaignDayRow {
  return {
    date: '2026-10-01',
    accountId: '990016692137088', // Umar - 64 → Collagen
    accountName: 'Umar - 64',
    campaignId: '1',
    campaignName: 'Leads ABO',
    objective: 'OUTCOME_LEADS',
    spendMicroUsd: 0n,
    impressions: 0,
    clicks: 0,
    leads: 0,
    conversations: 0,
    ...fields,
  }
}

function metaRow(fields: Partial<RoistatMetaRow>): RoistatMetaRow {
  return {
    accountId: '990016692137088',
    accountName: 'Umar - 64',
    campaignId: '100',
    campaignName: 'Leads ABO',
    objective: 'OUTCOME_LEADS',
    adsetId: null,
    adsetName: null,
    adId: null,
    adName: null,
    spendMicroUsd: 0n,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leads: 0,
    ...fields,
  }
}

function harness() {
  const bitrixCalls: { period: Period; now: Date; shape: string }[] = []
  const metaCalls: unknown[][] = []
  const repository = {
    bitrix: async (period: Period, now: Date, shape = 'all') => {
      bitrixCalls.push({ period, now, shape })
      return shape === 'total'
        ? [bitrixRow('total', { leads: 50, sold: 5, soldMinor: 5_000_000_00n })]
        : [
            bitrixRow('total', { leads: 100, kval: 40, sold: 10, soldMinor: 12_000_000_00n }),
            bitrixRow('day', { day: '2026-10-01', leads: 60, sold: 6, soldMinor: 7_000_000_00n }),
            bitrixRow('day', { day: '2026-10-02', leads: 40, sold: 4, soldMinor: 5_000_000_00n }),
          ]
    },
    meta: async (...args: unknown[]) => {
      metaCalls.push(args)
      return [
        metaRow({ campaignId: '100', campaignName: 'Leads ABO', spendMicroUsd: 30_000_000n }),
        metaRow({ campaignId: '200', campaignName: 'EX - Sinolife (vakansiya) - DM', spendMicroUsd: 99_000_000n }),
        metaRow({ accountId: '517245084208402', accountName: 'Kosmetika Eldor', campaignId: '300', spendMicroUsd: 7_000_000n }),
      ]
    },
    metaName: async (kind: 'campaign' | 'adset', id: string) =>
      kind === 'adset' ? { name: `adset ${id}`, campaignId: '100', campaignName: 'Leads ABO' } : { name: `camp ${id}`, campaignId: id, campaignName: `camp ${id}` },
    metaImportedAt: async () => new Date('2026-10-05T06:00:00Z'),
  }
  const reklama = {
    campaignDays: async (from: string) =>
      from === '2026-10-01'
        ? [
            campaignDay({ date: '2026-10-01', spendMicroUsd: 30_000_000n }),
            campaignDay({ date: '2026-10-02', objective: 'OUTCOME_ENGAGEMENT', spendMicroUsd: 10_000_000n }),
            campaignDay({ date: '2026-10-02', campaignName: 'EX - TOF - Vacancy - 19.09', spendMicroUsd: 50_000_000n }),
          ]
        : [campaignDay({ date: from, spendMicroUsd: 20_000_000n })],
  }
  const usdDays: string[][] = []
  const usd = {
    forDays: async (days: readonly string[]) => {
      usdDays.push([...days])
      return days.map(() => 12_000)
    },
  }
  const service = new RoistatService(repository as never, reklama, usd)
  return { service, bitrixCalls, metaCalls, usdDays }
}

describe('RoistatService.overview', () => {
  it('builds the tiles from the Bitrix total and the ad budget — hiring out', async () => {
    const { service } = harness()
    const r = await service.overview(PERIOD, { dim: 'days' }, NOW)
    // 30 $ form + 10 $ DM; the 50 $ vacancy is not ad budget.
    expect(r.kpi.spendUsd).toBe(40)
    expect(r.kpi.leads).toBe(100)
    expect(r.kpi.soldUzs).toBe(12_000_000)
    expect(r.campaignSpendUsd).toBe(40)
    expect(r.kpiPrevious).toMatchObject({ spendUsd: 20, leads: 50 })
  })

  it('reads the previous cohort at the same age, not as of today', async () => {
    const { service, bitrixCalls } = harness()
    await service.overview(PERIOD, { dim: 'camp' }, NOW)
    const previous = bitrixCalls.find((c) => c.shape === 'total')!
    const shift = PERIOD.start.getTime() - previous.period.start.getTime()
    expect(previous.now.getTime()).toBe(NOW.getTime() - shift)
    expect(bitrixCalls.find((c) => c.shape === 'all')!.now).toEqual(NOW)
  })

  it('lists only ad-budget campaigns on the Meta cut, biggest spend first', async () => {
    const { service } = harness()
    const r = await service.overview(PERIOD, { dim: 'camp' }, NOW)
    expect(r.rows.map((row) => row.key)).toEqual(['100'])
    expect(r.total.spendUsd).toBe(30)
    expect(r.columns).toEqual({ meta: true, leads: false, spend: true, sales: false })
  })

  it('names the drill path: the adset under its campaign', async () => {
    const { service, metaCalls } = harness()
    const r = await service.overview(PERIOD, { dim: 'ad', parent: '555' }, NOW)
    expect(metaCalls[0]).toEqual(['ad', '2026-10-01', '2026-10-05', '555'])
    expect(r.parent).toEqual({ key: '555', label: 'adset 555' })
    expect(r.grandParent).toEqual({ key: '100', label: 'Leads ABO' })
  })

  it('ignores a parent on a cut that has none', async () => {
    const { service, metaCalls } = harness()
    const r = await service.overview(PERIOD, { dim: 'camp', parent: '555' }, NOW)
    expect(metaCalls[0]![3]).toBeNull()
    expect(r.parent).toBeNull()
  })

  it('charts every day up to today, and takes the rate for the last one', async () => {
    const { service, usdDays } = harness()
    const r = await service.overview(PERIOD, { dim: 'days' }, NOW)
    expect(r.daily.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'])
    expect(r.daily[0]).toEqual({ date: '2026-10-01', spendUsd: 30, soldUzs: 7_000_000 })
    expect(usdDays[0]).toEqual(['2026-10-05'])
    expect(r.rate).toEqual({ uzsPerUsd: 12_000, date: '2026-10-05' })
    expect(r.freshFrom).toBe('2026-09-29')
  })
})

describe('RoistatService.days — «Kunlar boʻyicha» on Savdo dinamikasi', () => {
  it('answers the overview\'s «Дни» rows exactly, without the previous window or Meta cut', async () => {
    const { service, bitrixCalls, metaCalls } = harness()
    const overview = await service.overview(PERIOD, { dim: 'days' }, NOW)
    bitrixCalls.length = 0
    const days = await service.days(PERIOD, NOW)
    expect(days.dim).toBe('days')
    expect(days.rows).toEqual(overview.rows)
    expect(days.total).toEqual(overview.total)
    expect(days.columns).toEqual(overview.columns)
    expect(days.rate).toEqual(overview.rate)
    expect(days.freshFrom).toBe(overview.freshFrom)
    // Newest day first, as the reference's «Дни».
    expect(days.rows.map((r) => r.key)).toEqual(['2026-10-02', '2026-10-01'])
    // Only the () and (day) sets are asked for.
    expect(bitrixCalls.map((c) => c.shape)).toEqual(['days'])
    expect(metaCalls).toHaveLength(0)
  })
})

describe('RoistatRepository.bitrix — which set a row is', () => {
  /** A raw row with every flag rolled up except the named ones. */
  function raw(grouped: readonly string[], fields: Record<string, unknown> = {}) {
    const flags = ['g_day', 'g_form', 'g_targetolog', 'g_source', 'g_source_name', 'g_product', 'g_region', 'g_rop', 'g_seller', 'g_registrar']
    return {
      ...Object.fromEntries(flags.map((f) => [f, grouped.includes(f) ? 0 : 1])),
      leads: 1n,
      clean: 1n,
      kval: 0n,
      orders: 0n,
      ordered_minor: '0',
      sold: 0n,
      sold_minor: '0',
      new_customers: 0n,
      deal_days_sum: null,
      deal_count: 0n,
      ...fields,
    }
  }

  it('tells the product set from the form and source sets it shares columns with', async () => {
    const answer = [
      raw([]),
      raw(['g_day']),
      raw(['g_form', 'g_targetolog']),
      raw(['g_source', 'g_source_name']),
      raw(['g_source', 'g_form', 'g_product']),
      raw(['g_region']),
      raw(['g_rop']),
      raw(['g_seller']),
      raw(['g_registrar']),
    ]
    const prisma = { $queryRawUnsafe: async () => answer } as unknown as PrismaClient
    const rows = await new RoistatRepository(prisma).bitrix(PERIOD, NOW)
    expect(rows.map((r) => r.set)).toEqual(['total', 'day', 'form', 'source', 'product', 'region', 'rop', 'seller', 'registrar'])
  })
})
