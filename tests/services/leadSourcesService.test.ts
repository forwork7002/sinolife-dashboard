import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LeadFakt1ClientRow } from '@/server/repositories/insightsRepository'
import type { CampaignDayRow } from '@/server/repositories/reklamaRepository'
import type { AiQualifiedStageRow, RegistrationDayRow, TriageDayRow } from '@/server/repositories/leadSourcesRepository'

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
  targetolog: null,
  stage: 'Сделка успешна',
  status: 'WON',
  aiQualified: false,
  repeat: null,
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
  targetolog: null,
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
      // sinolifeuz: 4 leads, 1 kval (the one the AI qualified), 1 duplicate (a repeat lead).
      reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', aiQualified: true, leads: 1 }),
      reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Дубликат (лид)', status: 'OPEN', repeat: 'PROCESSING', leads: 1 }),
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
    // «ИИ квал сана» in the window, any creation day — on the client's nine sources 5 in Регистрация (one a duplicate), 3 moved on.
    aiQualified: [
      { registration: true, sourceId: 'UC_1X1J24', formTitle: null, productLine: null, stage: 'Сделка успешна', status: 'WON', repeat: null, leads: 1 },
      { registration: true, sourceId: 'UC_LBSZDU', formTitle: null, productLine: null, stage: 'Обработка', status: 'OPEN', repeat: null, leads: 3 },
      { registration: true, sourceId: 'UC_1X1J24', formTitle: null, productLine: null, stage: 'Дубликат (лид)', status: 'OPEN', repeat: 'PROCESSING', leads: 1 },
      // Not one of the nine «Источник» of the client's filter: «Телеграмм», no source.
      { registration: true, sourceId: 'UC_8NZNYM', formTitle: null, productLine: null, stage: 'Обработка', status: 'OPEN', repeat: null, leads: 4 },
      { registration: true, sourceId: null, formTitle: null, productLine: null, stage: 'Дубликат', status: 'OPEN', repeat: null, leads: 1 },
      // Already in Первичный отдел / Доставка: a repeat, counted on no tile (the client, 2026-10-03).
      { registration: false, sourceId: 'UC_A8LE21', formTitle: null, productLine: null, stage: 'Новая', status: 'OPEN', repeat: null, leads: 2 },
      { registration: false, sourceId: 'UC_A8LE21', formTitle: null, productLine: null, stage: 'Сделка успешна', status: 'WON', repeat: null, leads: 1 },
      { registration: false, sourceId: 'UC_8NZNYM', formTitle: null, productLine: null, stage: 'Новая', status: 'OPEN', repeat: null, leads: 5 },
    ],
    // «Сарафан маркетинг» in every pipeline: 3 created, 2 won (the client, 2026-10-10).
    sarafan: { leads: 3, qualified: 2 },
    // «Kimga qancha lid kelayapti» → «Квал», two days: 5 to Sevinch, 2 to nobody's team (one a repeat contact).
    handedOut: [
      { day: '2026-09-18', rop: 'Sevinch', leads: 5, duplicates: 0 },
      { day: '2026-09-19', rop: null, leads: 2, duplicates: 1 },
    ],
  })

  it('reads the six headline figures off the counted tiles — «Исход» is in none (the client, 2026-10-09)', () => {
    expect(data.funnel).toEqual({
      // 26 Регистрация deals less «Исход» 7 and the Регистрация «Сарафан маркетинг» lead.
      total: 18,
      fresh: 17,
      duplicates: 1,
      repeatBought: 0,
      repeatProcessing: 1,
      // The cohort: of those 18, WON by now — «Ген лид» 5, «Сммщик ии»'s card 1 (sinolifeuz), Telegram 1, the site 1.
      qualified: 8,
      qualifiedPercent: (8 / 17) * 100,
      // WON in the window whenever it arrived, the old count: «Ген лид» 3 + sinolifeuz 1 («Исход» and the sourceless kval apart).
      closedQualified: 4,
      // Handed out to a ROP in the window, the grid's «Jami» summed — every team, nobody's, duplicates in.
      handedOut: 7,
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

  it('puts each account\'s unlinked money on its targetolog\'s row, so the rows add up to «Jami»', () => {
    const d = leadSourcesOverview({
      window: WINDOW,
      importedAt: null,
      registration: [reg({ formTitle: UMAR_FORM, leads: 3 })],
      triage: [],
      campaigns: [
        campaign({ leads: 4, spendMicroUsd: 20_000_000n }),
        campaign({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'Sms-1', spendMicroUsd: 3_000_000n }),
        // Kamron spent on DM alone: no form, no lead, still a targetolog's row.
        campaign({ accountId: '926218346480236', accountName: 'Zextra Kamron 1', objective: 'OUTCOME_ENGAGEMENT', campaignName: 'DM', spendMicroUsd: 6_000_000n }),
        // Hiring is no ad budget: neither a row's DM money nor «Jami»'s.
        campaign({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'vakansiya DM', spendMicroUsd: 7_000_000n }),
      ],
      fakt1: [],
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    })
    const rows = d.forms.owners.map((o) => [o.key, o.spendUsd, o.unlinkedUsd])
    expect(rows).toEqual([
      ['Collagen|Umar', 20, 3],
      ['Zextra|Kamron', 0, 6],
    ])
    expect(d.forms.expenseOwners).toEqual([])
    const sum = d.forms.owners.reduce((t, o) => t + o.spendUsd + o.unlinkedUsd, 0)
    expect(sum).toBe(d.forms.total.spendUsd)
  })

  it('files a «Ген лид» the form does not name under the deal\'s «Таргетолог» field', () => {
    const d = leadSourcesOverview({
      window: WINDOW,
      importedAt: null,
      registration: [
        reg({ formTitle: UMAR_FORM, leads: 3 }),
        // Renamed by hand, no form left — the field still says Umar; «Проект» says Collagen.
        reg({ targetolog: 'Umar', productLine: 'Collagen', leads: 2 }),
        // A form whose name names nobody, on Eldor's deal.
        reg({ formTitle: 'Заполнение CRM-формы "Collagen Marine ген лид"', targetolog: 'Элдор', stage: 'Недозвон', status: 'OPEN', leads: 1 }),
        // No «Проект»: no brand, so his «Brendsiz» row — never guessed into a product.
        reg({ targetolog: 'Kamron', leads: 1 }),
        // The portal's «AI».
        reg({ targetolog: 'AI', productLine: 'Collagen', leads: 1 }),
        // Nobody named at all: «Ген лид · formasiz».
        reg({ leads: 4 }),
        // A DM page's lead is the page's, whatever the field says.
        reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', targetolog: 'Umar', leads: 5 }),
      ],
      triage: [],
      campaigns: [],
      fakt1: [fakt1({ formTitle: null, targetolog: 'Umar', productLine: 'Collagen' })],
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    })
    const rows = d.forms.owners.map((o) => [o.key, o.outcome.leads, o.formlessLeads, o.forms])
    expect(rows).toEqual([
      ['Collagen|Umar', 5, 2, ['Sinolife (UMAR) 777']],
      ['Collagen|Элдор', 1, 0, ['Collagen Marine ген лид']],
      ['Collagen|AI targetolog', 1, 1, []],
      ['brandless|Kamron', 1, 1, []],
    ])
    // «Yetib keldi» is the forms': Umar's 2 field-filed leads are not in it.
    expect(d.forms.owners.find((o) => o.key === 'Collagen|Umar')!.reachPercent).toBeNull()
    expect(d.forms.manual.leads).toBe(4)
    expect(d.forms.owners.find((o) => o.key === 'Collagen|Umar')!.fakt1Clients).toBe(1)
    expect(d.dm.pages.find((p) => p.key === 'UC_1X1J24')!.outcome.leads).toBe(5)
  })

  it('gives a copy\'s short form name to the form it ends, and draws every field-filed row under its leads\' own brand', () => {
    const input = {
      window: WINDOW,
      importedAt: null,
      registration: [
        reg({ formTitle: 'Заполнение CRM-формы "Timur-zextra zextra - 27 / 09 Варианты"', leads: 3 }),
        // The «Qayta zayavka» copy names the form as Meta knows it.
        reg({ formTitle: 'Qayta zayavka (forma akt #4663340) Заполнена CRM-форма "zextra - 27 / 09 Варианты"', leads: 2 }),
        // One word ends nobody's form: «777» stays a row of its own.
        reg({ formTitle: 'Заполнение CRM-формы "777"', leads: 1 }),
        // No form: Eldor's by the field — Collagen by «Проект», «Brendsiz» without it.
        reg({ targetolog: 'Элдор', productLine: 'Collagen', leads: 4 }),
        reg({ targetolog: 'Элдор', leads: 6 }),
      ],
      triage: [],
      campaigns: [campaign({ leads: 10, spendMicroUsd: 1_000_000n, accountId: '1794735288825705', accountName: 'Collagen Eldor' })],
      fakt1: [],
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    }
    const keys = (brand?: 'Collagen' | 'Zextra' | 'none') =>
      leadSourcesOverview({ ...input, brand }).forms.owners.map((o) => [o.key, o.outcome.leads])
    expect(keys()).toEqual([
      ['Collagen|Элдор', 4],
      ['Zextra|Timur', 5],
      ['brandless|Элдор', 6],
      ['form|777', 1],
    ])
    // Each slice draws exactly the rows of its own leads, so the three add up to «Hammasi».
    expect(keys('Collagen')).toEqual([
      ['Collagen|Элдор', 4],
      ['form|777', 1],
    ])
    expect(keys('Zextra')).toEqual([['Zextra|Timur', 5]])
    expect(keys('none')).toEqual([['brandless|Элдор', 6]])
    // Eldor's Collagen reach is his form leads' only — none here.
    expect(leadSourcesOverview(input).forms.owners[0]!.reachPercent).toBe(0)
    expect(leadSourcesOverview(input).totals.formReachPercent).toBe(60)
  })

  it('counts the repeat leads («Такрор лид») as Дубль, whatever stage they sit in (the client, 2026-10-16)', () => {
    const d = leadSourcesOverview({
      window: WINDOW,
      importedAt: null,
      registration: [
        reg({ stage: 'Дубликат (лид)', status: 'OPEN', repeat: 'PROCESSING', leads: 9 }),
        reg({ stage: 'Лид новый (лид)', status: 'OPEN', repeat: 'PROCESSING', leads: 4 }),
        reg({ stage: 'Лид новый (лид)', status: 'OPEN', repeat: 'BOUGHT', leads: 2 }),
        // A value the portal may add later: still a repeat lead, on neither line.
        reg({ stage: 'Обработка', status: 'OPEN', repeat: 'OTHER', leads: 1 }),
        // In «Дубликат (лид)» with the field empty, and the red «Дубликат»: new leads now.
        reg({ stage: 'Дубликат (лид)', status: 'OPEN', leads: 3 }),
        reg({ stage: 'Дубликат', status: 'OPEN', leads: 7 }),
        reg({ stage: 'Обработка', status: 'OPEN', leads: 74 }),
      ],
      triage: [],
      campaigns: [],
      fakt1: [],
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    })
    expect(d.funnel).toMatchObject({ total: 100, duplicates: 16, fresh: 84, repeatBought: 2, repeatProcessing: 13 })
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
    // The bot accounts by the day the deal was created — sinolifeuz 4 (one «Дубликат (лид)») and
    // collagen.sinolife 1 — whatever the AI marked; «Jami» summed it until 2026-10-16.
    expect(tile('aiSmm')).toMatchObject({ leads: 5, fresh: 4, qualified: 2, qualifiedPercent: 50, closedQualified: 1 })
    // The card itself (the client's portal filter, 2026-10-15): «ИИ квал сана» + the nine sources, Регистрация, by account —
    // what «Jami» sums since 2026-10-16.
    expect(data.tiles.ai).toEqual({ leads: 5, fresh: 4, qualified: 1, qualifiedPercent: 25 })
    expect(data.tiles.smmAccounts).toEqual([
      { key: 'UC_LBSZDU', name: 'zextra.sinolife', leads: 3, fresh: 3, qualified: 0, qualifiedPercent: 0, closedQualified: 0 },
      { key: 'UC_1X1J24', name: 'sinolifeuz', leads: 2, fresh: 1, qualified: 1, qualifiedPercent: 100, closedQualified: 0 },
    ])
    expect(data.tiles.aiElsewhere).toBe(3)
    expect(tile('web')).toMatchObject({ leads: 1, qualified: 1 })
    // «Сарафан маркетинг» of every pipeline, not Регистрация's alone.
    expect(tile('sarafan')).toMatchObject({ leads: 3, fresh: 3, qualified: 2 })
    // Out of «Jami»: the operators' own calls, and the Регистрация «Сарафан маркетинг» lead (with the sourceless closed kval).
    expect(tile('outbound')).toMatchObject({ leads: 7, qualified: 0, closedQualified: 1 })
    expect(tile('other')).toMatchObject({ leads: 1, fresh: 1, qualified: 0, closedQualified: 1 })
    // «Jami» = the cards on screen (the client, 2026-10-16): «Сммщик ии» as its card, its close-day count the row's.
    const inTotal = data.tiles.rows.filter((r) => !['outbound', 'other', 'sarafan'].includes(r.tile))
    const shown = inTotal.map((r) => (r.tile === 'aiSmm' ? { ...r, ...data.tiles.ai } : r))
    expect(data.tiles.total).toEqual({
      leads: shown.reduce((n, r) => n + r.leads, 0),
      fresh: shown.reduce((n, r) => n + r.fresh, 0),
      qualified: shown.reduce((n, r) => n + r.qualified, 0),
      qualifiedPercent: (8 / 17) * 100,
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
    // And with «Исход» and «Boshqa», «Сммщик ии» by creation day, it is every Регистрация deal — nothing is lost, only kept apart.
    const apart = data.tiles.rows.filter((r) => r.tile === 'outbound' || r.tile === 'other')
    const smmRow = data.tiles.rows.find((r) => r.tile === 'aiSmm')!
    expect(total.leads - data.tiles.ai.leads + smmRow.leads + apart.reduce((n, r) => n + r.leads, 0)).toBe(data.totals.registration.leads)
  })

  it('counts the card on the client\'s nine sources alone — a page\'s second bot, «Сммщик» and «Ген лид» are not in it', () => {
    const ai = (sourceId: string, stage: string, status: string, leads: number): AiQualifiedStageRow => ({
      registration: true,
      sourceId,
      formTitle: null,
      productLine: null,
      stage,
      status,
      repeat: null,
      leads,
    })
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
      aiQualified: [
        ai('UC_LBSZDU', 'Сделка успешна', 'WON', 2),
        ai('46|NEXTBOT', 'Обработка', 'OPEN', 3),
        ai('REPEAT_SALE', 'Обработка', 'OPEN', 9),
        ai('UC_5JW4YK', 'Обработка', 'OPEN', 4),
        ai('UC_Z1OF0D', 'Обработка', 'OPEN', 1),
      ],
      sarafan: NO_SARAFAN,
    })
    expect(d.tiles.smmAccounts.map((a) => [a.name, a.leads, a.qualified])).toEqual([
      ['zextra.sinolife', 2, 2],
      ['sinolif_tg', 1, 0],
    ])
    expect(d.tiles.ai.leads).toBe(3)
    // «Jami»'s row still reads the SMM sources by creation day, the second bot folded into its page.
    expect(d.tiles.rows.find((r) => r.tile === 'aiSmm')!.leads).toBe(6)
    expect(d.tiles.rows.find((r) => r.tile === 'aiSmm')!.leads).toBe(6)
    expect(d.tiles.rows.find((r) => r.tile === 'telegram')!.leads).toBe(0)
  })

  it('keeps a form\'s «Исход» leads on a line apart, so every «Barcha manbalar» line is wholly in «Jami» or out of it', () => {
    const rows = [
      reg({ sourceId: 'UC_KPZA32', source: 'Исход', formTitle: UMAR_FORM, leads: 2 }),
      reg({ formTitle: UMAR_FORM, leads: 3 }),
    ]
    for (const registration of [rows, [...rows].reverse()]) {
      const d = leadSourcesOverview({ window: WINDOW, importedAt: null, registration, triage: [], campaigns: [], fakt1: [], qualified: [], aiQualified: [], sarafan: NO_SARAFAN })
      expect(d.sources.map((x) => [x.outcome.leads, x.counted]).sort()).toEqual([[2, false], [3, true]])
      expect(d.sources.filter((x) => x.counted).reduce((n, x) => n + x.outcome.leads, 0)).toBe(d.totals.counted.leads)
    }
  })

  it('keeps the totals equal on an empty window', () => {
    const empty = leadSourcesOverview({ window: WINDOW, importedAt: null, registration: [], triage: [], campaigns: [], fakt1: [], qualified: [], aiQualified: [], sarafan: NO_SARAFAN })
    expect(empty.tiles).toMatchObject({ smmAccounts: [], aiElsewhere: 0 })
    expect(empty.tiles.ai).toEqual({ leads: 0, fresh: 0, qualified: 0, qualifiedPercent: null })
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

  it('puts «Факт1 мижоз» on the form owner and on the person, distinct — «Target tahlili»\'s cards', () => {
    expect(data.forms.owners.find((o) => o.key === 'Collagen|Umar')!.fakt1Clients).toBe(2)
    expect(data.forms.fakt1Targetologs).toEqual([{ targetolog: 'Umar', clients: 2 }])

    const both = leadSourcesOverview({
      window: WINDOW,
      importedAt: null,
      registration: [reg({ formTitle: UMAR_FORM }), reg({ formTitle: 'Заполнение CRM-формы "Zextra Umar 64"' })],
      triage: [],
      campaigns: [],
      // One client who filled Umar's Collagen form AND his Zextra form: one per product, one for the person.
      fakt1: [fakt1({}), fakt1({ formTitle: 'Заполнение CRM-формы "Zextra Umar 64"' })],
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    })
    expect(both.forms.owners.map((o) => [o.key, o.fakt1Clients])).toEqual([
      ['Collagen|Umar', 1],
      ['Zextra|Umar', 1],
    ])
    expect(both.forms.fakt1Targetologs).toEqual([{ targetolog: 'Umar', clients: 1 }])
  })

  it('reads «Факт1 мижоз» as unread, never 0, when the phone match did not answer', () => {
    const unread = leadSourcesOverview({
      window: WINDOW,
      importedAt: null,
      registration: [reg({ formTitle: UMAR_FORM })],
      triage: [],
      campaigns: [],
      fakt1: null,
      qualified: [],
      aiQualified: [],
      sarafan: NO_SARAFAN,
    })
    expect(unread.forms.owners[0]!.fakt1Clients).toBeNull()
    expect(unread.forms.fakt1Targetologs).toBeNull()
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
      { registration: true, sourceId: 'UC_A8LE21', formTitle: null, productLine: null, stage: 'Обработка', status: 'OPEN', repeat: null, leads: 1 },
      { registration: true, sourceId: null, formTitle: null, productLine: null, stage: 'Обработка', status: 'OPEN', repeat: null, leads: 2 },
    ],
    sarafan: { leads: 3, qualified: 2 },
    inboundCalls: 9,
    // Handed out to a ROP («Kimga qancha lid kelayapti» → «Квал»): a Zextra team, a Collagen team, and nobody's.
    handedOut: [
      { day: '2026-09-18', rop: 'Asliddin', leads: 4, duplicates: 0 },
      { day: '2026-09-19', rop: 'Sevinch', leads: 6, duplicates: 1 },
      { day: '2026-09-19', rop: null, leads: 2, duplicates: 0 },
    ],
  }
  const all = leadSourcesOverview(input)
  const zextra = leadSourcesOverview({ ...input, brand: 'Zextra' })
  const collagen = leadSourcesOverview({ ...input, brand: 'Collagen' })

  it('narrows leads by source then form, kval and FAKT 1 clients alike, and money by ad account', () => {
    expect(all.brand).toBe('all')
    expect(zextra.brand).toBe('Zextra')
    // Kval is the cohort's (the Kamron form's 3 leads, WON); the 2 closed in the window ride beside it,
    // and the handed-out card counts the leads given to the brand's teams. «Jami» adds «Сммщик ии»'s card (2026-10-16):
    // Zextra the form's 3 and zextrauzb's 1 by «ИИ квал сана»; sinolifeuz's 5 carry none in the window, so Collagen reads 0.
    expect(zextra.funnel).toMatchObject({ total: 4, qualified: 3, closedQualified: 2, handedOut: 4, spendUsd: 8 })
    expect(collagen.funnel).toMatchObject({ total: 0, qualified: 0, closedQualified: 1, handedOut: 6, spendUsd: 20 })
    expect(all.funnel.handedOut).toBe(12)
    // The outgoing call is no lead, so the two brands make «Жами лидлар»; with it they make Регистрация.
    expect(all.funnel.total).toBe(zextra.funnel.total + collagen.funnel.total)
    const smmRow = all.tiles.rows.find((r) => r.tile === 'aiSmm')!.leads
    expect(all.totals.registration.leads).toBe(all.funnel.total - all.tiles.ai.leads + smmRow + 7)
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
    expect(zextra.tiles.ai.leads).toBe(1)
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
    expect(collagen.funnel.handedOut + zextra.funnel.handedOut + none.funnel.handedOut).toBe(all.funnel.handedOut)
    // «Сммщик ии»'s «ИИ квал сана» card too: zextra.uz is Zextra's, the sourceless AI deals are on no card.
    expect(collagen.tiles.ai.leads + zextra.tiles.ai.leads + none.tiles.ai.leads).toBe(all.tiles.ai.leads)
    expect(collagen.tiles.aiElsewhere + zextra.tiles.aiElsewhere + none.tiles.aiElsewhere).toBe(all.tiles.aiElsewhere)
    expect([all.tiles.ai.leads, zextra.tiles.ai.leads, none.tiles.smmAccounts.length]).toEqual([1, 1, 0])
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
          sourceCount: slow ? never('sourceCount') : async () => NO_SARAFAN,
          inboundCallCount: slow ? never('inboundCallCount') : async () => null,
          handedOutDays: slow ? never('handedOutDays') : async () => [],
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

    // Without the phone match «Факт1 мижоз» is unread, never 0 — and everything else is the overview's.
    expect(umar.fakt1Clients).toBeNull()
    expect(alone.forms.fakt1Targetologs).toBeNull()
    const whole = await service(false).overview(period, 'Asia/Tashkent')
    const unread = {
      ...whole.forms,
      owners: whole.forms.owners.map((o) => ({ ...o, fakt1Clients: null })),
      expenseOwners: whole.forms.expenseOwners.map((o) => ({ ...o, fakt1Clients: null })),
      fakt1Targetologs: null,
    }
    expect(alone.forms).toEqual(unread)
    // «Target tahlili» asks for it, and gets the overview's block to the client.
    const withFakt1 = await service(false).targetologForms(period, 'Asia/Tashkent', 'all', { fakt1: true })
    expect(withFakt1.forms).toEqual(whole.forms)
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
        sourceCount: async () => NO_SARAFAN,
        inboundCallCount: async () => null,
        handedOutDays: async () => [],
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
        sourceCount: async () => NO_SARAFAN,
        inboundCallCount: async () => null,
        handedOutDays: async () => [],
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
        sourceCount: async () => NO_SARAFAN,
        inboundCallCount: async () => null,
        handedOutDays: async () => [],
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
        sourceCount: read('sourceCount', NO_SARAFAN),
        inboundCallCount: read('inboundCallCount', null),
        handedOutDays: read('handedOutDays', []),
      } as never,
      { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
      { leadFakt1Clients: read('leadFakt1Clients', []) } as never,
    )

    const answer = service.overview(period, 'Asia/Tashkent')
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Nothing has answered and every read is out — the six scans with them, where the warmer's pace shows two.
    expect([...inFlight].sort()).toEqual([
      'aiQualifiedStages',
      'handedOutDays',
      'inboundCallCount',
      'leadFakt1Clients',
      'qualifiedSources',
      'registrationDays',
      'sourceCount',
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
        sourceCount: async () => NO_SARAFAN,
        inboundCallCount: async () => null,
        handedOutDays: async () => [],
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
          sourceCount: read(NO_SARAFAN),
          inboundCallCount: read(null),
          handedOutDays: async () => [],
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
          sourceCount: read('sourceCount', NO_SARAFAN),
          inboundCallCount: read('inboundCallCount', null),
          handedOutDays: read('handedOutDays', []),
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
        'handedOutDays',
        'inboundCallCount',
        'leadFakt1Clients',
        'qualifiedSources',
        'registrationDays',
        'sourceCount',
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
          sourceCount: read('sourceCount', NO_SARAFAN),
          inboundCallCount: read('inboundCallCount', null),
          handedOutDays: read('handedOutDays', []),
        } as never,
        { campaignDays: async () => [], campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
        { leadFakt1Clients: read('leadFakt1Clients', []) } as never,
      )
    await service(warmers.LeadSourcesService).warm(now, 'Asia/Tashkent')
    expect(reads).toHaveLength(16)

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

describe('«Targetologlar» counts Meta\'s way — every CRM-form fill (2026-10-15)', () => {
  /*
    01–15.10.2026: Meta 13 197 Collagen form leads, the portal 13 174 fills,
    10 896 Регистрация deals — a returning contact's fill lands on the old
    deal. The client: «leadlar qanday hisoblanayotgan bo'lsa huddi shunday».
  */
  const UMAR = 'Umar-collagen Collagen (UMAR)'
  const fill = (day: string, form: string, fills: number) => ({ day, subject: `Заполнена CRM-форма "${form}"`, fills })
  const input = {
    window: WINDOW,
    importedAt: null,
    registration: [
      // Umar's form opened three deals, all kval.
      reg({ formTitle: `Заполнение CRM-формы "${UMAR}"`, leads: 3 }),
      // The AI targetolog's leads arrive as deals, never as a CRM-form fill.
      reg({ formTitle: 'CRM-формы «AI targetolog · Sinolife AI forma»', leads: 2, stage: 'Недозвон', status: 'OPEN' }),
    ],
    formFills: [
      fill('2026-09-18', UMAR, 4),
      fill('2026-09-19', UMAR, 1),
      fill('2026-09-18', 'Timur-zextra zextra - 27 / 09 Варианты', 2),
      // The website's form: the «Sayt» campaigns' leads land there.
      fill('2026-09-18', 'collagen form web', 5),
    ],
    triage: [],
    campaigns: [campaign({ leads: 6, spendMicroUsd: 3_000_000n })],
    fakt1: [],
    qualified: [],
    aiQualified: [],
    sarafan: NO_SARAFAN,
  }
  const owner = (d: ReturnType<typeof leadSourcesOverview>, key: string) => d.forms.owners.find((o) => o.key === key)!

  it('sets the fills beside Meta\'s leads, and keeps what the deals became', () => {
    const d = leadSourcesOverview(input)
    const umar = owner(d, 'Collagen|Umar')
    expect(umar).toMatchObject({ bitrixLeads: 5, leadsBasis: 'fills', metaLeads: 6 })
    expect(umar.outcome).toMatchObject({ leads: 3, success: 3 })
    expect(umar.reachPercent).toBeCloseTo((5 / 6) * 100, 6)
    expect(umar.costPerLeadUsd).toBeCloseTo(3 / 5, 6)
    expect(umar.days.map((day) => day.leads)).toEqual([4, 1])
    expect(owner(d, 'Zextra|Timur').bitrixLeads).toBe(2)
    expect(owner(d, 'Collagen|AI targetolog').bitrixLeads).toBe(2)
    // The website form's fills are on its own row: this screen's «Meta lid» counts the «Sayt» leads.
    expect(owner(d, 'form|collagen form web').bitrixLeads).toBe(5)
    expect(d.forms).toMatchObject({ bitrixLeads: 14, leadsBasis: 'fills' })
    expect(d.forms.days.map((day) => day.leads)).toEqual([13, 1])
    expect(d.totals.formReachPercent).toBeCloseTo((14 / 6) * 100, 6)
  })

  it('narrows the fills by the brand their form states', () => {
    const zextra = leadSourcesOverview({ ...input, brand: 'Zextra' })
    expect(zextra.forms.owners.map((o) => [o.key, o.bitrixLeads])).toEqual([['Zextra|Timur', 2]])
  })

  it('files a fill where its form\'s deals are filed — a form naming nobody keeps its fills on its own row', () => {
    const d = leadSourcesOverview({
      ...input,
      registration: [...input.registration, reg({ formTitle: 'Заполнение CRM-формы "Collagen marine forma"', leads: 4 })],
      formFills: [...input.formFills, fill('2026-09-18', 'Collagen marine forma', 6)],
    })
    expect(owner(d, 'form|Collagen marine forma')).toMatchObject({ bitrixLeads: 6, outcome: expect.objectContaining({ leads: 4 }) })
    // The website form too: this screen's «Meta lid» counts the «Sayt» campaigns' leads.
    expect(owner(d, 'form|collagen form web').bitrixLeads).toBe(5)
    expect(d.forms.bitrixLeads).toBe(5 + 2 + 2 + 6 + 5)
  })

  it('counts no vacancy or cosmetics form\'s fill', () => {
    const d = leadSourcesOverview({ ...input, formFills: [fill('2026-09-18', 'Eldor kosmetika forma', 7), fill('2026-09-18', 'Umar vakansiya', 3)] })
    expect(d.forms.owners.some((o) => o.bitrixLeads > 0 && o.key !== 'Collagen|AI targetolog')).toBe(false)
  })

  it('never lets a fill move a deal to another targetolog', () => {
    const copy = 'Qayta zayavka (forma akt #4663340) Заполнена CRM-форма "zextra - 27 / 09 Варианты"'
    const base = {
      ...input,
      registration: [reg({ formTitle: 'Заполнение CRM-формы "Timur-zextra zextra - 27 / 09 Варианты"', leads: 1 }), reg({ formTitle: copy, leads: 5 })],
    }
    const without = leadSourcesOverview({ ...base, formFills: [] })
    // Kamron's form ending alike appears among the fills alone: the copy's five deals stay Timur's.
    const withFill = leadSourcesOverview({ ...base, formFills: [fill('2026-09-18', 'Kamron-zextra zextra - 27 / 09 Варианты', 1)] })
    expect(owner(without, 'Zextra|Timur').outcome.leads).toBe(6)
    expect(owner(withFill, 'Zextra|Timur').outcome.leads).toBe(6)
  })

  it('keeps the deals on «Brendsiz», where no customer form\'s fill can land', () => {
    const d = leadSourcesOverview({ ...input, registration: [reg({ targetolog: 'Элдор', leads: 3 })], brand: 'none' })
    expect(owner(d, 'brandless|Элдор')).toMatchObject({ bitrixLeads: 3, leadsBasis: 'deals' })
  })

  it('«Ген лид» — and «Жами лидлар» through it — is the fills, read from Bitrix24 (2026-10-16); its kval stays the deals\'', () => {
    const d = leadSourcesOverview(input)
    const generated = d.tiles.rows.find((t) => t.tile === 'generated')!
    expect(d.tiles.generatedBasis).toBe('fills')
    expect(generated).toMatchObject({ leads: 14, qualified: 3 })
    expect(d.funnel).toMatchObject({ total: 14, qualified: 3 })
    // The «Ген лид» deals themselves stay where they were: «Barcha manbalar».
    expect(d.totals.counted.leads).toBe(5)

    const deals = leadSourcesOverview({ ...input, formFills: null })
    expect(deals.tiles.generatedBasis).toBe('deals')
    expect(deals.funnel.total).toBe(5)
  })

  it('«Ген лид» keeps its deals beside the fills, for the quiet line', () => {
    expect(leadSourcesOverview(input).tiles.generatedDeals).toBe(5)
    expect(leadSourcesOverview({ ...input, formFills: null }).tiles.generatedDeals).toBe(5)
  })

  it('«Ген лид»: a formless deal filed on an owner is its fill, so Collagen + Zextra + Brendsiz is «Hammasi»', () => {
    const withOwned = {
      ...input,
      registration: [
        ...input.registration,
        // A form lead whose name was lost, filed on Eldor by the «Таргетолог» field, no «Проект»: «Brendsiz».
        reg({ targetolog: 'Элдор', leads: 3 }),
        reg({ stage: 'Недозвон', status: 'OPEN' }),
      ],
    }
    const view = (brand?: 'Collagen' | 'Zextra' | 'none') => leadSourcesOverview({ ...withOwned, brand })
    const generated = (brand?: 'Collagen' | 'Zextra' | 'none') => view(brand).tiles.rows.find((r) => r.tile === 'generated')!
    // 12 fills + 2 AI targetolog deals + 1 typed by hand; Eldor's three are in none of it.
    expect(generated().leads).toBe(15)
    // «Brendsiz»: the hand-typed one alone; its deals are Eldor's three and it.
    expect(generated('none').leads).toBe(1)
    expect(view('none').tiles).toMatchObject({ generatedBasis: 'fills', generatedDeals: 4 })
    expect(generated('Collagen').leads + generated('Zextra').leads + generated('none').leads).toBe(generated().leads)
    expect(generated('Collagen').qualified + generated('Zextra').qualified + generated('none').qualified).toBe(generated().qualified)
  })

  it('«Ген лид» never prints more duplicates than leads while the fills trail the deals', () => {
    const d = leadSourcesOverview({
      ...input,
      registration: [reg({ formTitle: `Заполнение CRM-формы "${UMAR}"`, leads: 4, stage: 'Дубликат (лид)', status: 'OPEN', repeat: 'PROCESSING' })],
      formFills: [fill('2026-09-18', UMAR, 2)],
    })
    expect(d.tiles.rows.find((r) => r.tile === 'generated')).toMatchObject({ leads: 2, fresh: 0 })
    expect(d.funnel).toMatchObject({ total: 2, fresh: 0, duplicates: 2, repeatBought: 0, repeatProcessing: 2 })
  })

  it('cuts the two «Такрор» lines with the cap, so they never sum past «Дубль лидлар»', () => {
    const form = `Заполнение CRM-формы "${UMAR}"`
    const d = leadSourcesOverview({
      ...input,
      registration: [
        reg({ formTitle: form, leads: 3, stage: 'Лид новый (лид)', status: 'OPEN', repeat: 'BOUGHT' }),
        reg({ formTitle: form, leads: 4, stage: 'Лид новый (лид)', status: 'OPEN', repeat: 'PROCESSING' }),
        reg({ formTitle: form, leads: 1, stage: 'Лид новый (лид)', status: 'OPEN', repeat: 'OTHER' }),
      ],
      formFills: [fill('2026-09-18', UMAR, 5)],
    })
    // 8 repeat deals over 5 fills: the 3 too many come off «boshqa» (1), then «обработка» (2).
    expect(d.funnel).toMatchObject({ total: 5, duplicates: 5, repeatBought: 3, repeatProcessing: 2 })
  })

  it('counts the deals, as before, for a window the fills do not cover', () => {
    const d = leadSourcesOverview({ ...input, formFills: null })
    expect(owner(d, 'Collagen|Umar')).toMatchObject({ bitrixLeads: 3, leadsBasis: 'deals' })
    expect(owner(d, 'Collagen|Umar').reachPercent).toBeCloseTo(50, 6)
    expect(d.forms.leadsBasis).toBe('deals')
  })
})
