/**
 * Whether the deletion sweep should run on this tick.
 *
 * THE SWEEP USED TO PICK ITS HOUR FROM THE LAST DEPLOY. It fired on
 * `tick % SYNC_SWEEP_EVERY === 0`, and `tick` starts at zero with the process —
 * so a deploy at 11:00 Asia/Tashkent put the largest burst this integration
 * sends (~9 300 `crm.deal.list` invocations, all 464 000 deal ids) at 11:00
 * every day after it. Every OVERLOAD_LIMIT block on obey.bitrix24.kz landed
 * between 10:50 and 11:59, when the client's own floor works `crm.deal.*`
 * hardest and the method's basket is shared with them.
 *
 * The same counter hid a second fault: with a deploy most days the worker never
 * lived to tick 720, so the sweep did not run at all and a deleted deal stayed
 * counted indefinitely.
 *
 * So the sweep is pinned to one wall-clock hour of the portal's night, and
 * `lastSweepAt` is only this process's memory. A restart inside the hour can
 * cost a second sweep; nobody deploys at 03:00, and an idempotent anti-join run
 * twice on an empty portal is the cheap side of that trade against a migration.
 */

/** Asia/Tashkent has been UTC+5 with no DST since 1992. */
const TASHKENT_OFFSET_MS = 5 * 3_600_000

/** Longer than the window, shorter than a day: once per night. */
const MIN_GAP_MS = 20 * 3_600_000

export function sweepDue(
  now: Date,
  lastSweepAt: Date | null,
  /** Hour of the Asia/Tashkent day, 0-23. Anything else switches the sweep off. */
  hour: number,
): boolean {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false
  if (new Date(now.getTime() + TASHKENT_OFFSET_MS).getUTCHours() !== hour) return false
  return lastSweepAt === null || now.getTime() - lastSweepAt.getTime() >= MIN_GAP_MS
}
