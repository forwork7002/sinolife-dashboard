import type { MedalCode, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { formatSomFull } from '@/lib/format'

/**
 * Medal va daraja lug'atlari — frontend nusxasi.
 *
 * Mirrors `sellerMedals.ts` (`MEDAL_UNLOCK_LEVEL`, `MEDAL_ORDER`,
 * `LEVEL_TITLES`, `titleOf`, `romanOf`). Frontend server domenini import
 * qilmaydi (qatlam qoidasi), shuning uchun nusxa; hech narsa nusxani
 * tekshirmaydi — ikkala tomonni birga o'zgartiring.
 */
export type MedalFamily = 'oy' | 'seriya' | 'kun' | 'sifat' | 'osish'

export const MEDALS: Readonly<Record<MedalCode, { readonly name: string; readonly family: MedalFamily }>> =
  Object.freeze({
    'month-gold': { name: 'Oy chempioni', family: 'oy' },
    'month-silver': { name: 'Kumush oy', family: 'oy' },
    'month-bronze': { name: 'Bronza oy', family: 'oy' },
    'year-champion': { name: 'Yil chempioni', family: 'oy' },
    'streak-fire': { name: 'Olov seriyasi', family: 'seriya' },
    'streak-steady': { name: 'Barqaror', family: 'seriya' },
    'day-record': { name: 'Kun rekordi', family: 'kun' },
    'day-winner': { name: 'Kun gʻolibi', family: 'kun' },
    'conversion-master': { name: 'Konversiya ustasi', family: 'sifat' },
    'clean-month': { name: 'Toza oy', family: 'sifat' },
    jump: { name: 'Sakrash', family: 'osish' },
    rookie: { name: 'Yangi yulduz', family: 'osish' },
    'first-sale': { name: 'Birinchi savdo', family: 'osish' },
    'work-month': { name: 'Ishchan oy', family: 'osish' },
  })

export const FAMILY_NAMES: Readonly<Record<MedalFamily, string>> = Object.freeze({
  oy: 'Oy',
  seriya: 'Seriya',
  kun: 'Kun',
  sifat: 'Sifat',
  osish: 'Oʻsish',
})

/** Qaysi daraja qaysi medalni ochadi. Mirrors `sellerMedals.MEDAL_UNLOCK_LEVEL`. */
export const MEDAL_UNLOCK_LEVEL: Readonly<Record<MedalCode, number>> = Object.freeze({
  'first-sale': 1,
  'work-month': 1,
  'day-winner': 1,
  rookie: 1,
  'clean-month': 2,
  jump: 2,
  'day-record': 2,
  'month-bronze': 2,
  'month-silver': 2,
  'month-gold': 2,
  'conversion-master': 3,
  'streak-steady': 3,
  'streak-fire': 4,
  'year-champion': 5,
})

/** Chizilish tartibi. Mirrors `sellerMedals.MEDAL_ORDER`. */
export const MEDAL_ORDER: readonly MedalCode[] = Object.freeze([
  'year-champion',
  'month-gold',
  'streak-fire',
  'month-silver',
  'month-bronze',
  'streak-steady',
  'conversion-master',
  'day-record',
  'clean-month',
  'jump',
  'rookie',
  'day-winner',
  'work-month',
  'first-sale',
])

export interface LadderRung {
  readonly level: number
  readonly title: string
  /** Eski aytiladigan yorliq («10 mln») — `usePromotions.thresholdLabel` uni hali tashiydi. */
  readonly thresholdLabel: string
  /** Ostona so'mda — legenda va e'lon to'liq raqam yozadi (spec §1). Yangi — birinchi so'm, raqamsiz. */
  readonly thresholdSom: number | null
}

/** Mirrors `sellerMedals.LEVEL_THRESHOLDS_MINOR` / `LEVEL_TITLES`. */
export const LADDER: readonly LadderRung[] = Object.freeze([
  { level: 1, title: 'Yangi', thresholdLabel: 'birinchi soʻm', thresholdSom: null },
  { level: 2, title: 'Sotuvchi', thresholdLabel: '10 mln', thresholdSom: 10_000_000 },
  { level: 3, title: 'Katta sotuvchi', thresholdLabel: '30 mln', thresholdSom: 30_000_000 },
  { level: 4, title: 'Usta', thresholdLabel: '100 mln', thresholdSom: 100_000_000 },
  { level: 5, title: 'Ustoz', thresholdLabel: '300 mln', thresholdSom: 300_000_000 },
  { level: 6, title: 'Legenda', thresholdLabel: '1 mlrd', thresholdSom: 1_000_000_000 },
])

/** Legenda har keyingi milliardda II, III … Mirrors `sellerMedals.LEGENDA_STEP_MINOR`. */
export const LEGENDA_STEP_SOM = 1_000_000_000

/** Shu darajaning ostonasi so'mda; 1-darajada null (birinchi so'm), 6-darajada bosqich × 1 mlrd. */
export function thresholdSomOf(level: number, legendaTier: number): number | null {
  if (level >= 6) return Math.max(1, legendaTier) * LEGENDA_STEP_SOM
  return LADDER[level - 1]?.thresholdSom ?? null
}

export function romanOf(n: number): string {
  const table: readonly (readonly [number, string])[] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let rest = Math.max(0, Math.floor(n))
  let out = ''
  for (const [value, glyph] of table) {
    while (rest >= value) {
      out += glyph
      rest -= value
    }
  }
  return out
}

/** «Ustoz», «Legenda II»; 0-darajada null. Mirrors `sellerMedals.titleOf`. */
export function levelTitle(level: number, legendaTier: number): string | null {
  const rung = LADDER[level - 1]
  if (!rung) return null
  return level === 6 && legendaTier > 1 ? `${rung.title} ${romanOf(legendaTier)}` : rung.title
}

/**
 * Jo'nalish kelishigi: «Ustozga», «Katta sotuvchiga», «Legenda II ga».
 * Rim raqami bilan tugagan unvonda qo'shimcha alohida — «IIga» o'qilmaydi.
 */
export function dativeOf(title: string): string {
  return /\s[IVXLCDM]+$/.test(title) ? `${title} ga` : `${title}ga`
}

/* ---------------------------------------------------------------------------
 * EFIR — belgi xaritasi va tartib (spec §3). Mirrors `gen_efir.py`
 * (MEDAL_SYM, MONTH_NUM, RARE, HIDE_IN_ROWS) — mock va taxta bir xil chizsin.
 * ------------------------------------------------------------------------- */

export type Metal = 'gold' | 'silver' | 'bronze'

/** Nodir yettilik — faqat qorong'i sahnada yumshoq oltin soya (`.medal.rare`). */
export const RARE_MEDALS: ReadonlySet<MedalCode> = new Set<MedalCode>([
  'year-champion',
  'month-gold',
  'month-silver',
  'month-bronze',
  'day-record',
  'conversion-master',
  'streak-fire',
])

/** Qatorda chizilmaydiganlar: 100 dan 92 tasida bor nishon nishon emas. O'rindiqda bor. */
export const HIDDEN_IN_ROWS: readonly MedalCode[] = Object.freeze(['first-sale'])

/** Kod → mock `<defs>` dagi belgi. Oy oilasi bitta diskni bo'lishadi; raqam `MONTH_NUMERAL` dan. */
export const MEDAL_SYMBOL: Readonly<Record<MedalCode, string>> = Object.freeze({
  'month-gold': 'm-month',
  'month-silver': 'm-month',
  'month-bronze': 'm-month',
  'year-champion': 'm-year',
  'streak-fire': 'm-fire',
  'streak-steady': 'm-steady',
  'day-record': 'm-bolt',
  'day-winner': 'm-sun',
  'conversion-master': 'm-target',
  'clean-month': 'm-shield',
  jump: 'm-jump',
  rookie: 'm-star',
  'first-sale': 'm-sprout',
  'work-month': 'm-cal',
})

/** Oy diskiga o'yiladigan raqam — 1/2/3. */
export const MONTH_NUMERAL: Readonly<Partial<Record<MedalCode, '1' | '2' | '3'>>> = Object.freeze({
  'month-gold': '1',
  'month-silver': '2',
  'month-bronze': '3',
})

/** Oy oilasi O'Z metallida, qolgan 11 kod oltin (spec §3). */
export function metalOfMedal(code: MedalCode): Metal {
  if (code === 'month-silver') return 'silver'
  if (code === 'month-bronze') return 'bronze'
  return 'gold'
}

/** `MEDAL_ORDER` bo'yicha (eng nodir avval), `hide` dagilar tashlab yuboriladi; kirish o'zgarmaydi. */
export function sortMedals(
  medals: readonly SellerMedalDto[],
  hide: readonly MedalCode[] = [],
): readonly SellerMedalDto[] {
  return medals
    .filter((m) => !hide.includes(m.code))
    .slice()
    .sort((a, b) => MEDAL_ORDER.indexOf(a.code) - MEDAL_ORDER.indexOf(b.code))
}

/**
 * Keyingi darajagacha bosib o'tilgan yo'l, 0,03…1 ga qisilgan (spec §4).
 *
 * PASTDAN 0,03: bo'sh yo'l bilan «endigina boshlandi» bir xil ko'rinmasin —
 * uch foiz 10 px yo'lda ko'rinadigan eng kichik uch. YUQORIDAN 1: `nextLevelAt`
 * motordan keladi va bir yetkazishda ostonadan oshib ketish mumkin. 0-daraja
 * — bo'sh yo'l: kutilayotgan voqea, bosib o'tilgan yo'l emas.
 */
export function progressOf(row: SellerMedalRowDto): number {
  if (row.level === 0) return 0
  const span = Math.max(1, row.nextLevelAt.amount - row.levelFloor.amount)
  const share = (row.delivered.amount - row.levelFloor.amount) / span
  return Math.max(0.03, Math.min(1, share))
}

/**
 * «Ustozga 127 010 000 qoldi» — keyingi darajagacha qolgan pul, TO'LIQ SO'M
 * (spec §1: «mln» sahifadan ketdi). 0-darajada gap boshqacha — qoladigan pul
 * emas, kutilayotgan voqea. Jo'nalish kelishigi `dativeOf` da («Legenda II ga»).
 */
export function nextLevelSentence(row: SellerMedalRowDto): string {
  if (row.level === 0) return 'Birinchi savdo kutilmoqda'
  const left = Math.max(0, row.nextLevelAt.amount - row.delivered.amount)
  return `${dativeOf(row.nextTitle)} ${formatSomFull(left)} qoldi`
}
