import { describe, expect, it } from 'vitest'

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
      // sinolifeuz: 4 leads, 1 kval, 1 duplicate.
      reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', leads: 1 }),
      reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Дубликат (лид)', status: 'OPEN', leads: 1 }),
      reg({ sourceId: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Обработка', status: 'OPEN', leads: 2 }),
      // Not ad leads, but Регистрация: outgoing calls and a hand-typed «Ген лид».
      reg({ sourceId: 'UC_KPZA32', source: 'Исход', stage: 'Отказ', status: 'LOST', leads: 7 }),
      reg({ sourceId: 'REPEAT_SALE', source: 'Ген лид', leads: 2 }),
      // A non-ad page that chats: its leads join its DM row.
      reg({ sourceId: 'UC_NBCV5K', source: 'collagen.sinolife', leads: 1 }),
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
    ],
  })

  it('counts every Регистрация lead, and splits the ad ones out', () => {
    expect(data.totals.registration.leads).toBe(19)
    // forms (5) + the ad page (4); calls, «Ген лид» by hand and collagen.sinolife are not ads.
    expect(data.totals.ads.leads).toBe(9)
    expect(data.totals.ads.success).toBe(4)
    expect(data.channels.find((c) => c.channel === 'outbound')!.outcome.lowQuality).toBe(7)
    expect(data.channels.find((c) => c.channel === 'manual')!.outcome.leads).toBe(2)
    const summed = data.sources.reduce((n, s) => n + s.outcome.leads, 0)
    expect(summed).toBe(data.totals.registration.leads)
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
    expect(umar.days).toEqual([
      { date: '2026-09-18', metaLeads: 8, leads: 3, success: 3 },
      { date: '2026-09-19', metaLeads: 2, leads: 2, success: 0 },
    ])
  })

  it('keeps an unmapped account visible with no Bitrix24 leads', () => {
    const ai = data.forms.owners.find((o) => o.targetolog === 'Newgen_davi01')!
    expect(ai.product).toBe('Boshqa')
    expect(ai.metaLeads).toBe(4)
    expect(ai.outcome.leads).toBe(0)
    expect(ai.reachPercent).toBe(0)
    expect(data.totals.metaFormLeads).toBe(14)
    expect(data.totals.formLeads).toBe(5)
  })

  it('reads DM from «ИИ обработка», and a chatting non-ad page is a page', () => {
    expect(data.totals.conversations).toBe(105)
    const uz = data.dm.pages.find((p) => p.key === 'UC_1X1J24')!
    expect(uz.conversations).toBe(100)
    expect(uz.outcome.leads).toBe(4)
    expect(uz.outcome.success).toBe(1)
    expect(uz.leadPercent).toBe(4)
    expect(uz.product).toBe('Collagen')
    const cs = data.dm.pages.find((p) => p.key === 'UC_NBCV5K')!
    expect(cs.product).toBeNull()
    expect(cs.outcome.leads).toBe(1)
    // The ad page is listed first.
    expect(data.dm.pages[0]!.key).toBe('UC_1X1J24')
    expect(data.dm.days.map((d) => d.conversations)).toEqual([45, 60])
  })
})
