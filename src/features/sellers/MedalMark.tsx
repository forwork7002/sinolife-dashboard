import { MEDALS, MEDAL_SYMBOL, MONTH_NUMERAL, RARE_MEDALS, metalOfMedal } from '@/features/sellers/medalCatalog'
import type { MedalCode } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/**
 * Bitta medal — 24 birlik quti, faqat-fill, bitta metall (spec §3). Belgi
 * `medalDefs.ts` da, rang `.medal[data-metal]` da; Oy oilasi diskiga 1/2/3
 * raqami <text> bilan o'yiladi (`class="cut"` — sirt rangi).
 *
 * ×N — SVG TASHQARISIDA, HTML <b>: tabular raqam, mavzu tokenlari. Faqat
 * `count > 1` da va faqat chaqiruvchi `count` bersa — qator uni bermaydi
 * (spec §3: qatorda ×N yo'q).
 *
 * NOMI BIR MARTA. `role="img"` + `aria-label` nomni (va ×N ni) o'zi aytadi.
 */
export function MedalMark({
  code,
  count = 1,
  size = 24,
  isNew = false,
}: {
  code: MedalCode
  count?: number
  size?: number
  /** Oxirgi yangilanishda paydo bo'lgan — bir marta 0,6 → 1 kattalashadi. */
  isNew?: boolean
}) {
  const name = MEDALS[code].name
  const numeral = MONTH_NUMERAL[code]
  const label = count > 1 ? `${name} ×${formatNumber(count)}` : name
  const svg = (
    <svg
      className={`medal${RARE_MEDALS.has(code) ? ' rare' : ''}${isNew ? ' medal--new' : ''}`}
      data-medal={code}
      data-metal={metalOfMedal(code)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
    >
      <use href={`#${MEDAL_SYMBOL[code]}`} />
      {numeral !== undefined && (
        <text className="cut medal__num" x="12" y="18.6" textAnchor="middle">
          {numeral}
        </text>
      )}
    </svg>
  )
  if (count <= 1) return svg
  return (
    <span className="medal-group">
      {svg}
      <b className="medal-count">×{formatNumber(count)}</b>
    </span>
  )
}
