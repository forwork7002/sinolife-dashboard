import { Medal } from '@/features/sellers/Medal'
import type { MedalCode, SellerMedalDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** Qatorda nechta; qolgani «+N». Aylanish yo'q — 126 qator bir vaqtda o'zgarmaydi. */
export const ROW_MEDALS = 3

export function RowMedals({
  medals,
  newKeys,
}: {
  medals: readonly SellerMedalDto[]
  newKeys?: ReadonlySet<MedalCode>
}) {
  if (medals.length === 0) return null
  const shown = medals.slice(0, ROW_MEDALS)
  const rest = medals.length - shown.length
  return (
    <div className="tv-rowmedals">
      {shown.map((m) => (
        <Medal key={m.code} code={m.code} size="row" count={m.count} isNew={newKeys?.has(m.code) ?? false} />
      ))}
      {rest > 0 && <span className="medal-more">+{formatNumber(rest)}</span>}
    </div>
  )
}
