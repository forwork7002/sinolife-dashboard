/**
 * Keeps «RNP jadvali» warm: the current month is built in the background
 * every few minutes, so nobody opening the sheet ever waits for a cold build.
 *
 * WHY. A month's rows come from seven scans (the queue cohort, a month of
 * leads, calls, stage history, registration …). Served from the memo the page
 * answers in ~0.1 s; cold — the first reader after a deploy, or after ten
 * quiet minutes past the memo's hard limit — it took ~17 s on production
 * (2026-09-30). The client asked for the section to open fast.
 *
 * THE CADENCE, 4 MINUTES: the memo's TTL, well under its 30-minute hard limit, so an idle
 * sheet is never older than that and never cold. One build at a time — a
 * slow tick is skipped over, never stacked.
 *
 * EACH TICK IS A REAL BUILD, WAITED FOR (`RnpService.warm`, 2026-10-02): it
 * used to take the memo's answer and rebuild behind it, so «rnp warmed»
 * logged 0 ms and a failed build was never heard of. Now `ms` is the build's
 * own time and a failure is the warn below. In a month's first week the
 * month that just ended is built once too: a closed month has no hard limit
 * (it is served however old, and rebuilt behind its reader).
 *
 * Started once per server by `src/instrumentation.ts`, Node runtime only.
 */

import { logger } from '@/server/logging/logger'

export const RNP_WARM_EVERY_MS = 4 * 60_000

/*
  THE FIRST BUILD HOLDS BACK A DEPLOY (2026-10-06, «RNP sekin»). A fresh
  server's first build took 38.7 s on production, and there were ten deploys
  that day: each left the sheet cold for whoever opened it next. `/api/health`
  reads this and answers «warming» until the first build is done, so the
  platform keeps the old, warm server serving meanwhile — bounded there by
  `WARMING_GRACE_S`, so a slow or failing build never fails a deploy.

  ON `globalThis`, NOT A MODULE VARIABLE: `instrumentation.ts` and the route
  handlers are separate bundles in one process, and each would get its own
  copy of a module-level flag.
*/
const FIRST_WARM = Symbol.for('sinolife.rnp.firstWarmPending')
type WarmFlag = { [FIRST_WARM]?: boolean }

/** True from the warmer's start until its first build has finished, well or not; false where no warmer runs. */
export function rnpFirstWarmPending(): boolean {
  return (globalThis as WarmFlag)[FIRST_WARM] === true
}

interface Timers {
  setInterval(fn: () => void, ms: number): { unref?: () => void }
}

export function startRnpWarmer(
  warm: () => Promise<void>,
  timers: Timers = globalThis as unknown as Timers,
): () => Promise<void> {
  let running: Promise<void> | null = null
  ;(globalThis as WarmFlag)[FIRST_WARM] = true
  const tick = (): Promise<void> => {
    if (running) return running
    const started = Date.now()
    running = warm()
      .then(() => logger.info({ ms: Date.now() - started }, 'rnp warmed'))
      .catch((error: unknown) => logger.warn({ err: error }, 'rnp warm-up failed; the next tick tries again'))
      .finally(() => {
        running = null
        ;(globalThis as WarmFlag)[FIRST_WARM] = false
      })
    return running
  }
  void tick()
  timers.setInterval(() => void tick(), RNP_WARM_EVERY_MS).unref?.()
  return tick
}
