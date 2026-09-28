/**
 * «RNP jadvali» — the client's «СентябрРНП» sheet for one calendar month.
 *
 * Asked for on 2026-09-28 with a written spec of every cell of the sheet
 * («huddi shu jadvaldek har bir malumot bitrix24 dan tortiladi»). The user's
 * choices that day, each of which this file relies on:
 *
 *   - FAKT 1 / FAKT 2 are the dashboard's own (the queue cohort), not the
 *     spec's «качонки сделка» date — so this screen and Savdo dinamikasi,
 *     Sotuvchilar reytingi and Logistika can never disagree on a team's money.
 *     The team is the one the deal names, as on Logistika.
 *   - Plans are typed in here; FAKT 1 / FAKT 2 plans are the ones «Sotuv · ROP»
 *     already keeps (`team_month_plan`).
 *   - Rows with no source in Bitrix24 or Meta (followers, HR, bloggers) are
 *     not on the screen.
 *   - A team is its Bitrix24 department name plus its head, every ROP team.
 *
 * WHERE EACH BLOCK COMES FROM:
 *   ROP blocks, logistics, summary — `InsightsRepository.rnpTeamDays`.
 *   Leads, registration, calls, warehouse, plans — `RnpRepository`.
 *   Маркетинг — Meta campaign days (`ReklamaRepository.campaignDays`), split
 *     by product at read time (`ownerOf`); hiring campaigns and accounts that
 *     are neither Collagen nor Zextra are not the sheet's money.
 */

import { type RnpOverviewDto, buildRnpSheet } from '@/server/domain/rnp/rnpSheet'
import { zonedDateKey } from '@/server/domain/period/period'
import type { TargetProduct } from '@/server/domain/types'
import { campaignChannel, ownerOf } from '@/server/integrations/meta/accounts'
import { InsightsRepository, type RnpTeamDayRow } from '@/server/repositories/insightsRepository'
import type { ReklamaRepository } from '@/server/repositories/reklamaRepository'
import type {
  RnpCallDayRow,
  RnpLeadDayRow,
  RnpRegistrationDayRow,
  RnpRepository,
  RnpTeam,
  RnpWarehouseDayRow,
} from '@/server/repositories/rnpRepository'

import { monthDays, monthPeriod } from './salesTeamService'
import { ttlCache } from './ttlCache'

interface MonthRows {
  fakt: RnpTeamDayRow[]
  leads: RnpLeadDayRow[]
  registration: RnpRegistrationDayRow[]
  calls: RnpCallDayRow[]
  warehouse: RnpWarehouseDayRow[]
  meta: { day: string; product: TargetProduct; spendMicroUsd: bigint; leads: number }[]
  teams: RnpTeam[]
}

/*
  A memo keyed by the month. Company-wide by construction — the route refuses
  a narrowed account — and the plans are read fresh every time, so a saved
  plan shows on the next load rather than a minute later.
*/
const monthCache = ttlCache<MonthRows>(60_000)

export function resetRnpCaches(): void {
  monthCache.clear()
}

export class RnpService {
  constructor(
    private readonly insights: InsightsRepository,
    private readonly repository: RnpRepository,
    private readonly reklama: ReklamaRepository,
  ) {}

  async overview(input: { month: string; timeZone: string; now: Date; canEditPlans: boolean }): Promise<RnpOverviewDto> {
    const days = monthDays(input.month)
    const from = days[0]!
    const to = days[days.length - 1]!
    const [rows, plans] = await Promise.all([
      monthCache.get(input.month, () => this.monthRows(input.month, from, to, input.timeZone, input.now)),
      this.repository.plans(input.month),
    ])
    return buildRnpSheet({
      month: input.month,
      days,
      today: zonedDateKey(input.now, input.timeZone),
      teams: rows.teams,
      fakt: rows.fakt,
      leads: rows.leads,
      registration: rows.registration,
      calls: rows.calls,
      warehouse: rows.warehouse,
      meta: rows.meta,
      plans,
      noRop: InsightsRepository.NO_ROP,
      canEditPlans: input.canEditPlans,
    })
  }

  savePlans: RnpRepository['savePlans'] = async (month, input, by) => {
    await this.repository.savePlans(month, input, by)
  }

  private async monthRows(month: string, from: string, to: string, timeZone: string, now: Date): Promise<MonthRows> {
    const [fakt, leads, registration, calls, warehouse, campaigns, teams] = await Promise.all([
      this.insights.rnpTeamDays(monthPeriod(month, timeZone, now)),
      this.repository.leadDays(from, to),
      this.repository.registrationDays(from, to),
      this.repository.callDays(from, to),
      this.repository.warehouseDays(from, to, now),
      this.reklama.campaignDays(from, to),
      this.repository.teams(),
    ])
    const meta: MonthRows['meta'] = []
    for (const c of campaigns) {
      const { product } = ownerOf(c.accountId, c.accountName)
      if (product === 'Boshqa') continue
      if (campaignChannel(c.objective, c.campaignName, c.accountId) === 'hiring') continue
      meta.push({ day: c.date, product, spendMicroUsd: c.spendMicroUsd, leads: c.leads })
    }
    return { fakt, leads, registration, calls, warehouse, meta, teams }
  }
}
