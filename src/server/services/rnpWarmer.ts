/**
 * Keeps «RNP jadvali» warm: the current month is built in the background
 * every few minutes of the working day, so nobody opening the sheet then
 * waits for a cold build.
 *
 * WHY. A month's rows come from seven scans (the queue cohort, a month of
 * leads, calls, stage history, registration …). Served from the memo the page
 * answers in ~0.1 s; cold — the first reader after a deploy, or after a
 * quiet half hour, the memo's hard limit — it took ~17 s on production
 * (2026-09-30). The client asked for the section to open fast.
 *
 * THE CADENCE, 4 MINUTES: the memo's TTL, well under its 30-minute hard limit, so an idle
 * sheet is never older than that and never cold — in working hours
 * (`WARM_HOURS`). One build at a time — a slow tick is skipped over,
 * never stacked.
 *
 * EACH TICK OF THE WORKING DAY IS A REAL BUILD, WAITED FOR
 * (`RnpService.warm`, 2026-10-02): it used to take the memo's answer and
 * rebuild behind it, so «rnp warmed» logged 0 ms and a failed build was
 * never heard of. Now `ms` is the build's own time and a failure is the warn
 * below. A tick outside `WARM_HOURS` builds nothing: `warm` answers
 * `OFF_HOURS` and the tick logs «rnp warm skipped — outside working hours»
 * at debug (2026-10-06) — as «rnp warmed» it read 0 ms every four minutes
 * all night, the very log the 2026-10-02 change took away. In a month's
 * first week the month that just ended is built once too: a closed month has
 * no hard limit (it is served however old, and rebuilt behind its reader).
 *
 * Started once per server by `src/instrumentation.ts`, Node runtime only.
 */

import { logger } from '@/server/logging/logger'
import { processWide } from '@/server/processWide'

export const RNP_WARM_EVERY_MS = 4 * 60_000

/*
  WORKING HOURS ONLY (2026-10-06): Tashkent [7, 23), for both warmers — this
  one and «Lidlar»'s (`LeadSourcesService.warm`) read this one constant, so
  the two never keep different days. Round the clock it was ~120 month
  builds a night nobody asked for, each up to ~80 s of database time on the
  one-core database, beside the worker's night jobs (`DEALS_BACKFILL`
  01:00–06:00, the deletion sweep). The 07:00 tick builds before the morning;
  a night reader waits for one cold build, as after any quiet half hour.
  Each `warm` checks it and answers `OFF_HOURS` at once, so a night deploy's
  first-build flag still clears.
*/
export const WARM_HOURS = [7, 23] as const

/** A warm-up's answer when the hour is outside `WARM_HOURS`: it built nothing. */
export const OFF_HOURS = 'off-hours'
/** What a warm-up answers: nothing once it has built, `OFF_HOURS` when it did not. */
export type WarmOutcome = void | typeof OFF_HOURS

/**
 * Whether `now` is within the hours [from, to) of the day in `timeZone`. A
 * window whose `from` is past its `to` crosses midnight — [22, 6] is 22:00
 * to 05:59 — rather than never opening; `from` = `to` never opens.
 */
export function withinHours(now: Date, timeZone: string, [from, to]: readonly [number, number]): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(now))
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to
}

/*
  THE FIRST BUILD HOLDS BACK A DEPLOY (2026-10-06, «RNP sekin», then «Lidlar
  juda sekin»). A fresh server's first RNP build took 38.7 s on production,
  and there were ten deploys that day: each left the sheet cold for whoever
  opened it next. `/api/health` reads this and answers «warming» until every
  warmer's first build is done, so the platform keeps the old, warm server
  serving meanwhile — bounded there by `WARMING_GRACE_S`, so a slow or failing
  build never fails a deploy.

  ON `globalThis`, NOT A MODULE VARIABLE (`processWide`): `instrumentation.ts`
  and the route handlers are separate bundles in one process, and each would
  get its own copy of a module-level set.
*/
const FIRST_WARM = 'sinolife.firstWarmPending'

function pendingSet(): Set<string> {
  return processWide(FIRST_WARM, () => new Set<string>())
}

/** True while any warmer's first build is still running; false where no warmer runs. */
export function firstWarmPending(): boolean {
  return pendingSet().size > 0
}

interface Timers {
  setInterval(fn: () => void, ms: number): { unref?: () => void }
}

/**
 * Builds once now — or once `after` has settled — then every `everyMs`,
 * without holding the process open. One build at a time — a slow tick is
 * skipped over, never stacked. Logs «<name> warmed» with the build's time,
 * or «<name> warm skipped» at debug when `warm` answers `OFF_HOURS`; a
 * failure is a warn, and the next tick tries again. Counts as pending for
 * `/api/health` from this call, not from its first tick.
 */
export function startWarmer(
  name: string,
  warm: () => Promise<WarmOutcome>,
  everyMs: number,
  timers: Timers = globalThis as unknown as Timers,
  after: Promise<unknown> = Promise.resolve(),
): () => Promise<void> {
  let running: Promise<void> | null = null
  pendingSet().add(name)
  const tick = (): Promise<void> => {
    if (running) return running
    const started = Date.now()
    running = warm()
      .then((outcome) =>
        outcome === OFF_HOURS
          ? logger.debug(`${name} warm skipped — outside working hours`)
          : logger.info({ ms: Date.now() - started }, `${name} warmed`),
      )
      .catch((error: unknown) => logger.warn({ err: error }, `${name} warm-up failed; the next tick tries again`))
      .finally(() => {
        running = null
        pendingSet().delete(name)
      })
    return running
  }
  void after.then(tick, tick)
  timers.setInterval(() => void tick(), everyMs).unref?.()
  return tick
}

export function startRnpWarmer(warm: () => Promise<WarmOutcome>, timers?: Timers): () => Promise<void> {
  return startWarmer('rnp', warm, RNP_WARM_EVERY_MS, timers)
}
