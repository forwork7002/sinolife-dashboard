import type { MedalCode } from '@/lib/api'
import { formatCompactUzs } from '@/lib/format'

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
  /** Narvon legendasi ostidagi yozuv — aytiladigan raqam. */
  readonly thresholdLabel: string
}

/** Mirrors `sellerMedals.LEVEL_THRESHOLDS_MINOR` / `LEVEL_TITLES`. */
export const LADDER: readonly LadderRung[] = Object.freeze([
  { level: 1, title: 'Yangi', thresholdLabel: 'birinchi soʻm' },
  { level: 2, title: 'Sotuvchi', thresholdLabel: '10 mln' },
  { level: 3, title: 'Katta sotuvchi', thresholdLabel: '30 mln' },
  { level: 4, title: 'Usta', thresholdLabel: '100 mln' },
  { level: 5, title: 'Ustoz', thresholdLabel: '300 mln' },
  { level: 6, title: 'Legenda', thresholdLabel: '1 mlrd' },
])

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

/** «127 mln», «9.1 mln», «1.2 mlrd» — `formatCompactUzs` ning o'zi (o'nlik nuqta bilan), nom aniqroq. */
export function mlnLabel(som: number): string {
  return formatCompactUzs(som)
}
