/**
 * Sotuvchilar medallari — pagon, ball va daraja.
 *
 * SOF FUNKSIYA, ATAYLAB. Bazaga tegmaydi, React'ga tegmaydi va bitta ham
 * o'zbek so'zi chiqarmaydi — medalning SABABI bu yerda strukturaviy (qaysi
 * oy, qancha pul, necha foiz), matnga aylanishi esa `Pagon.tsx` da bo'ladi.
 * Sabab: bu qoidalar bazasiz test qilinadi va ular bilan bahslashadigan
 * yagona narsa — raqam, matn emas.
 *
 * KOEFFITSIYENTLAR 2026-09-15 da production'da 126 sotuvchi ustida
 * kalibrlangan va qotirilgan. Bir marta ishga tushgan darajani keyin
 * pasaytirish mumkin emas: floor uni jazo deb o'qiydi. Kalibrlash natijasi va
 * nima uchun aynan bu raqamlar tanlangani spec'da:
 * `docs/superpowers/specs/2026-09-15-sotuvchilar-medallari-design.md`.
 */

/**
 * N-darajaga kerak bo'ladigan ball: `50·N² − 50·N`.
 *
 * KVADRATIK, chunki chiziqli narvon ikki yomonlikdan birini beradi: boshida
 * juda sekin (yangi sotuvchi hech qachon qimirlamaydi) yoki oxirida juda tez
 * (chempion bir yilda 40-darajaga chiqib, narvonni tugatadi). O'lchov:
 * mediana sotuvchi oyiga ~800–1 100 ball yig'adi, ya'ni boshida deyarli har
 * ikki haftada daraja ko'tariladi va 10-darajadan keyin sekinlashadi.
 */
export function levelFloorOf(level: number): number {
  return 50 * level * level - 50 * level
}

/**
 * Ballga mos daraja.
 *
 * Yopiq shakl (`levelFloorOf` ni teskarisi) emas, sanoq — narvon 30-daraja
 * atrofida tugaydi, ya'ni sikl eng ko'pi bilan o'ttiz qadam yuradi va
 * kvadrat ildizning suzuvchi nuqtadagi yaxlitlanishi chegaraning AYNAN
 * ustida turgan ballni bir daraja pastga tushirib yuborish xavfini
 * butunlay olib tashlaydi.
 */
export function levelOf(points: number): number {
  let level = 1
  while (levelFloorOf(level + 1) <= points) level++
  return level
}

/**
 * Unvon bandlari, KAMAYIB — o'qilishi «siz o'tgan eng yuqori chegara», va
 * o'sib baholansa 21-darajali Legendaga «Yangi» berilardi.
 */
export const RANK_TITLES: readonly (readonly [number, string])[] = Object.freeze([
  [21, "Legenda"],
  [16, "Master"],
  [12, "Usta"],
  [8, "Katta sotuvchi"],
  [4, "Sotuvchi"],
  [1, "Yangi"],
] as const)

export function titleOf(level: number): string {
  return RANK_TITLES.find(([floor]) => level >= floor)?.[1] ?? "Yangi"
}

/**
 * Keyingi daraja unvonni almashtirsa — o'sha unvon; almashtirmasa — null.
 *
 * Progress chizig'i har doim KEYINGI DARAJANI ko'rsatadi, chunki u yaqin va
 * erishsa bo'ladigan maqsad. Lekin «13-darajaga 680 ball» dan ko'ra
 * «Master'ga 1 000 ball» ko'proq narsa aytadi, shuning uchun sarlavha o'tish
 * unvonni ko'targan paytdagina unvon nomini oladi.
 */
export function nextTitleOf(level: number): string | null {
  const next = titleOf(level + 1)
  return next === titleOf(level) ? null : next
}
