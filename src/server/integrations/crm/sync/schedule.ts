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
 * How long a FAILED sweep waits before it is tried again.
 *
 * On the tick counter a failure simply waited out the next full period. On a
 * wall clock with no record of the failure it would be due again on the very
 * next tick — ~186 requests and ~9 300 invocations every two minutes into a
 * portal that has just refused one. An hour is long enough that a refusal
 * cannot turn into a loop and short enough that a blip does not cost a day.
 */
export const SWEEP_RETRY_MS = 60 * 60_000
