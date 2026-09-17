/**
 * The title line's date on the «Bugun» board — «17-sentabr 2026, payshanba · bugun»
 * (EFIR Premium spec §7).
 *
 * THE WEEKDAY IS COMPUTED, NEVER TYPED. `Intl.DateTimeFormat('uz', { weekday:
 * 'long', timeZone: 'Asia/Tashkent' })` names the day the SERVER's window
 * starts on, read in the reporting timezone — so a television whose clock or
 * zone is wrong still prints the floor's day, and a window that starts at
 * Tashkent midnight (19:00 UTC the evening before) is never named after the
 * day before it.
 *
 * Only the `today` preset reads this; every other window keeps the shell's
 * own «1-sen 2026 – 17-sen 2026» range.
 */
const ZONE = 'Asia/Tashkent'

const WEEKDAY = new Intl.DateTimeFormat('uz', { weekday: 'long', timeZone: ZONE })
const DATE = new Intl.DateTimeFormat('uz', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONE })

/** «payshanba» for any instant on 2026-09-17 in Tashkent. */
export function weekdayOf(iso: string): string {
  return WEEKDAY.format(new Date(iso))
}

/** «17-sentabr 2026, payshanba · bugun». */
export function todayDateLine(iso: string): string {
  const parts = DATE.formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('day')}-${part('month')} ${part('year')}, ${weekdayOf(iso)} · bugun`
}
