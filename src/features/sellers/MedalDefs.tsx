import { LAVHA_DEFS, MEDAL_DEFS } from '@/features/sellers/medalDefs'

/**
 * Sahifaning yagona <defs>. 126 qatorning har biriga alohida <defs> qo'yilsa
 * id'lar takrorlanib, <use> birinchisiga bog'lanib qoladi va mavzu
 * almashganda yarmi eski rangda qoladi — shuning uchun BIR MARTA, taxtaning
 * boshida. `dangerouslySetInnerHTML` — statik, repo'dagi ishonchli satr,
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
      dangerouslySetInnerHTML={{ __html: `<defs>${LAVHA_DEFS}${MEDAL_DEFS}</defs>` }}
    />
  )
}
