import type { MedalCode, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { formatSomFull } from '@/lib/format'

/**
 * Medal va daraja lug'atlari — frontend nusxasi.
 *
 * Mirrors `sellerMedals.ts` (`MEDAL_UNLOCK_LEVEL`, `MEDAL_ORDER`,
 * `LEVEL_TITLES`, `titleOf`, `romanOf`). Frontend server domenini import
 * qilmaydi (qatlam qoidasi), shuning uchun nusxa. Testlar qatlam qoidasidan
 * ozod, va `tests/features/medalCatalogMirror.test.ts` nusxani aslidan
 * tekshiradi (tartib, ochilish darajasi, kodlar, narvon) — lekin ikkala
 * tomonni baribir BIR commit'da o'zgartiring.
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

/**
 * Chizilish tartibi. Mirrors `sellerMedals.MEDAL_ORDER` — ikkala tomon BIR
 * commit'da o'zgaradi (EFIR Premium, spec §3, mijoz qarori 4): HAQIQIY METALL
 * AVVAL — nodir yettilik (oltin, kumush, bronza tanalar), keyin gilt belgili
 * po'lat beshlik, oxirida po'lat/po'lat ikkilik. Qatorda eng ko'pi 3 ta va
 * «+N» yo'q, shuning uchun tartib qaysi uchtasi ko'rinishini hal qiladi.
 */
export const MEDAL_ORDER: readonly MedalCode[] = Object.freeze([
  'year-champion',
  'month-gold',
  'month-silver',
  'month-bronze',
  'streak-fire',
  'conversion-master',
  'day-record',
  'streak-steady',
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
  /**
   * Qisqa aytiladigan yorliq («10 mln» … «1 mlrd»). IKKI O'QUVCHISI BOR:
   * `usePromotions` (aytiladigan matn) va `TierLegend` — legenda kaliti spec
   * §1 ning to'liq-so'm qoidasidan YAGONA istisno, chunki u o'lchov emas,
   * izoh, va bir qatorga sig'ishi kerak (sabab `TierLegend.tsx` da).
   */
  readonly thresholdLabel: string
  /**
   * Ostona so'mda — TO'LIQ RAQAM YOZADIGAN joylar uchun: e'lon, o'rindiq
   * jumlasi, progress hisobi (spec §1). Legenda buni faqat «yorliq bormi»
   * deb o'qiydi — RAQAMINI chizmaydi (yuqoriga qarang). Yangi — birinchi
   * so'm, ya'ni null va shu sababli yorliqsiz.
   */
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
 * EFIR Premium — «ZARB» medal tizimi (spec §3). Mirrors `gen_final.py`
 * (METAL_OF, ORDER, RARE, seat_medals) — mock va taxta bir xil chizsin.
 *
 * SHAKL OILANI, METALL NODIRLIKNI AYTADI. Metall `<defs>` dagi `m-<code>`
 * belgisining ichiga pishirilgan (`medalDefs.ts`); bu xarita faqat instance
 * tomonida kerak bo'lgan joylar uchun: ×N plastinkasining rim gradienti
 * (`body`), uning raqam rangi (`dev`), oy dafnasi va o'rindiqdagi yashirish.
 * ------------------------------------------------------------------------- */

export type Metal = 'gold' | 'silver' | 'bronze' | 'steel' | 'gilt'

/** Tana metalli va belgi (qurilma) metalli. Tana hech qachon gilt emas. */
export const MEDAL_METAL: Readonly<
  Record<MedalCode, { readonly body: Exclude<Metal, 'gilt'>; readonly dev: Metal }>
> = Object.freeze({
  'year-champion': { body: 'gold', dev: 'gold' },
  'month-gold': { body: 'gold', dev: 'gold' },
  'month-silver': { body: 'silver', dev: 'silver' },
  'month-bronze': { body: 'bronze', dev: 'bronze' },
  'day-record': { body: 'gold', dev: 'gold' },
  'conversion-master': { body: 'gold', dev: 'gold' },
  'streak-fire': { body: 'gold', dev: 'gold' },
  'streak-steady': { body: 'steel', dev: 'gilt' },
  'day-winner': { body: 'steel', dev: 'gilt' },
  'clean-month': { body: 'steel', dev: 'gilt' },
  jump: { body: 'steel', dev: 'gilt' },
  rookie: { body: 'steel', dev: 'gilt' },
  'first-sale': { body: 'steel', dev: 'steel' },
  'work-month': { body: 'steel', dev: 'steel' },
})

/**
 * Nodir yettilik — haqiqiy metall tanalar. Endi faqat o'rindiq yashirish
 * qoidasi o'qiydi (`seatMedals`); soya ham, `.rare` sinfi ham yo'q.
 */
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

/** Oy oilasi — o'rindiqda (≥ 40 px) dafna oladi. */
export function isMonthMedal(code: MedalCode): code is 'month-gold' | 'month-silver' | 'month-bronze' {
  return code === 'month-gold' || code === 'month-silver' || code === 'month-bronze'
}

/**
 * Shu nusxa taniydigan kod. Server bu fayldan OLDIN deploy bo'lishi mumkin, va
 * televizor tabi deploylar orasida kunlab ochiq turadi: yangi kodli medal
 * kelganda `MEDAL_METAL[code]` undefined bo'lib, uni destrukturlash butun
 * ustunni yiqitardi. Notanish medal CHIZILMAYDI — sahifa yangilanganda chiqadi.
 */
export function isKnownMedal(code: string): code is MedalCode {
  return Object.prototype.hasOwnProperty.call(MEDAL_METAL, code)
}

/**
 * `MEDAL_ORDER` bo'yicha (eng nodir avval), `hide` dagilar va notanish kodlar
 * (`isKnownMedal`) tashlab yuboriladi; kirish o'zgarmaydi.
 */
export function sortMedals(
  medals: readonly SellerMedalDto[],
  hide: readonly MedalCode[] = [],
): readonly SellerMedalDto[] {
  return medals
    .filter((m) => isKnownMedal(m.code) && !hide.includes(m.code))
    .slice()
    .sort((a, b) => MEDAL_ORDER.indexOf(a.code) - MEDAL_ORDER.indexOf(b.code))
}

/**
 * O'rindiq tokchasi (spec §3): `MEDAL_ORDER` bo'yicha; nodir yoki gilt medal
 * bor bo'lsa `first-sale` va `work-month` tushadi (oddiy po'lat nishon
 * haqiqiy mukofot yonida joy egallamasin), keyin `cap` gacha kesiladi —
 * P1 da 4, P2/P3 da 3. «+N» yo'q. Kirish o'zgarmaydi.
 */
export function seatMedals(medals: readonly SellerMedalDto[], cap: number): readonly SellerMedalDto[] {
  let visible = sortMedals(medals)
  if (visible.some((m) => RARE_MEDALS.has(m.code) || MEDAL_METAL[m.code].dev === 'gilt')) {
    visible = visible.filter((m) => m.code !== 'first-sale' && m.code !== 'work-month')
  }
  return visible.slice(0, Math.max(0, cap))
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
