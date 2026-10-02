import { resolvePeriod } from '@/server/domain/period/period'
import { addDays, buildLeadSplit, type LeadSplitDto, type SplitShare, GRID_DAYS } from '@/server/domain/registration/leadSplit'
import { buildRopReport, type RopReportDto, type SellerPlanInput } from '@/server/domain/registration/ropReport'
import type { InsightsRepository, SellerFaktDayRow } from '@/server/repositories/insightsRepository'
import type { RegistrationRepository } from '@/server/repositories/registrationRepository'

import { ttlCache } from './ttlCache'

/*
  The day's queue cohort, memoised a minute — the sync worker's cadence. It is
  the one heavy read here (the sellers board's whole queue prelude); the leads,
  the roster and the plans are read fresh, so a saved plan is on the next load.
*/
const faktCache = ttlCache<SellerFaktDayRow[]>(60_000)

/**
 * «Registratsiya» — one day's handed-out leads per ROP and the day's split,
 * and «ROP otchet», the same day seller by seller. The split is three small
 * reads (the leads index on `leadDistributedOn` serves the week), so nothing
 * there is memoised: a split saved a second ago is on the next read.
 */
export class RegistrationService {
  constructor(
    private readonly repository: RegistrationRepository,
    private readonly insights: InsightsRepository,
  ) {}

  async overview(input: { day: string; canEdit: boolean }): Promise<LeadSplitDto> {
    const [rows, split, previous] = await Promise.all([
      this.repository.distributedDays(addDays(input.day, -(GRID_DAYS - 1)), input.day),
      this.repository.split(input.day),
      this.repository.previousSplit(input.day),
    ])
    return buildLeadSplit({ day: input.day, rows, split, previous, canEdit: input.canEdit })
  }

  async saveSplit(day: string, rows: readonly SplitShare[], by: string): Promise<void> {
    await this.repository.saveSplit(day, rows, by)
  }

  async report(input: { day: string; timeZone: string; now: Date; canEdit: boolean }): Promise<RopReportDto> {
    const period = resolvePeriod('custom', {
      timeZone: input.timeZone,
      now: input.now,
      customStart: new Date(`${input.day}T00:00:00Z`),
      customEnd: new Date(`${input.day}T00:00:00Z`),
    })
    const [fakt, leads, roster, plans] = await Promise.all([
      faktCache.get(input.day, () => this.insights.sellerFaktDays(period)),
      this.repository.sellerLeads(input.day),
      this.repository.roster(),
      this.repository.sellerPlans(input.day.slice(0, 7)),
    ])
    const rostered = new Set(roster.map((m) => m.employeeId))
    const strangers = new Set([...fakt.map((r) => r.employeeId), ...leads.flatMap((r) => (r.employeeId ? [r.employeeId] : []))])
    const names = await this.repository.names([...strangers].filter((id) => !rostered.has(id)))
    return buildRopReport({ day: input.day, leads, fakt, roster, names, plans, canEdit: input.canEdit })
  }

  /** False when a seller sent is unknown or inactive — the route answers 400 rather than let the foreign key throw. */
  async saveSellerPlans(month: string, rows: readonly SellerPlanInput[], by: string): Promise<boolean> {
    const ids = [...new Set(rows.map((r) => r.employeeId))]
    if ((await this.repository.countEmployees(ids)) !== ids.length) return false
    await this.repository.saveSellerPlans(month, rows, by)
    return true
  }
}
