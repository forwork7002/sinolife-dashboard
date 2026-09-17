import { levelTitle } from '@/features/sellers/medalCatalog'

/**
 * Gerb («pagon») — «ZARB» (spec §3). BITTA `<use href="#crest-N">`: yoniq
 * katakchalar `currentColor` + umumiy yaltiroq, o'chiqlari o'yilgan uya,
 * 6-darajada toj — hammasi `medalDefs.ts` dagi belgida. Rang CSS'da:
 * `.crest { color: var(--tier) }`, `[data-tier]` → `--tier`, ya'ni mavzu
 * almashganda hech narsa qayta chizilmaydi.
 *
 * O'lcham `height` bilan: qator 20, legenda 15, o'rindiq 18 (P2/P3) va 20
 * (P1, sahna). Kenglik viewBox nisbatidan — 72/26, Legendada toj uchun 88/26.
 * `plated` (o'rindiq, sahna) ostiga botiq plastinka qo'yadi.
 *
 * Ko'tarilish marosimi (`animate`): eng yangi katakcha ustiga bitta `#ch`
 * qoplamasi (`.crest__cell--fill`) — bir marta to'ladi.
 *
 * SO'Z BIR MARTA. Gerbning o'zi `aria-label` da to'liq aytadi
 * («4-daraja · Usta»), shuning uchun `sr-only` nusxa yo'q.
 */
export function Crest({
  level,
  legendaTier = 0,
  height = 20,
  plated = false,
  animate = false,
}: {
  level: number
  legendaTier?: number
  height?: number
  /** O'rindiq va sahna: botiq plastinka ustida. */
  plated?: boolean
  /** Ko'tarilish marosimi: eng yangi katakcha bir marta to'ladi (`.crest__cell--fill`). */
  animate?: boolean
}) {
  const lit = Math.max(0, Math.min(6, Math.floor(level)))
  const title = levelTitle(level, legendaTier)
  const vw = lit === 6 ? 88 : 72
  const width = Math.round(((height * vw) / 26) * 100) / 100
  return (
    <svg
      className="crest"
      data-tier={lit}
      viewBox={`-3 -3 ${vw} 26`}
      width={width}
      height={height}
      role="img"
      aria-label={title === null ? 'Hali darajasiz' : `${level}-daraja · ${title}`}
    >
      {plated && <use href={lit === 6 ? '#crest-plate-6' : '#crest-plate'} />}
      <use href={`#crest-${lit}`} />
      {animate && lit > 0 && (
        <use href="#ch" x={(lit - 1) * 11} className="crest__cell--fill" style={{ fill: 'currentColor' }} />
      )}
    </svg>
  )
}
