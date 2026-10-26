import type { BezkvalCountedDay } from '@/server/domain/registration/bezkval'

/**
 * «БЕЗКВАЛ» IS COUNTED HERE, IN THE SYNC WORKER, AND STORED (2026-10-24).
 *
 * The client's spec asks for exactly this («Ma'lumot PostgreSQL'ga
 * sinxronlanadi … har 15–30 daqiqada bugungi kun, kuniga 1 marta oxirgi 7
 * kun qayta hisoblanadi»), and production forced it: the month grid counted
 * 31 days of leads on every request, and on the one-core database, beside
 * the other screens, it ran past the web pool's 20 s statement timeout —
 * «Lidlar» answered 500 on 22–24.10. A day costs a few seconds here, once;
 * every screen reads the stored rows (`bezkval_client`).
 *
 * WHICH DAYS, HOW OFTEN (`bezkvalDaysDue`): today and yesterday every
 * `BEZKVAL_LIVE_MS` (a registrar hands a lead to a ROP within the day, a deal
 * moves in from «ИИ»); the `BEZKVAL_WEEK_DAYS` before them every
 * `BEZKVAL_WEEK_MS` (late hand-overs, a contact merged, the feeds catching
 * up); every older day from `BEZKVAL_FROM` once,
 * when it has never been counted. At most `BEZKVAL_DAYS_PER_PASS` a pass,
 * newest first, so a first run spreads over a few ticks.
 */

/**
 * The counting rules' version, stored on each day (`bezkval_day.rules`). Change
 * it with any change to how a day is counted: every day counted by other rules
 * is then due again, newest first, as a never-counted day is.
 * 2026-10-24b: a person in the ROP fields who heads no ROP team counts for the
 * ROP team they sit in, else for nobody (was: their own name).
 * 2026-10-26 v2: the client's spec v2 — Регистрация births and «ИИ» moves only,
 * days by DATE_CREATE, foreign numbers whole, ROP by the main deal through the
 * org chart, yangi / takror 30 / takror eski, Kval beside it.
 */
export const BEZKVAL_RULES = '2026-10-26-v2'

/** The first day counted — «Guruhlar» and /rnp read whole months, the grid a month back. */
export const BEZKVAL_FROM = '2026-09-01'
export const BEZKVAL_LIVE_MS = 10 * 60_000
export const BEZKVAL_WEEK_DAYS = 7
export const BEZKVAL_WEEK_MS = 3 * 3_600_000
export const BEZKVAL_DAYS_PER_PASS = 6

const shift = (day: string, n: number) => {
  const t = new Date(`${day}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** The days a pass should count, in order: today, yesterday, the week before, then never-counted days, newest first. */
export function bezkvalDaysDue(input: {
  today: string
  /** When each day was last counted, and by which rules. */
  computed: ReadonlyMap<string, BezkvalCounted>
  now: Date
  from?: string
  limit?: number
}): string[] {
  const from = input.from ?? BEZKVAL_FROM
  const fresh = (day: string) => {
    const c = input.computed.get(day)
    return c !== undefined && c.rules === BEZKVAL_RULES ? c : undefined
  }
  const stale = (day: string, ageMs: number) => {
    const c = fresh(day)
    return c === undefined || input.now.getTime() - c.at.getTime() >= ageMs
  }
  const due: string[] = []
  for (let i = 0; i <= 1 + BEZKVAL_WEEK_DAYS; i++) {
    const day = shift(input.today, -i)
    if (day < from) break
    if (stale(day, i <= 1 ? BEZKVAL_LIVE_MS : BEZKVAL_WEEK_MS)) due.push(day)
  }
  for (let day = shift(input.today, -(2 + BEZKVAL_WEEK_DAYS)); day >= from; day = shift(day, -1)) {
    if (fresh(day) === undefined) due.push(day)
  }
  return due.slice(0, input.limit ?? BEZKVAL_DAYS_PER_PASS)
}

/** When a day was counted, and by which rules (null: before rules were stored). */
export interface BezkvalCounted {
  readonly at: Date
  readonly rules: string | null
}

/** What a pass needs of the repository — a seam, so the pass is tested without a database. */
export interface BezkvalStore {
  /**
   * Both stage-history feeds (births and moves) have reached the newest row
   * once. Until then a day would be counted without its «ИИ» moves and stored
   * as counted by these rules — never counted again — so nothing is counted.
   */
  bezkvalReady(): Promise<boolean>
  bezkvalComputedDays(from: string, to: string): Promise<Map<string, BezkvalCounted>>
  computeBezkvalDay(day: string, timeZone: string): Promise<BezkvalCountedDay>
  storeBezkvalDay(day: string, counted: BezkvalCountedDay, at: Date, rules: string): Promise<void>
}

/**
 * One pass: count the due days and store each as it is counted. A day's
 * clock is the instant its count STARTED — that is how current its rows are.
 * A failure on one day ends the pass with what came before it stored.
 */
export async function refreshBezkval(deps: {
  readonly store: BezkvalStore
  readonly today: string
  readonly timeZone: string
  readonly now: () => Date
  readonly stopping?: () => boolean
}): Promise<{ days: { day: string; clients: number; kirim: number; kval: number; ms: number }[]; waiting: boolean }> {
  if (!(await deps.store.bezkvalReady())) return { days: [], waiting: true }
  const computed = await deps.store.bezkvalComputedDays(BEZKVAL_FROM, deps.today)
  const due = bezkvalDaysDue({ today: deps.today, computed, now: deps.now() })
  const days: { day: string; clients: number; kirim: number; kval: number; ms: number }[] = []
  for (const day of due) {
    if (deps.stopping?.()) break
    const started = deps.now()
    const counted = await deps.store.computeBezkvalDay(day, deps.timeZone)
    await deps.store.storeBezkvalDay(day, counted, started, BEZKVAL_RULES)
    days.push({
      day,
      clients: counted.clients.length,
      kirim: counted.clients.reduce((n, r) => n + r.client.deals.length, 0),
      kval: counted.kval.length,
      ms: deps.now().getTime() - started.getTime(),
    })
  }
  return { days, waiting: false }
}
