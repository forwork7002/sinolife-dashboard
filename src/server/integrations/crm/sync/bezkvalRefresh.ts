import type { BezkvalClientDto } from '@/server/domain/registration/bezkval'

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
 * `BEZKVAL_LIVE_MS` (a Lead Guard deal lands on the evening before; a
 * registrar hands a lead to a ROP within the day); the `BEZKVAL_WEEK_DAYS`
 * before them every `BEZKVAL_WEEK_MS` (late Lead Guard deals, late hand-overs,
 * the births feed catching up); every older day from `BEZKVAL_FROM` once,
 * when it has never been counted. At most `BEZKVAL_DAYS_PER_PASS` a pass,
 * newest first, so a first run spreads over a few ticks.
 */

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
  /** When each day was last counted. */
  computed: ReadonlyMap<string, Date>
  now: Date
  from?: string
  limit?: number
}): string[] {
  const from = input.from ?? BEZKVAL_FROM
  const stale = (day: string, ageMs: number) => {
    const at = input.computed.get(day)
    return at === undefined || input.now.getTime() - at.getTime() >= ageMs
  }
  const due: string[] = []
  for (let i = 0; i <= 1 + BEZKVAL_WEEK_DAYS; i++) {
    const day = shift(input.today, -i)
    if (day < from) break
    if (stale(day, i <= 1 ? BEZKVAL_LIVE_MS : BEZKVAL_WEEK_MS)) due.push(day)
  }
  for (let day = shift(input.today, -(2 + BEZKVAL_WEEK_DAYS)); day >= from; day = shift(day, -1)) {
    if (!input.computed.has(day)) due.push(day)
  }
  return due.slice(0, input.limit ?? BEZKVAL_DAYS_PER_PASS)
}

/** What a pass needs of the repository — a seam, so the pass is tested without a database. */
export interface BezkvalStore {
  bezkvalComputedDays(from: string, to: string): Promise<Map<string, Date>>
  computeBezkvalDay(day: string, timeZone: string): Promise<{ key: string; client: BezkvalClientDto }[]>
  storeBezkvalDay(day: string, rows: readonly { key: string; client: BezkvalClientDto }[], at: Date): Promise<void>
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
}): Promise<{ days: { day: string; clients: number; ms: number }[] }> {
  const computed = await deps.store.bezkvalComputedDays(BEZKVAL_FROM, deps.today)
  const due = bezkvalDaysDue({ today: deps.today, computed, now: deps.now() })
  const days: { day: string; clients: number; ms: number }[] = []
  for (const day of due) {
    if (deps.stopping?.()) break
    const started = deps.now()
    const rows = await deps.store.computeBezkvalDay(day, deps.timeZone)
    await deps.store.storeBezkvalDay(day, rows, started)
    days.push({ day, clients: rows.length, ms: deps.now().getTime() - started.getTime() })
  }
  return { days }
}
