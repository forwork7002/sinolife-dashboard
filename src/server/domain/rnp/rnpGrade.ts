/**
 * «Баҳо» — a ROP team's grade for a day, from its «Сумма факт 1» that day
 * (the client, 2026-10-03). Each kind of team has its own scale, in soʻm:
 *
 *   Collagen первичка (Азизбек, Лола, Севинч, Мафтуна, Саидазиз, Гулзора,
 *   Шохжахон, Маржона, Ҳаёт):  < 20 M → 2, 20–35 M → 3, 35–50 M → 4, 50 M+ → 5
 *   Zextra (Аслиддин, Садриддин): < 25 M → 2, 25–40 M → 3, 40–60 M → 4, 60 M+ → 5
 *   Collagen БАЗА (Фаррух) and Zextra БАЗА (Малика), one scale:
 *                                 < 15 M → 2, 15–25 M → 3, 25–35 M → 4, 35 M+ → 5
 *
 * A bound belongs to the grade above it: 20 000 000 exactly is a 3. The
 * client wrote Zextra's 4 as «45–60 M» after «25–40 M»; the gap is closed at
 * 40 M. A day with no FAKT 1 (a day off) has no grade — it is not a 2 — and
 * the month is the mean of the days that have one.
 *
 * Pure: no framework, no database.
 */

/** The FAKT 1 a day needs for a 3, a 4 and a 5, in whole soʻm. */
export type RnpGradeScale = readonly [three: number, four: number, five: number]

const COLLAGEN_PRIMARY: RnpGradeScale = [20_000_000, 35_000_000, 50_000_000]
const ZEXTRA: RnpGradeScale = [25_000_000, 40_000_000, 60_000_000]
const BASE: RnpGradeScale = [15_000_000, 25_000_000, 35_000_000]

/** By department (`rop`). A team not named here has no scale, and its row stays empty. */
export const RNP_GRADE_SCALES: Readonly<Record<string, RnpGradeScale>> = Object.freeze({
  Azizbek: COLLAGEN_PRIMARY,
  Lola: COLLAGEN_PRIMARY,
  Sevinch: COLLAGEN_PRIMARY,
  Maftuna: COLLAGEN_PRIMARY,
  Saidaziz: COLLAGEN_PRIMARY,
  Gulzora: COLLAGEN_PRIMARY,
  Shohjaxon: COLLAGEN_PRIMARY,
  Marjona: COLLAGEN_PRIMARY,
  Hayot: COLLAGEN_PRIMARY,
  Asliddin: ZEXTRA,
  Sadriddin: ZEXTRA,
  Baza: BASE,
  Charos: BASE,
})

/** The day's grade, 2–5; null for a day with no FAKT 1. */
export function rnpDayGrade(fakt1Som: number, [three, four, five]: RnpGradeScale): number | null {
  if (!(fakt1Som > 0)) return null
  if (fakt1Som >= five) return 5
  if (fakt1Som >= four) return 4
  if (fakt1Som >= three) return 3
  return 2
}

const mln = (som: number) => `${som / 1_000_000} mln`

/** The scale in words, for the row's hint. */
export function rnpGradeScaleText([three, four, five]: RnpGradeScale): string {
  return `${mln(three)} gacha — 2, ${mln(three)}–${mln(four)} — 3, ${mln(four)}–${mln(five)} — 4, ${mln(five)} dan — 5`
}
