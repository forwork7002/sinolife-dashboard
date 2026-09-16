import { Medal } from '@/features/sellers/Medal'
import type { MedalCode, SellerMedalDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** Seat tokchasida nechta; qolgani «+N». */
export const SEAT_MEDALS = 5

/** Seat tokchasi — o'rindiqning chromi yuvindisida, bo'sh bo'lsa chizilmaydi. */
export function MedalRail({
  medals,
  newKeys,
}: {
  medals: readonly SellerMedalDto[]
  newKeys?: ReadonlySet<MedalCode>
}) {
  if (medals.length === 0) return null
  const shown = medals.slice(0, SEAT_MEDALS)
  const rest = medals.length - shown.length
  return (
    <div className="medal-rail">
      {shown.map((m) => (
        <Medal key={m.code} code={m.code} size="seat" count={m.count} isNew={newKeys?.has(m.code) ?? false} />
      ))}
      {rest > 0 && <span className="medal-more">+{formatNumber(rest)}</span>}
    </div>
  )
}
