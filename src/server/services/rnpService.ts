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

/*
  THE REGISTRATION DESK'S CLOSED DAYS, KEPT HALF AN HOUR AND SERVED STALE.

  Регистрация is the one scan that cannot be made cheap: a month is ~44 000
  LEAD / AI_TRIAGE deals spread over ~30 000 heap pages, and on production
  (2026-09-28) it read them from disk in 7–10 s — alone. Beside the other
  six reads it ran past the pool's 20 s statement timeout and the screen
  failed. Its past days hardly move (a lead is registered once; a duplicate
  is re-staged now and then), so they are read once per half hour, and after
  that a reader is handed the previous answer at once while the next one is
  built behind them. Today is its own one-day read, inside `monthCache`.
*/
const REGISTRATION_HISTORY_MS = 30 * 60_000
const registrationHistory = staleWhileRevalidate<RnpRegistrationDayRow[]>(REGISTRATION_HISTORY_MS)

export function resetRnpCaches(): void {
  monthCache.clear()
  registrationHistory.clear()
}

/**
 * A memo that, once its answer is older than `ttlMs`, still returns it at
 * once and rebuilds it in the background; a failed rebuild keeps the old
 * answer. Only the very first reader of a key waits. Exported for its test.
 */
export function staleWhileRevalidate<T>(ttlMs: number, clock: () => number = Date.now) {
  const entries = new Map<string, { at: number; value: Promise<T>; refreshing: boolean }>()
  return {
    get(key: string, build: () => Promise<T>): Promise<T> {
      const hit = entries.get(key)
      if (!hit) {
        const value = build()
        entries.set(key, { at: clock(), value, refreshing: false })
        value.catch(() => {
          if (entries.get(key)?.value === value) entries.delete(key)
        })
        return value
      }
      if (clock() - hit.at >= ttlMs && !hit.refreshing) {
        hit.refreshing = true
        build().then(
          (fresh) => entries.set(key, { at: clock(), value: Promise.resolve(fresh), refreshing: false }),
          () => {
            hit.refreshing = false
          },
        )
      }
      return hit.value
    },
    clear(): void {
      entries.clear()
    },
  }
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
    const today = zonedDateKey(now, timeZone)
    const closedTo = today > to ? to : previousDay(today)
    const [fakt, leads, registration, calls, warehouse, campaigns, teams] = await Promise.all([
      this.insights.rnpTeamDays(monthPeriod(month, timeZone, now)),
      this.repository.leadDays(from, to),
      this.registration(from, to, today, closedTo),
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

  /** The closed days from the half-hour memo, today read live. */
  private async registration(from: string, to: string, today: string, closedTo: string): Promise<RnpRegistrationDayRow[]> {
    const [closed, live] = await Promise.all([
      closedTo >= from
        ? registrationHistory.get(`${from}|${closedTo}`, () => this.repository.registrationDays(from, closedTo))
        : Promise.resolve([]),
      today >= from && today <= to ? this.repository.registrationDays(today, today) : Promise.resolve([]),
    ])
    /*
      A kval closed today on a lead from last week is today's row in the live
      read and nobody's in the closed one, so the two never overlap: each
      statement buckets by its own day and is bounded to its own days.
    */
    return [...closed.filter((r) => r.day <= closedTo), ...live.filter((r) => r.day === today)]
  }
}

/** `YYYY-MM-DD` of the day before. */
function previousDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)
}
