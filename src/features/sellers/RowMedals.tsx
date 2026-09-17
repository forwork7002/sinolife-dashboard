import { MedalMark } from '@/features/sellers/MedalMark'
import { HIDDEN_IN_ROWS, sortMedals } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalDto } from '@/lib/api'

/** Qatorda nechta joy. Qolgani CHIZILMAYDI — «+N» yo'q (mijoz qarori, 2026-09-17). */
export const ROW_MEDALS = 3

/**
 * Qator medallari (spec §3): `first-sale` yashirin (100 dan 92 tasida bor),
 * `MEDAL_ORDER` bo'yicha — haqiqiy metall avval — eng ko'pi 3 ta, 28 px.
 * Sanoq yo'q, dafna yo'q (`seat` hech qachon berilmaydi), «+N» yo'q.
 *
 * O'NGDAN CHAPGA (`row-reverse`, CSS): eng nodiri pul yonida turadi, ya'ni
 * yuzta qatorning eng qimmat medallari bitta vertikal ustun bo'lib o'qiladi.
 *
 * KONTEYNER HAR DOIM CHIZILADI. Qator — CSS grid, va bolalar tartib bilan
 * uyalarga tushadi: bo'sh uya o'rniga hech narsa qaytarilsa pul medal
 * ustuniga surilib ketadi.
 */
export function RowMedals({
  medals,
  newKeys,
}: {
  medals: readonly SellerMedalDto[]
  newKeys?: ReadonlySet<MedalCode>
}) {
  const shown = sortMedals(medals, HIDDEN_IN_ROWS).slice(0, ROW_MEDALS)
  return (
    <span className="row__medals">
      {shown.map((m) => (
        <MedalMark key={m.code} code={m.code} size={28} isNew={newKeys?.has(m.code) ?? false} />
      ))}
    </span>
  )
}
