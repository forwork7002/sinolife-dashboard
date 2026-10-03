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
 *   - Plans are typed in here; FAKT 1 / FAKT 2 plans live in `team_month_plan`.
 *   - Rows with no source in Bitrix24 or Meta (followers, HR, bloggers) are
 *     not on the screen. (Reversed on 2026-09-30: such a row keeps its place,
 *     empty and hatched; HR went with the client's own reshape.)
 *   - A team is its Bitrix24 department name plus its head, every ROP team.
 *
 * WHERE EACH BLOCK COMES FROM:
 *   ROP blocks, logistics, summary — `InsightsRepository.rnpTeamDays`.
 *   Leads, registration, calls, warehouse, plans — `RnpRepository`.
 *   Маркетинг — Meta campaign days (`ReklamaRepository.campaignDays`), split
 *     by product at read time (`adBudgetProduct`); hiring campaigns and accounts that
 *     are neither Collagen nor Zextra are not the sheet's money.
 */

import type { CbuUsdRates } from '@/server/integrations/cbu/cbuRates'
import { type RnpOverviewDto, buildRnpSheet } from '@/server/domain/rnp/rnpSheet'
import { type Period, resolvePeriod, zonedDateKey } from '@/server/domain/period/period'
import type { TargetProduct } from '@/server/domain/types'
import { formNameOf, formOwner } from '@/server/domain/leads/leadSources'
import { LEAD_SOURCE_BRAND } from '@/server/integrations/crm/bitrix24/mapping'
import { adBudgetProduct } from '@/server/integrations/meta/accounts'
import { logger } from '@/server/logging/logger'
import { InsightsRepository, type RnpTeamDayRow } from '@/server/repositories/insightsRepository'
import type { ReklamaRepository } from '@/server/repositories/reklamaRepository'
import type {
  RnpCallDayRow,
  RnpLeadDayRow,
  RnpRegistrarKvalRow,
  RnpRegistrationDayRow,
  RnpRepository,
  RnpTeam,
  RnpWarehouseDayRow,
} from '@/server/repositories/rnpRepository'

/** Every day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function monthDays(month: string): string[] {
  const out: string[] = []
  for (let d = new Date(`${month}-01T00:00:00Z`); d.toISOString().startsWith(month); d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** The month as a dashboard Period — its first to its last Tashkent day. */
function monthPeriod(month: string, timeZone: string, now: Date): Period {
  const days = monthDays(month)
  return resolvePeriod('custom', {
    timeZone,
    now,
    customStart: new Date(`${days[0]}T00:00:00Z`),
    customEnd: new Date(`${days[days.length - 1]}T00:00:00Z`),
  })
}

interface MonthRows {
  fakt: RnpTeamDayRow[]
  leads: RnpLeadDayRow[]
  registration: RnpRegistrationDayRow[]
  registrarKval: RnpRegistrarKvalRow[]
  calls: RnpCallDayRow[]
  warehouse: RnpWarehouseDayRow[]
  meta: { day: string; product: TargetProduct; spendMicroUsd: bigint; impressions: number; clicks: number; leads: number }[]
  teams: RnpTeam[]
}

/*
  Keyed by the month. Company-wide by construction — the route refuses
  a narrowed account — and the plans are read fresh every time, so a saved
  plan shows on the next load rather than a minute later.

  SERVED STALE, REBUILT BEHIND THE READER. A month's rows take seconds to
  build (the queue cohort, a month of leads, calls and stage history), and
  the sheet is read all day by people who open it and wait. After the first
  build a reader always gets the last answer at once; once it is a minute old
  the next reader triggers a rebuild in the background and the one after
  gets the new rows. Rows older than ten minutes (a quiet night) are not
  handed out at all — their «today» and live cells would be wrong — so that
  reader waits for a fresh build, as the first reader after a deploy does.

  A MONTH THAT ENDED BEFORE TODAY HAS NO LIVE CELLS, so it has no hard limit
  (`pastMonthCache`, 2026-10-02): its last answer is handed out however old
  and rebuilt behind the reader. Held to the ten minutes, September read in
  October waited for a cold build (~17 s on production) after every quiet
  spell — the warmer keeps only the current month. A rebuild that fails
  behind a reader is logged (`warnRebuild`); the reader keeps the old answer.
*/
const monthCache = staleWhileRevalidate<MonthRows>(60_000, Date.now, 10 * 60_000, warnRebuild)
const pastMonthCache = staleWhileRevalidate<MonthRows>(60_000, Date.now, Infinity, warnRebuild)

function warnRebuild(key: string, err: unknown): void {
  logger.warn({ err, key }, 'rnp rebuild failed; serving the previous answer')
}

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
/* Cold, beside the other reads, the scan ran past 20 s on 2026-09-30; see `registrationDays`. */
const REGISTRATION_HISTORY_TIMEOUT_MS = 60_000
const registrationHistory = staleWhileRevalidate<RnpRegistrationDayRow[]>(REGISTRATION_HISTORY_MS, Date.now, Infinity, warnRebuild)

/**
 * A memo that, once its answer is older than `ttlMs`, still returns it at
 * once and rebuilds it in the background; a failed rebuild keeps the old
 * answer and goes to `onError`. Only the very first reader of a key waits.
 * `refresh` is the warmer's: a real rebuild, waited for. One rebuild of a
 * key at a time — whoever asks while one runs shares it. Exported for its test.
 */
export function staleWhileRevalidate<T>(
  ttlMs: number,
  clock: () => number = Date.now,
  maxStaleMs = Infinity,
  onError?: (key: string, error: unknown) => void,
) {
  type Entry = { at: number; value: Promise<T>; rebuilding: Promise<void> | null }
  const entries = new Map<string, Entry>()
  const rebuild = (key: string, hit: Entry, build: () => Promise<T>): Promise<void> =>
    (hit.rebuilding ??= build().then(
      (fresh) => {
        entries.set(key, { at: clock(), value: Promise.resolve(fresh), rebuilding: null })
      },
      (error: unknown) => {
        hit.rebuilding = null
        throw error
      },
    ))
  const memo = {
    get(key: string, build: () => Promise<T>): Promise<T> {
      const found = entries.get(key)
      // Too old to show even while rebuilding: drop it and build in the open.
      const hit = found && clock() - found.at >= maxStaleMs ? undefined : found
      if (!hit) {
        const value = build()
        const entry: Entry = { at: clock(), value, rebuilding: null }
        // The key's one build on its way: a refresh, or a reader past the ttl, shares it rather than starting another.
        entry.rebuilding = value.then(
          () => {
            entry.rebuilding = null
          },
          (error: unknown) => {
            if (entries.get(key) === entry) entries.delete(key)
            throw error
          },
        )
        entry.rebuilding.catch(() => undefined) // its reader hears of a failure through `value`
        entries.set(key, entry)
        return value
      }
      if (clock() - hit.at >= ttlMs && !hit.rebuilding) {
        // Nobody waits on it, so nobody would hear of its failure: report it.
        rebuild(key, hit, build).catch((error: unknown) => onError?.(key, error))
      }
      return hit.value
    },
    /**
     * Builds `key` now and resolves once the new answer is in; a failure
     * rejects and the old answer stays. With nothing to hand out yet it is a
     * first build, which a reader who comes meanwhile shares.
     */
    async refresh(key: string, build: () => Promise<T>): Promise<void> {
      const found = entries.get(key)
      if (!found || clock() - found.at >= maxStaleMs) await memo.get(key, build)
      else await rebuild(key, found, build)
    },
    /** Whether `key` has an answer, or its first build on the way. */
    has(key: string): boolean {
      return entries.has(key)
    },
  }
  return memo
}

export class RnpService {
  constructor(
    private readonly insights: InsightsRepository,
    private readonly repository: RnpRepository,
    private readonly reklama: ReklamaRepository,
    /** The dollar's official rate per day — see `integrations/cbu/cbuRates.ts`. */
    private readonly usd: Pick<CbuUsdRates, 'forDays'>,
  ) {}

  async overview(input: { month: string; timeZone: string; now: Date; canEditPlans: boolean }): Promise<RnpOverviewDto> {
    const days = monthDays(input.month)
    const from = days[0]!
    const to = days[days.length - 1]!
    const today = zonedDateKey(input.now, input.timeZone)
    const memo = to < today ? pastMonthCache : monthCache
    /* Plans are read fresh: what somebody just saved shows on the next load. */
    const [rows, plans, usdRates, manualCosts, manualHeadcount] = await Promise.all([
      memo.get(input.month, () => this.monthRows(input.month, from, to, input.timeZone, input.now)),
      this.repository.plans(input.month),
      this.usd.forDays(days, today),
      // Typed a moment ago, shown on the next load — never cached.
      this.repository.manualCosts(from, to),
      this.repository.manualHeadcount(from, to),
    ])
    return buildRnpSheet({
      month: input.month,
      days,
      today,
      usdRates,
      manualCosts,
      manualHeadcount,
      teams: rows.teams,
      fakt: rows.fakt,
      leads: rows.leads,
      registration: rows.registration.map((r) => ({ ...r, brand: leadBrand(r.sourceId, r.formTitle) })),
      registrarKval: rows.registrarKval,
      calls: rows.calls,
      warehouse: rows.warehouse,
      meta: rows.meta,
      plans,
      noRop: InsightsRepository.NO_ROP,
      canEditPlans: input.canEditPlans,
    })
  }

  /**
   * Builds the month that is `now` in `timeZone` into the memo — no reader
   * waiting on it. `rnpWarmer` calls it every few minutes so the sheet is
   * never cold: a first reader after a deploy or a quiet hour was waiting
   * ~17 s for the month's scans (measured on production, 2026-09-30).
   *
   * A real rebuild, waited for (`refresh`, 2026-10-02): it used to hand back
   * the memo's answer and rebuild behind it, so «rnp warmed» logged 0 ms
   * and a failed build was never heard of. In a month's first week the
   * month that just ended is built too, once — after the current one, never
   * beside it (two cold months at once would fill the pool) — so its first
   * reader after a deploy or on the 1st does not wait; readers keep it fresh.
   */
  async warm(now: Date, timeZone: string): Promise<void> {
    const today = zonedDateKey(now, timeZone)
    const month = today.slice(0, 7)
    const days = monthDays(month)
    await Promise.all([
      monthCache.refresh(month, () => this.monthRows(month, days[0]!, days[days.length - 1]!, timeZone, now)),
      this.usd.forDays(days, today),
    ])
    const last = previousDay(days[0]!).slice(0, 7)
    if (Number(today.slice(8)) > 7 || pastMonthCache.has(last)) return
    const lastDays = monthDays(last)
    await Promise.all([
      pastMonthCache.refresh(last, () => this.monthRows(last, lastDays[0]!, lastDays[lastDays.length - 1]!, timeZone, now)),
      this.usd.forDays(lastDays, today),
    ])
  }

  saveManualCosts: RnpRepository['saveManualCosts'] = async (cells, by) => {
    await this.repository.saveManualCosts(cells, by)
  }

  savePlanCells: RnpRepository['savePlanCells'] = async (month, cells, by) => {
    await this.repository.savePlanCells(month, cells, by)
  }

  /**
   * The plan cells the month's sheet leaves open (`planInput`), as
   * `team|metric` — the only cells a typed plan may name. A plan the sheet
   * computes (orders, conversions, «Отказ %», row 47) is not among them.
   */
  async planInputs(input: { month: string; timeZone: string; now: Date }): Promise<ReadonlySet<string>> {
    const sheet = await this.overview({ ...input, canEditPlans: false })
    return new Set(sheet.blocks.flatMap((b) => b.rows).flatMap((r) => (r.planInput ? [`${r.planInput.team}|${r.planInput.metric}`] : [])))
  }

  saveManualHeadcount: RnpRepository['saveManualHeadcount'] = async (cells, by) => {
    await this.repository.saveManualHeadcount(cells, by)
  }

  /**
   * The teams whose «Ходим сони» the month's sheet draws — the only names a
   * typed headcount may carry. Canonical names only: a row saved under an
   * alias would sit beside the canonical one, and either could show.
   */
  async headcountTeams(input: { month: string; timeZone: string; now: Date }): Promise<ReadonlySet<string>> {
    const sheet = await this.overview({ ...input, canEditPlans: false })
    return new Set(sheet.blocks.flatMap((b) => b.rows).flatMap((r) => (r.manual?.kind === 'headcount' ? [r.manual.rop] : [])))
  }


  private async monthRows(month: string, from: string, to: string, timeZone: string, now: Date): Promise<MonthRows> {
    const today = zonedDateKey(now, timeZone)
    const closedTo = today > to ? to : previousDay(today)
    const [fakt, leads, registration, registrarKval, calls, warehouse, campaigns, teams] = await Promise.all([
      this.insights.rnpTeamDays(monthPeriod(month, timeZone, now)),
      this.repository.leadDays(from, to),
      this.registration(from, to, today, closedTo),
      this.repository.registrarKvalDays(from, to),
      this.repository.callDays(from, to),
      this.repository.warehouseDays(from, to, now),
      this.reklama.campaignDays(from, to),
      this.repository.teams(),
    ])
    const meta: MonthRows['meta'] = []
    for (const c of campaigns) {
      const product = adBudgetProduct(c)
      if (product === null) continue
      meta.push({ day: c.date, product, spendMicroUsd: c.spendMicroUsd, impressions: c.impressions, clicks: c.clicks, leads: c.leads })
    }
    return { fakt, leads, registration, registrarKval, calls, warehouse, meta, teams }
  }

  /** The closed days from the half-hour memo, today read live. */
  private async registration(from: string, to: string, today: string, closedTo: string): Promise<RnpRegistrationDayRow[]> {
    const [closed, live] = await Promise.all([
      closedTo >= from
        ? registrationHistory.get(`${from}|${closedTo}`, () =>
            this.repository.registrationDays(from, closedTo, REGISTRATION_HISTORY_TIMEOUT_MS),
          )
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

/**
 * A Регистрация lead's brand: its source when the source is a brand's page or
 * line; else its CRM form's — «zextra» or «collagen» in the name, then a
 * Kamron form (his Meta accounts are all Zextra; «Kamron 6 etap filt forma»
 * names no product); any other form sold the collagen (every form of
 * 18–24.09 without «zextra» did). A name that says «collagen» outranks its
 * owner: the forms read «<targetolog>-collagen / -zextra» (01.10), so a
 * «Kamron-collagen» form must not turn Zextra. Null: a lead nothing ties to a
 * brand (an operator's outgoing call, a lead typed in by hand) — the P&L
 * prints those as «brendsiz».
 */
export function leadBrand(sourceId: string | null, formTitle: string | null): TargetProduct | null {
  const bySource = sourceId === null ? undefined : LEAD_SOURCE_BRAND[sourceId]
  if (bySource) return bySource
  const form = formNameOf(formTitle)
  if (form === null) return null
  if (/zextra/i.test(form)) return 'Zextra'
  if (/collagen|коллаген/i.test(form)) return 'Collagen'
  const owner = formOwner(form)
  if (owner?.targetolog === 'Kamron') return 'Zextra'
  return 'Collagen'
}

/** `YYYY-MM-DD` of the day before. */
function previousDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)
}
