/**
 * «Lid kogortasi» on «Reklama samarasi» — see `domain/leadCohort/leadCohort.ts`
 * for what the table means and how a lead is counted.
 *
 * The window is the screen's OWN (default: the last 14 days), not the
 * dashboard preset: a cohort needs whole days, and «Bugun» would be a table of
 * one row. The deals are memoised per window for five minutes — the client
 * asked for 5–10 so that opening the tab does not re-read everything — and
 * the filters (pipelines, ROP) are applied to the memoised rows, so changing
 * a filter costs no query at all.
 */

import {
  type LeadCohortOverviewDto,
  type LeadDealRow,
  leadCohortOverview,
} from '@/server/domain/leadCohort/leadCohort'
import { resolvePeriod, zonedDateKey } from '@/server/domain/period/period'
import type { LeadCohortRepository } from '@/server/repositories/leadCohortRepository'

import { ttlCache } from './ttlCache'

/** The client's «5–10 daqiqa». Company-wide by construction — the route refuses a narrowed account. */
const LEAD_COHORT_TTL_MS = 5 * 60_000

/** The widest window the screen will read in one go. */
export const LEAD_COHORT_MAX_DAYS = 92

/** Days in the default window, today included. */
export const LEAD_COHORT_DEFAULT_DAYS = 14

const rowsCache = ttlCache<{ rows: LeadDealRow[]; names: Map<string, string> }>(LEAD_COHORT_TTL_MS)

export function resetLeadCohortCaches(): void {
  rowsCache.clear()
}

const shiftDay = (day: string, by: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10)

/**
 * The window the reader asked for, made sane: missing ends default to the
 * last `LEAD_COHORT_DEFAULT_DAYS`, the end never passes today, an inverted
 * pair is swapped and anything wider than `LEAD_COHORT_MAX_DAYS` keeps its
 * END and loses its start. Exported for its test.
 */
export function leadCohortWindow(input: { from?: string; to?: string; today: string }): { from: string; to: string } {
  let to = input.to && input.to < input.today ? input.to : input.today
  let from = input.from ?? shiftDay(to, -(LEAD_COHORT_DEFAULT_DAYS - 1))
  if (from > to) [from, to] = [to, from]
  const earliest = shiftDay(to, -(LEAD_COHORT_MAX_DAYS - 1))
  if (from < earliest) from = earliest
  return { from, to }
}

export class LeadCohortService {
  constructor(private readonly repository: LeadCohortRepository) {}

  async overview(input: {
    from?: string
    to?: string
    pipelines: readonly number[]
    rop: string | null
    timeZone: string
    now: Date
  }): Promise<LeadCohortOverviewDto> {
    const today = zonedDateKey(input.now, input.timeZone)
    const { from, to } = leadCohortWindow({ from: input.from, to: input.to, today })
    const period = resolvePeriod('custom', {
      timeZone: input.timeZone,
      now: input.now,
      customStart: new Date(`${from}T00:00:00Z`),
      customEnd: new Date(`${to}T00:00:00Z`),
    })

    // `today` is in the key: the query reads «distributed today» by name.
    const { rows, names } = await rowsCache.get(`${from}|${to}|${today}`, async () => {
      const rows = await this.repository.deals({ start: period.start, end: period.end, from, to, today })
      const ropIds = [...new Set(rows.map((r) => r.ropEmployeeId).filter((id): id is string => id !== null))]
      return { rows, names: await this.repository.names(ropIds) }
    })

    return leadCohortOverview({
      rows,
      from,
      to,
      today,
      timeZone: input.timeZone,
      pipelines: input.pipelines,
      rop: input.rop,
      names,
    })
  }
}
