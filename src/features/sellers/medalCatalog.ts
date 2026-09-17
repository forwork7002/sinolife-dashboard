import type { MedalCode, SellerMedalDto } from '@/lib/api'

/**
 * Medal lug'ati — frontend nusxasi.
 *
 * Mirrors `sellerMedals.ts` (`MEDAL_CODES`, `MEDAL_ORDER`). Frontend server
 * domenini import qilmaydi (qatlam qoidasi), shuning uchun nusxa. Testlar
 * qatlam qoidasidan ozod, va `tests/features/medalCatalogMirror.test.ts`
 * nusxani aslidan tekshiradi (tartib, kodlar) — lekin ikkala tomonni baribir
 * BIR commit'da o'zgartiring.
 *
 * DARAJA YO'Q (2026-09-17, mijoz: «uroven kerak emas, medallar qolsin»):
 * narvon, unvonlar, ochilish darajalari va ularning yordamchilari shu faylda
 * edi — o'chirildi. Medal hech narsaning ortiga yashirilmaydi.
 */
/** Medal nomi — `MedalMark` ning `aria-label` i shuni o'qiydi; boshqa matn yo'q. */
export const MEDALS: Readonly<Record<MedalCode, { readonly name: string }>> =
  Object.freeze({
    'month-gold': { name: 'Oy chempioni' },
    'month-silver': { name: 'Kumush oy' },
    'month-bronze': { name: 'Bronza oy' },
    'year-champion': { name: 'Yil chempioni' },
    'streak-fire': { name: 'Olov seriyasi' },
    'streak-steady': { name: 'Barqaror' },
    'day-record': { name: 'Kun rekordi' },
    'day-winner': { name: 'Kun gʻolibi' },
    'conversion-master': { name: 'Konversiya ustasi' },
    'clean-month': { name: 'Toza oy' },
    jump: { name: 'Sakrash' },
    rookie: { name: 'Yangi yulduz' },
    'first-sale': { name: 'Birinchi savdo' },
    'work-month': { name: 'Ishchan oy' },
  })

/**
 * Chizilish tartibi. Mirrors `sellerMedals.MEDAL_ORDER` — ikkala tomon BIR
 * commit'da o'zgaradi (ZARB to'plami, mijoz qarori, 2026-09-17): HAQIQIY METALL
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

/* ---------------------------------------------------------------------------
 * «ZARB» medal tizimi (zarb qilingan tanga to'plami). Mirrors `gen_final.py`
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
 * Podium tokchasi (klassik spec §1.5): `MEDAL_ORDER` bo'yicha; nodir yoki gilt medal
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
