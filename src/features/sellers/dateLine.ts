/**
 * The title line's date on the «Bugun» board — «17-sentabr 2026, payshanba · bugun»
 * (EFIR Premium spec §7).
 *
 * THE WEEKDAY IS COMPUTED, NEVER TYPED. It names the day the SERVER's window
 * starts on, read in the reporting timezone — so a television whose clock or
 * zone is wrong still prints the floor's day, and a window that starts at
 * Tashkent midnight (19:00 UTC the evening before) is never named after the
 * day before it.
 *
 * THE NAMES ARE A TABLE, NOT AN `Intl.DateTimeFormat('uz')` LOOKUP. That is
 * how this line was first written, and in Chromium — the browser the
 * television runs — it printed «17-M09 2026, Thu · bugun»: its ICU build
 * carries no Uzbek month or weekday names, so the CLDR fallback renders the
 * literal pattern and the English day. Node's full ICU hid it from the test
 * suite; the real-data audit found it on 2026-09-17. `src/lib/format.ts`
 * learned the same thing about short months. `Intl` is still what reads the
 * calendar fields in Tashkent — from an `en-GB` formatter, whose numeric parts
 * and English weekday every ICU build carries — and the words come from here.
 *
 * Only the `today` preset reads this; every other window keeps the shell's
 * own «1-sen 2026 – 17-sen 2026» range.
 */
const ZONE = 'Asia/Tashkent'

/** Uzbek (Latin) month names, January first. The seat caption reads the same table. */
export const UZ_MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
] as const

/** Uzbek (Latin) weekday names, keyed by the English short name `en-GB` hands back. */
const UZ_WEEKDAYS: Readonly<Record<string, string>> = {
  Mon: 'dushanba',
  Tue: 'seshanba',
  Wed: 'chorshanba',
  Thu: 'payshanba',
  Fri: 'juma',
  Sat: 'shanba',
  Sun: 'yakshanba',
}

const PARTS = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  timeZone: ZONE,
})

function tashkentParts(iso: string): { day: number; month: number; year: string; weekday: string } {
  const parts = PARTS.formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    day: Number(part('day')),
    month: Number(part('month')),
    year: part('year'),
    weekday: part('weekday'),
  }
}

/** «payshanba» for any instant on 2026-09-17 in Tashkent. */
export function weekdayOf(iso: string): string {
  const { weekday } = tashkentParts(iso)
  return UZ_WEEKDAYS[weekday] ?? ''
}

/** «17-sentabr 2026, payshanba · bugun». */
export function todayDateLine(iso: string): string {
  const { day, month, year, weekday } = tashkentParts(iso)
  return `${day}-${UZ_MONTHS[month - 1] ?? ''} ${year}, ${UZ_WEEKDAYS[weekday] ?? ''} · bugun`
}
