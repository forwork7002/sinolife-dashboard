import { Lavha } from '@/features/sellers/Lavha'
import { dativeOf, mlnLabel } from '@/features/sellers/medalCatalog'
import type { SellerMedalRowDto } from '@/lib/api'

/**
 * Seat'dagi daraja bloki: lavha + (chempionda) keyingi lavhaning sharpasi,
 * o'nta shtamp va «Ustozga 127 mln qoldi» — sotuvchi qila oladigan yagona
 * narsa. Foiz yo'q: shtamp uzoqdan sanaladi, foiz sanalmaydi.
 */
export function LevelBlock({
  row,
  ghost,
  rise = false,
}: {
  row: SellerMedalRowDto
  /** Keyingi lavhaning sharpasi — faqat chempion seat'ida (kengroq). */
  ghost: boolean
  /** Ko'tarilish marosimi — yulduzlar tushadi, bir marta yaltiraydi. */
  rise?: boolean
}) {
  const floor = row.levelFloor.amount
  const next = row.nextLevelAt.amount
  const have = row.delivered.amount
  const span = Math.max(1, next - floor)
  const share = Math.max(0, Math.min(1, (have - floor) / span))
  const done = Math.min(10, Math.floor(share * 10))
  const near = row.level > 0 && share >= 0.9
  const remaining = Math.max(0, next - have)
  const qoldi =
    row.level === 0 ? 'Birinchi savdo kutilmoqda' : `${dativeOf(row.nextTitle)} ${mlnLabel(remaining)} qoldi`

  const nextLevel = row.level < 6 ? row.level + 1 : 6
  const nextTier = row.level < 6 ? (nextLevel === 6 ? 1 : 0) : row.legendaTier + 1
  const nextLabel = row.level === 0 ? 'birinchi soʻm' : mlnLabel(next)

  return (
    <div className="lv-block">
      <div className="lv-head">
        <div className={`lv-plate${rise ? ' lv-plate--rise' : ''}`}>
          <Lavha level={row.level} legendaTier={row.legendaTier} size="seat" title={row.rankTitle} animate={rise} />
          <span className="lv-sheen" aria-hidden="true" />
        </div>
        {ghost && (
          <div className="lv-ghost">
            <Lavha level={nextLevel} legendaTier={nextTier} size="ghost" ghost />
            <span>
              keyingi · {row.nextTitle} · {nextLabel}
            </span>
          </div>
        )}
      </div>
      <div className="lv-stamps" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < done ? 'on' : undefined} />
        ))}
      </div>
      <p className={`lv-qoldi${near ? ' lv-qoldi--near' : ''}`}>{qoldi}</p>
    </div>
  )
}
