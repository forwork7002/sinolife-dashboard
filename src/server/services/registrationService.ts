import { callFloorApplied } from '@/lib/callQuality'
import { resolvePeriod } from '@/server/domain/period/period'
import { buildGroupIntake, type GroupIntakeDto } from '@/server/domain/registration/groupIntake'
import { addDays, buildLeadSplit, type LeadSplitDto, type SplitShare, GRID_DAYS } from '@/server/domain/registration/leadSplit'
import { buildRopReport, type RopReportDto } from '@/server/domain/registration/ropReport'
import type { InsightsRepository, SellerFaktDayRow } from '@/server/repositories/insightsRepository'
import type { RegistrationRepository } from '@/server/repositories/registrationRepository'
import type { RnpRepository } from '@/server/repositories/rnpRepository'

import { ttlCache } from './ttlCache'

/*
  The day's queue cohort, memoised a minute — the sync worker's cadence. It is
  the one heavy read here (the sellers board's whole queue prelude); the leads,
  the roster and the calls are read fresh.
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
    private readonly rnp: RnpRepository,
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

  async report(input: { day: string; timeZone: string; now: Date }): Promise<RopReportDto> {
    const period = resolvePeriod('custom', {
      timeZone: input.timeZone,
      now: input.now,
      customStart: new Date(`${input.day}T00:00:00Z`),
      customEnd: new Date(`${input.day}T00:00:00Z`),
    })
    const [fakt, leads, roster, calls] = await Promise.all([
      faktCache.get(input.day, () => this.insights.sellerFaktDays(period)),
      this.repository.sellerLeads(input.day),
      this.repository.roster(),
      callFloorApplied(period.start) ? null : this.repository.sellerCalls(period.start, period.end),
    ])
    const rostered = new Set(roster.map((m) => m.employeeId))
    const strangers = new Set([...fakt.map((r) => r.employeeId), ...leads.flatMap((r) => (r.employeeId ? [r.employeeId] : []))])
    const names = await this.repository.names([...strangers].filter((id) => !rostered.has(id)))
    return buildRopReport({ day: input.day, leads, fakt, roster, names, calls })
  }

  /** «Guruhlar · безквал / квал» — one day. See groupIntake.ts. */
  async groupIntake(input: { day: string; canEdit: boolean }): Promise<GroupIntakeDto> {
    const [handedOut, intake] = await Promise.all([this.rnp.leadDays(input.day, input.day), this.repository.groupIntake(input.day)])
    return buildGroupIntake({ day: input.day, handedOut, intake, canEdit: input.canEdit })
  }

  async saveGroupIntake(day: string, rows: readonly { group: string; leads: number | null }[], by: string): Promise<void> {
    await this.repository.saveGroupIntake(day, rows, by)
  }
}
