import { describe, expect, it } from 'vitest'

import type { Period } from '@/server/domain/period/period'
import type { RnpTeamDayRow } from '@/server/repositories/insightsRepository'
import type { CampaignDayRow } from '@/server/repositories/reklamaRepository'
import { AdSalesDaysService } from '@/server/services/adSalesDaysService'

// «Shu oy» on 05.10.2026: [01.10, 06.10) Tashkent, now 05.10 12:00.
const PERIOD: Period = {
  start: new Date('2026-09-30T19:00:00Z'),
  end: new Date('2026-10-05T19:00:00Z'),
  timeZone: 'Asia/Tashkent',
  preset: 'this_month',
}

function teamDay(day: string, rop: string, som: number): RnpTeamDayRow {
  return {
    day,
    rop,
    fakt1Orders: 1,
    fakt1Minor: BigInt(som) * 100n,
    fakt2Orders: 0,
    fakt2Minor: 0n,
    refusedOrders: 0,
    refusedMinor: 0n,
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

function harness() {
  const metaWindows: [string, string][] = []
  const service = new AdSalesDaysService(
    {
      rnpTeamDays: async () => [
        teamDay('2026-10-01', 'Sevinch', 2_000_000),
        teamDay('2026-10-01', 'Baza', 500_000),
        teamDay('2026-10-05', 'Charos', 300_000),
      ],
    },
    {
      campaignDays: async (from, to) => {
        metaWindows.push([from, to])
        return [
          campaignDay({ date: '2026-10-01', spendMicroUsd: 30_500_000n }),
          campaignDay({ date: '2026-10-01', campaignName: 'EX - TOF - Vacancy - 19.09', spendMicroUsd: 50_000_000n }),
          campaignDay({ date: '2026-10-05', accountId: '517245084208402', accountName: 'Kosmetika Eldor', spendMicroUsd: 7_000_000n }),
        ]
      },
    },
  )
  return { service, metaWindows }
}

describe('AdSalesDaysService.days', () => {
  it('reads Meta over the window up to today and leaves hiring and unmapped money out', async () => {
    const { service, metaWindows } = harness()
    const out = await service.days(PERIOD, new Date('2026-10-05T07:00:00Z'))
    expect(metaWindows).toEqual([['2026-10-01', '2026-10-05']])
    expect(out.rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'])
    expect(out.rows[0]).toEqual({ date: '2026-10-01', spendUsd: 30.5, fakt1: 2_500_000, primary: 2_000_000, base: 500_000 })
    expect(out.rows[4]).toEqual({ date: '2026-10-05', spendUsd: 0, fakt1: 300_000, primary: 0, base: 300_000 })
    expect(out.total).toEqual({ spendUsd: 30.5, fakt1: 2_800_000, primary: 2_000_000, base: 800_000 })
    expect(out.openDay).toBe('2026-10-05')
  })

  it('marks no day open once the window has ended', async () => {
    const { service } = harness()
    const out = await service.days(PERIOD, new Date('2026-10-07T07:00:00Z'))
    expect(out.rows).toHaveLength(5)
    expect(out.openDay).toBeNull()
  })

  it('draws no day that has not begun', async () => {
    const { service } = harness()
    const out = await service.days(PERIOD, new Date('2026-10-02T03:00:00Z'))
    expect(out.rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02'])
  })
})
