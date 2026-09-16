import { Lavha } from '@/features/sellers/Lavha'
import { LADDER } from '@/features/sellers/medalCatalog'

/**
 * Narvon — podium ostidagi doimiy legenda. Olti lavha, unvon, ostona.
 * Statik: «daraja o'rin emas» jumlasining o'rnini shu chizma bosadi.
 */
export function Narvon() {
  return (
    <div className="narvon" aria-label="Daraja narvoni">
      {LADDER.map((rung) => (
        <div key={rung.level} className="narvon-rung">
          <Lavha level={rung.level} legendaTier={rung.level === 6 ? 1 : 0} size="narvon" />
          <b>{rung.title}</b>
          <span>{rung.thresholdLabel}</span>
        </div>
      ))}
    </div>
  )
}
