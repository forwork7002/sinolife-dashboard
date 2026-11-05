/**
 * KECHIKISH JARIMASI — the owner, 2026-11-05: «sotuvchilar oyligida
 * hisoblashingda … har bir kechikkan minutiga 1 somdan jarima bo'ladi».
 *
 * THE FACTS ARE TIMEPAY'S, THE RULE IS OURS. TimePay (the company's FaceID
 * attendance, timepay24.uz) says per person per day whether they were late
 * and by how many minutes against their own shift (`late`, `late_minutes` —
 * 08:30 for almost everyone). Which of those days a fine is taken for is
 * decided here, and it is «Otsenka ROP app»'s «Kechikdi» rule
 * (`packages/shared/src/formulas/attendance.ts` `attState`), so the minutes a
 * ROP sees on the attendance board and the minutes the payroll fines are one
 * number:
 *
 *   - Sunday and the company's holidays are not workdays. TimePay marks
 *     EVERY day a workday for everyone, so a Sunday arrival would read late.
 *   - Leave (`on_leave`) is not a workday.
 *   - No arrival mark, no lateness: an absent FaceID mark is not «late».
 *   - Otherwise TimePay's minutes, from the first minute (Otsenka's
 *     `ATTENDANCE.lateFromMinutes` = 1).
 *
 * THE FINE COMES OFF «JAMI», NEVER OFF FAKT 2. The tier a seller reaches is
 * still FAKT 2's; the fine is subtracted from what the tier pays, and pay is
 * never negative.
 */

/** 1 soʻm per late minute, in minor units (tiyin) like every amount here. */
export const LATE_FINE_PER_MINUTE_MINOR = 100n

/**
 * The company's days off besides Sundays — «Otsenka ROP app»'s
 * `DEFAULT_CALENDAR.holidays`, restated. Edit both.
 */
export const COMPANY_HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-01-01',
  '2026-01-02',
  '2026-03-08',
  '2026-03-20',
  '2026-03-21',
  '2026-03-22',
  '2026-05-09',
  '2026-09-01',
  '2026-10-01',
  '2026-12-08',
])

/** One person's day as stored from TimePay (`timepay_day`). */
export interface LateDay {
  /** The Tashkent calendar day, `YYYY-MM-DD`. */
  readonly day: string
  /** First arrival, «HH:MM»; null — no arrival mark. */
  readonly checkIn: string | null
  /** TimePay's minutes late, 0 when it does not say late. */
  readonly lateMinutes: number
  /** TimePay's own holiday flag. */
  readonly holiday: boolean
  readonly onLeave: boolean
}

/** Whether a calendar day is a company workday: Monday to Saturday, not a holiday. */
export function isWorkday(day: string): boolean {
  if (COMPANY_HOLIDAYS.has(day)) return false
  return new Date(`${day}T12:00:00Z`).getUTCDay() !== 0
}

/**
 * Why a day TimePay calls late is NOT fined, or null when it is — the
 * proof list on «Sotuvchilar oyligi» prints the reason beside the day, so a
 * seller who came late on a Sunday sees why nothing was taken.
 */
export type LateSkip = 'sunday' | 'holiday' | 'leave' | 'no_mark'

export function lateSkipOf(d: LateDay): LateSkip | null {
  if (d.checkIn === null) return 'no_mark'
  if (d.onLeave) return 'leave'
  if (COMPANY_HOLIDAYS.has(d.day) || d.holiday) return 'holiday'
  if (!isWorkday(d.day)) return 'sunday'
  return null
}

/** The minutes of one day a fine is taken for — see the rule above. */
export function fineableMinutes(d: LateDay): number {
  if (lateSkipOf(d) !== null) return 0
  return Number.isFinite(d.lateMinutes) && d.lateMinutes >= 1 ? Math.floor(d.lateMinutes) : 0
}

/**
 * When the shift started, read back from TimePay's own figures: the arrival
 * less the minutes it called late («08:46» − 16 → «08:30»). TimePay counts
 * whole minutes (08:31 → 1, 08:46 → 16, checked 2026-11-05), so this is the
 * start it measured against. Null when the arrival is unreadable.
 */
export function shiftStartOf(checkIn: string, lateMinutes: number): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(checkIn)
  if (!m) return null
  const at = Number(m[1]) * 60 + Number(m[2]) - Math.max(0, Math.floor(lateMinutes))
  if (at < 0) return null
  return `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`
}

/** The fine for a number of late minutes, in minor units. */
export function lateFineMinor(minutes: number): bigint {
  return minutes > 0 ? BigInt(minutes) * LATE_FINE_PER_MINUTE_MINOR : 0n
}

/** What is paid once the fine is taken off: never below zero. */
export function netOfFine(totalMinor: bigint, fineMinor: bigint): bigint {
  const net = totalMinor - fineMinor
  return net > 0n ? net : 0n
}
