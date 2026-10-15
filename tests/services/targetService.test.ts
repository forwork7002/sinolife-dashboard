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
const { TargetService, countersDto, fillDays, fillsCover, metaBlock, resetTargetCaches, withTargetologLeads } = await import(
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
  let fills: Awaited<ReturnType<TargetRepository['formFills']>>

  beforeEach(() => {
    resetTargetCaches()
    asked = []
    fills = {
      coverage: null,
      rows: [
        { subject: 'Заполнена CRM-форма "Umar-collagen Collagen (UMAR)"', fills: 7 },
        { subject: 'Заполнена CRM-форма "Umar-zextra UMAR (zextra-1)"', fills: 3 },
      ],
    }
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
      metaCampaigns: async () => [],
      formLeads: async () => [],
      formFills: async () => fills,
      metaImportedAt: async () => null,
    } as unknown as TargetRepository
    const marketing = { snapshot: async () => null } as unknown as MarketingRepository
    service = new TargetService(repository, marketing)
  })

  it('counts the target pages by default and every source when asked', async () => {
    await service.overview(PERIOD, 'target', 'all', 'Asia/Tashkent')
    await service.overview(PERIOD, 'all', 'all', 'Asia/Tashkent')
    expect(asked.map((w) => w.sourceIds)).toEqual([TARGET_SOURCE_IDS, null])
  })

  it('narrows the leads to one product\'s own pages, whatever the scope says', async () => {
    await service.overview(PERIOD, 'all', 'Zextra', 'Asia/Tashkent')
    await service.overview(PERIOD, 'target', 'Collagen', 'Asia/Tashkent')
    expect([...asked[0]!.sourceIds!].sort()).toEqual(['38|NEXTBOT', 'UC_A8LE21', 'UC_LBSZDU'])
    // collagen.marine joined the Collagen pages on 2026-10-02.
    expect([...asked[1]!.sourceIds!].sort()).toEqual(['UC_0FMQ5Q', 'UC_1X1J24', 'UC_A4WINR', 'UC_MWIKOC', 'UC_U9KZG8'])
  })

  it('keys the memo on the scope — «all» never serves the target answer', async () => {
    await service.overview(PERIOD, 'target', 'all', 'Asia/Tashkent')
    await service.overview(PERIOD, 'target', 'all', 'Asia/Tashkent')
    await service.overview(PERIOD, 'all', 'all', 'Asia/Tashkent')
    expect(asked).toHaveLength(2)
  })

  it('counts the fills only once a pass has caught up, and only from where they were read', async () => {
    // No pass has reached the newest fill yet: a backfill under way is no count.
    expect((await service.overview(PERIOD, 'target', 'all', 'Asia/Tashkent')).meta.total).toMatchObject({
      formLeadsBasis: 'deals',
      bitrixFormLeads: 0,
    })

    resetTargetCaches()
    fills = { ...fills, coverage: { from: new Date('2026-08-31T19:00:00Z'), through: new Date('2026-09-03T19:05:00Z') } }
    expect((await service.overview(PERIOD, 'target', 'all', 'Asia/Tashkent')).meta.total).toMatchObject({
      formLeadsBasis: 'fills',
      bitrixFormLeads: 10,
    })

    // One product asked for: the other product's fills are no part of any figure.
    resetTargetCaches()
    expect((await service.overview(PERIOD, 'target', 'Collagen', 'Asia/Tashkent')).meta.total.bitrixFormLeads).toBe(7)

    // A window that starts before the fills were read would be counted short.
    resetTargetCaches()
    fills = { ...fills, coverage: { from: new Date('2026-09-02T19:00:00Z'), through: new Date('2026-09-03T19:05:00Z') } }
    expect((await service.overview(PERIOD, 'target', 'all', 'Asia/Tashkent')).meta.total.formLeadsBasis).toBe('deals')
  })

  it('stops trusting fills the feed has not brought current in half an hour', () => {
    const coverage = (through: string) => ({ from: new Date('2026-08-31T19:00:00Z'), through: new Date(through) })
    const now = new Date('2026-10-15T10:00:00Z')
    const live = { ...PERIOD, end: now }
    expect(fillsCover(coverage('2026-10-15T09:31:00Z'), live, now)).toBe(true)
    expect(fillsCover(coverage('2026-10-15T09:29:00Z'), live, now)).toBe(false)
    // A window that ended long ago needs the fills only up to its end.
    expect(fillsCover(coverage('2026-09-03T18:40:00Z'), PERIOD, now)).toBe(true)
    expect(fillsCover(coverage('2026-09-03T18:00:00Z'), PERIOD, now)).toBe(false)
    expect(fillsCover(null, live, now)).toBe(false)
  })

  it('says «never imported» for Meta rather than printing zero spend', async () => {
    const dto = await service.overview(PERIOD, 'target', 'all', 'Asia/Tashkent')
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

  it('heads «Collagen va Zextra» with the two products alone — no «Boshqa» money over their leads', () => {
    const products = block.products.filter((p) => p.product !== 'Boshqa')
    const spend = products.reduce((n, p) => n + p.spendUsd, 0)
    expect(block.productsTotal.spendUsd).toBe(674.56)
    expect(block.productsTotal.spendUsd).toBeCloseTo(spend, 6)
    expect(block.productsTotal.bitrixLeads).toBe(500)
    expect(block.productsTotal.costPerBitrixLeadUsd).toBeCloseTo(674.56 / 500, 6)
    expect(block.productsTotal.deliveredMoney).toEqual(block.total.deliveredMoney)
    // The «Лид база» Jami keeps the unmapped 5 $.
    expect(block.total.costPerBitrixLeadUsd).toBeCloseTo(679.56 / 500, 6)
  })

  describe('a window where one product has not spent yet («Bugun» before Zextra\'s first dollar)', () => {
    const oneProduct = (metaRows: ReturnType<typeof row>[]) =>
      metaBlock({
        rows: metaRows,
        importedAt: new Date('2026-09-19T06:00:00Z'),
        window: { from: '2026-08-01', to: '2026-08-01' },
        // Zextra's page already has leads, orders and money; its accounts have no row.
        sources: [
          { key: 'sinolifeuz', ...ZERO, leads: 400, orders: 40, deliveredMinor: 1_000_000_000n },
          { key: 'zextrauzb', ...ZERO, leads: 100, orders: 10, deliveredMinor: 500_000_000n },
        ],
        productOfSource: new Map([
          ['sinolifeuz', 'Collagen' as const],
          ['zextrauzb', 'Zextra' as const],
        ]),
        usdRate: 12_000,
      })

    it('heads the hero with the one column drawn — Collagen\'s money over Collagen\'s leads, not Zextra\'s too', () => {
      const one = oneProduct([row('990016692137088', 'Umar - 64', '2026-08-01', 217_970_000n, 199)])
      expect(one.products.map((p) => p.product)).toEqual(['Collagen'])
      expect({ product: 'Collagen', ...one.productsTotal }).toEqual(one.products[0])
      expect(one.productsTotal).toMatchObject({ spendUsd: 217.97, bitrixLeads: 400, orders: 40 })
      expect(one.productsTotal.costPerBitrixLeadUsd).toBeCloseTo(217.97 / 400, 6)
      // The «Лид база» Jami still counts Zextra's page.
      expect(one.total).toMatchObject({ bitrixLeads: 500, orders: 50 })
    })

    it('heads nothing when neither product spent — zero, never both products\' pages under 0 $', () => {
      const none = oneProduct([row('999', 'Yangi akkaunt', '2026-08-01', 5_000_000n)])
      expect(none.products.map((p) => p.product)).toEqual(['Boshqa'])
      expect(none.productsTotal).toMatchObject({ spendUsd: 0, bitrixLeads: 0, orders: 0, costPerBitrixLeadUsd: null })
      expect(none.total.bitrixLeads).toBe(500)
    })
  })

  describe('Meta\'s lead forms against the form leads that reached Bitrix24 (2026-10-13)', () => {
    /*
      On «Shu oy» 01–13.10 the card read Meta 11 041 leads against 1 200
      Bitrix24 leads: the Bitrix24 half counted the DM pages alone, and a form
      fill lands as «Ген лид», never on a page (12 723 of them that window).
    */
    const campaign = (accountId: string, accountName: string, campaignName: string, objective: string, spend: bigint, leads: number, conversations = 0) => ({
      accountId,
      accountName,
      campaignName,
      objective,
      spendMicroUsd: spend,
      leads,
      conversations,
    })
    const form = (formTitle: string, over: Partial<TargetCountersRow>, productLine: string | null = null, sourceId: string | null = 'REPEAT_SALE') => ({
      formTitle,
      sourceId,
      productLine,
      ...ZERO,
      ...over,
    })
    const pairedInput = {
      rows,
      importedAt: new Date('2026-10-13T06:00:00Z'),
      window: { from: '2026-10-01', to: '2026-10-13' },
      sources: [
        { key: 'sinolifeuz', ...ZERO, leads: 400, leadWon: 40, orders: 10, deliveredMinor: 1_000_000_000n },
        { key: 'zextrauzb', ...ZERO, leads: 100 },
      ],
      productOfSource: new Map([
        ['sinolifeuz', 'Collagen' as const],
        ['zextrauzb', 'Zextra' as const],
      ]),
      forms: [
        form('Заполнение CRM-формы "Umar-collagen Collagen (UMAR)"', { leads: 900, leadWon: 200, orders: 60, deliveredMinor: 3_000_000_000n }, 'Collagen'),
        form('Заполнение CRM-формы "Umar-zextra UMAR (zextra-1)"', { leads: 70, leadWon: 5, orders: 2 }, 'Zextra'),
        // A form deal filed under a target page is a FORM lead, taken back out of the page.
        form('Заполнение CRM-формы "Eldor-collagen x"', { leads: 30, leadWon: 3 }, null, 'UC_1X1J24'),
      ],
      campaigns: [
        campaign('990016692137088', 'Umar - 64', 'Collagen form', 'OUTCOME_LEADS', 150_000_000n, 1_000),
        campaign('990016692137088', 'Umar - 64', 'Sms-1', 'OUTCOME_ENGAGEMENT', 50_000_000n, 0, 320),
        // A hiring form is no customer's lead.
        campaign('1312865112943517', 'Umar 63', 'EX - Sinolife (vakansiya)', 'OUTCOME_LEADS', 10_000_000n, 55),
        campaign('926218346480236', 'Zextra Kamron 1', 'Zextra form', 'OUTCOME_LEADS', 80_000_000n, 80),
        // A website lead campaign never arrives as a CRM form.
        campaign('990016692137088', 'Umar - 64', 'Sayt-1', 'OUTCOME_LEADS', 12_000_000n, 9),
      ],
      usdRate: 12_000,
    }
    const paired = metaBlock(pairedInput)
    const collagen = paired.products.find((p) => p.product === 'Collagen')!
    const zextra = paired.products.find((p) => p.product === 'Zextra')!

    it('counts Meta\'s lead-form campaigns alone — not the hiring forms, not «Sayt», not the DM', () => {
      expect(collagen.metaFormLeads).toBe(1_000)
      expect(collagen.metaFormCplUsd).toBeCloseTo(150 / 1_000, 6)
      expect(collagen.metaConversations).toBe(320)
      expect(zextra.metaFormLeads).toBe(80)
    })

    it('sets the form leads that reached Bitrix24 beside them, and the pages apart', () => {
      expect(collagen).toMatchObject({ bitrixFormLeads: 930, bitrixPageLeads: 370, bitrixLeads: 1_300 })
      expect(collagen.formReachPercent).toBeCloseTo(93, 6)
      expect(zextra).toMatchObject({ bitrixFormLeads: 70, bitrixPageLeads: 100, bitrixLeads: 170 })
    })

    it('carries the form leads\' kval, orders and money into the product\'s results', () => {
      expect(collagen).toMatchObject({ bitrixLeadWon: 240, orders: 70 })
      expect(collagen.deliveredMoney.amountMinor).toBe('4000000000')
      expect(collagen.costPerBitrixLeadUsd).toBeCloseTo(452.63 / 1_300, 6)
      expect(paired.productsTotal.bitrixLeads).toBe(1_470)
    })
 
    it('says it counted deals when no fills were handed over', () => {
      expect(collagen.formLeadsBasis).toBe('deals')
    })

    describe('…COUNTED AS META COUNTS THEM: EVERY FILL (2026-10-15)', () => {
      /*
        01–15.10.2026: 13 197 Meta Collagen form leads, 13 174 CRM-form fills
        on the portal, 10 896 Регистрация deals — a returning contact's fill
        lands on the old deal and opens none. The client: count «huddi shu
        kombinatsiyada».
      */
      const fill = (form: string, fills: number) => ({ subject: `Заполнена CRM-форма "${form}"`, fills })
      const counted = metaBlock({
        ...pairedInput,
        forms: [
          ...pairedInput.forms,
          // The AI targetolog files deals, never a CRM form: its leads are its deals.
          form('CRM-формы «AI targetolog · Sinolife AI forma 26.09.2026»', { leads: 5, leadWon: 1 }, 'Collagen'),
        ],
        fills: [
          fill('Umar-collagen Collagen (UMAR)', 990),
          fill('Eldor-collagen x', 31),
          fill('Umar-zextra UMAR (zextra-1)', 78),
          // A website form answers no Meta form campaign.
          fill('collagen form web', 4),
          // No form named at all: not a form fill this screen can place.
          { subject: 'Заполнена форма', fills: 2 },
        ],
      })
      const col = counted.products.find((p) => p.product === 'Collagen')!
      const zex = counted.products.find((p) => p.product === 'Zextra')!

      it('counts every fill of the product\'s forms, plus the AI targetolog\'s deals', () => {
        expect(col).toMatchObject({ bitrixFormLeads: 990 + 31 + 5, formLeadsBasis: 'fills' })
        expect(col.formReachPercent).toBeCloseTo(102.6, 6)
        expect(zex).toMatchObject({ bitrixFormLeads: 78, formLeadsBasis: 'fills' })
        expect(zex.formReachPercent).toBeCloseTo(97.5, 6)
      })

      it('keeps the pages, kval, orders and money on the deals', () => {
        expect(col).toMatchObject({ bitrixPageLeads: 370, bitrixLeads: 370 + 1_026, bitrixLeadWon: 241, orders: 70 })
        expect(col.deliveredMoney.amountMinor).toBe('4000000000')
        expect(counted.productsTotal.bitrixLeads).toBe(370 + 1_026 + 100 + 78)
      })
    })
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

  it('gives each person one total across both products, biggest spender first', () => {
    const both = metaBlock({
      rows: [
        row('2804901113001448', 'Collagen Sobirjon #2', '2026-08-01', 44_460_000n, 38),
        row('4401744916740587', 'Zextra Sobirjon', '2026-08-01', 107_500_000n, 53),
        row('926218346480236', 'Zextra Kamron 1', '2026-08-01', 221_930_000n, 81),
      ],
      importedAt: null,
      window: { from: '2026-08-01', to: '2026-08-01' },
      sources: [],
      productOfSource: new Map(),
      usdRate: null,
    })
    expect(both.targetologs.map((t) => t.targetolog)).toEqual(['Kamron', 'Sobirjon'])
    const sobirjon = both.targetologs[1]!
    expect(sobirjon.spendUsd).toBe(151.96)
    expect(sobirjon.metaLeads).toBe(91)
    expect(sobirjon.products.map((p) => p.product)).toEqual(['Collagen', 'Zextra'])
    // Each fixture row carries 1 000 impressions and 10 clicks.
    expect(sobirjon.clicks).toBe(20)
    expect(sobirjon.cpcUsd).toBeCloseTo(151.96 / 20, 6)
    expect(sobirjon.cpmUsd).toBeCloseTo((151.96 / 2000) * 1000, 6)
  })

  it('prints no ROAS without a rate rather than a wrong one', () => {
    const noRate = metaBlock({
      rows,
      importedAt: null,
      window: { from: '2026-08-01', to: '2026-08-02' },
      sources: [],
      productOfSource: new Map(),
      usdRate: null,
    })
    expect(noRate.total.roas).toBeNull()
    expect(noRate.total.costPerBitrixLeadUsd).toBeNull()
  })
})

describe('withTargetologLeads — the cards\' kval, kval % and FAKT 1 clients', () => {
  const row = (accountId: string, accountName: string, micro: bigint) => ({
    accountId,
    accountName,
    date: '2026-08-01',
    spendMicroUsd: micro,
    impressions: 1000,
    clicks: 10,
    leads: 5,
  })
  const meta = metaBlock({
    rows: [
      row('2804901113001448', 'Collagen Sobirjon #2', 44_460_000n),
      row('4401744916740587', 'Zextra Sobirjon', 107_500_000n),
      row('926218346480236', 'Zextra Kamron 1', 221_930_000n),
      row('999', 'Yangi akkaunt', 5_000_000n),
    ],
    importedAt: null,
    window: { from: '2026-08-01', to: '2026-08-01' },
    sources: [],
    productOfSource: new Map(),
    usdRate: null,
  })
  const overview = { meta } as Parameters<typeof withTargetologLeads>[0]
  const owner = (targetolog: string, product: 'Collagen' | 'Zextra', formUsd: number, leads: number, success: number, fakt1Clients: number | null) => ({
    targetolog,
    product,
    formUsd,
    outcome: { leads, success },
    fakt1Clients,
  })
  const forms = {
    owners: [
      owner('Sobirjon', 'Collagen', 40, 20, 8, 3),
      owner('Sobirjon', 'Zextra', 100.5, 30, 10, 4),
      // A form nobody's Meta account maps to: no card to land on.
      owner('Sinolife filtr forma 3', 'Collagen', 0, 9, 2, 1),
    ],
    // One client of both Sobirjon forms: 6 people, not 7.
    fakt1Targetologs: [{ targetolog: 'Sobirjon', clients: 6 }],
  }
  const card = (dto: ReturnType<typeof withTargetologLeads>, who: string) =>
    dto.meta.targetologs.find((t) => t.targetolog === who)!.bitrix

  it('sums the person\'s forms over both products and prices kval and clients on «Rasxod $»', () => {
    const sobirjon = card(withTargetologLeads(overview, forms, 'all'), 'Sobirjon')!
    expect(sobirjon).toMatchObject({ formUsd: 140.5, leads: 50, qualified: 18, clients: 6 })
    expect(sobirjon.qualifiedPercent).toBeCloseTo(36, 6)
    expect(sobirjon.costPerQualifiedUsd).toBeCloseTo(140.5 / 18, 6)
    expect(sobirjon.costPerClientUsd).toBeCloseTo(140.5 / 6, 6)
  })

  it('cuts to one product\'s forms, as the card\'s money is cut to its accounts', () => {
    const zextra = card(withTargetologLeads(overview, forms, 'Zextra'), 'Sobirjon')!
    expect(zextra).toMatchObject({ formUsd: 100.5, leads: 30, qualified: 10, clients: 4 })
  })

  it('reads 0 leads and no price for a person with money and no form lead', () => {
    const kamron = card(withTargetologLeads(overview, forms, 'all'), 'Kamron')!
    expect(kamron).toMatchObject({ formUsd: 0, leads: 0, qualified: 0, qualifiedPercent: null, clients: 0 })
    expect(kamron.costPerQualifiedUsd).toBeNull()
    expect(kamron.costPerClientUsd).toBeNull()
  })

  it('leaves the clients unread, never 0, when the phone match did not answer', () => {
    const unread = withTargetologLeads(
      overview,
      { owners: forms.owners.map((o) => ({ ...o, fakt1Clients: null })), fakt1Targetologs: null },
      'all',
    )
    expect(card(unread, 'Sobirjon')).toMatchObject({ qualified: 18, clients: null, costPerClientUsd: null })
    expect(card(withTargetologLeads(overview, { ...forms, fakt1Targetologs: null, owners: forms.owners.map((o) => ({ ...o, fakt1Clients: null })) }, 'Zextra'), 'Sobirjon')!.clients).toBeNull()
  })

  it('leaves every card unread when the forms scan failed', () => {
    const dto = withTargetologLeads(overview, null, 'all')
    expect(dto.meta.targetologs.every((t) => t.bitrix === null)).toBe(true)
  })
})
