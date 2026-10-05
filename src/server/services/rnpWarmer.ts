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

interface Timers {
  setInterval(fn: () => void, ms: number): { unref?: () => void }
}

export function startRnpWarmer(
  warm: () => Promise<void>,
  timers: Timers = globalThis as unknown as Timers,
): () => Promise<void> {
  let running: Promise<void> | null = null
  const tick = (): Promise<void> => {
    if (running) return running
    const started = Date.now()
    running = warm()
      .then(() => logger.info({ ms: Date.now() - started }, 'rnp warmed'))
      .catch((error: unknown) => logger.warn({ err: error }, 'rnp warm-up failed; the next tick tries again'))
      .finally(() => {
        running = null
      })
    return running
  }
  void tick()
  timers.setInterval(() => void tick(), RNP_WARM_EVERY_MS).unref?.()
  return tick
}
