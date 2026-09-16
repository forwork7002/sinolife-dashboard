import { MEDALS } from '@/features/sellers/medalCatalog'
import { monthLabel } from '@/features/sellers/RecordWall'
import type { SellerMedalDto } from '@/lib/api'
import { formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

/**
 * Medalning sababi, bir jumlada — televizorda sichqoncha yo'q, medal o'zini
 * tanishtirishi kerak. Domen qatlami bo'laklar beradi (oy/kun, pul, foiz);
 * jumla shu yerda yig'iladi. Bo'sh satr hech qachon qaytmaydi.
 */
export function medalReason(medal: SellerMedalDto): string {
  const when = medal.at === null ? null : monthLabel(medal.at)
  const parts: string[] = []

  /*
    📅 «ISHCHAN OY»NING `orders` MAYDONI BUYURTMA EMAS, KUN, VA `percent`
    KONVERSIYA EMAS, DAVOMAT — umumiy yo'ldan o'tsa «24 buyurtma» va yorliqsiz
    foiz chiqardi (mijoz 2026-09-15 da o'chirtirgan ziddiyat).
  */
  if (medal.code === 'work-month') {
    if (when !== null) parts.push(when)
    if (medal.orders !== null) parts.push(`${formatNumber(medal.orders)} kun`)
    if (medal.percent !== null) parts.push(`davomat ${formatPercent(medal.percent)}`)
    if (medal.count > 1) parts.push(`${formatNumber(medal.count)} marta`)
    return parts.length > 0 ? parts.join(' · ') : MEDALS[medal.code].name
  }

  if (when !== null) parts.push(when)
  if (medal.percent !== null) parts.push(formatPercent(medal.percent))
  if (medal.amount !== null) parts.push(`${formatFullUzs(medal.amount.amount)} soʻm`)
  // 🚀 NING `orders` MAYDONI O'RIN — «7 buyurtma» emas, «7-oʻrin».
  if (medal.code === 'rookie' && medal.orders !== null) {
    parts.push(`${formatNumber(medal.orders)}-oʻrin`)
  } else if (medal.orders !== null) {
    parts.push(`${formatNumber(medal.orders)} buyurtma`)
  }
  if (medal.count > 1) parts.push(`${formatNumber(medal.count)} marta`)

  return parts.length > 0 ? parts.join(' · ') : MEDALS[medal.code].name
}
