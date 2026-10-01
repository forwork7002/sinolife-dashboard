import { addDays, buildLeadSplit, type LeadSplitDto, type SplitShare, WEEK_DAYS } from '@/server/domain/registration/leadSplit'
import type { RegistrationRepository } from '@/server/repositories/registrationRepository'

/**
 * «Registratsiya» — one day's handed-out leads per ROP and the day's split.
 * Three small reads (the leads index on `leadDistributedOn` serves the week),
 * so nothing is memoised: a split saved a second ago is on the next read.
 */
export class RegistrationService {
  constructor(private readonly repository: RegistrationRepository) {}

  async overview(input: { day: string; canEdit: boolean }): Promise<LeadSplitDto> {
    const [rows, split, previous] = await Promise.all([
      this.repository.distributedDays(addDays(input.day, -(WEEK_DAYS - 1)), input.day),
      this.repository.split(input.day),
      this.repository.previousSplit(input.day),
    ])
    return buildLeadSplit({ day: input.day, rows, split, previous, canEdit: input.canEdit })
  }

  async saveSplit(day: string, rows: readonly SplitShare[], by: string): Promise<void> {
    await this.repository.saveSplit(day, rows, by)
  }
}
