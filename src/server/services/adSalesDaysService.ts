/**
 * «Kunlar boʻyicha» on Savdo dinamikasi — see domain/sales/adSalesDays.ts for
 * what each column is and why.
 *
 * Two reads, both already reconciled elsewhere: `rnpTeamDays` (the queue
 * cohort per day × team, /rnp's «Сумма ФАКТ 1») and `campaignDays` (Meta per
 * campaign-day, /rnp's «Жами бюджет»). Company-wide by construction — Meta
 * money carries no employee — so the route refuses a narrowed account.
 */

import { type AdSalesDays, buildAdSalesDays, daysFrom } from '@/server/domain/sales/adSalesDays'
import { type Period, zonedDateKey } from '@/server/domain/period/period'
import { adBudgetProduct } from '@/server/integrations/meta/accounts'
import type { InsightsRepository } from '@/server/repositories/insightsRepository'
import type { ReklamaRepository } from '@/server/repositories/reklamaRepository'

export type AdSalesDaysDto = AdSalesDays

export class AdSalesDaysService {
  constructor(
    private readonly insights: Pick<InsightsRepository, 'rnpTeamDays'>,
    private readonly reklama: Pick<ReklamaRepository, 'campaignDays'>,
  ) {}

  async days(period: Period, now: Date): Promise<AdSalesDaysDto> {
    const today = zonedDateKey(now, period.timeZone)
    const from = zonedDateKey(period.start, period.timeZone)
    const last = zonedDateKey(new Date(period.end.getTime() - 1), period.timeZone)
    // A day not lived yet is not a row of zeros.
    const to = last < today ? last : today
    if (to < from) return buildAdSalesDays([], [], [])

    const [fakt, campaigns] = await Promise.all([
      this.insights.rnpTeamDays(period),
      this.reklama.campaignDays(from, to),
    ])
    const out = buildAdSalesDays(
      daysFrom(from, to),
      fakt,
      campaigns.map((c) => ({ date: c.date, product: adBudgetProduct(c), spendMicroUsd: c.spendMicroUsd })),
    )
    return { ...out, openDay: to === today ? today : null }
  }
}
