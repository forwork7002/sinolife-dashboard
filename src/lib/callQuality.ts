/**
 * What the telephony data can honestly be asked.
 *
 * WHY A DATA FLOOR EXISTS, AND WHY IT IS A DATE RATHER THAN A FILTER ON THE
 * ROW. Every call imported between 2026-08-28 and 11:00 Tashkent on 2026-09-14
 * carries a duration that had not finished happening. The per-minute incremental pass
 * read `voximplant.statistic.get` from its own watermark, which picks a call
 * up while it is still ringing or still being spoken; `CALL_DURATION` is then
 * whatever has elapsed, the watermark advances past that call's start, and the
 * row is never re-read. The symptom is a per-day ceiling of roughly one sync
 * interval — a week of 26 511 calls whose longest conversation was six minutes
 * — and a connected share of 11.6% against a normal 31%, because a leg caught
 * mid-dial has not been given its code 200 either.
 *
 * So BOTH measures are wrong in that window, not just the duration, and no
 * predicate on the row can tell a truncated call from a genuinely short one. A
 * date is the only honest discriminator.
 *
 * THE BOUNDARY IS AN HOUR, AND THE FLOOR IS THE NEXT WHOLE DAY. Measured per
 * Tashkent hour: the import lag is one to three minutes on every hour up to
 * 10:00 on 2026-09-14 and jumps to 256 minutes at 11:00 — that is `CALLS`
 * leaving the per-minute list for the half-hourly reference pass (done for the
 * portal's overload, not for this). The maximum duration jumps with it, 126 s
 * to 1 677 s. The floor sits at the following midnight rather than at 11:00, so
 * no bucket on the daily chart is half truncated and reads as a dip.
 * `SETTLE_LOOKBACK_MS` in `SyncEngine.ts` is what stops it ever moving again.
 *
 * A first reading put the boundary a day and a half earlier. That probe
 * bucketed with the one-step `AT TIME ZONE 'Asia/Tashkent'`, which reads this
 * naive UTC column as Tashkent local — the trap CLAUDE.md's third rule names.
 *
 * The truncated days stay wrong in `call_record`. The client chose the floor over
 * a ~7 000-request portal re-read; correcting them later needs no code, only a
 * full CALLS pass and one edit here.
 *
 * WHY IT LIVES IN `src/lib`. Both sides read it: the repository clamps its
 * window at the floor, and the screen names the same date when the clamp bit.
 * A business definition must not have two homes. `src/lib` is client-safe (no
 * server imports).
 */

/**
 * Tashkent midnight on 2026-09-15, as a UTC instant.
 *
 * Written out rather than computed from a timezone library: this is a fact
 * about one past date, and `Asia/Tashkent` has been UTC+5 with no DST since
 * 1992. Computing it would make a constant depend on a lookup table.
 */
export const CALL_DATA_FLOOR = new Date('2026-09-14T19:00:00.000Z')

/** The lower bound a call query may actually use, whatever was asked for. */
export function callWindowStart(start: Date): Date {
  return start < CALL_DATA_FLOOR ? CALL_DATA_FLOOR : start
}

/**
 * Whether the reader is being shown less than they asked for.
 *
 * STRICTLY below, so a window starting exactly on the floor prints no caveat: a
 * reader who asked for the first honest day got the day they asked for.
 */
export function callFloorApplied(start: Date): boolean {
  return start < CALL_DATA_FLOOR
}
