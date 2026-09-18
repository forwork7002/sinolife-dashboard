import { MEDAL_DEFS } from '@/features/sellers/medalDefs'

/**
 * Sahifaning yagona medal <defs> i. Har medal `<use href="#m-…">` bilan
 * chiziladi — 100 qatorning har biriga alohida <defs> qo'yilsa id'lar
 * takrorlanib, <use> birinchisiga bog'lanib qoladi va mavzu almashganda
 * yarmi eski rangda qoladi. Shuning uchun BIR MARTA, taxtaning boshida.
 *
 * `medal-defs` SINFI RANG BERMAYDI (EMAL, 2026-09-18). Belgilar `--emal-*`
 * tokenlarini to'g'ridan-to'g'ri `:root` dan o'qiydi va hech narsa qayta
 * bog'lanmaydi — globals.css da `.medal-defs` qoidasi yo'q va bo'lmasligi
 * kerak. Sinf faqat testlar yashirin `<defs>` ni topadigan ilgak
 * (`medalMark.test.tsx`, `sellersMedals.test.tsx`) — olib tashlamang.
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
