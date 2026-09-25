import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import type { Period } from '@/server/domain/period/period'
import { leadBucket } from '@/server/domain/reklama/leadQuality'
import { campaignChannel } from '@/server/integrations/meta/accounts'
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

const { calendarDays, reklamaOverview } = await import('@/server/services/reklamaService')
const { ReklamaRepository } = await import('@/server/repositories/reklamaRepository')

const PAGES = [
  { key: 'UC_1X1J24', name: 'sinolifeuz', product: 'Collagen' as const },
  { key: 'UC_0FMQ5Q', name: 'sinolife_otziv', product: 'Collagen' as const },
  { key: 'UC_A8LE21', name: 'zextrauzb', product: 'Zextra' as const },
]

const WINDOW = { from: '2026-08-01', to: '2026-08-02' }

const lead = (day: string, sourceId: string, stage: string, status: string, leads: number): LeadStageDayRow => ({
  day,
  sourceId,
  source: PAGES.find((p) => p.key === sourceId)!.name,
  stage,
  status,
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
    expect(campaignChannel('OUTCOME_LEADS', '10/08 B')).toBe('form')
    expect(campaignChannel('OUTCOME_ENGAGEMENT', 'Sms-021')).toBe('dm')
  })

  it('keeps the hiring DM campaign off both — the 7.4 $ gap on 01.08', () => {
    expect(campaignChannel('OUTCOME_ENGAGEMENT', 'EX - Sinolife (vakansiya) - DM - 23.04')).toBe('hiring')
  })

  it('files any other objective as other, so it is still counted in the total', () => {
    expect(campaignChannel('OUTCOME_TRAFFIC', 'x')).toBe('other')
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
    // Every day is listed, the quiet one as zeros.
    expect(out.dm.days.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-02'])
    expect(out.dm.days[1]).toMatchObject({ leads: 0, spendUsd: 0 })
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
        return [{ day: '2026-08-01', source_id: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Отказ', status: 'LOST', leads: 3n }]
      },
    } as unknown as PrismaClient
    const rows = await new ReklamaRepository(prisma).leadStageDays(PERIOD, ['UC_1X1J24'])

    expect(rows).toEqual([
      { day: '2026-08-01', sourceId: 'UC_1X1J24', source: 'sinolifeuz', stage: 'Отказ', status: 'LOST', leads: 3 },
    ])
    const { sql, params } = calls[0]!
    const bare = sql.replace(/\/\*[\s\S]*?\*\//g, '')
    const named = new Set([...bare.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))
    // Postgres refuses a bound parameter it cannot type — every one is named.
    expect([...named].sort()).toEqual(params.map((_, i) => i + 1))
    expect(sql).toContain(`p."role" = 'LEAD'`)
    expect(params[3]).toEqual(['UC_1X1J24'])
  })
})
