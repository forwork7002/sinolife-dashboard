/**
 * What the telephony data can honestly be asked, and how a call's length is
 * banded.
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
 * window and builds its `CASE` from the bands, and the screen draws its labels
 * and colours from the same table. A business definition must not have two
 * homes — the arrangement `logisticsBuckets.ts` and `customerStates.ts` already
 * use. `src/lib` is client-safe (no server imports).
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

export interface CallDurationBand {
  readonly key: string
  /** EXCLUSIVE upper bound in seconds. `null` on the last band only. */
  readonly maxSec: number | null
  readonly label: string
  /** A CSS custom property from `globals.css`. */
  readonly colour: string
}

/**
 * Six bands, because the mean call is 3.2x the median and neither figure
 * explains the other.
 *
 * Measured above the floor on 2026-09-16 (3 261 connected calls — one whole
 * working day and part of the next, so a small sample whose shape matched a
 * wider, partly truncated one to within a few points): 169 s mean against a
 * 53 s median, with 8.4% of calls running past ten minutes and holding 50% of
 * all talk time. An average alone tells a ROP that a typical call runs nearly
 * three minutes when half of them end inside a minute. The distribution is what makes both readable,
 * and it is what the client asked for by «call duration toʻliq malumot».
 *
 * `colour` follows the entity, never its rank (docs/DESIGN.md) — one ramp from
 * short to long, fixed per band and never reassigned by size.
 */
export const CALL_DURATION_BANDS = [
  { key: 'S0', maxSec: 10, label: '0-9 s', colour: '--series-1' },
  { key: 'S10', maxSec: 30, label: '10-29 s', colour: '--series-2' },
  { key: 'S30', maxSec: 60, label: '30-59 s', colour: '--series-3' },
  { key: 'M1', maxSec: 180, label: '1-3 daq', colour: '--series-4' },
  { key: 'M3', maxSec: 600, label: '3-10 daq', colour: '--series-5' },
  { key: 'M10', maxSec: null, label: '10+ daq', colour: '--series-6' },
] as const satisfies readonly CallDurationBand[]

export interface CallCustomerBand {
  readonly key: string
  /** INCLUSIVE upper bound in calls. `null` on the last band only. */
  readonly maxCalls: number | null
  readonly label: string
}

/**
 * How many calls one customer takes.
 *
 * INCLUSIVE bounds here, unlike the duration bands: a call count is a small
 * whole number a reader counts on their fingers, and «2-3» is the label they
 * expect to mean two or three. Measured above the floor on 2026-09-16: 5 476
 * customers called once, 1 495 two or three times, 246 four or five, 138 six or
 * more.
 */
export const CALL_CUSTOMER_BANDS = [
  { key: 'C1', maxCalls: 1, label: '1' },
  { key: 'C2', maxCalls: 3, label: '2-3' },
  { key: 'C4', maxCalls: 5, label: '4-5' },
  { key: 'C6', maxCalls: null, label: '6+' },
] as const satisfies readonly CallCustomerBand[]

/**
 * Which side of the base a call landed on — decided at the moment of the call.
 *
 * «Baza» means the customer had a База deal created BEFORE the call started.
 * Membership TODAY would move 376 calls (~9% of the База side, measured over
 * 2026-09-13 → 09-16 — a membership question, which the truncation does not
 * touch) across: a lead rung on Monday who buys on Friday enters База
 * afterwards, and "today" would retroactively make Monday's call a База call.
 *
 * The split is informative where the customer-level one is not. Above the
 * floor a typical call to a База customer runs 86 s against 46 s for everyone
 * else, and it is nearly a team split — Baza(ROP) places 88% of the База calls.
 *
 * Colours are unique within the card that draws them. This screen carries
 * eleven categorical entities and the palette has eight tokens, one of them the
 * red reserved for «Yoʻqotilgan». `--ink-muted` for the unlinked side, because
 * it is not a kind of customer.
 */
export const CALL_SIDES = [
  { key: 'BAZA', label: 'Baza mijozi', colour: '--series-1' },
  { key: 'NOT_BAZA', label: 'Baza emas', colour: '--series-2' },
  { key: 'UNLINKED', label: 'Mijozga bogʻlanmagan', colour: '--ink-muted' },
] as const satisfies readonly { key: string; label: string; colour: string }[]

export type CallSideKey = (typeof CALL_SIDES)[number]['key']
