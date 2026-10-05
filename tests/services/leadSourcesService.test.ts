import { describe, expect, it } from 'vitest'

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
      // A DM campaign is not a form: its money and conversations stay off this tab.
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
      { sourceId: 'REPEAT_SALE', aiQualified: false, qualified: 3 },
      { sourceId: 'UC_1X1J24', aiQualified: true, qualified: 1 },
      { sourceId: 'UC_KPZA32', aiQualified: false, qualified: 1 },
      { sourceId: null, aiQualified: false, qualified: 1 },
    ],
    // «ИИ квал сана» in the window, any creation day — 6 in Регистрация (one a duplicate), 3 moved on.
    aiQualified: [
      { registration: true, stage: 'Сделка успешна', status: 'WON', leads: 1 },
      { registration: true, stage: 'Обработка', status: 'OPEN', leads: 3 },
      { registration: true, stage: 'Дубликат (лид)', status: 'OPEN', leads: 1 },
      // The red «Дубликат» is no «Дубль лид» (the client, 2026-10-02): still a fresh lead here.
      { registration: true, stage: 'Дубликат', status: 'OPEN', leads: 1 },
      // Already in Первичный отдел / Доставка: a repeat, counted on no tile (the client, 2026-10-03).
      { registration: false, stage: 'Новая', status: 'OPEN', leads: 2 },
      { registration: false, stage: 'Сделка успешна', status: 'WON', leads: 1 },
    ],
  })

  it('reads the six headline figures', () => {
    expect(data.funnel).toEqual({
      total: 26,
      fresh: 25,
      duplicates: 1,
      qualified: 6,
      qualifiedPercent: (6 / 25) * 100,
      // Umar's form 20 + 5 and his DM 9; the unmapped account and the hiring campaign are left out.
      spendUsd: 34,
      costPerQualifiedUsd: 34 / 6,
    })
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
    })
    expect(d.funnel).toMatchObject({ total: 100, duplicates: 16, fresh: 84 })
    // The channel tiles read the same Дубль, so their Jami stays the headline's.
    expect(d.tiles.total).toMatchObject({ leads: 100, fresh: 84 })
  })

  it('prices nothing when nobody was qualified or nothing arrived', () => {
    const empty = leadSourcesOverview({ window: WINDOW, importedAt: null, registration: [], triage: [], campaigns: [], fakt1: [], qualified: [], aiQualified: [] })
    expect(empty.funnel).toMatchObject({ total: 0, fresh: 0, qualified: 0, qualifiedPercent: null, costPerQualifiedUsd: null })
  })

  it('leaves the kval price unknown, not free, when no Meta spend was read', () => {
    const noMeta = leadSourcesOverview({ window: WINDOW, importedAt: null, registration: [reg({})], triage: [], campaigns: [], fakt1: [], qualified: [{ sourceId: 'REPEAT_SALE', aiQualified: false, qualified: 5 }], aiQualified: [] })
    expect(noMeta.funnel.costPerQualifiedUsd).toBeNull()
  })

  it('counts every Регистрация lead, and splits the ad ones out', () => {
    expect(data.totals.registration.leads).toBe(26)
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

  it('fills the client\'s channel tiles, «Исход» and «Boshqa» included, and sums all but those two', () => {
    const tile = (t: string) => data.tiles.rows.find((r) => r.tile === t)!
    expect(data.tiles.rows.map((r) => r.tile)).toEqual(['generated', 'inbound', 'telegram', 'aiSmm', 'web', 'sarafan', 'outbound', 'other'])
    // Umar's form (5) and the hand-typed «Ген лид» (2): «Ген лид» whole; kval by the day it was WON.
    expect(tile('generated')).toMatchObject({ leads: 7, fresh: 7, qualified: 3, qualifiedPercent: (3 / 7) * 100 })
    expect(tile('inbound')).toMatchObject({ leads: 3, qualified: 0, qualifiedPercent: 0 })
    expect(tile('telegram')).toMatchObject({ leads: 2, qualified: 0 })
    // By «ИИ квал сана», Регистрация only — not the one window lead the AI marked, nor the 3 moved on.
    expect(tile('aiSmm')).toMatchObject({ leads: 6, fresh: 5, qualified: 1, qualifiedPercent: 20 })
    expect(data.tiles.aiElsewhere).toBe(3)
    expect(tile('web')).toMatchObject({ leads: 1, qualified: 0 })
    expect(tile('sarafan')).toMatchObject({ leads: 1, qualified: 0 })
    expect(tile('outbound')).toMatchObject({ leads: 7, qualified: 1 })
    // The page's unqualified three (one a duplicate), collagen.sinolife, and the kval with no source.
    expect(tile('other')).toMatchObject({ leads: 4, fresh: 3, qualified: 1 })
    // «Jami» is the headline less «Исход» (7 · 1 kval) and «Boshqa» (4, one a duplicate · 1 kval),
    // with «Сммщик ии» on its own date: 6 (one «Дубликат (лид)») where the window held 1.
    expect(data.tiles.total).toEqual({
      leads: data.funnel.total - 11 - 1 + 6,
      fresh: data.funnel.fresh - 10 - 1 + 5,
      qualified: data.funnel.qualified - 2,
      qualifiedPercent: ((data.funnel.qualified - 2) / (data.funnel.fresh - 10 - 1 + 5)) * 100,
    })
    const inTotal = data.tiles.rows.filter((r) => r.tile !== 'outbound' && r.tile !== 'other')
    expect(data.tiles.total.leads).toBe(inTotal.reduce((n, r) => n + r.leads, 0))
  })

  it('says what takes «Jami» to «Жами лидлар», to the lead (the client, 2026-10-02)', () => {
    // «Исход» 7, «Boshqa» 4, and the AI: 1 window lead carried the mark, «Сммщик ии» reads 6.
    expect(data.tiles.toHeadline).toEqual({ outbound: 7, other: 4, ai: 1 - 6 })
    const { outbound, other, ai } = data.tiles.toHeadline
    expect(data.tiles.total.leads + outbound + other + ai).toBe(data.funnel.total)
  })

  it('keeps the identity on an empty window', () => {
    const empty = leadSourcesOverview({ window: WINDOW, importedAt: null, registration: [], triage: [], campaigns: [], fakt1: [], qualified: [], aiQualified: [] })
    expect(empty.tiles.toHeadline).toEqual({ outbound: 0, other: 0, ai: 0 })
    expect(empty.tiles.aiElsewhere).toBe(0)
    expect(empty.tiles.total.leads).toBe(empty.funnel.total)
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
    // The day's lead-form spend rides each day — the DM campaign's 9 $ does not.
    expect(umar.days).toEqual([
      { date: '2026-09-18', spendUsd: 20, metaLeads: 8, leads: 3, success: 3 },
      { date: '2026-09-19', spendUsd: 5, metaLeads: 2, leads: 2, success: 0 },
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
