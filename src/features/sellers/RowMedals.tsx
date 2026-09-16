import { MedalMark } from '@/features/sellers/MedalMark'
import { HIDDEN_IN_ROWS, sortMedals } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** Qatorda nechta; qolgani «+N». Aylanish yo'q — 100 qator bir vaqtda o'zgarmaydi. */
export const ROW_MEDALS = 3

/**
 * Qator medallari (spec §3): `first-sale` yashirin (100 dan 92 tasida bor),
 * `MEDAL_ORDER` bo'yicha eng nodir avval, 3 ta + «+N», ×N YO'Q (aria ham
 * sanoqsiz — `count` berilmaydi).
 *
 * KONTEYNER HAR DOIM CHIZILADI. Qator — CSS grid, va bolalar tartib bilan
 * uyalarga tushadi: bo'sh uya o'rniga hech narsa qaytarilsa FAKT 2 medal
 * ustuniga surilib ketadi.
 */
export function RowMedals({
  medals,
  newKeys,
}: {
  medals: readonly SellerMedalDto[]
  newKeys?: ReadonlySet<MedalCode>
}) {
  const visible = sortMedals(medals, HIDDEN_IN_ROWS)
  const shown = visible.slice(0, ROW_MEDALS)
  const rest = visible.length - shown.length
  return (
    <span className="row__medals">
      {shown.map((m) => (
        <MedalMark key={m.code} code={m.code} isNew={newKeys?.has(m.code) ?? false} />
      ))}
      {rest > 0 && <span className="row__more">+{formatNumber(rest)}</span>}
    </span>
  )
}
