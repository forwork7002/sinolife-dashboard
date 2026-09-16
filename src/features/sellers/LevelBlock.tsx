import { Lavha } from '@/features/sellers/Lavha'
import { dativeOf, mlnLabel } from '@/features/sellers/medalCatalog'
import type { SellerMedalRowDto } from '@/lib/api'

/**
 * Keyingi darajagacha bosib o'tilgan yo'l, 0..1 ga qisilgan.
 *
 * QISISH KERAK: `nextLevelAt` motordan keladi va bir sotuvchi bitta
 * yetkazishda ostonadan oshib ketishi mumkin — qisilmagan ulush o'nta emas,
 * o'n uchta shtamp yoqardi.
 */
function shareOf(row: SellerMedalRowDto): number {
  const span = Math.max(1, row.nextLevelAt.amount - row.levelFloor.amount)
  return Math.max(0, Math.min(1, (row.delivered.amount - row.levelFloor.amount) / span))
}

/**
 * 90% dan oshganmi — «yaqin». Seat'da matn ko'karadi, jadval qatorida unvon
 * so'zi ko'karadi, VA BU BIR QOIDA: ikkita nusxa ikki ekranda bir odamni bir
 * vaqtda yaqin va yaqin emas deb ko'rsatishi mumkin edi.
 */
export function isNearNextLevel(row: SellerMedalRowDto): boolean {
  return row.level > 0 && shareOf(row) >= 0.9
}

/**
 * «Ustozga 127 mln» — keyingi darajagacha qolgan pul, so'z bilan.
 *
 * OXIRIDA « qoldi» YO'Q: seat bloki jumlani gap qilib tugatadi, jadval
 * qatorining chase chizig'i esa uni ikkinchi bo'lak sifatida qisqa oladi.
 * 0-darajada gap boshqacha — qoladigan pul emas, kutilayotgan voqea.
 */
export function nextLevelSentence(row: SellerMedalRowDto): string {
  if (row.level === 0) return 'Birinchi savdo kutilmoqda'
  return `${dativeOf(row.nextTitle)} ${mlnLabel(Math.max(0, row.nextLevelAt.amount - row.delivered.amount))}`
}

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
  const next = row.nextLevelAt.amount
  const done = Math.min(10, Math.floor(shareOf(row) * 10))
  const near = isNearNextLevel(row)
  // «… qoldi» ni gap qiladigan joy shu: `nextLevelSentence` bo'lakni beradi,
  // 0-daraja esa qoladigan pul haqida emas — unga hech narsa qo'shilmaydi.
  const sentence = nextLevelSentence(row)
  const qoldi = row.level === 0 ? sentence : `${sentence} qoldi`

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
