import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LeadFakt1ClientRow } from '@/server/repositories/insightsRepository'
import type { CampaignDayRow } from '@/server/repositories/reklamaRepository'
import type { RegistrationDayRow, TriageDayRow } from '@/server/repositories/leadSourcesRepository'

/*
  The service imports reklamaService for `calendarDays`, whose repository
  reads `env` at module scope — the same preamble reklamaService.test.ts
  explains.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { leadSourcesOverview } = await import('@/server/services/leadSourcesService')

const WINDOW = { from: '2026-09-18', to: '2026-09-19' }
const UMAR_FORM = 'Заполнение CRM-формы "Sinolife (UMAR) 777"'

const reg = (over: Partial<RegistrationDayRow>): RegistrationDayRow => ({
  day: '2026-09-18',
  sourceId: 'REPEAT_SALE',
  source: 'Ген лид',
  formTitle: null,
  productLine: null,
  stage: 'Сделка успешна',
  status: 'WON',
  aiQualified: false,
  leads: 1,
  ...over,
})

const campaign = (over: Partial<CampaignDayRow>): CampaignDayRow => ({
  date: '2026-09-18',
  accountId: '1312865112943517', // Umar 63 · Collagen
  accountName: 'Umar 63',
  campaignId: 'c1',
  campaignName: '11/09 A',
  objective: 'OUTCOME_LEADS',
  spendMicroUsd: 0n,
  impressions: 0,
  clicks: 0,
  leads: 0,
  conversations: 0,
  ...over,
})

const fakt1 = (over: Partial<LeadFakt1ClientRow>): LeadFakt1ClientRow => ({
  sourceId: 'REPEAT_SALE',
  source: 'Ген лид',
  formTitle: UMAR_FORM,
  productLine: null,
  client: '901234567',
  ...over,
})

const triage = (over: Partial<TriageDayRow>): TriageDayRow => ({
  day: '2026-09-18',
  sourceId: 'UC_1X1J24',
  source: 'sinolifeuz',
  conversations: 0,
  ...over,
})

const NO_SARAFAN = { leads: 0, qualified: 0 }

describe('leadSourcesOverview', () => {
  const data = leadSourcesOverview({
    window: WINDOW,
    importedAt: null,
    registration: [
      // Umar's form: 3 kval on the 18th, 2 недозвон on the 19th.
      reg({ formTitle: UMAR_FORM, leads: 3 }),
      reg({ formTitle: UMAR_FORM, day: '2026-09-19', stage: 'Недозвон', status: 'OPEN', leads: 2 }),
      // sinolifeuz: 4 leads, 1 kval (the one the AI qualified), 1 duplicate.
      reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', aiQualified: true, leads: 1 }),
      reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Дубликат (лид)', status: 'OPEN', leads: 1 }),
      reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Обработка', status: 'OPEN', leads: 2 }),
      // Not ad leads, but Регистрация: outgoing calls and a hand-typed «Ген лид».
      reg({ sourceId: 'UC_KPZA32', source: 'Исход', stage: 'Отказ', status: 'LOST', leads: 7 }),
      reg({ sourceId: 'REPEAT_SALE', source: 'Ген лид', leads: 2 }),
      // A non-ad page that chats: its leads join its DM row.
      reg({ sourceId: 'UC_NBCV5K', source: 'collagen.sinolife', leads: 1 }),
      // The non-ad channels of 2026-09-29: an incoming call, Telegram (one kval).
      reg({ sourceId: 'CALL', source: 'Входящий', stage: 'Недозвон', status: 'OPEN', leads: 3 }),
      reg({ sourceId: 'UC_8NZNYM', source: 'Телеграмм', leads: 1 }),
      reg({ sourceId: 'UC_8NZNYM', source: 'Телеграмм', stage: 'Обработка', status: 'OPEN', leads: 1 }),
      // The site and word of mouth, the client's tiles of 2026-10-01.
      reg({ sourceId: 'WEB', source: 'Веб-сайт', leads: 1 }),
      reg({ sourceId: 'UC_9SNG04', source: 'Сарафан маркетинг', stage: 'Обработка', status: 'OPEN', leads: 1 }),
    ],
    triage: [
      triage({ conversations: 40 }),
      triage({ day: '2026-09-19', conversations: 60 }),
      triage({ sourceId: 'UC_NBCV5K', source: 'collagen.sinolife', conversations: 5 }),
    ],
    campaigns: [
      campaign({ leads: 8, spendMicroUsd: 20_000_000n }),
      campaign({ date: '2026-09-19', leads: 2, spendMicroUsd: 5_000_000n }),
      // A DM campaign is not a form: its money and conversations are the targetolog's «SMS», never the form's $.
      campaign({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'DM', leads: 0, conversations: 99, spendMicroUsd: 9_000_000n }),
      // An account nobody mapped still gets a row, under its own name.
      campaign({ accountId: '1306271057053174', accountName: 'Newgen_davi01', leads: 4, spendMicroUsd: 1_000_000n }),
      // Recruiting staff: in no ad budget.
      campaign({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'EX - Sinolife (vakansiya) - DM', spendMicroUsd: 7_000_000n }),
    ],
    fakt1: [
      // One client, two of Umar's leads: one client on that line.
      fakt1({}),
      fakt1({}),
      fakt1({ client: '907654321' }),
      // The same client also wrote to sinolifeuz: one there too, still one in the total.
      fakt1({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', formTitle: null }),
      fakt1({ sourceId: 'CALL', source: 'Входящий', formTitle: null, client: '935550000' }),
    ],
    // WON in the window, whenever the deal arrived — 6 in all.
    qualified: [
      { sourceId: 'REPEAT_SALE', formTitle: null, productLine: null, aiQualified: false, qualified: 3 },
      { sourceId: 'UC_1X1J24', formTitle: null, productLine: null, aiQualified: true, qualified: 1 },
      { sourceId: 'UC_KPZA32', formTitle: null, productLine: null, aiQualified: false, qualified: 1 },
      { sourceId: null, formTitle: null, productLine: null, aiQualified: false, qualified: 1 },
    ],
    // «ИИ квал сана» in the window, any creation day — 6 in Регистрация (one a duplicate), 3 moved on.
    aiQualified: [
      { registration: true, sourceId: null, formTitle: null, productLine: null, stage: 'Сделка успешна', status: 'WON', leads: 1 },
      { registration: true, sourceId: null, formTitle: null, productLine: null, stage: 'Обработка', status: 'OPEN', leads: 3 },
      { registration: true, sourceId: null, formTitle: null, productLine: null, stage: 'Дубликат (лид)', status: 'OPEN', leads: 1 },
      // The red «Дубликат» is no «Дубль лид» (the client, 2026-10-02): still a fresh lead here.
      { registration: true, sourceId: null, formTitle: null, productLine: null, stage: 'Дубликат', status: 'OPEN', leads: 1 },
      // Already in Первичный отдел / Доставка: a repeat, counted on no tile (the client, 2026-10-03).
      { registration: false, sourceId: null, formTitle: null, productLine: null, stage: 'Новая', status: 'OPEN', leads: 2 },
      { registration: false, sourceId: null, formTitle: null, productLine: null, stage: 'Сделка успешна', status: 'WON', leads: 1 },
    ],
    // «Сарафан маркетинг» in Ecommerce: 3 created, 2 delivered (the client, 2026-10-05).
    sarafan: { leads: 3, qualified: 2 },
  })

  it('reads the six headline figures off the counted tiles — «Исход» is in none (the client, 2026-10-09)', () => {
    expect(data.funnel).toEqual({
      // 26 Регистрация deals less «Исход» 7 and the Регистрация «Сарафан маркетинг» lead.
      total: 18,
      fresh: 17,
      duplicates: 1,
      // The cohort: of those 18, WON by now — «Ген лид» 5, sinolifeuz 1, collagen.sinolife 1, Telegram 1, the site 1.
      qualified: 9,
      qualifiedPercent: (9 / 17) * 100,
      // WON in the window whenever it arrived, the old count: «Ген лид» 3 + sinolifeuz 1 («Исход» and the sourceless kval apart).
      closedQualified: 4,
      // Umar's forms 20 + 5, the unmapped account's form 1, and his DM 9; the hiring campaign is no ad money.
      spendUsd: 35,
      // Every «Ген лид» kval of the cohort: the form's 3 and the hand-typed 2 — not the free channels'.
      generatedQualified: 5,
      costPerQualifiedUsd: 35 / 5,
    })
  })

  it('prices a kval as «Targetologlar»\'s «Jami» does — one figure, the forms\' money and the unlinked over «Ген лид» kval', () => {
    const { forms, funnel } = data
    expect(forms.spendUsd).toBe(26)
    expect(forms.unlinked).toEqual({ spendUsd: 9, accounts: [{ name: 'Umar 63', spendUsd: 9 }] })
    expect(forms.manual).toMatchObject({ leads: 2, success: 2 })
    expect(forms.total).toEqual({
      spendUsd: forms.spendUsd + forms.unlinked.spendUsd,
      outcome: expect.objectContaining({ leads: forms.outcome.leads + 2, success: forms.outcome.success + 2 }),
      costPerLeadUsd: 35 / 7,
      costPerSuccessUsd: 35 / 5,
    })
    expect(funnel.spendUsd).toBe(forms.total.spendUsd)
    expect(funnel.costPerQualifiedUsd).toBe(forms.total.costPerSuccessUsd)
    // The «Ген лид» tile's cohort kval is that divisor.
    expect(data.tiles.rows.find((r) => r.tile === 'generated')!.qualified).toBe(funnel.generatedQualified)
  })

  it('lists the unlinked money by account, largest first, and leaves hiring and unmapped accounts out', () => {
    const d = leadSourcesOverview({
      window: WINDOW,
      importedAt: null,
      registration: [],
      triage: [],
      campaigns: [
        campaign({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'DM', spendMicroUsd: 3_000_000n }),
        campaign({ objective: 'OUTCOME_TRAFFIC', campaignName: 'Trafik', spendMicroUsd: 1_500_000n }),
        campaign({ accountId: '926218346480236', accountName: 'Zextra Kamron 1', objective: 'OUTCOME_ENGAGEMENT', campaignName: 'DM', spendMicroUsd: 6_000_000n }),
        campaign({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'vakansiya DM', spendMicroUsd: 7_000_000n }),
        campaign({ accountId: '1306271057053174', accountName: 'Newgen_davi01', objective: 'OUTCOME_ENGAGEMENT', campaignName: 'DM', spendMicroUsd: 2_000_000n }),
      ],
      fakt1: [],
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    })
    expect(d.forms.unlinked).toEqual({
      spendUsd: 10.5,
      accounts: [
        { name: 'Zextra Kamron 1', spendUsd: 6 },
        { name: 'Umar 63', spendUsd: 4.5 },
      ],
    })
    // Money with no «Ген лид» kval to divide it: a price is unknown, not infinite and not free.
    expect(d.funnel).toMatchObject({ spendUsd: 10.5, generatedQualified: 0, costPerQualifiedUsd: null })
  })

  it('counts only «Дубликат (лид)» as Дубль, not the red «Дубликат» at the end', () => {
    const d = leadSourcesOverview({
      window: WINDOW,
      importedAt: null,
      registration: [
        reg({ stage: 'Дубликат (лид)', status: 'OPEN', leads: 16 }),
        reg({ stage: 'Дубликат', status: 'OPEN', leads: 10 }),
        reg({ stage: 'Обработка', status: 'OPEN', leads: 74 }),
      ],
      triage: [],
      campaigns: [],
      fakt1: [],
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    })
    expect(d.funnel).toMatchObject({ total: 100, duplicates: 16, fresh: 84 })
    // The channel tiles read the same Дубль, so their Jami stays the headline's.
    expect(d.tiles.total).toMatchObject({ leads: 100, fresh: 84 })
  })

  it('prices nothing when nobody was qualified or nothing arrived', () => {
    const empty = leadSourcesOverview({ window: WINDOW, importedAt: null, registration: [], triage: [], campaigns: [], fakt1: [], qualified: [], aiQualified: [], sarafan: NO_SARAFAN })
    expect(empty.funnel).toMatchObject({ total: 0, fresh: 0, qualified: 0, qualifiedPercent: null, costPerQualifiedUsd: null })
  })

  it('leaves the kval price unknown, not free, when no Meta spend was read', () => {
    const noMeta = leadSourcesOverview({ window: WINDOW, importedAt: null, registration: [reg({})], triage: [], campaigns: [], fakt1: [], qualified: [{ sourceId: 'REPEAT_SALE', formTitle: null, productLine: null, aiQualified: false, qualified: 5 }], aiQualified: [], sarafan: NO_SARAFAN })
    expect(noMeta.funnel.costPerQualifiedUsd).toBeNull()
  })

  it('counts every Регистрация lead, and splits the ad ones out', () => {
    expect(data.totals.registration.leads).toBe(26)
    // «Barcha manbalar»'s «Jami» is «Жами лидлар»: «Исход» and the unlisted source are listed, marked, not summed.
    expect(data.totals.counted.leads).toBe(data.funnel.total)
    expect(data.sources.filter((s) => !s.counted).map((s) => s.key).sort()).toEqual(['source|UC_9SNG04', 'source|UC_KPZA32'])
    // forms (5) + the ad page (4); calls, «Ген лид» by hand and collagen.sinolife are not ads.
    const ads = (['form', 'page'] as const).map((ch) => data.channels.find((c) => c.channel === ch)!.outcome)
    expect(ads[0]!.leads + ads[1]!.leads).toBe(9)
    expect(ads[0]!.success + ads[1]!.success).toBe(4)
    expect(data.channels.find((c) => c.channel === 'outbound')!.outcome.lowQuality).toBe(7)
    expect(data.channels.find((c) => c.channel === 'manual')!.outcome.leads).toBe(2)
    const summed = data.sources.reduce((n, s) => n + s.outcome.leads, 0)
    expect(summed).toBe(data.totals.registration.leads)
  })

  it('carries every channel, a quiet one at zero, in LEAD_CHANNELS order', () => {
    expect(data.channels.map((c) => c.channel)).toEqual([
      'form',
      'page',
      'inbound',
      'manual',
      'telegram',
      'smm',
      'other',
      'outbound',
    ])
    const smm = data.channels.find((c) => c.channel === 'smm')!.outcome
    expect(smm.leads).toBe(0)
    expect(smm.successPercent).toBeNull()
    const tg = data.channels.find((c) => c.channel === 'telegram')!.outcome
    expect(tg).toMatchObject({ leads: 2, success: 1, open: 1, successPercent: 50 })
    expect(data.sources.find((s) => s.key === 'source|UC_8NZNYM')!.channel).toBe('telegram')
  })

  it('fills the client\'s channel tiles by source alone, kval the cohort\'s, and sums all but «Исход», «Boshqa» and «Сарафан»', () => {
    const tile = (t: string) => data.tiles.rows.find((r) => r.tile === t)!
    expect(data.tiles.rows.map((r) => r.tile)).toEqual(['generated', 'inbound', 'telegram', 'aiSmm', 'web', 'sarafan', 'outbound', 'other'])
    // Umar's form (5) and the hand-typed «Ген лид» (2): «Ген лид» whole. Kval: of those 7, WON by now; 3 were closed in the window.
    expect(tile('generated')).toEqual({ tile: 'generated', leads: 7, fresh: 7, qualified: 5, qualifiedPercent: (5 / 7) * 100, closedQualified: 3 })
    expect(tile('inbound')).toMatchObject({ leads: 3, qualified: 0, qualifiedPercent: 0, closedQualified: 0 })
    expect(tile('telegram')).toMatchObject({ leads: 2, qualified: 1, closedQualified: 0 })
    // The bot accounts by the day the deal was created — sinolifeuz 4 (one «Дубликат (лид)») and collagen.sinolife 1 —
    // whatever the AI marked: «ИИ квал сана» is a line apart.
    expect(tile('aiSmm')).toMatchObject({ leads: 5, fresh: 4, qualified: 2, qualifiedPercent: 50, closedQualified: 1 })
    expect(data.tiles.smmAccounts).toEqual([
      { key: 'UC_1X1J24', name: 'sinolifeuz', leads: 4, fresh: 3, qualified: 1, qualifiedPercent: (1 / 3) * 100, closedQualified: 0 },
      { key: 'UC_NBCV5K', name: 'collagen.sinolife', leads: 1, fresh: 1, qualified: 1, qualifiedPercent: 100, closedQualified: 0 },
    ])
    expect(data.tiles.aiQualified).toBe(6)
    expect(data.tiles.aiElsewhere).toBe(3)
    expect(tile('web')).toMatchObject({ leads: 1, qualified: 1 })
    // Ecommerce's «Сарафан маркетинг», not Регистрация's.
    expect(tile('sarafan')).toMatchObject({ leads: 3, fresh: 3, qualified: 2 })
    // Out of «Jami»: the operators' own calls, and the Регистрация «Сарафан маркетинг» lead (with the sourceless closed kval).
    expect(tile('outbound')).toMatchObject({ leads: 7, qualified: 0, closedQualified: 1 })
    expect(tile('other')).toMatchObject({ leads: 1, fresh: 1, qualified: 0, closedQualified: 1 })
    const inTotal = data.tiles.rows.filter((r) => !['outbound', 'other', 'sarafan'].includes(r.tile))
    expect(data.tiles.total).toEqual({
      leads: inTotal.reduce((n, r) => n + r.leads, 0),
      fresh: inTotal.reduce((n, r) => n + r.fresh, 0),
      qualified: inTotal.reduce((n, r) => n + r.qualified, 0),
      qualifiedPercent: (9 / 17) * 100,
      closedQualified: inTotal.reduce((n, r) => n + r.closedQualified, 0),
    })
  })

  it('has ONE total: the tiles\' «Jami» is «Жами лидлар», «Янги» and the kval to the lead (the client, 2026-10-09)', () => {
    const { total } = data.tiles
    expect(data.funnel).toMatchObject({
      total: total.leads,
      fresh: total.fresh,
      duplicates: total.leads - total.fresh,
      qualified: total.qualified,
      qualifiedPercent: total.qualifiedPercent,
      closedQualified: total.closedQualified,
    })
    // And with «Исход» and «Boshqa» it is every Регистрация deal — nothing is lost, only kept apart.
    const apart = data.tiles.rows.filter((r) => r.tile === 'outbound' || r.tile === 'other')
    expect(total.leads + apart.reduce((n, r) => n + r.leads, 0)).toBe(data.totals.registration.leads)
  })

  it('folds a page\'s second bot into its account, and names an unlisted account by its id', () => {
    const d = leadSourcesOverview({
      window: WINDOW,
      importedAt: null,
      registration: [
        reg({ sourceId: 'UC_LBSZDU', source: 'zextra.sinolife', leads: 2 }),
        reg({ sourceId: '46|NEXTBOT', source: 'NEXTBOT - zextra.sinolife', stage: 'Обработка', status: 'OPEN', leads: 3 }),
        reg({ sourceId: 'UC_Z1OF0D', source: 'sinolif_tg', stage: 'Обработка', status: 'OPEN', leads: 1 }),
      ],
      triage: [],
      campaigns: [],
      fakt1: [],
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    })
    expect(d.tiles.smmAccounts.map((a) => [a.name, a.leads, a.qualified])).toEqual([
      ['zextra.sinolife', 5, 2],
      ['sinolif_tg', 1, 0],
    ])
    expect(d.tiles.rows.find((r) => r.tile === 'aiSmm')!.leads).toBe(6)
    expect(d.tiles.rows.find((r) => r.tile === 'telegram')!.leads).toBe(0)
  })

  it('keeps the totals equal on an empty window', () => {
    const empty = leadSourcesOverview({ window: WINDOW, importedAt: null, registration: [], triage: [], campaigns: [], fakt1: [], qualified: [], aiQualified: [], sarafan: NO_SARAFAN })
    expect(empty.tiles).toMatchObject({ smmAccounts: [], aiQualified: 0, aiElsewhere: 0 })
    expect(empty.tiles.total.leads).toBe(empty.funnel.total)
    expect(empty.forms.total).toMatchObject({ spendUsd: 0, costPerLeadUsd: null, costPerSuccessUsd: null })
  })

  it('puts the form and the Meta account on one targetolog, and reads the reach', () => {
    const umar = data.forms.owners.find((o) => o.key === 'Collagen|Umar')!
    expect(umar.forms).toEqual(['Sinolife (UMAR) 777'])
    expect(umar.accounts).toEqual(['Umar 63'])
    expect(umar.metaLeads).toBe(10)
    expect(umar.outcome.leads).toBe(5)
    expect(umar.outcome.success).toBe(3)
    expect(umar.outcome.noAnswer).toBe(2)
    expect(umar.reachPercent).toBe(50)
    expect(umar.spendUsd).toBe(25)
    expect(umar.costPerLeadUsd).toBe(5)
    expect(umar.costPerSuccessUsd).toBeCloseTo(25 / 3)
    // The day's lead-form spend rides each day — the DM campaign's 9 $ and the hiring 7 $ ride beside it.
    expect(umar.days).toEqual([
      {
        date: '2026-09-18',
        spendUsd: 20,
        metaLeads: 8,
        leads: 3,
        success: 3,
        formUsd: 20,
        siteUsd: 0,
        siteLeads: 0,
        smsUsd: 9,
        smsCount: 99,
        hrUsd: 7,
        otherUsd: 0,
        totalUsd: 36,
      },
      {
        date: '2026-09-19',
        spendUsd: 5,
        metaLeads: 2,
        leads: 2,
        success: 0,
        formUsd: 5,
        siteUsd: 0,
        siteLeads: 0,
        smsUsd: 0,
        smsCount: 0,
        hrUsd: 0,
        otherUsd: 0,
        totalUsd: 5,
      },
    ])
  })

  it('sums the days\' spend to the targetologs\' (the client\'s day sheet, 2026-10-05)', () => {
    expect(data.forms.days.map((d) => d.spendUsd)).toEqual([21, 5])
    expect(data.forms.days.reduce((n, d) => n + d.spendUsd, 0)).toBe(data.forms.spendUsd)
  })

  it('keeps an unmapped account visible with no Bitrix24 leads', () => {
    const ai = data.forms.owners.find((o) => o.targetolog === 'Newgen_davi01')!
    expect(ai.product).toBe('Boshqa')
    expect(ai.metaLeads).toBe(4)
    expect(ai.outcome.leads).toBe(0)
    expect(ai.reachPercent).toBe(0)
    expect(data.forms.metaLeads).toBe(14)
    expect(data.forms.outcome.leads).toBe(5)
    expect(data.totals.formReachPercent).toBe((5 / 14) * 100)
  })

  it('reads DM from «ИИ обработка», and a chatting non-ad page is a page', () => {
    expect(data.dm.conversations).toBe(105)
    const uz = data.dm.pages.find((p) => p.key === 'UC_1X1J24')!
    expect(uz.conversations).toBe(100)
    expect(uz.outcome.leads).toBe(4)
    expect(uz.outcome.success).toBe(1)
    expect(uz.product).toBe('Collagen')
    const cs = data.dm.pages.find((p) => p.key === 'UC_NBCV5K')!
    // «collagen.sinolife» is a Collagen page in `LEAD_SOURCE_BRAND` since 2026-10-02 (the RNP P&L's lead brand).
    expect(cs.product).toBe('Collagen')
    expect(cs.outcome.leads).toBe(1)
    expect(data.dm.days.map((d) => d.conversations)).toEqual([45, 60])
  })

  it('counts «Факт1 мижоз» as distinct clients on each line, its channel and the whole', () => {
    expect(data.sources.find((s) => s.key === 'form|Sinolife (UMAR) 777')!.fakt1Clients).toBe(2)
    expect(data.sources.find((s) => s.key === 'source|UC_1X1J24')!.fakt1Clients).toBe(1)
    expect(data.sources.find((s) => s.key === 'source|CALL')!.fakt1Clients).toBe(1)
    expect(data.sources.find((s) => s.key === 'source|UC_KPZA32')!.fakt1Clients).toBe(0)
    const channel = (c: string) => data.channels.find((x) => x.channel === c)!.fakt1Clients
    expect(channel('form')).toBe(2)
    expect(channel('page')).toBe(1)
    expect(channel('inbound')).toBe(1)
    expect(channel('outbound')).toBe(0)
    // 901234567 is on two lines and counted once.
    expect(data.totals.fakt1Clients).toBe(3)
  })

  it('lists every DM page in the portal order, a quiet one at zero', () => {
    expect(data.dm.pages.map((p) => p.name)).toEqual([
      'sinolif_tg',
      'sinolife_otziv',
      'sinolifeuz',
      'zextra.uz',
      'zextra.sinolife',
      'zextra_life',
      'sinogummy',
      'collagen.sinolife',
      'collagen.marine',
    ])
    const quiet = data.dm.pages.find((p) => p.key === 'UC_KX2114')!
    expect(quiet.conversations).toBe(0)
    expect(quiet.outcome.leads).toBe(0)
    expect(quiet.days.map((d) => d.conversations)).toEqual([0, 0])
  })

  it('folds the second zextra.sinolife bot into the page, and keeps an unlisted chatting source last', () => {
    const dm = leadSourcesOverview({
      window: WINDOW,
      importedAt: null,
      registration: [
        reg({ sourceId: '46|NEXTBOT', source: 'NEXTBOT - zextra.sinolife', leads: 2 }),
        reg({ sourceId: 'UC_LBSZDU', source: 'zextra.sinolife', stage: 'Обработка', status: 'OPEN', leads: 1 }),
      ],
      triage: [
        triage({ sourceId: '46|NEXTBOT', source: 'NEXTBOT - zextra.sinolife', conversations: 3 }),
        triage({ sourceId: 'UC_LBSZDU', source: 'zextra.sinolife', conversations: 4 }),
        triage({ sourceId: 'UC_MXY08O', source: 'Instagram', conversations: 1 }),
      ],
      campaigns: [],
      fakt1: [],
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    }).dm
    expect(dm.pages.some((p) => p.key === '46|NEXTBOT')).toBe(false)
    const zs = dm.pages.find((p) => p.key === 'UC_LBSZDU')!
    expect(zs.name).toBe('zextra.sinolife')
    expect(zs.conversations).toBe(7)
    expect(zs.outcome.leads).toBe(3)
    expect(zs.outcome.success).toBe(2)
    expect(dm.pages.at(-1)!.name).toBe('Instagram')
    expect(dm.conversations).toBe(8)
  })
})

describe('leadSourcesOverview — a targetolog\'s other expenses', () => {
  // Umar · Collagen on 03.10.2026, as Meta had it: forms 223.97 $ / 248, «Sayt-1» 11.87 $ / 1, DM + Sms 48.51 $.
  const campaigns = [
    campaign({ date: '2026-09-18', campaignName: '03/10 A', leads: 248, spendMicroUsd: 223_970_000n }),
    campaign({ date: '2026-09-18', campaignName: 'Sayt-1', leads: 1, spendMicroUsd: 11_870_000n }),
    campaign({
      date: '2026-09-18',
      accountId: '990016692137088',
      accountName: 'Umar - 64',
      campaignName: 'Sms-008',
      objective: 'OUTCOME_ENGAGEMENT',
      conversations: 291,
      spendMicroUsd: 48_510_000n,
    }),
    campaign({ date: '2026-09-18', campaignName: 'Vakansiya', objective: 'OUTCOME_LEADS', spendMicroUsd: 5_000_000n }),
    campaign({ date: '2026-09-19', campaignName: 'Trafik', objective: 'OUTCOME_TRAFFIC', spendMicroUsd: 2_000_000n }),
    // Newgen_davi01 runs no form: out of the lead tables, but its money gets a card of its own (`expenseOwners`).
    campaign({ accountId: '1657709689205277', accountName: 'HR Eldor', campaignName: 'Ishga', objective: 'OUTCOME_LEADS', spendMicroUsd: 3_000_000n }),
    campaign({ accountId: '1306271057053174', accountName: 'Newgen_davi01', objective: 'OUTCOME_ENGAGEMENT', spendMicroUsd: 9_000_000n }),
  ]
  const forms = leadSourcesOverview({
    window: WINDOW,
    registration: [],
    triage: [],
    campaigns,
    fakt1: [],
    qualified: [],
    aiQualified: [],
    sarafan: NO_SARAFAN,
    importedAt: null,
  }).forms

  it('splits the site, messages, hiring and the rest beside the forms, and totals them', () => {
    expect(forms.owners.map((o) => o.key)).toEqual(['Collagen|Umar'])
    const umar = forms.owners[0]!
    expect(umar).toMatchObject({
      spendUsd: 235.84,
      metaLeads: 249,
      formUsd: 223.97,
      siteUsd: 11.87,
      siteLeads: 1,
      smsUsd: 48.51,
      smsCount: 291,
      hrUsd: 5,
      otherUsd: 2,
      totalUsd: 291.35,
    })
    expect(umar.days[0]).toMatchObject({ spendUsd: 235.84, siteUsd: 11.87, smsUsd: 48.51, hrUsd: 5, totalUsd: 289.35 })
    expect(umar.days[1]).toMatchObject({ spendUsd: 0, otherUsd: 2, totalUsd: 2 })
    expect(forms.days[0]!.totalUsd).toBe(289.35)
  })

  it('gives an owner with only message or hiring money a card apart, outside the lead totals', () => {
    expect(forms.expenseOwners.map((o) => [o.targetolog, o.product, o.spendUsd, o.smsUsd, o.hrUsd, o.totalUsd])).toEqual([
      ['Элдор', 'Boshqa', 0, 0, 3, 3],
      ['Newgen_davi01', 'Boshqa', 0, 9, 0, 9],
    ])
    expect(forms.expenseOwners[1]!.days[0]).toMatchObject({ smsUsd: 9, totalUsd: 9 })
    // The block's own totals are the lead-form owners' alone, as before.
    expect(forms.spendUsd).toBe(235.84)
    expect(forms.days[0]!.totalUsd).toBe(289.35)
  })
})

describe('leadSourcesOverview — the Collagen / Zextra switch', () => {
  const KAMRON_FORM = 'Заполнение CRM-формы "Kamron 6 etap filt forma"'
  const input = {
    window: WINDOW,
    importedAt: null,
    registration: [
      reg({ sourceId: 'UC_A8LE21', source: 'zextrauzb', stage: 'Обработка', status: 'OPEN', leads: 4 }),
      // A Kamron form that names no product: Zextra, as RNP's leadBrand reads it.
      reg({ formTitle: KAMRON_FORM, leads: 3 }),
      reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Обработка', status: 'OPEN', leads: 5 }),
      // An outgoing call: no brand, in neither.
      reg({ sourceId: 'UC_KPZA32', source: 'Исход', stage: 'Отказ', status: 'LOST', leads: 7 }),
    ],
    triage: [
      triage({ sourceId: 'UC_A8LE21', source: 'zextrauzb', conversations: 10 }),
      triage({ conversations: 20 }),
      triage({ sourceId: 'UC_Z1OF0D', source: 'sinolif_tg', conversations: 3 }),
    ],
    campaigns: [
      campaign({ leads: 5, spendMicroUsd: 20_000_000n }),
      campaign({ accountId: '440073592484616', accountName: 'Zextra Umar', leads: 2, spendMicroUsd: 8_000_000n }),
    ],
    fakt1: [fakt1({ formTitle: KAMRON_FORM }), fakt1({ sourceId: 'UC_1X1J24', formTitle: null, client: '907654321' })],
    qualified: [
      { sourceId: 'REPEAT_SALE', formTitle: KAMRON_FORM, productLine: null, aiQualified: false, qualified: 2 },
      { sourceId: 'UC_1X1J24', formTitle: null, productLine: null, aiQualified: false, qualified: 1 },
    ],
    aiQualified: [
      { registration: true, sourceId: 'UC_A8LE21', formTitle: null, productLine: null, stage: 'Обработка', status: 'OPEN', leads: 1 },
      { registration: true, sourceId: null, formTitle: null, productLine: null, stage: 'Обработка', status: 'OPEN', leads: 2 },
    ],
    sarafan: { leads: 3, qualified: 2 },
    inboundCalls: 9,
  }
  const all = leadSourcesOverview(input)
  const zextra = leadSourcesOverview({ ...input, brand: 'Zextra' })
  const collagen = leadSourcesOverview({ ...input, brand: 'Collagen' })

  it('narrows leads by source then form, kval and FAKT 1 clients alike, and money by ad account', () => {
    expect(all.brand).toBe('all')
    expect(zextra.brand).toBe('Zextra')
    // Kval is the cohort's (the Kamron form's 3 leads, WON); the 2 closed in the window ride beside it.
    expect(zextra.funnel).toMatchObject({ total: 7, qualified: 3, closedQualified: 2, spendUsd: 8 })
    expect(collagen.funnel).toMatchObject({ total: 5, qualified: 0, closedQualified: 1, spendUsd: 20 })
    // The outgoing call is no lead, so the two brands make «Жами лидлар»; with it they make Регистрация.
    expect(all.funnel.total).toBe(zextra.funnel.total + collagen.funnel.total)
    expect(all.totals.registration.leads).toBe(all.funnel.total + 7)
    expect(zextra.totals.fakt1Clients).toBe(1)
  })

  it('puts the Kamron form on a Zextra row, beside his Zextra account', () => {
    expect(zextra.forms.owners.map((o) => [o.targetolog, o.product])).toContainEqual(['Kamron', 'Zextra'])
    expect(collagen.forms.owners.some((o) => o.targetolog === 'Kamron')).toBe(false)
  })

  it('lists only the brand\'s DM pages, and reads «Сммщик ии» and the AI\'s mark by their source', () => {
    expect(zextra.dm.pages.map((p) => p.key)).toEqual(['UC_A8LE21', 'UC_LBSZDU', '38|NEXTBOT'])
    expect(zextra.dm.conversations).toBe(10)
    expect(collagen.dm.pages.some((p) => p.key === 'UC_Z1OF0D')).toBe(false)
    expect(zextra.tiles.rows.find((r) => r.tile === 'aiSmm')!.leads).toBe(4)
    expect(zextra.tiles.smmAccounts.map((a) => a.name)).toEqual(['zextra.uz'])
    expect(zextra.tiles.aiQualified).toBe(1)
  })

  it('cannot split «Сарафан» or the inbound calls, and does not pretend to', () => {
    expect(all.tiles.rows.find((r) => r.tile === 'sarafan')!.leads).toBe(3)
    expect(zextra.tiles.rows.find((r) => r.tile === 'sarafan')!.leads).toBe(0)
    expect(all.inboundCalls).toBe(9)
    expect(zextra.inboundCalls).toBeNull()
  })

  it('reads a lead\'s «Проект» before its source: an «Исход» call the floor marked Zextra is Zextra\'s', () => {
    const marked = { ...input, registration: [...input.registration, reg({ sourceId: 'UC_KPZA32', source: 'Исход', productLine: 'Zextra sure', leads: 2 })] }
    const outbound = (brand: 'Zextra' | 'none') => leadSourcesOverview({ ...marked, brand }).tiles.rows.find((r) => r.tile === 'outbound')!.leads
    expect(outbound('Zextra')).toBe(2)
    expect(outbound('none')).toBe(7)
    // Whatever its brand, an operator's own call is no lead of «Жами лидлар».
    expect(leadSourcesOverview({ ...marked, brand: 'Zextra' }).funnel.total).toBe(zextra.funnel.total)
  })

  it('files what no brand claims under «Brendsiz» — the three add up to «Hammasi»', () => {
    const none = leadSourcesOverview({ ...input, brand: 'none' })
    expect(none.brand).toBe('none')
    expect(none.totals.registration.leads).toBe(7)
    expect(none.funnel.total).toBe(0)
    expect(collagen.totals.registration.leads + zextra.totals.registration.leads + none.totals.registration.leads).toBe(all.totals.registration.leads)
    expect(collagen.funnel.total + zextra.funnel.total + none.funnel.total).toBe(all.funnel.total)
    expect(collagen.funnel.qualified + zextra.funnel.qualified + none.funnel.qualified).toBe(all.funnel.qualified)
    expect(collagen.funnel.spendUsd + zextra.funnel.spendUsd + none.funnel.spendUsd).toBe(all.funnel.spendUsd)
    // «Сарафан» and the inbound calls carry no brand: they are «Brendsiz»'s, whole.
    expect(none.tiles.rows.find((r) => r.tile === 'sarafan')!.leads).toBe(3)
    expect(none.inboundCalls).toBe(9)
  })
})

describe('LeadSourcesService.targetologForms', () => {
  it('builds «Targetologlar · kunlik» from Регистрация and Meta alone — the overview\'s block to the lead', async () => {
    const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
    const { resolvePeriod } = await import('@/server/domain/period/period')
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      customStart: new Date('2026-07-18T00:00:00Z'),
      customEnd: new Date('2026-07-19T00:00:00Z'),
    })
    const registration = [
      reg({ day: '2026-07-18', formTitle: UMAR_FORM, leads: 3 }),
      reg({ day: '2026-07-19', formTitle: UMAR_FORM, stage: 'Недозвон', status: 'OPEN', leads: 2 }),
    ]
    const campaigns = [campaign({ date: '2026-07-18', leads: 8, spendMicroUsd: 20_000_000n })]
    const called: string[] = []
    const never = (name: string) => async () => {
      called.push(name)
      throw new Error(`${name}: statement timeout`)
    }
    const service = (slow: boolean) =>
      new LeadSourcesService(
        {
          registrationDays: async () => registration,
          triageDays: slow ? never('triageDays') : async () => [],
          qualifiedSources: slow ? never('qualifiedSources') : async () => [],
          aiQualifiedStages: slow ? never('aiQualifiedStages') : async () => [],
          pipelineSourceCount: slow ? never('pipelineSourceCount') : async () => NO_SARAFAN,
          inboundCallCount: slow ? never('inboundCallCount') : async () => null,
        } as never,
        { campaignDays: async () => campaigns, campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
        { leadFakt1Clients: slow ? never('leadFakt1Clients') : async () => [] } as never,
      )

    // The other scans failing (the FAKT 1 phone match timing out) no longer takes the sheet down.
    const alone = await service(true).targetologForms(period, 'Asia/Tashkent')
    expect(called).toEqual([])
    const umar = alone.forms.owners.find((o) => o.targetolog === 'Umar')!
    expect(umar.spendUsd).toBe(20)
    expect(umar.metaLeads).toBe(8)
    expect(umar.outcome.leads).toBe(5)

    const whole = await service(false).overview(period, 'Asia/Tashkent')
    expect(alone.forms).toEqual(whole.forms)
  })
})

describe('LeadSourcesService.overview — «Факт1 мижоз» never takes Lidlar down', () => {
  it('shows the tab with «Факт1 мижоз» unknown when the phone match fails, and retries next time', async () => {
    const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
    const { resolvePeriod } = await import('@/server/domain/period/period')
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      customStart: new Date('2026-06-10T00:00:00Z'),
      customEnd: new Date('2026-06-11T00:00:00Z'),
    })
    let fakt1Calls = 0
    const service = new LeadSourcesService(
      {
        registrationDays: async () => [reg({ day: '2026-06-10', formTitle: UMAR_FORM, leads: 3 })],
        triageDays: async () => [],
        qualifiedSources: async () => [],
        aiQualifiedStages: async () => [],
        pipelineSourceCount: async () => NO_SARAFAN,
        inboundCallCount: async () => null,
      } as never,
      { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
      {
        leadFakt1Clients: async () => {
          fakt1Calls += 1
          if (fakt1Calls === 1) throw new Error('canceling statement due to statement timeout')
          return [fakt1({}), fakt1({ client: '907654321' })]
        },
      } as never,
    )

    const first = await service.overview(period, 'Asia/Tashkent')
    expect(first.totals.registration.leads).toBe(3)
    expect(first.totals.fakt1Clients).toBeNull()
    expect(first.channels.every((c) => c.fakt1Clients === null)).toBe(true)
    expect(first.sources.every((s) => s.fakt1Clients === null)).toBe(true)

    // The failure was not memoised: the next poll asks again and reads it.
    const second = await service.overview(period, 'Asia/Tashkent')
    expect(second.totals.fakt1Clients).toBe(2)
  })
})

describe('LeadSourcesService.overview — a slow «Факт1 мижоз»', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers without it after the wait, and the scan still fills the memo for the next poll', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
    const { resolvePeriod } = await import('@/server/domain/period/period')
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      customStart: new Date('2026-05-10T00:00:00Z'),
      customEnd: new Date('2026-05-11T00:00:00Z'),
    })
    let finish: (rows: LeadFakt1ClientRow[]) => void = () => {}
    let fakt1Calls = 0
    const service = new LeadSourcesService(
      {
        registrationDays: async () => [reg({ day: '2026-05-10', formTitle: UMAR_FORM, leads: 3 })],
        triageDays: async () => [],
        qualifiedSources: async () => [],
        aiQualifiedStages: async () => [],
        pipelineSourceCount: async () => NO_SARAFAN,
        inboundCallCount: async () => null,
      } as never,
      { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
      {
        leadFakt1Clients: () => {
          fakt1Calls += 1
          return new Promise<LeadFakt1ClientRow[]>((resolve) => {
            finish = resolve
          })
        },
      } as never,
    )

    const pending = service.overview(period, 'Asia/Tashkent')
    await vi.advanceTimersByTimeAsync(8_000)
    const first = await pending
    expect(first.totals.registration.leads).toBe(3)
    expect(first.totals.fakt1Clients).toBeNull()

    finish([fakt1({})])
    const second = await service.overview(period, 'Asia/Tashkent')
    expect(second.totals.fakt1Clients).toBe(1)
    // The late answer was the first scan's — no second phone match was started.
    expect(fakt1Calls).toBe(1)
  })
})

describe('LeadSourcesService.overview — the leads and their kval from one rebuild (2026-10-06 audit)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never pairs the previous rebuild\'s leads with this one\'s kval, and agrees with «Targetologlar · kunlik»', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
    const { resolvePeriod } = await import('@/server/domain/period/period')
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      customStart: new Date('2026-03-10T00:00:00Z'),
      customEnd: new Date('2026-03-11T00:00:00Z'),
    })
    // Each scan answers with how many times it has been read: the n-th rebuild says n.
    let registrations = 0
    let kvals = 0
    const service = new LeadSourcesService(
      {
        registrationDays: async () => [reg({ day: '2026-03-10', formTitle: UMAR_FORM, leads: ++registrations })],
        triageDays: async () => [],
        qualifiedSources: async () => [
          { sourceId: 'REPEAT_SALE', formTitle: UMAR_FORM, productLine: null, aiQualified: false, qualified: ++kvals },
        ],
        aiQualifiedStages: async () => [],
        pipelineSourceCount: async () => NO_SARAFAN,
        inboundCallCount: async () => null,
      } as never,
      { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
      { leadFakt1Clients: async () => [] } as never,
    )

    const first = await service.overview(period, 'Asia/Tashkent')
    expect([first.funnel.total, first.funnel.qualified]).toEqual([1, 1])

    // Past the TTL: the old answer at once, every memo rebuilt behind it.
    vi.advanceTimersByTime(180_000)
    await service.overview(period, 'Asia/Tashkent')
    await vi.runAllTimersAsync()

    const second = await service.overview(period, 'Asia/Tashkent')
    expect([second.funnel.total, second.funnel.qualified]).toEqual([2, 2])
    const sheet = await service.targetologForms(period, 'Asia/Tashkent')
    expect(sheet.forms.outcome.leads).toBe(second.forms.outcome.leads)
  })
})

describe('LeadSourcesService.overview — a reader\'s cold miss (2026-10-06 review)', () => {
  it('runs every read at once — only the warmer goes two scans at a time', async () => {
    const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
    const { resolvePeriod } = await import('@/server/domain/period/period')
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      customStart: new Date('2026-02-10T00:00:00Z'),
      customEnd: new Date('2026-02-11T00:00:00Z'),
    })
    const inFlight: string[] = []
    const answers: (() => void)[] = []
    /** A read that answers only when the test lets it. */
    const read = <T,>(name: string, rows: T) => () => {
      inFlight.push(name)
      return new Promise<T>((resolve) => answers.push(() => resolve(rows)))
    }
    const service = new LeadSourcesService(
      {
        registrationDays: read('registrationDays', [reg({ day: '2026-02-10', formTitle: UMAR_FORM, leads: 2 })]),
        triageDays: read('triageDays', []),
        qualifiedSources: read('qualifiedSources', []),
        aiQualifiedStages: read('aiQualifiedStages', []),
        pipelineSourceCount: read('pipelineSourceCount', NO_SARAFAN),
        inboundCallCount: read('inboundCallCount', null),
      } as never,
      { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
      { leadFakt1Clients: read('leadFakt1Clients', []) } as never,
    )

    const answer = service.overview(period, 'Asia/Tashkent')
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Nothing has answered and every read is out — the five scans with them, where the warmer's pace shows two.
    expect([...inFlight].sort()).toEqual([
      'aiQualifiedStages',
      'inboundCallCount',
      'leadFakt1Clients',
      'pipelineSourceCount',
      'qualifiedSources',
      'registrationDays',
      'triageDays',
    ])
    for (const release of answers) release()
    expect((await answer).funnel.total).toBe(2)
  })
})

describe('LeadSourcesService.warm — the windows the tab opens on, kept warm', () => {
  it('builds «Bugun» then «Shu oy» by working hours, through the reader\'s own memo keys, and nothing at night', async () => {
    const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
    const { OFF_HOURS } = await import('@/server/services/rnpWarmer')
    const windows: string[] = []
    const service = new LeadSourcesService(
      {
        registrationDays: async (p: { preset: string }) => {
          windows.push(p.preset)
          return []
        },
        triageDays: async () => [],
        qualifiedSources: async () => [],
        aiQualifiedStages: async () => [],
        pipelineSourceCount: async () => NO_SARAFAN,
        inboundCallCount: async () => null,
      } as never,
      { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
      { leadFakt1Clients: async () => [] } as never,
    )
    // 03:00 Tashkent: nobody reads it — and it says so, for the warmer's log.
    expect(await service.warm(new Date('2026-05-11T22:00:00Z'), 'Asia/Tashkent')).toBe(OFF_HOURS)
    expect(windows).toEqual([])
    // 10:00 Tashkent.
    expect(await service.warm(new Date('2026-05-12T05:00:00Z'), 'Asia/Tashkent')).toBeUndefined()
    expect(windows).toEqual(['today', 'this_month'])
  })

  describe('each rebuild waited for (2026-10-06 audit)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('waits for every memo\'s rebuild, window by window and two scans at a time — on the second tick too', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      vi.setSystemTime(new Date('2026-04-14T05:00:00Z')) // 10:00 Tashkent
      const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
      let inFlight = 0
      let peak = 0
      let reads = 0
      /** A read that holds a connection for a second. */
      const read = <T,>(rows: T) => async () => {
        reads++
        peak = Math.max(peak, ++inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        inFlight--
        return rows
      }
      const service = new LeadSourcesService(
        {
          registrationDays: read([]),
          triageDays: read([]),
          qualifiedSources: read([]),
          aiQualifiedStages: read([]),
          pipelineSourceCount: read(NO_SARAFAN),
          inboundCallCount: read(null),
        } as never,
        { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
        { leadFakt1Clients: read([]) } as never,
      )
      const tick = async () => {
        let done = false
        const warming = service.warm(new Date(), 'Asia/Tashkent').then(() => (done = true))
        // Each window: registration 1 s, the five scans two at a time 3 s; then each window's FAKT 1, 1 s. 10 s in all.
        await vi.advanceTimersByTimeAsync(9_999)
        expect(done).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await warming
        expect(inFlight).toBe(0)
      }

      await tick() // cold: every memo's first build
      expect(reads).toBe(14)
      // Three minutes on: every memo past its TTL and still showable — `get` would hand it out and rebuild behind.
      vi.advanceTimersByTime(180_000)
      await tick()
      expect(reads).toBe(28)
      expect(peak).toBe(2)
    })
  })

  describe('a memo that fails (2026-10-06 review)', () => {
    /** Each read logged as «<read> <preset>»; `fails` names the one that throws. */
    const warmer = async (reads: string[], fails: string) => {
      const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
      const read = <T,>(name: string, rows: T) => async (period: { preset: string }) => {
        reads.push(`${name} ${period.preset}`)
        if (`${name} ${period.preset}` === fails) throw new Error('canceling statement due to statement timeout')
        return rows
      }
      return new LeadSourcesService(
        {
          registrationDays: read('registrationDays', []),
          triageDays: read('triageDays', []),
          qualifiedSources: read('qualifiedSources', []),
          aiQualifiedStages: read('aiQualifiedStages', []),
          pipelineSourceCount: read('pipelineSourceCount', NO_SARAFAN),
          inboundCallCount: read('inboundCallCount', null),
        } as never,
        { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
        { leadFakt1Clients: read('leadFakt1Clients', []) } as never,
      )
    }

    it('still builds «Shu oy» when «Bugun»\'s «Факт1 мижоз» fails — the tab answers without it — and reports it', async () => {
      const reads: string[] = []
      const service = await warmer(reads, 'leadFakt1Clients today')
      // 10:00 Tashkent. Thrown at the end, for «leads warm-up failed».
      await expect(service.warm(new Date('2026-08-12T05:00:00Z'), 'Asia/Tashkent')).rejects.toThrow('statement timeout')
      expect(reads.filter((r) => r.endsWith(' this_month')).map((r) => r.split(' ')[0]).sort()).toEqual([
        'aiQualifiedStages',
        'inboundCallCount',
        'leadFakt1Clients',
        'pipelineSourceCount',
        'qualifiedSources',
        'registrationDays',
        'triageDays',
      ])
      // Every window's other memos come first: a slow phone match holds up none of them.
      expect(reads.slice(-2)).toEqual(['leadFakt1Clients today', 'leadFakt1Clients this_month'])
    })

    it('ends the tick when «Bugun»\'s Регистрация fails — the month\'s heavier scans would only add to the strain', async () => {
      const reads: string[] = []
      const service = await warmer(reads, 'registrationDays today')
      await expect(service.warm(new Date('2026-01-13T05:00:00Z'), 'Asia/Tashkent')).rejects.toThrow('statement timeout')
      expect(reads).toEqual(['registrationDays today'])
    })
  })

  it('fills the memos the routes read — `instrumentation.ts` runs its own copy of this module (2026-10-06 audit)', async () => {
    const warmers = await import('@/server/services/leadSourcesService')
    const now = new Date('2026-06-16T05:00:00Z') // 10:00 Tashkent
    const reads: string[] = []
    const read = <T,>(name: string, rows: T) => async () => {
      reads.push(name)
      return rows
    }
    const service = (Service: typeof warmers.LeadSourcesService) =>
      new Service(
        {
          registrationDays: read('registrationDays', [reg({ day: '2026-06-16', formTitle: UMAR_FORM, leads: 4 })]),
          triageDays: read('triageDays', []),
          qualifiedSources: read('qualifiedSources', []),
          aiQualifiedStages: read('aiQualifiedStages', []),
          pipelineSourceCount: read('pipelineSourceCount', NO_SARAFAN),
          inboundCallCount: read('inboundCallCount', null),
        } as never,
        { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
        { leadFakt1Clients: read('leadFakt1Clients', []) } as never,
      )
    await service(warmers.LeadSourcesService).warm(now, 'Asia/Tashkent')
    expect(reads).toHaveLength(14)

    // A second instance of the module, as the route handlers' bundle holds one.
    vi.resetModules()
    const routes = await import('@/server/services/leadSourcesService')
    const { resolvePeriod } = await import('@/server/domain/period/period')
    expect(routes.LeadSourcesService).not.toBe(warmers.LeadSourcesService)
    reads.length = 0
    const today = await service(routes.LeadSourcesService).overview(resolvePeriod('today', { timeZone: 'Asia/Tashkent', now }), 'Asia/Tashkent')
    expect(reads).toEqual([])
    expect(today.funnel.total).toBe(4)
  })
})

describe('telegramLeads — the «Telegram» card\'s Bitrix лид / кв лид', () => {
  it('counts the Регистрация leads the portal filed under Telegram, per brand per day, kval apart', async () => {
    const { telegramLeads } = await import('@/server/services/leadSourcesService')
    const rows = [
      // The Telegram bot, «Проект» Zextra: a kval and an open lead on one day, a kval the next.
      reg({ day: '2026-09-18', sourceId: 'UC_8NZNYM', source: 'Telegram bot', productLine: 'Zextra', leads: 2 }),
      reg({ day: '2026-09-18', sourceId: 'UC_8NZNYM', source: 'Telegram bot', productLine: 'Zextra', stage: 'Недозвон', status: 'OPEN', leads: 3 }),
      reg({ day: '2026-09-19', sourceId: '2|TELEGRAM', source: 'Открытая линия', productLine: 'Zextra', leads: 1 }),
      // Collagen's own Telegram lead goes on Collagen.
      reg({ day: '2026-09-18', sourceId: 'UC_Z1OF0D', source: 'Telegram', productLine: 'Collagen', leads: 4 }),
      // Not Telegram: a form lead and a web lead, whatever their brand.
      reg({ day: '2026-09-18', formTitle: UMAR_FORM, productLine: 'Zextra', leads: 9 }),
      reg({ day: '2026-09-18', sourceId: 'WEB', source: 'Веб-сайт', productLine: 'Zextra', leads: 9 }),
      // A Telegram lead with no «Проект» names no brand: «Brendsiz», on neither card.
      reg({ day: '2026-09-18', sourceId: 'UC_8NZNYM', source: 'Telegram bot', productLine: null, leads: 7 }),
    ]
    const out = telegramLeads(rows)
    expect([...out.get('Zextra')!.entries()]).toEqual([
      ['2026-09-18', { leads: 5, success: 2 }],
      ['2026-09-19', { leads: 1, success: 1 }],
    ])
    expect([...out.get('Collagen')!.entries()]).toEqual([['2026-09-18', { leads: 4, success: 4 }]])
    // The brand switch narrows it as `ofBrand` narrows a lead; «Brendsiz» has no card to fill.
    expect([...telegramLeads(rows, 'Collagen').keys()]).toEqual(['Collagen'])
    expect([...telegramLeads(rows, 'Zextra').keys()]).toEqual(['Zextra'])
    expect(telegramLeads(rows, 'none').size).toBe(0)
  })

  it('reaches the «Telegram» card through targetologForms, narrowed by the brand switch', async () => {
    const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
    const { resolvePeriod } = await import('@/server/domain/period/period')
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      customStart: new Date('2026-09-18T00:00:00Z'),
      customEnd: new Date('2026-09-19T00:00:00Z'),
    })
    const service = new LeadSourcesService(
      { registrationDays: async () => [reg({ day: '2026-09-18', sourceId: 'UC_8NZNYM', source: 'Telegram bot', productLine: 'Zextra', leads: 2 })] } as never,
      {
        campaignDays: async () => [],
        campaignsImportedAt: async () => null,
        manualSpend: async () => [{ day: '2026-09-18', project: 'Zextra', channel: 'telegram', amountCents: 39_060 }],
      } as never,
      {} as never,
    )
    const all = await service.targetologForms(period, 'Asia/Tashkent')
    expect(all.manual.map((m) => [m.product, m.totalUsd, m.leads, m.success])).toEqual([
      ['Collagen', 0, 0, 0],
      ['Zextra', 390.6, 2, 2],
    ])
    expect(all.manual[1]!.days[0]).toEqual({ date: '2026-09-18', spendUsd: 390.6, leads: 2, success: 2 })
    // «HR · Kosmetika» rides the same answer since the strip moved to «Lidlar» (2026-10-08): always both columns.
    expect(all.side.map((c) => [c.key, c.totalUsd, c.days.length])).toEqual([
      ['hr', 0, 2],
      ['kosmetika', 0, 2],
    ])
    const zextra = await service.targetologForms(period, 'Asia/Tashkent', 'Zextra')
    expect(zextra.manual.map((m) => m.product)).toEqual(['Zextra'])
    const collagen = await service.targetologForms(period, 'Asia/Tashkent', 'Collagen')
    expect(collagen.manual.map((m) => [m.product, m.leads])).toEqual([['Collagen', 0]])
    expect((await service.targetologForms(period, 'Asia/Tashkent', 'none')).manual).toEqual([])
  })

  it('carries «HR · Kosmetika» narrowed as the cards\' money is: hiring is no brand\'s', async () => {
    const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
    const { resolvePeriod } = await import('@/server/domain/period/period')
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      customStart: new Date('2026-09-18T00:00:00Z'),
      customEnd: new Date('2026-09-18T00:00:00Z'),
    })
    const service = new LeadSourcesService(
      { registrationDays: async () => [] } as never,
      {
        campaignDays: async () => [campaign({ campaignName: 'EX - Sinolife (vakansiya) - DM - 23.04', objective: 'OUTCOME_ENGAGEMENT', spendMicroUsd: 9_120_000n })],
        campaignsImportedAt: async () => null,
        manualSpend: async () => [],
      } as never,
      {} as never,
    )
    const hr = async (brand?: 'Collagen' | 'Zextra' | 'none') => (await service.targetologForms(period, 'Asia/Tashkent', brand)).side[0]!.totalUsd
    expect(await hr()).toBe(9.12)
    expect(await hr('none')).toBe(9.12)
    expect(await hr('Collagen')).toBe(0)
    expect(await hr('Zextra')).toBe(0)
  })
})
