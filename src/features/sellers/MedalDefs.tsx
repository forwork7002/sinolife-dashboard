import { MEDAL_DEFS } from '@/features/sellers/medalDefs'

/**
 * Sahifaning yagona medal <defs> i. Har medal `<use href="#m-…">` bilan
 * chiziladi — 100 qatorning har biriga alohida <defs> qo'yilsa id'lar
 * takrorlanib, <use> birinchisiga bog'lanib qoladi va mavzu almashganda
 * yarmi eski rangda qoladi. Shuning uchun BIR MARTA, taxtaning boshida.
 *
 * `medal-defs` SINFI BEZAK EMAS. Gradientlar o'z to'xtash ranglarini SHU
 * elementdan meros oladi (instance'dan emas), va medalning o'rta toni
 * `--medal-gold/silver/bronze` ga globals.css dagi MEDALS bo'limi aynan shu
 * sinf orqali beriladi. Sinf olib tashlansa, medallar podium xromi rangida
 * chiziladi — xato emas, faqat noto'g'ri metall.
 *
 * `dangerouslySetInnerHTML` — statik, repo'dagi generatsiya qilingan satr,
 * foydalanuvchi matni emas.
 */
export function MedalDefs() {
  return (
    <svg
      className="medal-defs"
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute' }}
      dangerouslySetInnerHTML={{ __html: `<defs>${MEDAL_DEFS}</defs>` }}
    />
  )
}
