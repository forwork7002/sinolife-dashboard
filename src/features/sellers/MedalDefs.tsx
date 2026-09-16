import { EFIR_DEFS } from '@/features/sellers/medalDefs'

/**
 * Sahifaning yagona <defs>. Gerb ham, medal ham `<use href="#…">` bilan
 * chiziladi — 100 qatorning har biriga alohida <defs> qo'yilsa id'lar
 * takrorlanib, <use> birinchisiga bog'lanib qoladi va mavzu almashganda
 * yarmi eski rangda qoladi. Shuning uchun BIR MARTA, taxtaning boshida.
 * `dangerouslySetInnerHTML` — statik, repo'dagi generatsiya qilingan satr,
 * foydalanuvchi matni emas.
 */
export function MedalDefs() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute' }}
      dangerouslySetInnerHTML={{ __html: `<defs>${EFIR_DEFS}</defs>` }}
    />
  )
}
