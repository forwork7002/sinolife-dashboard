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
 * EVERY WINDOW, NOT ONLY «BUGUN». The first version wrote the words for the
 * today preset alone and left the rest to PageShell's `formatDate`, which is
 * `Intl` with 'uz' short months — so in the television's Chromium «Shu oy»
 * read «1-sen 2026 – 17-sen 2026», where the mock prints «1–17 sentabr 2026»
 * (premium review, 2026-09-17). `rangeDateLine` is that line from the same
 * tables.
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

/**
 * Any other window, in the mock's words (EFIR Premium spec §7):
 *
 *   one day            «16-sentabr 2026, chorshanba»
 *   within a month     «1–17 sentabr 2026»
 *   within a year      «28 avgust – 3 sentabr 2026»
 *   across a year      «28 dekabr 2025 – 3 yanvar 2026»
 *
 * `end` is the window's EXCLUSIVE bound, as the API sends it (Tashkent
 * midnight after the last day); the last day printed is the instant before
 * it — PageShell's own reading of the same field.
 */
export function rangeDateLine(startIso: string, endIsoExclusive: string): string {
  const a = tashkentParts(startIso)
  const b = tashkentParts(new Date(new Date(endIsoExclusive).getTime() - 1).toISOString())
  const month = (m: number) => UZ_MONTHS[m - 1] ?? ''
  if (a.year === b.year && a.month === b.month && a.day >= b.day) {
    return `${a.day}-${month(a.month)} ${a.year}, ${UZ_WEEKDAYS[a.weekday] ?? ''}`
  }
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${month(a.month)} ${a.year}`
  if (a.year === b.year) return `${a.day} ${month(a.month)} – ${b.day} ${month(b.month)} ${a.year}`
  return `${a.day} ${month(a.month)} ${a.year} – ${b.day} ${month(b.month)} ${b.year}`
}
