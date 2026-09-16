import { levelTitle } from '@/features/sellers/medalCatalog'

/**
 * Gerb («pagon») — olti o'ngga qaragan chevron, `0…level−1` katakchalar
 * `--tier` rangida, qolganlari `--track` (spec §2). Geometriya `#ch` da
 * (`medalDefs.ts`), bu yerda faqat QAYSI katakcha yoniq. Rang CSS'da:
 * `[data-tier]` → `--tier`, ya'ni mavzu almashganda hech narsa qayta
 * chizilmaydi.
 *
 * SO'Z BIR MARTA. Daraja so'zi gerb yonida faqat o'rindiqda HTML bilan;
 * gerbning o'zi `aria-label` da to'liq aytadi («4-daraja · Usta»), shuning
 * uchun `sr-only` nusxa yo'q.
 */
export type CrestSize = 'row' | 'seat' | 'legend'

const DIMS: Readonly<Record<CrestSize, readonly [number, number]>> = {
  row: [60, 20],
  seat: [78, 26],
  legend: [42, 14],
}
const CELLS = [0, 1, 2, 3, 4, 5] as const
/** Legenda toji — oltinchi katakcha ustida (mock `crest()`), faqat 6-darajada. */
const CROWN = 'M56 -7l2.5-4 2.5 3 2.5-3 2.5 4z'

export function Crest({
  level,
  legendaTier = 0,
  size,
  animate = false,
}: {
  level: number
  legendaTier?: number
  size: CrestSize
  /** Ko'tarilish marosimi: eng yangi katakcha bir marta to'ladi (`.crest__cell--fill`). */
  animate?: boolean
}) {
  const lit = Math.max(0, Math.min(6, level))
  const title = levelTitle(level, legendaTier)
  const [w, h] = DIMS[size]
  return (
    <svg
      className={`crest crest--${size}`}
      data-tier={lit}
      viewBox="0 -1 66 22"
      width={w}
      height={h}
      role="img"
      aria-label={title === null ? 'Hali darajasiz' : `${level}-daraja · ${title}`}
    >
      {CELLS.map((i) => (
        <use
          key={i}
          href="#ch"
          x={i * 11}
          className={i < lit ? (animate && i === lit - 1 ? 'on crest__cell--fill' : 'on') : 'off'}
        />
      ))}
      {lit >= 6 && <path className="crest__crown" d={CROWN} />}
    </svg>
  )
}
