import { callFloorApplied } from '@/lib/callQuality'
import { resolvePeriod, zonedDateKey } from '@/server/domain/period/period'
import { buildGroupPlan, type GroupPlanDto, monthStart } from '@/server/domain/registration/groupPlan'
import {
  type BezkvalClientDto,
  type BezkvalClientsDto,
  type BezkvalDayDto,
  bezkvalDayTotals,
  buildBezkvalDay,
} from '@/server/domain/registration/bezkval'
import {
  addDays,
  type BezkvalDayRow,
  buildLeadSplit,
  type DistributedDayRow,
  type LeadSplitDto,
  type SplitShare,
  GRID_DAYS,
  leadSplitOfBrand,
  teamOrder,
} from '@/server/domain/registration/leadSplit'
import { buildRopReport, type RopReportDto } from '@/server/domain/registration/ropReport'
import { teamBrand } from '@/server/domain/rnp/rnpSheet'
import { type BrandFilter, brandMatches } from '@/server/domain/types'
import type { InsightsRepository, SellerFaktDayRow } from '@/server/repositories/insightsRepository'
import type { RegistrationRepository } from '@/server/repositories/registrationRepository'

import { LIVE_CACHE, ttlCache } from './ttlCache'

/*
  The window's queue cohort, memoised a minute — the sync worker's cadence. It is
  the one heavy read here (the sellers board's whole queue prelude); the leads,
  the roster and the calls are read fresh.
*/
const faktCache = ttlCache<SellerFaktDayRow[]>(120_000, LIVE_CACHE)

/*
  The month grid's day rows — the handed-out leads and «Безквал» — memoised
  like the rest of «Lidlar» (2026-10-06 audit). They were read afresh on
  every poll of every open «Lid manbalari» tab and on every brand switch,
  and «Безквал» is 31 days of Регистрация deals with correlated subplans per
  deal (the owner's ROP, the hand-over history). They carry no brand — it is
  applied after (`leadSplitOfBrand`) — so a switch costs no query.

  THE SETTLED DAYS APART FROM THE LAST TWO (2026-10-16, «dashboard sekin»).
  Past this memo's few minutes every reader waited for all 31 days again:
  10–14 s on production that day. Today and yesterday stay on the live clock
  — «Безквал» credits a deal to its CURRENT owner and drops it once it is
  re-staged as «Дубликат (лид)», which happens to last evening's leads the
  next morning. The 29 days before them have settled (a late hand-over
  re-credits one now and then), so they are read once per half hour, and
  past that handed out — up to 12 h old, for the one poll a rebuild behind
  the reader takes — rather than waited for: «RNP jadvali» keeps its closed
  Регистрация and «Безквал» days the same way, without even that bound. The
  price: those days may trail «Guruhlar», which reads the month on the live
  clock, by that long.
  «Безквал» is a stored read since 2026-10-24 (`bezkval_client`, counted by
  the worker), so only the hand-outs cost a scan here now.
  Both statements bucket by day and are bounded to their own days (a
  duplicate is a contact's — for «Безквал» a phone number's — later deal THAT
  day), so the two reads never overlap and their rows simply add up.
*/
type SplitDays = { readonly rows: readonly DistributedDayRow[]; readonly bezkval: readonly BezkvalDayRow[] }
const splitDaysCache = ttlCache<DistributedDayRow[]>(120_000, LIVE_CACHE)
const SETTLED_DAYS_MS = 30 * 60_000
const settledDaysCache = ttlCache<DistributedDayRow[]>(SETTLED_DAYS_MS, { ...LIVE_CACHE, staleMs: 12 * 60 * 60_000 })
const NO_DAYS: Promise<DistributedDayRow[]> = Promise.resolve([])

/** Test seam: the memos are module-wide, and each case builds its own answer. */
export function resetRegistrationCaches(): void {
  splitDaysCache.clear()
  settledDaysCache.clear()
  storedDayCache.clear()
  trendCache.clear()
}

/* «Bezkval lidlar»: one stored day — the worker recomputes today every ten minutes, so a minute's memo costs nothing. */
type StoredDay = { readonly computedAt: Date | null; readonly clients: readonly BezkvalClientDto[] }
const storedDayCache = ttlCache<StoredDay>(60_000, LIVE_CACHE)
const trendCache = ttlCache<BezkvalDayRow[]>(60_000, LIVE_CACHE)
/** The trend under the day card: the spec's 30 days. */
const BEZKVAL_TREND_DAYS = 30

/* «Guruhlar»' month of «Безквал», the same statement on the same terms; brand applied after. */
const monthBezkvalCache = ttlCache<BezkvalDayRow[]>(120_000, LIVE_CACHE)

/**
 * «Registratsiya» — one day's handed-out leads per ROP and the day's split,
 * «ROP otchet», the same day seller by seller, and «Guruhlar», that sheet
 * summed from the first of the month. The split itself — two small reads —
 * is never memoised: a split saved a second ago is on the next read.
 */
export class RegistrationService {
  constructor(
    private readonly repository: RegistrationRepository,
    private readonly insights: InsightsRepository,
  ) {}

  async overview(input: { day: string; timeZone: string; canEdit: boolean; brand?: BrandFilter; now: Date }): Promise<LeadSplitDto> {
    const [days, split, previous] = await Promise.all([
      this.monthDays(input.day, input.timeZone, input.now),
      this.repository.split(input.day),
      this.repository.previousSplit(input.day),
    ])
    const whole = buildLeadSplit({ day: input.day, rows: days.rows, bezkval: days.bezkval, split, previous, canEdit: input.canEdit })
    return leadSplitOfBrand(whole, input.brand ?? 'all')
  }

  /**
   * The month grid's days to `day`. The hand-outs: the settled days from their
   * memo, yesterday and today live — see `settledDaysCache`. «Безквал»: the
   * stored rows, whole, on a minute's memo — a cheap read, and the worker
   * recounts settled days too (the week every 3 h, every day on a rules
   * change), so the half-hour memo would show a recount up to 30 min late.
   */
  private async monthDays(day: string, timeZone: string, now: Date): Promise<SplitDays> {
    const from = addDays(day, -(GRID_DAYS - 1))
    const yesterday = addDays(zonedDateKey(now, timeZone), -1)
    const settledTo = day < yesterday ? day : addDays(yesterday, -1)
    const liveFrom = from > yesterday ? from : yesterday
    const handedOut = (lo: string, hi: string) => () => this.repository.distributedDays(lo, hi)
    const [settled, live, bezkval] = await Promise.all([
      settledTo >= from ? settledDaysCache.get(`${from}:${settledTo}:${timeZone}`, handedOut(from, settledTo)) : NO_DAYS,
      day >= liveFrom ? splitDaysCache.get(`${liveFrom}:${day}:${timeZone}`, handedOut(liveFrom, day)) : NO_DAYS,
      trendCache.get(`${from}:${day}`, () => this.repository.bezkvalDays(from, day)),
    ])
    return { rows: [...settled, ...live], bezkval }
  }

  /**
   * «Bezkval lidlar» — one day opened up (the spec's 5): «Jami lid», the
   * clients, the new ones, the ROPs, the sources, the hours and the 30 days to
   * it, every count from the client list `bezkvalClients` serves — so a number
   * and the rows behind it cannot disagree. One brand keeps the clients of its
   * teams (`teamBrand`); «Brendsiz» the ones no team got.
   */
  async bezkvalDay(input: { day: string; timeZone: string; now: Date; brand?: BrandFilter }): Promise<BezkvalDayDto> {
    const brand = input.brand ?? 'all'
    const trendDays = Array.from({ length: BEZKVAL_TREND_DAYS }, (_, i) => addDays(input.day, i - (BEZKVAL_TREND_DAYS - 1)))
    // The trend from the stored rows alone — never `monthDays`, whose hand-out scan is the slow read here.
    const [stored, trend] = await Promise.all([
      this.storedDay(input.day),
      trendCache.get(`${trendDays[0]}:${input.day}`, () => this.repository.bezkvalDays(trendDays[0]!, input.day)),
    ])
    const keep = (rop: string | null) => brand === 'all' || brandMatches(brand, teamBrand(rop))
    return buildBezkvalDay({
      day: input.day,
      clients: stored.clients.filter((c) => keep(c.rop)),
      computedAt: stored.computedAt?.toISOString() ?? null,
      trendDays,
      totals: bezkvalDayTotals(trend.filter((r) => keep(r.rop)).map((r) => ({ day: r.day, leads: r.leads, deals: r.deals ?? r.leads }))),
      order: (rops) => teamOrder(rops),
    })
  }

  /** The day's clients, each with its deals and what came before it — every drill-down of «Bezkval lidlar». */
  async bezkvalClients(input: { day: string; timeZone: string; brand?: BrandFilter }): Promise<BezkvalClientsDto> {
    const brand = input.brand ?? 'all'
    const stored = await this.storedDay(input.day)
    return { day: input.day, clients: brand === 'all' ? stored.clients : stored.clients.filter((c) => brandMatches(brand, teamBrand(c.rop))) }
  }

  /** The day as the sync worker stored it (`bezkvalRefresh.ts`) — the card and its drill-downs read one memo. */
  private storedDay(day: string): Promise<StoredDay> {
    return storedDayCache.get(day, () => this.repository.storedBezkvalDay(day))
  }

  async saveSplit(day: string, rows: readonly SplitShare[], by: string): Promise<void> {
    await this.repository.saveSplit(day, rows, by)
  }

  /** «ROP otchet» — one day, a month or a range (`from`…`to`, inclusive; 2026-10-14). See ropReport.ts. */
  async report(input: {
    from: string
    to: string
    timeZone: string
    now: Date
    brand?: BrandFilter
    /** A TEAM scope's people (2026-10-24): only their rows, the totals theirs. Null/absent = everybody. */
    employeeIds?: readonly string[] | null
  }): Promise<RopReportDto> {
    return this.sellerSheet({
      from: input.from,
      to: input.to,
      timeZone: input.timeZone,
      now: input.now,
      calls: true,
      brand: input.brand,
      employeeIds: input.employeeIds ?? null,
    })
  }

  /** «Guruhlar» — the first of the day's month to the day, one row per ROP. See groupPlan.ts. */
  async groupPlan(input: { day: string; timeZone: string; now: Date; brand?: BrandFilter }): Promise<GroupPlanDto> {
    const from = monthStart(input.day)
    const brand = input.brand ?? 'all'
    const [report, bezkval] = await Promise.all([
      this.sellerSheet({ from, to: input.day, timeZone: input.timeZone, now: input.now, calls: false, brand }),
      monthBezkvalCache.get(`${from}:${input.day}`, () => this.repository.bezkvalDays(from, input.day)),
    ])
    // The report keeps its groups by `teamBrand`; the без квал rows go the same way.
    const kept = brand === 'all' ? bezkval : bezkval.filter((r) => brandMatches(brand, teamBrand(r.rop)))
    return buildGroupPlan({ from, report, bezkval: kept })
  }

  /**
   * «ROP otchet» over `from`…`to` (inclusive), dated `to`; without the calls, their columns print a dash.
   * One brand keeps its teams' groups (`teamBrand`; «Brendsiz» the teams on neither list and the leads
   * and orders that name no team), after the memo. The sheet is built whole and narrowed by group: a
   * call names no team and sits on its seller's one row, so it is in exactly one slice.
   */
  private async sellerSheet(input: {
    from: string
    to: string
    timeZone: string
    now: Date
    calls: boolean
    brand?: BrandFilter
    employeeIds?: readonly string[] | null
  }): Promise<RopReportDto> {
    const period = resolvePeriod('custom', {
      timeZone: input.timeZone,
      now: input.now,
      customStart: new Date(`${input.from}T00:00:00Z`),
      customEnd: new Date(`${input.to}T00:00:00Z`),
    })
    const brand = input.brand ?? 'all'
    const scoped = input.employeeIds ? new Set(input.employeeIds) : null
    const [allFakt, allLeads, allRoster, calls] = await Promise.all([
      faktCache.get(`${input.from}:${input.to}`, () => this.insights.sellerFaktDays(period)),
      this.repository.sellerLeads(input.from, input.to),
      this.repository.roster(),
      !input.calls || callFloorApplied(period.start) ? null : this.repository.sellerCalls(period.start, period.end),
    ])
    const rostered = new Set(allRoster.map((m) => m.employeeId))
    const strangers = new Set([...allFakt.map((r) => r.employeeId), ...allLeads.flatMap((r) => (r.employeeId ? [r.employeeId] : []))])
    const names = await this.repository.names([...strangers].filter((id) => !rostered.has(id)))
    return buildRopReport({
      from: input.from,
      day: input.to,
      leads: allLeads,
      fakt: allFakt,
      roster: allRoster,
      names,
      calls,
      keepsGroup: brand === 'all' ? undefined : (rop) => brandMatches(brand, teamBrand(rop)),
      keepsSeller: scoped ? (id) => scoped.has(id) : undefined,
    })
  }
}
