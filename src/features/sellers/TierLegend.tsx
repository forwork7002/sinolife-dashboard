import { Crest } from '@/features/sellers/Crest'
import { LADDER } from '@/features/sellers/medalCatalog'
import { formatSomFull } from '@/lib/format'

/**
 * Legenda — sotuvchilar ustunining PASTIDA 28 px qator (spec §2): olti gerb,
 * so'z, ostona to'liq so'mda. Yagona kalit; hamma ma'lumot elementidan
 * kichik va yengil; podium bilan ro'yxat orasida hech qachon emas. Statik.
 *
 * Yangi pog'onasi raqamsiz — uning ostonasi «birinchi so'm» (mock ham
 * shunday chizadi); qolgan beshtasi raqam bilan.
 */
export function TierLegend() {
  return (
    <div className="tv-legend" role="list" aria-label="Daraja legendasi">
      <span className="tv-legend__title" aria-hidden="true">
        Daraja
      </span>
      {LADDER.map((rung) => (
        <span key={rung.level} className="legend__rung" role="listitem" data-tier={rung.level}>
          <Crest level={rung.level} legendaTier={rung.level === 6 ? 1 : 0} size="legend" />
          <b>{rung.title}</b>
          {rung.thresholdSom !== null && <i>{formatSomFull(rung.thresholdSom)}</i>}
        </span>
      ))}
    </div>
  )
}
