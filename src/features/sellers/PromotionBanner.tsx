import { Crest } from '@/features/sellers/Crest'
import { thresholdSomOf } from '@/features/sellers/medalCatalog'
import type { Promotion } from '@/features/sellers/usePromotions'
import { formatSomFull } from '@/lib/format'

/**
 * Ustun sarlavhasi USTIDA 8 soniya, EFIR tilida (spec §8): tasma + gerb +
 * «Ism — endi USTA · 100 000 000». Ostona to'liq so'mda — `Promotion.
 * thresholdLabel` («100 mln») bu sahifada o'qilmaydi, `usePromotions`
 * o'zgarmaydi. 1-darajada ostona yo'q (birinchi so'm) — nuqta ham yo'q.
 *
 * `role="status"` — fokusni tortmaydi, lekin ekran o'quvchiga aytiladi:
 * marosim hech kimning ishini bo'lmasligi kerak.
 */
export function PromotionBanner({ promotion, name }: { promotion: Promotion; name: string }) {
  const threshold = thresholdSomOf(promotion.level, promotion.legendaTier)
  return (
    <div className="tv-promo" role="status" data-tier={promotion.level}>
      <span className="tv-promo__band" aria-hidden="true" />
      <Crest level={promotion.level} legendaTier={promotion.legendaTier} size="row" />
      <span className="tv-promo__text">
        {name} — endi {promotion.rankTitle.toUpperCase()}
        {threshold !== null && ` · ${formatSomFull(threshold)}`}
      </span>
    </div>
  )
}
