import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import type { Period } from '@/server/domain/period/period'
import { leadBucket } from '@/server/domain/reklama/leadQuality'
import { LEAD_SOURCE_BRAND } from '@/server/integrations/crm/bitrix24/mapping'
import { DM_ACCOUNT_PAGES, campaignChannel } from '@/server/integrations/meta/accounts'
import type { CampaignDayRow, LeadStageDayRow } from '@/server/repositories/reklamaRepository'

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

const { calendarDays, reklamaOverview, ReklamaService, sideColumnsOf, targetDm, withFormKval } = await import('@/server/services/reklamaService')
const { ReklamaRepository } = await import('@/server/repositories/reklamaRepository')

const PAGES = [
  { key: 'UC_1X1J24', name: 'sinolifeuz', product: 'Collagen' as const },
  { key: 'UC_0FMQ5Q', name: 'sinolife_otziv', product: 'Collagen' as const },
  { key: 'UC_A8LE21', name: 'zextrauzb', product: 'Zextra' as const },
]

const WINDOW = { from: '2026-08-01', to: '2026-08-02' }

const lead = (
  day: string,
  sourceId: string,
  stage: string,
  status: string,
  leads: number,
  productLine: string | null = null,
): LeadStageDayRow => ({
  day,
  sourceId,
  source: PAGES.find((p) => p.key === sourceId)!.name,
  stage,
  status,
  productLine,
  leads,
})

const campaign = (over: Partial<CampaignDayRow>): CampaignDayRow => {
  const row = {
    date: '2026-08-01',
    accountId: '990016692137088', // Umar - 64 · Collagen
    accountName: 'Umar - 64',
    campaignName: 'Sms-001',
    objective: 'OUTCOME_ENGAGEMENT',
    spendMicroUsd: 0n,
    impressions: 0,
    clicks: 0,
    leads: 0,
    conversations: 0,
    ...over,
  }
  // One campaign per account and name unless a test says otherwise.
  return { campaignId: `${row.accountId}:${row.campaignName}`, ...row }
}

describe('leadBucket — the lead-quality sheet, from the Регистрация stage', () => {
  it('reads the four sheet columns and a fifth for leads still being worked', () => {
    expect(leadBucket('Сделка успешна', 'WON')).toBe('success')
    expect(leadBucket('Недозвон', 'LOST')).toBe('noAnswer')
    expect(leadBucket('Пропущенный', 'OPEN')).toBe('noAnswer')
    expect(leadBucket('Отказ', 'LOST')).toBe('lowQuality')
    expect(leadBucket('Российский номерлар', 'OPEN')).toBe('lowQuality')
    expect(leadBucket('Сммшик (лид)', 'OPEN')).toBe('open')
    expect(leadBucket('Обработка', 'OPEN')).toBe('open')
  })

  it('files a duplicate as a duplicate even though it is closed as lost', () => {
    expect(leadBucket('Дубликат', 'LOST')).toBe('duplicate')
  })

  it('files an unnamed closed-lost stage as low quality, never as open', () => {
    expect(leadBucket('Новая стадия', 'LOST')).toBe('lowQuality')
  })
})

describe('campaignChannel — which sheet a campaign belongs on', () => {
  it('puts lead-form campaigns on «Отчёт Т» and message campaigns on «DM»', () => {
    expect(campaignChannel('OUTCOME_LEADS', '10/08 B', '990016692137088')).toBe('form')
    expect(campaignChannel('OUTCOME_ENGAGEMENT', 'Sms-021', '990016692137088')).toBe('dm')
  })

  it('keeps the hiring DM campaign off both — the 7.4 $ gap on 01.08', () => {
    expect(campaignChannel('OUTCOME_ENGAGEMENT', 'EX - Sinolife (vakansiya) - DM - 23.04', '714191238260025')).toBe(
      'hiring',
    )
  })

  it('reads the English «Vacancy» as hiring too — the client\'s «HR» 21–26.09 (2026-10-02)', () => {
    expect(campaignChannel('OUTCOME_ENGAGEMENT', 'EX - TOF - Vacancy - 19.09', '1794735288825705')).toBe('hiring')
    expect(campaignChannel('OUTCOME_ENGAGEMENT', 'EX - TOF - Vacancy - 19.09 — Копия', '1794735288825705')).toBe('hiring')
    // Selling with an ambassador is not hiring one.
    expect(campaignChannel('OUTCOME_LEADS', 'EX-TOF-Collagen (Ambassador)-IF-15.01', '1794735288825705')).toBe('form')
  })

  it('files every campaign on HR Eldor as hiring, whatever it is called', () => {
    expect(campaignChannel('OUTCOME_LEADS', 'IF - 28.09', '1657709689205277')).toBe('hiring')
  })

  it('files any other objective as other, so it is still counted in the total', () => {
    expect(campaignChannel('OUTCOME_TRAFFIC', 'x', '990016692137088')).toBe('other')
  })
})

describe('calendarDays', () => {
  it('lists every day inclusive, across a month end', () => {
    expect(calendarDays('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
  })
})

describe('reklamaOverview', () => {
  const build = (leadRows: LeadStageDayRow[], campaignRows: CampaignDayRow[]) =>
    reklamaOverview({ window: WINDOW, pages: PAGES, leadRows, campaignRows, importedAt: null })

  it('puts a product\'s DM money and messages on its DM page, beside that page\'s leads', () => {
    const out = build(
      [
        lead('2026-08-01', 'UC_1X1J24', 'Сделка успешна', 'WON', 37),
        lead('2026-08-01', 'UC_1X1J24', 'Недозвон', 'LOST', 75),
        lead('2026-08-01', 'UC_0FMQ5Q', 'Сделка успешна', 'WON', 5),
      ],
      [campaign({ spendMicroUsd: 142_700_000n, conversations: 742 })],
    )
    const uz = out.dm.pages.find((p) => p.key === 'UC_1X1J24')!
    expect(uz.carriesDmSpend).toBe(true)
    expect(uz.days[0]).toMatchObject({
      date: '2026-08-01',
      conversations: 742,
      leads: 112,
      qualified: 37,
      spendUsd: 142.7,
    })
    expect(uz.days[0]!.costPerQualifiedUsd).toBeCloseTo(142.7 / 37, 9)

    const otziv = out.dm.pages.find((p) => p.key === 'UC_0FMQ5Q')!
    expect(otziv.carriesDmSpend).toBe(false)
    expect(otziv.total).toMatchObject({ leads: 5, qualified: 5, spendUsd: 0, conversations: 0 })
    // Money with nothing qualified has no cost per qualified lead, not zero.
    expect(out.dm.pages.find((p) => p.key === 'UC_A8LE21')!.total.costPerQualifiedUsd).toBeNull()

    expect(out.dm.total).toMatchObject({ leads: 117, qualified: 42, spendUsd: 142.7, conversations: 742 })
    // sinolife_otziv carries no DM money: its 5 kval are counted above but do not cheapen the price.
    expect(out.dm.total.costPerQualifiedUsd).toBeCloseTo(142.7 / 37, 9)
    // Every day is listed, the quiet one as zeros.
    expect(out.dm.days.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-02'])
    expect(out.dm.days[1]).toMatchObject({ leads: 0, spendUsd: 0 })
  })

  it('prices «Итог» over the pages that carry the DM money, as the tile does — every page still counted', () => {
    const out = build(
      [
        lead('2026-08-01', 'UC_1X1J24', 'Сделка успешна', 'WON', 50),
        lead('2026-08-01', 'UC_1X1J24', 'Недозвон', 'LOST', 50),
        lead('2026-08-01', 'UC_0FMQ5Q', 'Сделка успешна', 'WON', 30),
        lead('2026-08-02', 'UC_A8LE21', 'Сделка успешна', 'WON', 20),
        lead('2026-08-02', 'UC_0FMQ5Q', 'Сделка успешна', 'WON', 10),
      ],
      [
        campaign({ spendMicroUsd: 200_000_000n, conversations: 400 }),
        campaign({
          date: '2026-08-02',
          accountId: '440073592484616',
          accountName: 'Zextra Umar',
          spendMicroUsd: 60_000_000n,
          conversations: 100,
        }),
      ],
    )
    // sinolife_otziv's 40 kval are counted, and never divide the DM money.
    expect(out.dm.total).toMatchObject({ leads: 160, qualified: 110, spendUsd: 260, conversations: 500 })
    expect(out.dm.total.qualifiedPercent).toBeCloseTo((110 / 160) * 100, 9)
    expect(out.dm.total.costPerQualifiedUsd).toBeCloseTo(260 / 70, 9)
    expect(out.dm.total.conversationToQualifiedPercent).toBeCloseTo((70 / 500) * 100, 9)

    // The «DM kval narxi» tile's formula over the pages flagged `carriesDmSpend`.
    const carrying = out.dm.pages.filter((p) => p.carriesDmSpend)
    expect(carrying.map((p) => p.key)).toEqual(['UC_1X1J24', 'UC_A8LE21'])
    const tile =
      carrying.reduce((n, p) => n + p.total.spendUsd, 0) / carrying.reduce((n, p) => n + p.total.qualified, 0)
    expect(out.dm.total.costPerQualifiedUsd).toBeCloseTo(tile, 9)

    // Each day of the grid on the same rule.
    expect(out.dm.days[0]).toMatchObject({ qualified: 80, spendUsd: 200 })
    expect(out.dm.days[0]!.costPerQualifiedUsd).toBeCloseTo(200 / 50, 9)
    expect(out.dm.days[0]!.conversationToQualifiedPercent).toBeCloseTo((50 / 400) * 100, 9)
    expect(out.dm.days[1]).toMatchObject({ qualified: 30, spendUsd: 60 })
    expect(out.dm.days[1]!.costPerQualifiedUsd).toBeCloseTo(60 / 20, 9)

    // A page's own price is unchanged: its money over its own kval.
    expect(out.dm.pages.find((p) => p.key === 'UC_1X1J24')!.total.costPerQualifiedUsd).toBeCloseTo(200 / 50, 9)
  })

  it('keeps hiring and lead-form money off the DM sheet, and counts them in the split', () => {
    const out = build(
      [],
      [
        campaign({ spendMicroUsd: 10_000_000n }),
        campaign({ campaignName: 'EX - Sinolife (vakansiya) - DM', spendMicroUsd: 7_400_000n }),
        campaign({ objective: 'OUTCOME_LEADS', campaignName: '10/08 B', spendMicroUsd: 93_100_000n, leads: 77 }),
        campaign({ objective: 'OUTCOME_TRAFFIC', spendMicroUsd: 1_000_000n }),
      ],
    )
    expect(out.dm.total.spendUsd).toBe(10)
    expect(out.spend).toEqual({ totalUsd: 111.5, formUsd: 93.1, dmUsd: 10, hiringUsd: 7.4, otherUsd: 1 })
  })

  it('builds the side table — HR from every hiring campaign, Kosmetika from its own account', () => {
    const rows = [
        campaign({ campaignName: 'EX - Sinolife (vakansiya) - DM - 23.04', spendMicroUsd: 10_770_000n }),
        campaign({
          date: '2026-08-02',
          accountId: '1657709689205277',
          accountName: 'HR Eldor',
          objective: 'OUTCOME_LEADS',
          campaignName: 'IF - 28.09',
          spendMicroUsd: 11_000_000n,
        }),
        campaign({
          date: '2026-08-02',
          accountId: '517245084208402',
          accountName: 'Kosmetika Eldor',
          objective: 'OUTCOME_LEADS',
          campaignName: 'EX - TOF - Lipss - IF - 26.09',
          spendMicroUsd: 5_760_000n,
        }),
        campaign({
          date: '2026-08-02',
          accountId: '517245084208402',
          accountName: 'Kosmetika Eldor',
          campaignName: 'Vakansiya — new 18:09',
          spendMicroUsd: 2_000_000n,
        }),
        campaign({ spendMicroUsd: 50_000_000n }),
    ]
    const out = build([], rows)
    // The table itself rides «Targetologlar · kunlik»'s answer since 2026-10-08 (`sideColumnsOf`), off the same rows.
    expect(sideColumnsOf(rows, ['2026-08-01', '2026-08-02'])).toEqual([
      {
        key: 'hr',
        name: 'HR',
        totalUsd: 23.77,
        days: [
          { date: '2026-08-01', spendUsd: 10.77 },
          { date: '2026-08-02', spendUsd: 13 },
        ],
      },
      {
        key: 'kosmetika',
        name: 'Kosmetika',
        totalUsd: 5.76,
        days: [
          { date: '2026-08-01', spendUsd: 0 },
          { date: '2026-08-02', spendUsd: 5.76 },
        ],
      },
    ])
    // Kosmetika's lead form stays in «Отчёт Т» under «Boshqa»; HR money leaves both sheets.
    expect(out.form.owners.find((o) => o.key === 'Boshqa|Элдор')!.total.spendUsd).toBe(5.76)
    expect(out.spend.hiringUsd).toBe(23.77)
    expect(out.dm.total.spendUsd).toBe(50)
  })

  it('puts Sobirjon #2\'s message money on collagen.sinolife, the page its ads chat from (2026-10-07)', () => {
    const pages = [...PAGES, { key: 'UC_NBCV5K', name: 'collagen.sinolife', product: 'Collagen' as const }]
    const out = reklamaOverview({
      window: WINDOW,
      pages,
      leadRows: [
        lead('2026-08-01', 'UC_1X1J24', 'Сделка успешна', 'WON', 10),
        { day: '2026-08-01', sourceId: 'UC_NBCV5K', source: 'collagen.sinolife', stage: 'Сделка успешна', status: 'WON', productLine: null, leads: 4 },
      ],
      campaignRows: [
        campaign({ spendMicroUsd: 40_000_000n, conversations: 80 }),
        campaign({
          accountId: '2804901113001448',
          accountName: 'Collagen Sobirjon #2',
          campaignName: 'I.S | SMS| New strantsa | 06.10.2026',
          spendMicroUsd: 30_480_000n,
          conversations: 50,
        }),
      ],
      importedAt: null,
    })
    const page = (key: string) => out.dm.pages.find((p) => p.key === key)!
    expect(page('UC_1X1J24').total).toMatchObject({ spendUsd: 40, conversations: 80, costPerQualifiedUsd: 4 })
    expect(page('UC_NBCV5K').total).toMatchObject({ spendUsd: 30.48, conversations: 50, costPerQualifiedUsd: 7.62 })
    expect(page('UC_NBCV5K').carriesDmSpend).toBe(true)
    // Both pages' kval price «Итог», and nothing is left unattributed.
    expect(out.dm.total.costPerQualifiedUsd).toBeCloseTo(70.48 / 14, 9)
    expect(out.dm.unattributed).toEqual({ spendUsd: 0, conversations: 0 })
  })

  it('reports an unmapped account\'s DM money as unattributed instead of guessing a page', () => {
    const out = build(
      [],
      [campaign({ accountId: '1306271057053174', accountName: 'Newgen_davi01', spendMicroUsd: 5_000_000n, conversations: 9 })],
    )
    expect(out.dm.total.spendUsd).toBe(0)
    expect(out.dm.unattributed).toEqual({ spendUsd: 5, conversations: 9 })
  })

  it('builds «Отчёт Т» per targetolog × product from lead-form campaigns — Umar on 02.09', () => {
    const out = reklamaOverview({
      window: { from: '2026-09-02', to: '2026-09-02' },
      pages: PAGES,
      leadRows: [],
      campaignRows: [
        campaign({ date: '2026-09-02', objective: 'OUTCOME_LEADS', spendMicroUsd: 93_100_000n, leads: 77 }),
        campaign({
          date: '2026-09-02',
          accountId: '1312865112943517',
          accountName: 'Umar 63',
          objective: 'OUTCOME_LEADS',
          spendMicroUsd: 96_000_000n,
          leads: 110,
        }),
        campaign({ date: '2026-09-02', spendMicroUsd: 42_800_000n, conversations: 120 }),
      ],
      importedAt: null,
    })
    const umar = out.form.owners.find((o) => o.key === 'Collagen|Umar')!
    expect(umar.total).toMatchObject({ spendUsd: 189.1, metaLeads: 187 })
    expect(umar.total.costPerLeadUsd).toBeCloseTo(189.1 / 187, 9)
    expect(umar.dmSpendUsd).toBe(42.8)
    expect(umar.dmConversations).toBe(120)
    expect(umar.accounts).toEqual(['Umar - 64', 'Umar 63'])
    expect(out.form.total.spendUsd).toBe(189.1)
  })

  it('adds Meta\'s delivery to «Отчёт Т» and prices a DM conversation', () => {
    const out = build(
      [],
      [
        campaign({ objective: 'OUTCOME_LEADS', campaignName: 'A', spendMicroUsd: 50_000_000n, leads: 40, impressions: 20_000, clicks: 400 }),
        campaign({ spendMicroUsd: 10_000_000n, conversations: 80 }),
      ],
    )
    expect(out.form.total).toMatchObject({ spendUsd: 50, impressions: 20_000, clicks: 400 })
    expect(out.form.total.ctrPercent).toBeCloseTo(2, 9)
    expect(out.form.total.cpcUsd).toBeCloseTo(0.125, 9)
    expect(out.form.total.cpmUsd).toBeCloseTo(2.5, 9)
    expect(out.dm.total.costPerConversationUsd).toBeCloseTo(0.125, 9)
  })

  it('lists campaigns biggest first, each priced by its own channel\'s result', () => {
    const out = build(
      [],
      [
        campaign({ objective: 'OUTCOME_LEADS', campaignName: 'Form', spendMicroUsd: 30_000_000n, leads: 10 }),
        campaign({ date: '2026-08-02', objective: 'OUTCOME_LEADS', campaignName: 'Form', spendMicroUsd: 20_000_000n, leads: 15 }),
        campaign({ campaignName: 'Sms-1', spendMicroUsd: 5_000_000n, conversations: 50, leads: 0 }),
        campaign({ campaignName: 'Paused', spendMicroUsd: 0n }),
      ],
    )
    expect(out.campaigns.map((c) => c.name)).toEqual(['Form', 'Sms-1'])
    expect(out.campaigns[0]).toMatchObject({
      channel: 'form',
      targetolog: 'Umar',
      spendUsd: 50,
      results: 25,
      activeDays: 2,
      lastActive: '2026-08-02',
    })
    expect(out.campaigns[0]!.costPerResultUsd).toBeCloseTo(2, 9)
    expect(out.campaigns[1]).toMatchObject({ channel: 'dm', results: 50 })
    expect(out.campaigns[1]!.costPerResultUsd).toBeCloseTo(0.1, 9)
  })

  it('prices a campaign\'s kval from its own Meta leads met with the portal', () => {
    const rows = [
      campaign({ campaignId: 'c1', objective: 'OUTCOME_LEADS', campaignName: 'Read whole', spendMicroUsd: 60_000_000n, leads: 20 }),
      campaign({ campaignId: 'c2', objective: 'OUTCOME_LEADS', campaignName: 'Half read', spendMicroUsd: 40_000_000n, leads: 20 }),
      campaign({ campaignId: 'c3', objective: 'OUTCOME_LEADS', campaignName: 'No kval', spendMicroUsd: 30_000_000n, leads: 5 }),
      campaign({ campaignId: 'c4', campaignName: 'Sms-1', spendMicroUsd: 5_000_000n, conversations: 50, leads: 0 }),
    ]
    const out = reklamaOverview({
      window: WINDOW,
      pages: PAGES,
      leadRows: [],
      campaignRows: rows,
      campaignLeadRows: [
        { campaignId: 'c1', leads: 19, matched: 16, qualified: 4, noAnswer: 5, lowQuality: 2, duplicate: 1, open: 4 },
        // Its other form's page is closed to the token: half of Meta's 20 leads were read.
        { campaignId: 'c2', leads: 10, matched: 9, qualified: 3, noAnswer: 0, lowQuality: 0, duplicate: 0, open: 6 },
        { campaignId: 'c3', leads: 5, matched: 5, qualified: 0, noAnswer: 5, lowQuality: 0, duplicate: 0, open: 0 },
      ],
      importedAt: null,
    })
    const [whole, half, none, dm] = out.campaigns
    expect(whole!.crm).toMatchObject({ leadsRead: 19, matched: 16, qualified: 4, qualifiedPercent: 25 })
    expect(whole!.crm!.costPerQualifiedUsd).toBeCloseTo(15, 9)
    // The kval is counted, never priced: 40 $ over half the leads' kval would read dearer than it is.
    expect(half!.crm).toMatchObject({ qualified: 3, costPerQualifiedUsd: null })
    expect(half!.crm!.qualifiedPercent).toBeCloseTo(33.333, 2)
    // No kval is a measured 0 % with no price, not a free kval.
    expect(none!.crm).toMatchObject({ qualified: 0, qualifiedPercent: 0, costPerQualifiedUsd: null })
    // A DM campaign has no Meta lead to meet.
    expect(dm!.crm).toBeNull()
    // «Barcha manbalar»'s outcome columns: with the kval they are the matched leads.
    expect(whole!.crm).toMatchObject({ noAnswer: 5, lowQuality: 2, duplicate: 1, open: 4 })
    expect(4 + 5 + 2 + 1 + 4).toBe(whole!.crm!.matched)
  })

  it('sums the lead-quality buckets to the leads, with the sheet\'s % over them', () => {
    const out = build(
      [
        lead('2026-08-01', 'UC_1X1J24', 'Недозвон', 'LOST', 11),
        lead('2026-08-01', 'UC_1X1J24', 'Отказ', 'LOST', 3),
        lead('2026-08-01', 'UC_1X1J24', 'Сделка успешна', 'WON', 51),
        lead('2026-08-01', 'UC_0FMQ5Q', 'Дубликат', 'LOST', 2),
        lead('2026-08-02', 'UC_1X1J24', 'Сммшик (лид)', 'OPEN', 4),
      ],
      [],
    )
    expect(out.quality.days[0]).toMatchObject({ leads: 67, noAnswer: 11, lowQuality: 3, success: 51, duplicate: 2, open: 0 })
    expect(out.quality.days[0]!.successPercent).toBeCloseTo((51 / 67) * 100, 9)
    expect(out.quality.total.leads).toBe(71)
    expect(out.quality.pages[0]!.total).toMatchObject({ leads: 69, success: 51 })
    expect(out.quality.stages[0]).toEqual({ stage: 'Сделка успешна', bucket: 'success', leads: 51 })
  })

  it('sums money in micro-dollars, so the days add up to the total to the cent', () => {
    const rows = [0, 1, 2].map(() => campaign({ spendMicroUsd: 333_333n }))
    const out = build([], rows)
    // 3 × 0.333333 $ = 0.999999 $ → 1.00 $, not 3 × 0.33 = 0.99 $.
    expect(out.dm.total.spendUsd).toBe(1)
  })
})

describe('reklamaOverview — the Collagen / Zextra switch', () => {
  const leads = [
    lead('2026-08-01', 'UC_1X1J24', 'Сделка успешна', 'WON', 30),
    lead('2026-08-01', 'UC_0FMQ5Q', 'Недозвон', 'LOST', 5),
    lead('2026-08-01', 'UC_A8LE21', 'Сделка успешна', 'WON', 12),
  ]
  const campaigns = [
    campaign({ spendMicroUsd: 40_000_000n, conversations: 100 }), // Umar - 64 · Collagen DM
    campaign({ accountId: '440073592484616', accountName: 'Zextra Umar', objective: 'OUTCOME_LEADS', spendMicroUsd: 8_000_000n, leads: 9 }),
    campaign({ accountId: '517245084208402', accountName: 'Kosmetika Eldor', objective: 'OUTCOME_LEADS', spendMicroUsd: 3_000_000n }),
    campaign({ accountId: '1306271057053174', accountName: 'Newgen_davi01', spendMicroUsd: 5_000_000n, conversations: 9 }),
    // A Collagen account's vacancy campaign: hiring is no brand's ad budget.
    campaign({ campaignName: 'EX - TOF - Vacancy - 19.09', spendMicroUsd: 2_000_000n }),
  ]
  const build = (brand?: 'all' | 'Collagen' | 'Zextra' | 'none') =>
    reklamaOverview({ window: WINDOW, pages: PAGES, leadRows: leads, campaignRows: campaigns, importedAt: null, brand })

  it('keeps one brand\'s pages, leads and ad accounts — unmapped money drops out', () => {
    const z = build('Zextra')
    expect(z.dm.pages.map((p) => p.key)).toEqual(['UC_A8LE21'])
    expect(z.quality.total).toMatchObject({ leads: 12, success: 12 })
    expect(z.spend).toEqual({ totalUsd: 8, formUsd: 8, dmUsd: 0, hiringUsd: 0, otherUsd: 0 })
    expect(z.form.owners.map((o) => o.key)).toEqual(['Zextra|Umar'])
    expect(z.campaigns.map((c) => c.account)).toEqual(['Zextra Umar'])
    expect(z.dm.unattributed).toEqual({ spendUsd: 0, conversations: 0 })

    const c = build('Collagen')
    expect(c.dm.pages.map((p) => p.key)).toEqual(['UC_1X1J24', 'UC_0FMQ5Q'])
    expect(c.quality.total.leads).toBe(35)
    expect(c.dm.total).toMatchObject({ spendUsd: 40, conversations: 100, qualified: 30 })
  })

  it('adds back up to «Hammasi» with the brandless accounts', () => {
    const all = build()
    const [c, z] = [build('Collagen'), build('Zextra')]
    expect(c.quality.total.leads + z.quality.total.leads).toBe(all.quality.total.leads)
    // Kosmetika, the unmapped account and the vacancy are neither brand's.
    expect(c.spend.totalUsd + z.spend.totalUsd + 3 + 5 + 2).toBe(all.spend.totalUsd)
    expect(build('all')).toEqual(all)
  })

  it('reads a brand\'s money as its ad budget, the vacancy left to «Brendsiz», as every screen does', () => {
    expect(build('Collagen').spend.hiringUsd).toBe(0)
    const n = build('none')
    expect(n.spend).toMatchObject({ totalUsd: 10, hiringUsd: 2 })
    expect(n.quality.total.leads).toBe(0)
    const [all, c, z] = [build(), build('Collagen'), build('Zextra')]
    for (const k of ['totalUsd', 'formUsd', 'dmUsd', 'hiringUsd', 'otherUsd'] as const) {
      expect(c.spend[k] + z.spend[k] + n.spend[k]).toBeCloseTo(all.spend[k], 6)
    }
    expect(c.quality.total.leads + z.quality.total.leads + n.quality.total.leads).toBe(all.quality.total.leads)
  })

  it('files a lead by its «Проект» first, as «Lidlar», RNP and Roistat do (2026-10-06)', () => {
    const withProject = [
      ...leads,
      // On Collagen's DM page, but the registrar named the project: Zextra's lead, and a brandless one.
      lead('2026-08-01', 'UC_1X1J24', 'Сделка успешна', 'WON', 7, 'Zextra'),
      lead('2026-08-02', 'UC_1X1J24', 'Недозвон', 'LOST', 4, 'Kosmetika'),
      // A project naming the page's own brand changes nothing.
      lead('2026-08-02', 'UC_A8LE21', 'Сделка успешна', 'WON', 2, 'Zextra'),
    ]
    const build = (brand?: 'all' | 'Collagen' | 'Zextra' | 'none') =>
      reklamaOverview({ window: WINDOW, pages: PAGES, leadRows: withProject, campaignRows: campaigns, importedAt: null, brand })
    const [all, c, z, n] = [build(), build('Collagen'), build('Zextra'), build('none')]

    expect(c.quality.total).toMatchObject({ leads: 35, success: 30 })
    expect(z.quality.total).toMatchObject({ leads: 21, success: 21 })
    expect(n.quality.total).toMatchObject({ leads: 4, noAnswer: 4 })
    // The three slices partition «Hammasi», lead by lead and kval by kval.
    for (const k of ['leads', 'success', 'noAnswer'] as const) {
      expect(c.quality.total[k] + z.quality.total[k] + n.quality.total[k]).toBe(all.quality.total[k])
    }
    expect(c.dm.total.qualified + z.dm.total.qualified + n.dm.total.qualified).toBe(all.dm.total.qualified)

    // sinolifeuz stays on the Zextra slice for its Zextra lead — without it the lead would leave every total —
    // but Collagen's DM money is not in that slice, so the page carries none of it and prices nothing.
    const uzOnZ = z.dm.pages.find((p) => p.key === 'UC_1X1J24')!
    // …and it follows the slice's own pages: zextrauzb, which carries the slice's DM money, opens the sheet.
    expect(z.dm.pages.map((p) => p.key)).toEqual(['UC_A8LE21', 'UC_1X1J24'])
    expect(z.quality.pages.map((p) => p.key)).toEqual(['UC_A8LE21', 'UC_1X1J24'])
    expect(uzOnZ.carriesDmSpend).toBe(false)
    expect(uzOnZ.total).toMatchObject({ leads: 7, qualified: 7, spendUsd: 0 })
    expect(z.dm.pages.find((p) => p.key === 'UC_A8LE21')!.carriesDmSpend).toBe(true)
    // «Brendsiz» shows the page holding its Kosmetika lead, and no page carries DM money there.
    expect(n.dm.pages.map((p) => p.key)).toEqual(['UC_1X1J24'])
    expect(n.dm.pages.every((p) => !p.carriesDmSpend)).toBe(true)
    // Collagen keeps its own pages, the Zextra- and Kosmetika-project leads gone from sinolifeuz.
    expect(c.dm.pages.map((p) => p.key)).toEqual(['UC_1X1J24', 'UC_0FMQ5Q'])
    expect(c.dm.pages[0]!.total).toMatchObject({ leads: 30, qualified: 30, spendUsd: 40, conversations: 100 })
    expect(c.dm.total.costPerQualifiedUsd).toBeCloseTo(40 / 30, 9)
  })
})

describe('LeadSourcesService.targetologForms — «Targetologlar · kunlik» under the brand switch', () => {
  // A form naming no targetolog: «Boshqa» by its name, Collagen by `leadBrand` (no brand word, no owner).
  const UNNAMED_FORM = 'Заполнение CRM-формы "Sinolife filtr forma 3"'
  const UMAR_FORM = 'Заполнение CRM-формы "Sinolife (UMAR) 777"'
  const registration = [
    { day: '2026-08-01', sourceId: 'REPEAT_SALE', source: 'Ген лид', formTitle: UNNAMED_FORM, productLine: null, stage: 'Сделка успешна', status: 'WON', aiQualified: false, leads: 9 },
    { day: '2026-08-01', sourceId: 'REPEAT_SALE', source: 'Ген лид', formTitle: UMAR_FORM, productLine: null, stage: 'Сделка успешна', status: 'WON', aiQualified: false, leads: 5 },
    // Umar's Collagen form, but the lead's «Проект» is Kosmetika: brandless.
    { day: '2026-08-01', sourceId: 'REPEAT_SALE', source: 'Ген лид', formTitle: UMAR_FORM, productLine: 'Kosmetika', stage: 'Недозвон', status: 'LOST', aiQualified: false, leads: 2 },
  ]
  const campaigns = [
    campaign({ accountId: '1312865112943517', accountName: 'Umar 63', objective: 'OUTCOME_LEADS', spendMicroUsd: 20_000_000n, leads: 8 }),
    campaign({ accountId: '517245084208402', accountName: 'Kosmetika Eldor', objective: 'OUTCOME_LEADS', spendMicroUsd: 3_000_000n, leads: 1 }),
  ]
  const PERIOD: Period = {
    start: new Date('2026-07-31T19:00:00Z'),
    end: new Date('2026-08-01T19:00:00Z'),
    timeZone: 'Asia/Tashkent',
    preset: 'custom',
  }
  const forms = async (brand?: 'all' | 'Collagen' | 'Zextra' | 'none') => {
    const { LeadSourcesService } = await import('@/server/services/leadSourcesService')
    const service = new LeadSourcesService(
      { registrationDays: async () => registration } as never,
      { campaignDays: async () => campaigns, campaignsImportedAt: async () => null, manualSpend: async () => [] } as never,
      {} as never,
    )
    return (await service.targetologForms(PERIOD, 'Asia/Tashkent', brand)).forms
  }

  it('files an unnamed form\'s leads under Collagen, not «Brendsiz» — as «Lidlar» does', async () => {
    const [all, c, z, n] = [await forms(), await forms('Collagen'), await forms('Zextra'), await forms('none')]

    const unnamed = (f: typeof all) => f.owners.find((o) => o.key === 'form|Sinolife filtr forma 3')
    expect(unnamed(c)).toMatchObject({ product: 'Boshqa', outcome: { leads: 9, success: 9 } })
    expect(unnamed(n)).toBeUndefined()
    expect(unnamed(z)).toBeUndefined()

    // Umar's card keeps his Collagen money and leads on Collagen; his Kosmetika-project lead is «Brendsiz».
    expect(c.owners.find((o) => o.key === 'Collagen|Umar')).toMatchObject({ spendUsd: 20, outcome: { leads: 5 } })
    expect(n.owners.find((o) => o.key === 'Collagen|Umar')).toMatchObject({ spendUsd: 0, outcome: { leads: 2 } })
    // Kosmetika Eldor's money is no brand's ad budget.
    expect(n.owners.find((o) => o.key === 'Boshqa|Элдор')).toMatchObject({ spendUsd: 3 })
    expect(c.owners.find((o) => o.key === 'Boshqa|Элдор')).toBeUndefined()

    // The slices add up to «Hammasi».
    expect(c.outcome.leads + z.outcome.leads + n.outcome.leads).toBe(all.outcome.leads)
    expect(c.spendUsd + z.spendUsd + n.spendUsd).toBeCloseTo(all.spendUsd, 6)
    expect(await forms('all')).toEqual(all)
  })
})

describe('ReklamaService.overview — collagen.sinolife, the page Sobirjon #2\'s messages chat from', () => {
  const PERIOD: Period = {
    start: new Date('2026-07-31T19:00:00Z'),
    end: new Date('2026-08-02T19:00:00Z'),
    timeZone: 'Asia/Tashkent',
    preset: 'custom',
  }
  const asked: { leads?: readonly string[]; sources?: readonly string[] } = {}
  const repository = {
    leadStageDays: async (_: Period, ids: readonly string[]) => {
      asked.leads = ids
      return [
        { day: '2026-08-01', sourceId: 'UC_NBCV5K', source: 'collagen.sinolife', stage: 'Сделка успешна', status: 'WON', productLine: null, leads: 4 },
      ]
    },
    sources: async (ids: readonly string[]) => {
      asked.sources = ids
      return [
        { externalId: 'UC_1X1J24', name: 'sinolifeuz' },
        { externalId: 'UC_NBCV5K', name: 'collagen.sinolife' },
        { externalId: 'UC_A8LE21', name: 'zextrauzb' },
      ]
    },
    campaignDays: async () => [
      campaign({ accountId: '2804901113001448', accountName: 'Collagen Sobirjon #2', campaignName: 'I.S | SMS| New strantsa', spendMicroUsd: 30_000_000n, conversations: 50 }),
    ],
    campaignsImportedAt: async () => null,
    campaignLeads: async () => [],
  }
  const service = new ReklamaService(repository as never)

  it('draws the sheets and the campaigns when the per-campaign scan fails', async () => {
    const failing = new ReklamaService(
      { ...repository, campaignLeads: async () => Promise.reject(new Error('canceling statement due to statement timeout')) } as never,
    )
    // Another window, so the memo of the cases around this one is not what answers.
    const out = await failing.overview({ ...PERIOD, start: new Date(PERIOD.start.getTime() + 86_400_000) }, 'Asia/Tashkent')
    expect(out.campaigns).toHaveLength(1)
    // No lead read: the portal's columns stay empty, the campaign's own figures stand.
    expect(out.campaigns[0]!.crm).toBeNull()
  })

  it('reads the page\'s leads and name, draws it as Collagen\'s, and puts the money on it', async () => {
    const out = await service.overview(PERIOD, 'Asia/Tashkent')
    expect(asked.leads).toContain('UC_NBCV5K')
    expect(asked.sources).toContain('UC_NBCV5K')
    const page = out.dm.pages.find((p) => p.key === 'UC_NBCV5K')!
    expect(page).toMatchObject({ product: 'Collagen', carriesDmSpend: true })
    expect(page.total).toMatchObject({ spendUsd: 30, qualified: 4, costPerQualifiedUsd: 7.5 })
    // Right after sinolifeuz, the page with the product's own DM money.
    expect(out.dm.pages.map((p) => p.key)).toEqual(['UC_1X1J24', 'UC_NBCV5K', 'UC_A8LE21'])
  })

  it('keeps it on Collagen and out of Zextra, so the slices add up to «Hammasi»', async () => {
    const all = await service.overview(PERIOD, 'Asia/Tashkent')
    const collagen = await service.overview(PERIOD, 'Asia/Tashkent', 'Collagen')
    const zextra = await service.overview(PERIOD, 'Asia/Tashkent', 'Zextra')
    const none = await service.overview(PERIOD, 'Asia/Tashkent', 'none')
    expect(collagen.dm.pages.find((p) => p.key === 'UC_NBCV5K')!.total.spendUsd).toBe(30)
    expect(zextra.dm.pages.some((p) => p.key === 'UC_NBCV5K')).toBe(false)
    expect(collagen.dm.total.spendUsd + zextra.dm.total.spendUsd + none.dm.total.spendUsd).toBe(all.dm.total.spendUsd)
  })

  it('reports the money as unattributed when the portal names no such page', async () => {
    const bare = new ReklamaService({ ...repository, sources: async () => [{ externalId: 'UC_1X1J24', name: 'sinolifeuz' }] } as never)
    const out = await bare.overview(PERIOD, 'Asia/Tashkent')
    expect(out.dm.total.spendUsd).toBe(0)
    expect(out.dm.unattributed).toEqual({ spendUsd: 30, conversations: 50 })
  })

  it('names each such page\'s product as the portal\'s source map does', () => {
    for (const [page, product] of DM_ACCOUNT_PAGES) expect(LEAD_SOURCE_BRAND[page]).toBe(product)
  })

  it('draws the sheet\'s own blocks — sinogummy, sinolif_tg — with their leads, their targetolog and no DM money', async () => {
    const sheet = new ReklamaService({
      ...repository,
      leadStageDays: async (_: Period, ids: readonly string[]) => {
        asked.leads = ids
        return [{ day: '2026-08-01', sourceId: 'UC_KX2114', source: 'sinogummy', stage: 'Сделка успешна', status: 'WON', productLine: null, leads: 3 }]
      },
      sources: async () => [
        { externalId: 'UC_1X1J24', name: 'sinolifeuz' },
        { externalId: 'UC_NBCV5K', name: 'collagen.sinolife' },
        { externalId: 'UC_KX2114', name: 'sinogummy' },
        { externalId: 'UC_Z1OF0D', name: 'sinolif_tg' },
      ],
    } as never)
    // Another window, so the lead memo of the cases around this one is not what answers.
    const out = await sheet.overview({ ...PERIOD, end: new Date(PERIOD.end.getTime() + 86_400_000) }, 'Asia/Tashkent')
    expect(asked.leads).toEqual(expect.arrayContaining(['UC_KX2114', 'UC_Z1OF0D']))
    expect(out.dm.pages.map((p) => [p.name, p.targetolog])).toEqual([
      ['sinolifeuz', null],
      ['collagen.sinolife', 'Sobirjon'],
      ['sinogummy', 'Eldor'],
      ['sinolif_tg', 'TG'],
    ])
    expect(out.dm.pages[2]).toMatchObject({ carriesDmSpend: false, total: { leads: 3, qualified: 3, spendUsd: 0 } })
    // Its kval is in «Итог»'s count, never in the price the DM money is divided by.
    expect(out.dm.total).toMatchObject({ qualified: 3, costPerQualifiedUsd: null })
  })
})

describe('withFormKval — «Отчёт Т» with «Lidlar»\'s kval (2026-10-10)', () => {
  const overview = reklamaOverview({
    window: WINDOW,
    pages: PAGES,
    leadRows: [],
    campaignRows: [
      campaign({ accountId: '990016692137088', accountName: 'Umar - 64', spendMicroUsd: 90_000_000n, leads: 60 }),
      campaign({ accountId: '440763388459898', accountName: 'Zextra Eldor', spendMicroUsd: 10_000_000n, leads: 4 }),
    ],
    importedAt: null,
  })

  it('reads nothing before the forms are met', () => {
    expect(overview.form.qualified).toBeNull()
    expect(overview.form.owners.map((o) => o.qualified)).toEqual([null, null])
    expect(withFormKval(overview, null)).toBe(overview)
  })

  it('meets each targetolog on the owner key; one with money and no form lead is 0, and «Jami» is every form\'s', () => {
    const out = withFormKval(overview, {
      owners: [
        { key: 'Collagen|Umar', outcome: { success: 21 } },
        // A form no targetolog is read from: in «Jami», on no row here.
        { key: 'form|Sinolife umumiy', outcome: { success: 2 } },
      ],
      outcome: { success: 23 },
    })
    expect(out.form.owners.map((o) => [o.key, o.qualified])).toEqual([
      ['Collagen|Umar', 21],
      ['Zextra|Элдор', 0],
    ])
    expect(out.form.qualified).toBe(23)
    expect(out.form.total).toEqual(overview.form.total)
  })
})

describe('targetDm — «Target tahlili»\'s DM sheet (2026-10-07)', () => {
  const pages = [...PAGES, { key: 'UC_NBCV5K', name: 'collagen.sinolife', product: 'Collagen' as const }]
  const input = {
    window: WINDOW,
    pages,
    leadRows: [
      lead('2026-08-01', 'UC_1X1J24', 'Сделка успешна', 'WON', 10),
      lead('2026-08-01', 'UC_1X1J24', 'Недозвон', 'LOST', 10),
      // A Zextra-«Проект» kval on sinolifeuz: Zextra's under the switch, never Collagen's price.
      { ...lead('2026-08-01', 'UC_1X1J24', 'Сделка успешна', 'WON', 5), productLine: 'Zextra' },
      // sinolife_otziv carries no DM money: its kval never cheapens Collagen's price.
      lead('2026-08-01', 'UC_0FMQ5Q', 'Сделка успешна', 'WON', 50),
      { day: '2026-08-02', sourceId: 'UC_NBCV5K', source: 'collagen.sinolife', stage: 'Сделка успешна', status: 'WON', productLine: null, leads: 4 },
      lead('2026-08-02', 'UC_A8LE21', 'Сделка успешна', 'WON', 6),
    ],
    campaignRows: [
      campaign({ spendMicroUsd: 40_000_001n, conversations: 80 }),
      campaign({
        date: '2026-08-02',
        accountId: '2804901113001448',
        accountName: 'Collagen Sobirjon #2',
        campaignName: 'I.S | SMS| New strantsa | 06.10.2026',
        spendMicroUsd: 30_480_004n,
        conversations: 50,
      }),
      campaign({ date: '2026-08-02', accountId: '440073592484616', accountName: 'Zextra Umar', spendMicroUsd: 18_000_000n, conversations: 30 }),
    ],
    importedAt: null,
  }

  it('prices each product as «Reklama samarasi»\'s «Итог» under that product\'s switch', () => {
    const out = targetDm(input, 'all')
    for (const p of out.products) {
      const slice = reklamaOverview({ ...input, brand: p.product }).dm
      expect(p.costPerQualifiedUsd).toBe(slice.total.costPerQualifiedUsd)
    }
    const collagen = out.products.find((p) => p.product === 'Collagen')!
    expect(collagen).toMatchObject({ pages: ['sinolifeuz', 'collagen.sinolife'], qualified: 14, spendUsd: 70.48, conversations: 130 })
    expect(collagen.costPerQualifiedUsd).toBeCloseTo(70.480005 / 14, 9)
    expect(out.products.find((p) => p.product === 'Zextra')).toMatchObject({ pages: ['zextrauzb'], qualified: 6, costPerQualifiedUsd: 3 })
    // The sheet itself is the «Hammasi» block, unattributed money and all.
    expect(out.dm).toEqual(reklamaOverview({ ...input, brand: 'all' }).dm)
    expect(out.dmSpendUsd).toBe(88.48)
  })

  it('answers the same product figure whichever switch it is read under', () => {
    const all = targetDm(input, 'all').products
    expect(targetDm(input, 'Collagen').products).toEqual(all.filter((p) => p.product === 'Collagen'))
    expect(targetDm(input, 'Zextra').products).toEqual(all.filter((p) => p.product === 'Zextra'))
  })

  it('gives a product with kval but no DM money no price, not «$0»', () => {
    const out = targetDm({ ...input, campaignRows: input.campaignRows.slice(0, 2) }, 'all')
    const zextra = out.products.find((p) => p.product === 'Zextra')!
    expect(zextra).toMatchObject({ qualified: 6, spendUsd: 0, costPerQualifiedUsd: null })
  })
})

describe('ReklamaRepository.leadStageDays — the statement it sends', () => {
  const PERIOD: Period = {
    start: new Date('2026-07-31T19:00:00Z'),
    end: new Date('2026-08-02T19:00:00Z'),
    timeZone: 'Asia/Tashkent',
    preset: 'custom',
  }

  it('binds exactly the parameters it names, and reads only Регистрация', async () => {
    const calls: { sql: string; params: unknown[] }[] = []
    const prisma = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params })
        return [
          { day: '2026-08-01', source_id: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Отказ', status: 'LOST', product_line: 'Zextra', leads: 3n },
        ]
      },
    } as unknown as PrismaClient
    const rows = await new ReklamaRepository(prisma).leadStageDays(PERIOD, ['UC_1X1J24'])

    expect(rows).toEqual([
      { day: '2026-08-01', sourceId: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Отказ', status: 'LOST', productLine: 'Zextra', leads: 3 },
    ])
    const { sql, params } = calls[0]!
    const bare = sql.replace(/\/\*[\s\S]*?\*\//g, '')
    const named = new Set([...bare.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))
    // Postgres refuses a bound parameter it cannot type — every one is named.
    expect([...named].sort()).toEqual(params.map((_, i) => i + 1))
    expect(sql).toContain(`p."role" = 'LEAD'`)
    expect(params[3]).toEqual(['UC_1X1J24'])
    // «Проект» is read and grouped by, so the brand switch can file the lead by it (`leadBrand`).
    expect(bare).toContain(`NULLIF(btrim(d."productLine"), '') AS product_line`)
    expect(bare).toMatch(/GROUP BY 1, 2, 3, 4, 5, 6\b/)
  })
})
