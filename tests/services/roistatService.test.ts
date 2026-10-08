import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import type { Period } from '@/server/domain/period/period'
import type { RnpTeamDayRow } from '@/server/repositories/insightsRepository'
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

const { RoistatService, faktDays, resetRoistatCaches } = await import('@/server/services/roistatService')

beforeEach(() => {
  resetRoistatCaches()
  teamDays = []
})
const { RoistatRepository } = await import('@/server/repositories/roistatRepository')

const PERIOD: Period = {
  // 01.10–05.10.2026, Tashkent.
  start: new Date('2026-09-30T19:00:00Z'),
  end: new Date('2026-10-05T19:00:00Z'),
  timeZone: 'Asia/Tashkent',
  preset: 'custom',
}
const NOW = new Date('2026-10-05T07:00:00Z')

function teamDay(fields: Partial<RnpTeamDayRow> & Pick<RnpTeamDayRow, 'day' | 'rop'>): RnpTeamDayRow {
  return { fakt1Orders: 0, fakt1Minor: 0n, fakt2Orders: 0, fakt2Minor: 0n, refusedOrders: 0, refusedMinor: 0n, productBrand: null, ...fields }
}

/** The queue cohort's team-days under «Kunlar boʻyicha» — what a case puts here, `days` reads. */
let teamDays: RnpTeamDayRow[] = []
let teamDaysFail = false
const insights = {
  rnpTeamDays: async () => {
    if (teamDaysFail) throw new Error('canceling statement due to statement timeout')
    return teamDays
  },
}

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
    brandSource: null,
    brandForm: null,
    brandLine: null,
    brandTeam: null,
    brandProduct: null,
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
  const service = new RoistatService(repository as never, reklama, usd, insights)
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

  it('sets the queue cohort\'s FAKT beside each day, by the selling team', async () => {
    teamDays = [
      teamDay({ day: '2026-10-01', rop: 'Azizbek', fakt1Minor: 500_000_000n, fakt2Minor: 200_000_000n }),
      teamDay({ day: '2026-10-01', rop: '(ROP yoʻq)', fakt1Minor: 100_000_000n }),
      // БАЗА, one under the name its old deals carry: FAKT 1 is «База», its FAKT 2 on no column.
      teamDay({ day: '2026-10-01', rop: 'Baza', fakt1Minor: 300_000_000n, fakt2Minor: 300_000_000n }),
      teamDay({ day: '2026-10-01', rop: 'Malika', fakt1Minor: 50_000_000n }),
      // A day with orders in the queue and neither a lead nor a dollar.
      teamDay({ day: '2026-10-04', rop: 'Lola', fakt1Minor: 70_000_000n }),
      // Refused only: nothing to show.
      teamDay({ day: '2026-10-03', rop: 'Lola', refusedOrders: 1, refusedMinor: 90_000_000n }),
    ]
    const { service } = harness()
    const days = await service.days(PERIOD, NOW)
    expect(days.fakt!.byDay).toEqual({
      '2026-10-01': { fakt1PrimaryUzs: 6_000_000, fakt1BaseUzs: 3_500_000, fakt2PrimaryUzs: 2_000_000 },
      '2026-10-04': { fakt1PrimaryUzs: 700_000, fakt1BaseUzs: 0, fakt2PrimaryUzs: 0 },
    })
    expect(days.fakt!.total).toEqual({ fakt1PrimaryUzs: 6_700_000, fakt1BaseUzs: 3_500_000, fakt2PrimaryUzs: 2_000_000 })
    // The FAKT-only day gets a row of its own, in day order; the lead cohort's total is untouched.
    expect(days.rows.map((r) => r.key)).toEqual(['2026-10-04', '2026-10-02', '2026-10-01'])
    expect(days.rows[0]).toMatchObject({ leads: 0, spendUsd: 0, soldUzs: 0 })
    const overview = await service.overview(PERIOD, { dim: 'days' }, NOW)
    expect(days.total).toEqual(overview.total)
    // /roistat's own «Дни» carries no FAKT.
    expect('fakt' in overview).toBe(false)
  })

  it('still draws the table when the FAKT scan fails', async () => {
    teamDaysFail = true
    const { service } = harness()
    const days = await service.days(PERIOD, NOW).finally(() => {
      teamDaysFail = false
    })
    expect(days.rows.map((r) => r.key)).toEqual(['2026-10-02', '2026-10-01'])
    expect('fakt' in days).toBe(false)
  })
})

describe('faktDays — the brand switch', () => {
  const rows = [
    // An order is its product's brand; the team decides only one with no line item.
    teamDay({ day: '2026-10-01', rop: 'Azizbek', productBrand: 'Collagen', fakt1Minor: 100_000_000n }),
    teamDay({ day: '2026-10-01', rop: 'Azizbek', productBrand: 'Zextra', fakt1Minor: 40_000_000n }),
    teamDay({ day: '2026-10-01', rop: 'Asliddin', productBrand: null, fakt1Minor: 20_000_000n }),
    teamDay({ day: '2026-10-01', rop: 'Baza', productBrand: '-', fakt1Minor: 10_000_000n }),
  ]
  const of = (brand: 'all' | 'Collagen' | 'Zextra' | 'none') => faktDays(rows, brand).total

  it('files each order as the P&L does, and the three slices add up to «Hammasi»', () => {
    expect(of('Collagen')).toEqual({ fakt1PrimaryUzs: 1_000_000, fakt1BaseUzs: 0, fakt2PrimaryUzs: 0 })
    expect(of('Zextra')).toEqual({ fakt1PrimaryUzs: 600_000, fakt1BaseUzs: 0, fakt2PrimaryUzs: 0 })
    expect(of('none')).toEqual({ fakt1PrimaryUzs: 0, fakt1BaseUzs: 100_000, fakt2PrimaryUzs: 0 })
    expect(of('all')).toEqual({ fakt1PrimaryUzs: 1_600_000, fakt1BaseUzs: 100_000, fakt2PrimaryUzs: 0 })
  })
})

describe('RoistatService — the Collagen / Zextra switch', () => {
  /*
    A brand-keyed scan: leads split by source and form, sales by team. Zextra
    is the zextrauzb page's lead, the Kamron form's lead (Kamron sells
    Zextra), Asliddin's sale and Malika's (folded into Charos, a Zextra team);
    the Sinolife page's lead, Sevinch's sale and Hayot's (no brand) are not.
  */
  function keyedHarness() {
    const calls: { shape: string; keyed: boolean }[] = []
    const lead = (set: RoistatBitrixRow['set'], brandSource: string | null, brandForm: string | null, leads: number, extra: Partial<RoistatBitrixRow> = {}) =>
      bitrixRow(set, { brandSource, brandForm, leads, ...extra })
    const sale = (set: RoistatBitrixRow['set'], brandTeam: string, soldMinor: bigint, extra: Partial<RoistatBitrixRow> = {}) =>
      bitrixRow(set, { brandTeam, sold: 1, soldMinor, ...extra })
    const kamron = 'Заполнение CRM-формы «Kamron 6 etap filt forma»'
    const repository = {
      bitrix: async (_period: Period, _now: Date, shape = 'all', keyed = false) => {
        calls.push({ shape, keyed })
        const day = { day: '2026-10-01' }
        return [
          lead('total', 'UC_A8LE21', null, 10),
          lead('total', null, kamron, 3),
          lead('total', 'UC_1X1J24', null, 20),
          sale('total', 'Asliddin', 4_000_000_00n),
          sale('total', 'Malika', 1_000_000_00n),
          sale('total', 'Sevinch', 9_000_000_00n),
          sale('total', 'Hayot', 2_000_000_00n),
          ...(shape === 'total'
            ? []
            : [
                lead('day', 'UC_A8LE21', null, 10, day),
                lead('day', null, kamron, 3, day),
                lead('day', 'UC_1X1J24', null, 20, day),
                sale('day', 'Asliddin', 4_000_000_00n, day),
                sale('day', 'Malika', 1_000_000_00n, day),
                sale('day', 'Sevinch', 9_000_000_00n, day),
              ]),
        ]
      },
      meta: async () => [
        metaRow({ campaignId: '100', spendMicroUsd: 30_000_000n }),
        metaRow({ accountId: '440073592484616', accountName: 'Zextra Umar', campaignId: '400', spendMicroUsd: 8_000_000n }),
      ],
      metaName: async () => null,
      metaImportedAt: async () => null,
    }
    const reklama = {
      campaignDays: async () => [
        campaignDay({ spendMicroUsd: 30_000_000n }),
        campaignDay({ accountId: '440073592484616', accountName: 'Zextra Umar', spendMicroUsd: 8_000_000n }),
      ],
    }
    const usd = { forDays: async (days: readonly string[]) => days.map(() => 12_000) }
    return { service: new RoistatService(repository as never, reklama, usd, insights), calls }
  }

  it('keeps one brand: leads by source then form, sales by team, money by ad account', async () => {
    const { service, calls } = keyedHarness()
    const r = await service.overview(PERIOD, { dim: 'days', brand: 'Zextra' }, NOW)
    expect(calls).toEqual([{ shape: 'all', keyed: true }, { shape: 'total', keyed: true }])
    expect(r.kpi).toMatchObject({ leads: 13, sold: 2, soldUzs: 5_000_000, spendUsd: 8 })
    expect(r.kpiPrevious).toMatchObject({ leads: 13, sold: 2 })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ key: '2026-10-01', leads: 13, soldUzs: 5_000_000, spendUsd: 8 })
    expect(r.daily[0]).toEqual({ date: '2026-10-01', spendUsd: 8, soldUzs: 5_000_000 })
  })

  it('narrows the Meta cut to the brand\'s ad accounts', async () => {
    const { service } = keyedHarness()
    const r = await service.overview(PERIOD, { dim: 'camp', brand: 'Collagen' }, NOW)
    expect(r.rows.map((row) => row.key)).toEqual(['100'])
    expect(r.kpi).toMatchObject({ leads: 20, sold: 1, soldUzs: 9_000_000, spendUsd: 30 })
  })

  it('scans each window once for every cut, drill and brand slice — the scans are memoised apart from the table', async () => {
    const { service, calls } = keyedHarness()
    const dims = ['camp', 'adset', 'ad', 'targetolog', 'form', 'source', 'product', 'region', 'rop', 'seller', 'registrator', 'days'] as const
    // Two first visits at once share the scan in flight.
    await Promise.all([service.overview(PERIOD, { dim: 'camp' }, NOW), service.overview(PERIOD, { dim: 'rop' }, NOW)])
    expect(calls).toHaveLength(2)
    for (const brand of ['all', 'Collagen', 'Zextra', 'none'] as const) {
      for (const dim of dims) {
        await service.overview(PERIOD, { dim, brand, parent: dim === 'adset' || dim === 'ad' ? '555' : undefined }, NOW)
      }
    }
    // This window's every set and the previous window's total, plain once and brand-keyed once: 4, not 2 × 12 × 4.
    expect(calls).toEqual([
      { shape: 'all', keyed: false },
      { shape: 'total', keyed: false },
      { shape: 'all', keyed: true },
      { shape: 'total', keyed: true },
    ])
  })

  it('cuts the table again once a newer scan lands — two stale windows never stack into one answer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-05T07:00:00Z'))
      let leads = 100
      const repository = {
        bitrix: async () => [bitrixRow('total', { leads }), bitrixRow('rop', { rop: 'Sevinch', leads, sold: 1, soldMinor: 1_000_000_00n })],
        meta: async () => [],
        metaName: async () => null,
        metaImportedAt: async () => null,
      }
      const service = new RoistatService(repository as never, { campaignDays: async () => [] }, { forDays: async (d: readonly string[]) => d.map(() => 12_000) }, insights)
      expect((await service.overview(PERIOD, { dim: 'rop' }, NOW)).kpi.leads).toBe(100)

      // Past the TTL: the old answer is handed out while ONE rebuild of the scan runs behind it…
      leads = 200
      vi.setSystemTime(new Date('2026-10-05T07:02:01Z'))
      expect((await service.overview(PERIOD, { dim: 'rop' }, NOW)).kpi.leads).toBe(100)
      await new Promise((resolve) => setTimeout(resolve, 0))
      // …and the next read is cut from the new scan, not from a table rebuilt over the old one.
      expect((await service.overview(PERIOD, { dim: 'rop' }, NOW)).kpi.leads).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never re-cuts a table behind its reader over the scan that is being replaced', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-05T07:00:00Z'))
      let spendReads = 0
      const repository = {
        bitrix: async () => [bitrixRow('total', { leads: 1 })],
        meta: async () => [],
        metaName: async () => null,
        metaImportedAt: async () => null,
      }
      const reklama = {
        campaignDays: async () => {
          spendReads += 1
          return []
        },
      }
      const service = new RoistatService(repository as never, reklama, { forDays: async (d: readonly string[]) => d.map(() => 12_000) }, insights)
      await service.overview(PERIOD, { dim: 'rop' }, NOW)
      // A table's Meta reads: this window's spend and the previous one's.
      expect(spendReads).toBe(2)

      // Past both TTLs: the scan rebuilds behind the reader, and the table cut from it is handed out as it is…
      vi.setSystemTime(new Date('2026-10-05T07:02:01Z'))
      await service.overview(PERIOD, { dim: 'rop' }, NOW)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(spendReads).toBe(2)
      // …then cut once, from the new scan.
      await service.overview(PERIOD, { dim: 'rop' }, NOW)
      expect(spendReads).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks for the brand keys only when one brand is picked', async () => {
    const { service, calls } = keyedHarness()
    await service.overview(PERIOD, { dim: 'days', brand: 'all' }, NOW)
    await service.days(PERIOD, NOW, 'Zextra')
    await service.days(PERIOD, NOW, 'none')
    expect(calls.map((c) => c.keyed)).toEqual([false, false, true, true])
  })

  it('files a sale by the product it was paid for — the team only when it has no line item', async () => {
    const sale = (brandTeam: string, brandProduct: string | null, soldMinor: bigint) =>
      bitrixRow('total', { brandTeam, brandProduct, sold: 1, soldMinor })
    const rows = [
      sale('Sevinch', 'Zextra', 5_000_000_00n), // a Collagen team selling Zextra → Zextra
      sale('Asliddin', '-', 3_000_000_00n), // a Zextra team selling Prox → «Brendsiz»
      sale('Asliddin', null, 2_000_000_00n), // no line item → its team, Zextra
    ]
    const repository = {
      bitrix: async () => rows,
      meta: async () => [],
      metaName: async () => null,
      metaImportedAt: async () => null,
    }
    const service = new RoistatService(repository as never, { campaignDays: async () => [] }, { forDays: async (d: readonly string[]) => d.map(() => 12_000) }, insights)
    const z = await service.overview(PERIOD, { dim: 'days', brand: 'Zextra' }, NOW)
    expect(z.kpi).toMatchObject({ sold: 2, soldUzs: 7_000_000 })
    const n = await service.overview(PERIOD, { dim: 'days', brand: 'none' }, NOW)
    expect(n.kpi).toMatchObject({ sold: 1, soldUzs: 3_000_000 })
    const c = await service.overview(PERIOD, { dim: 'days', brand: 'Collagen' }, NOW)
    expect(c.kpi.sold).toBe(0)
  })

  it('files what neither brand claims under «Brendsiz» — Hayot\'s sale — and the three make the whole scan', async () => {
    const { service } = keyedHarness()
    const n = await service.overview(PERIOD, { dim: 'days', brand: 'none' }, NOW)
    expect(n.kpi).toMatchObject({ leads: 0, sold: 1, soldUzs: 2_000_000, spendUsd: 0 })
    resetRoistatCaches()
    const [c, z] = await Promise.all([
      service.overview(PERIOD, { dim: 'days', brand: 'Collagen' }, NOW),
      service.overview(PERIOD, { dim: 'days', brand: 'Zextra' }, NOW),
    ])
    // The harness's scan: 33 leads, 16 mln sold, 38 $ of ad budget.
    expect(c.kpi.leads + z.kpi.leads + n.kpi.leads).toBe(33)
    expect(c.kpi.sold + z.kpi.sold + n.kpi.sold).toBe(4)
    expect(c.kpi.soldUzs + z.kpi.soldUzs + n.kpi.soldUzs).toBe(16_000_000)
    expect(c.kpi.spendUsd + z.kpi.spendUsd + n.kpi.spendUsd).toBe(38)
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

  it('files a sale\'s «Товар» by its line items, its team only with none — the switch\'s rule', async () => {
    const sql: string[] = []
    const params: unknown[][] = []
    const prisma = {
      $queryRawUnsafe: async (text: string, ...p: unknown[]) => {
        sql.push(text)
        params.push(p)
        return [raw([])]
      },
    } as unknown as PrismaClient
    await new RoistatRepository(prisma).bitrix(PERIOD, NOW)
    expect(sql[0]).toContain('sale_base AS MATERIALIZED (')
    expect(sql[0]).toContain(`WHEN pb.brand = '-' THEN 'Boshqa'`)
    expect(sql[0]).toContain(`WHEN tm.team = ANY($5::text[]) THEN 'Collagen'`)
    expect(sql[0]).toContain(`WHEN tm.team = ANY($6::text[]) THEN 'Zextra'`)
    expect(params[0]![4]).toContain('Sevinch')
    expect(params[0]![5]).toContain('Asliddin')
  })

  it('splits every grouping set by the brand inputs only when asked', async () => {
    const sql: string[] = []
    const prisma = {
      $queryRawUnsafe: async (text: string) => {
        sql.push(text)
        return [raw([])]
      },
    } as unknown as PrismaClient
    const repository = new RoistatRepository(prisma)
    await repository.bitrix(PERIOD, NOW, 'days')
    await repository.bitrix(PERIOD, NOW, 'days', true)
    expect(sql[0]).toMatch(/GROUPING SETS \(\(\),\s*\(day\)\)/)
    expect(sql[1]).toMatch(/GROUPING SETS \(\(b_source, b_form, b_line, b_team, b_product\),\s*\(day, b_source, b_form, b_line, b_team, b_product\)\)/)
  })
})
