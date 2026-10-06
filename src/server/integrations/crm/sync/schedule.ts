import type { SyncEntityValue } from '@/server/domain/types'

import type { SyncResult } from './SyncEngine'

/**
 * When a slow-clock pass (reference data, the deletion sweep) is next due.
 *
 * A TICK COUNTER RESETS ON EVERY DEPLOY, AND THE PORTAL PAID FOR IT. Both
 * passes were scheduled as `tick % N === 0`, and `tick` starts at zero in every
 * new process. So every deploy ran the reference pass again — 24 hours to
 * 2026-09-17 logged SIXTEEN `DEPARTMENTS` passes against the eight the
 * three-hourly clock allows, each one EMPLOYEES 15.5 s and PRODUCTS 14 s of
 * portal time — and the daily sweep, which needs 720 unbroken ticks, never ran
 * at all on a day with more than one deploy. The load on Bitrix24 grew with
 * how often somebody shipped a change, which is not a number anybody controls.
 *
 * The clock is now the database's record of when the pass last RAN, read once
 * at startup, so a restart inherits it and a deploy costs the portal nothing.
 */
export function isPassDue(
  lastRun: Date | null,
  now: Date,
  everyMs: number,
): boolean {
  // Switched off.
  if (!Number.isFinite(everyMs) || everyMs <= 0) return false

  // Never recorded: a cold database, or the first start after this shipped.
  if (lastRun === null) return true

  /*
    A RECORD FROM THE FUTURE IS NOT A REASON TO WAIT FOREVER. Worker and
    database clocks can disagree by seconds; a row stamped ahead of `now`
    reads as «just ran», never as «wait until that moment and then N more».
  */
  const elapsed = Math.max(0, now.getTime() - lastRun.getTime())
  return elapsed >= everyMs
}

/**
 * How long after one pass that could resolve a skipped deal the next may run.
 *
 * A DEALS run SKIPS a deal whose employee or stage it does not know yet — a
 * seller hired, a stage added since the last reference pass — and the
 * reference pass is three-hourly (`REFERENCE_EVERY` 180, 2026-09-16). The
 * watermark rewinds 95 minutes for DEALS and 35 for STAGE_HISTORY after a skip
 * (`SKIP_LOOKBACK_MS`), so waiting for the scheduled pass let the deal, and the
 * C4:NEW arrival it brought, fall out of both windows for good. A skip now
 * brings the resolving entities forward instead; twenty minutes plus a tick
 * stays inside the thirty-five, and bounds what a skip that never resolves (a
 * deal assigned to somebody the portal no longer lists) can cost: one small
 * pass per twenty minutes, while the deal is still being re-read.
 */
export const RESOLVE_GAP_MS = 20 * 60_000

/**
 * Whether a DEALS run's skips should bring the reference data forward.
 *
 * `lastPasses` are the passes that re-read it — the scheduled reference pass
 * and the forced one — and only the newest counts: a skip seconds after a
 * pass that already re-read everything waits for the gap rather than asking
 * the same question again.
 */
export function isResolvePassDue(
  dealsSkipped: number,
  lastPasses: readonly (Date | null)[],
  now: Date,
): boolean {
  if (dealsSkipped <= 0) return false
  const times = lastPasses.filter((at): at is Date => at !== null).map((at) => at.getTime())
  return isPassDue(times.length > 0 ? new Date(Math.max(...times)) : null, now, RESOLVE_GAP_MS)
}

/**
 * What a deal the DEALS pass had to SKIP is waiting for — run ahead of the
 * schedule when it skips (`isResolvePassDue`), on the worker's next tick.
 *
 * A deal is skipped when its employee or its stage is unknown, and both arrive
 * only with the reference pass, every three hours — well past the 95 / 35
 * minutes the watermark rewinds after a skip. So a seller hired at ten whose
 * first order went straight into C4:NEW lost the deal row until somebody
 * touched it again and the arrival row for good: off Тасдиқлаш and FAKT 1, the
 * bug class of 935632 and 1050732. SOURCES rides along because it is one
 * request.
 *
 * DEPARTMENTS LEADS IT, as it leads the full pass, for the reason
 * `pendingHeads` in handlers.ts gives: an employee points at a unit. The
 * EMPLOYEES pass writes each person's unit — NULL when it does not resolve —
 * and REPLACES their memberships with the units that do, so run without it
 * during a reorganisation it took everybody in a unit newer than the last full
 * pass out of that unit for up to three hours. It costs one `department.get`.
 * And because this list now opens the way the full pass does, the full pass is
 * dated at startup by `REFERENCE_MARKER`, not by its first entity.
 */
export const RESOLVE: readonly SyncEntityValue[] = ['DEPARTMENTS', 'EMPLOYEES', 'STAGES', 'SOURCES']

/**
 * The entity whose `sync_log` row dates the full reference pass when the next
 * process starts: one of the worker's `REFERENCE` that `RESOLVE` never runs, so
 * a forced pass is never read back as the scheduled one — which would put the
 * full pass off for three hours after every skip.
 *
 * It was `REFERENCE[0]`, DEPARTMENTS, until that opened `RESOLVE` too.
 * PRODUCTS comes two entities later, seconds on a three-hour clock, and its row
 * is written whatever became of the two before it: `runAll` runs every entity
 * in turn.
 */
export const REFERENCE_MARKER: SyncEntityValue = 'PRODUCTS'

/**
 * Which slow pass a tick runs ahead of the hot entities, and what it leaves
 * owed for a later tick. Taken out of the worker's loop so it can be pinned.
 *
 * Inside the calm after an outage (`CALM_TICKS`) neither runs and both stay
 * owed: the portal has only just started answering again. The full pass
 * re-reads everything `RESOLVE` does, so it settles a forced pass owed beside
 * it — the forced one never rides a tick that runs the full one.
 */
export function planTick(state: {
  /** The scheduled pass is due, or one fell inside the calm. */
  readonly referenceDue: boolean
  /** A DEALS run skipped and asked for `RESOLVE` (`isResolvePassDue`). */
  readonly resolveOwed: boolean
  /** Hot-only ticks still to run after a recovery. */
  readonly calm: number
}): {
  readonly reference: boolean
  readonly resolve: boolean
  readonly referenceOwed: boolean
  readonly resolveOwed: boolean
} {
  const calm = state.calm > 0
  const reference = state.referenceDue && !calm
  const resolve = state.resolveOwed && !calm && !reference
  return {
    reference,
    resolve,
    referenceOwed: state.referenceDue && calm,
    resolveOwed: state.resolveOwed && calm,
  }
}

/**
 * How long a FAILED sweep waits before it is tried again.
 *
 * On the tick counter a failure simply waited out the next full period. On a
 * wall clock with no record of the failure it would be due again on the very
 * next tick — ~186 requests and ~9 300 invocations every two minutes into a
 * portal that has just refused one. An hour is long enough that a refusal
 * cannot turn into a loop and short enough that a blip does not cost a day.
 */
export const SWEEP_RETRY_MS = 60 * 60_000

/**
 * A one-off re-read of recent deals, requested in code when a new deal column
 * lands — «Target tahlili»'s `targetolog`, `creative` and `primarySource` on
 * 2026-09-19. Without it those columns fill only on deals the portal happens
 * to touch again, and last month's leads stay «Koʻrsatilmagan» forever.
 */
export interface DealsBackfill {
  /** Tashkent midnight of the first day to re-read (by DATE_MODIFY). */
  readonly since: Date
  /** When it was asked for; a success logged after this settles it. */
  readonly requestedAt: Date
}

/**
 * A request nobody has served in two weeks is dropped, not kept alive.
 *
 * Shorter than `sync_log`'s 30-day retention on purpose: the success row that
 * settles a request must outlive the request, or a pruned log would re-run it.
 */
const BACKFILL_EXPIRES_MS = 14 * 86_400_000

/**
 * The night hours a backfill may run in, Tashkent time: [01:00, 06:00).
 *
 * A windowed re-read is thousands of invocations the minute tick would never
 * spend. Bitrix24's OVERLOAD_LIMIT is portal-wide and shared with the client's
 * other integrations, and both blocks we have seen came in working hours — so
 * the one expensive thing we choose to do, we do while the floor is asleep.
 */
const BACKFILL_NIGHT = { fromHour: 1, toHour: 6 } as const

function hourIn(now: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
  )
}

/** Whether the backfill should run on this tick. */
export function isBackfillDue(
  backfill: DealsBackfill | null,
  settled: boolean,
  now: Date,
  timeZone: string,
  lastFailedAt: Date | null,
): boolean {
  if (backfill === null || settled) return false
  if (now.getTime() - backfill.requestedAt.getTime() > BACKFILL_EXPIRES_MS) return false
  const hour = hourIn(now, timeZone)
  if (hour < BACKFILL_NIGHT.fromHour || hour >= BACKFILL_NIGHT.toHour) return false
  // A refusal waits an hour, the sweep's rule — never a retry on the next tick.
  return lastFailedAt === null || now.getTime() - lastFailedAt.getTime() >= SWEEP_RETRY_MS
}

/**
 * A one-off read — the night backfill, a `ONE_OFF_READS` entry — run so that
 * nothing it throws reaches the tick loop.
 *
 * `runEntity` reports a failed fetch or write in its result, but its own
 * bookkeeping — `beginRun`, `setCursor` (a CUSTOMERS FULL), `finishRun` — is a
 * bare database write, and these were the two awaited calls in the worker's
 * loop with no catch: a connection dropped by a managed-Postgres failover in
 * the night window rejected into `main().catch` and exited the worker.
 * SETTLED is SUCCESS or PARTIAL, as it always was — a skipped deal is one the
 * portal no longer resolves, and re-reading the window would skip it again.
 */
export async function runOneOff(
  run: () => Promise<SyncResult>,
): Promise<{ readonly settled: true; readonly result: SyncResult } | { readonly settled: false; readonly reason: string }> {
  try {
    const result = await run()
    if (result.status === 'SUCCESS' || result.status === 'PARTIAL') return { settled: true, result }
    return { settled: false, reason: result.errorMessage ?? result.status }
  } catch (error) {
    return { settled: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
