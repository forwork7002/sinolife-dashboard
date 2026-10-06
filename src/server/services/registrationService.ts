import { callFloorApplied } from '@/lib/callQuality'
import { resolvePeriod } from '@/server/domain/period/period'
import { buildGroupPlan, type GroupPlanDto, monthStart } from '@/server/domain/registration/groupPlan'
import {
  addDays,
  buildLeadSplit,
  type LeadSplitDto,
  type SplitShare,
  GRID_DAYS,
  leadSplitOfBrand,
  teamRowsOfBrand,
} from '@/server/domain/registration/leadSplit'
import { buildRopReport, type RopReportDto } from '@/server/domain/registration/ropReport'
import type { BrandFilter } from '@/server/domain/types'
import type { InsightsRepository, SellerFaktDayRow } from '@/server/repositories/insightsRepository'
import type { RegistrationRepository } from '@/server/repositories/registrationRepository'

import { LIVE_CACHE, ttlCache } from './ttlCache'

/*
  The window's queue cohort, memoised a minute — the sync worker's cadence. It is
  the one heavy read here (the sellers board's whole queue prelude); the leads,
  the roster and the calls are read fresh.
*/
const faktCache = ttlCache<SellerFaktDayRow[]>(120_000, LIVE_CACHE)

/**
 * «Registratsiya» — one day's handed-out leads per ROP and the day's split,
 * «ROP otchet», the same day seller by seller, and «Guruhlar», that sheet
 * summed from the first of the month. The split is three small
 * reads (the leads index on `leadDistributedOn` serves the week), so nothing
 * there is memoised: a split saved a second ago is on the next read.
 */
export class RegistrationService {
  constructor(
    private readonly repository: RegistrationRepository,
    private readonly insights: InsightsRepository,
  ) {}

  async overview(input: { day: string; timeZone: string; canEdit: boolean; brand?: BrandFilter }): Promise<LeadSplitDto> {
    const from = addDays(input.day, -(GRID_DAYS - 1))
    const [rows, bezkval, split, previous] = await Promise.all([
      this.repository.distributedDays(from, input.day),
      this.repository.bezkvalDays(from, input.day, input.timeZone),
      this.repository.split(input.day),
      this.repository.previousSplit(input.day),
    ])
    const whole = buildLeadSplit({ day: input.day, rows, bezkval, split, previous, canEdit: input.canEdit })
    return leadSplitOfBrand(whole, input.brand ?? 'all')
  }

  async saveSplit(day: string, rows: readonly SplitShare[], by: string): Promise<void> {
    await this.repository.saveSplit(day, rows, by)
  }

  /** «ROP otchet» — one day. See ropReport.ts. */
  async report(input: { day: string; timeZone: string; now: Date; brand?: BrandFilter }): Promise<RopReportDto> {
    return this.sellerSheet({ from: input.day, to: input.day, timeZone: input.timeZone, now: input.now, calls: true, brand: input.brand })
  }

  /** «Guruhlar» — the first of the day's month to the day. See groupPlan.ts. */
  async groupPlan(input: { day: string; timeZone: string; now: Date; brand?: BrandFilter }): Promise<GroupPlanDto> {
    const from = monthStart(input.day)
    const report = await this.sellerSheet({ from, to: input.day, timeZone: input.timeZone, now: input.now, calls: false, brand: input.brand })
    return buildGroupPlan({ from, report })
  }

  /**
   * «ROP otchet» over `from`…`to` (inclusive), dated `to`; without the calls, their columns print a dash.
   * One brand keeps its teams' leads, orders and rosters (`teamRowsOfBrand`), after the memo — a call
   * names no team and follows its seller's row, so another brand's sellers' calls fall away with them.
   */
  private async sellerSheet(input: {
    from: string
    to: string
    timeZone: string
    now: Date
    calls: boolean
    brand?: BrandFilter
  }): Promise<RopReportDto> {
    const period = resolvePeriod('custom', {
      timeZone: input.timeZone,
      now: input.now,
      customStart: new Date(`${input.from}T00:00:00Z`),
      customEnd: new Date(`${input.to}T00:00:00Z`),
    })
    const brand = input.brand ?? 'all'
    const [allFakt, allLeads, allRoster, calls] = await Promise.all([
      faktCache.get(`${input.from}:${input.to}`, () => this.insights.sellerFaktDays(period)),
      this.repository.sellerLeads(input.from, input.to),
      this.repository.roster(),
      !input.calls || callFloorApplied(period.start) ? null : this.repository.sellerCalls(period.start, period.end),
    ])
    const fakt = teamRowsOfBrand(allFakt, brand)
    const leads = teamRowsOfBrand(allLeads, brand)
    const roster = teamRowsOfBrand(allRoster, brand)
    const rostered = new Set(roster.map((m) => m.employeeId))
    const strangers = new Set([...fakt.map((r) => r.employeeId), ...leads.flatMap((r) => (r.employeeId ? [r.employeeId] : []))])
    const names = await this.repository.names([...strangers].filter((id) => !rostered.has(id)))
    return buildRopReport({ day: input.to, leads, fakt, roster, names, calls })
  }
}
