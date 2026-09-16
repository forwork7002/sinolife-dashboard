import { Lavha } from '@/features/sellers/Lavha'
import type { Promotion } from '@/features/sellers/usePromotions'

/**
 * Ustun sarlavhasi ostida 8 soniya: yangi lavha, ism, unvon, ostona.
 *
 * `role="status"` — fokusni tortmaydi, lekin ekran o'quvchiga aytiladi:
 * marosim hech kimning ishini bo'lmasligi kerak.
 */
export function PromotionBanner({ promotion, name }: { promotion: Promotion; name: string }) {
  return (
    <div className="tv-promo" role="status">
      <Lavha level={promotion.level} legendaTier={promotion.legendaTier} size="narvon" />
      <div>
        {name} — endi {promotion.rankTitle.toUpperCase()} · {promotion.thresholdLabel}
        <small>Daraja koʻtarildi — bugun</small>
      </div>
    </div>
  )
}
