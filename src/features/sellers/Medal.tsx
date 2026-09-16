import { MEDALS } from '@/features/sellers/medalCatalog'
import type { MedalCode } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/**
 * Bitta medal — lentali dumaloq disk. Belgi `medalDefs.ts` da, rang
 * `.medal[data-medal]` da. ×N — HTML pill, SVG emas (tabular raqam, mavzu
 * tokenlari); QATORDA chizilmaydi — 26 px da o'qilish chegarasida.
 */
export type MedalSize = 'row' | 'seat' | 'speaking'

export function Medal({
  code,
  size,
  count = 1,
  bare = false,
  locked = false,
  label = true,
  isNew = false,
}: {
  code: MedalCode
  size: MedalSize
  count?: number
  /** Lentasiz disk — mijozning televizordagi tanlovi uchun. */
  bare?: boolean
  /** Hali ochilmagan medal — shtrix kontur, belgisiz. */
  locked?: boolean
  /** `sr-only` nom; nomni yonida o'zi yozadigan karta `false` beradi. */
  label?: boolean
  /** Oxirgi yangilanishda paydo bo'lgan — bir marta kattalashib tushadi. */
  isNew?: boolean
}) {
  const id = locked ? 'locked' : code
  const name = locked ? 'Ochilmagan medal' : MEDALS[code].name
  const showCount = count > 1 && size !== 'row'
  return (
    <span className={`medal-slot${isNew ? ' medal-slot--new' : ''}`} title={name}>
      <svg
        className={`medal medal--${size}${bare ? ' medal--bare' : ''}`}
        data-medal={id}
        viewBox={bare ? '0 8 32 32' : '0 0 32 40'}
        role="img"
        aria-label={name}
      >
        <use href={`#medal-${id}`} />
      </svg>
      {showCount && <span className="medal-count tabular">×{formatNumber(count)}</span>}
      {label && <span className="sr-only">{name}</span>}
    </span>
  )
}
