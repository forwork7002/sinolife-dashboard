import { Lavha } from '@/features/sellers/Lavha'
import { LADDER } from '@/features/sellers/medalCatalog'

/**
 * Narvon — podium ostidagi doimiy legenda. Olti lavha, unvon, ostona.
 * Statik: «daraja o'rin emas» jumlasining o'rnini shu chizma bosadi.
 *
 * `role="list"` / `role="listitem"` — `aria-label` oddiy `<div>` da
 * e'lon qilinmaydi (rolsiz elementga nom berilmaydi), ya'ni legendaning
 * nomi ekran o'quvchiga umuman yetib bormasdi. Roller `<ul>` o'rniga:
 * CSS `.narvon` / `.narvon-rung` sinflari bilan yozilgan va ro'yxatning
 * o'z chekinishlari bu yerda keraksiz.
 */
export function Narvon() {
  return (
    <div className="narvon" role="list" aria-label="Daraja narvoni">
      {LADDER.map((rung) => (
        <div key={rung.level} className="narvon-rung" role="listitem">
          <Lavha level={rung.level} legendaTier={rung.level === 6 ? 1 : 0} size="narvon" />
          <b>{rung.title}</b>
          <span>{rung.thresholdLabel}</span>
        </div>
      ))}
    </div>
  )
}
