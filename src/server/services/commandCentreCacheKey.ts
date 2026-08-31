import type { Period } from '@/server/domain/period/period'

/**
 * The key one command-centre build is stored under.
 *
 * Its own module because it is the one part of that service worth testing on
 * its own, and importing the service reaches the container, Prisma and the
 * environment — a unit test should not need a database to check a string.
 *
 * THE PRESET IS PART OF THE KEY, and leaving it out was a real bug. Two
 * presets can resolve to the same window and still want different
 * comparisons: every Monday "Bugun" and "Shu hafta" are both
 * [Mon 00:00, Tue 00:00), but `previousEquivalent` switches on the PRESET —
 * today looks back one day, this week one week. Keyed on the window alone
 * they shared an entry, so whichever was opened first inside the 45-second
 * window served the other its neighbour's "oʻtgan davrda" line, its delta
 * arrows and the reference line on its chart. Clicking from "Bugun" to
 * "Shu hafta" is exactly that interaction, and it was reproduced both ways
 * on the live app: this week showed 78 where 103 was right, today showed 103
 * where 78 was right.
 *
 * The same collision hit "Oʻtgan oy" against a custom range covering the same
 * days, where an anchored calendar comparison was replaced by a rolling one.
 */
export function commandCentreCacheKey(
  period: Pick<Period, 'preset' | 'start' | 'end'>,
  currency: string,
): string {
  return [
    period.preset,
    period.start.toISOString(),
    period.end.toISOString(),
    currency,
  ].join('|')
}
