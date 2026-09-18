import { MEDALS, MEDAL_METAL, isKnownMedal, type Metal } from '@/features/sellers/medalCatalog'
import type { MedalCode } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** ×N chipidagi eng katta son — ikki raqamdan ortig'i chipga sig'maydi. */
const COUNT_CAP = 99

/**
 * Bitta medal — «EMAL» (klassik taxta spec §1.4; EMAL spec 2026-09-18). 32
 * birlik quti, tanasi BITTA `<use href="#m-<code>">`: halqa, emal maydon va
 * belgi `medalDefs.ts` dagi belgining ichida, instance hech narsa bo'yamaydi.
 * Sahifada `MedalDefs` bir marta o'rnatilgan bo'lishi SHART — usiz `<use>`
 * hech narsaga ishora qilmaydi.
 *
 * PODIUM KARTASIDA (`seat`) bitta qo'shimcha, SVG ICHIDA: `count > 1` da ×N
 * chipi — taxtaning o'z chipi (halqaning pastki o'ng chetiga o'rnatilgan
 * pilyula, hairline'i tana metallida, raqami sahifa shriftida), 99 da qisiladi.
 * Qatorda (`seat` yo'q) chip YO'Q — qator hech qachon sanoq bermaydi. Dafna
 * yo'q (EMAL: oy medali to'liq metall disk, o'rinni metall aytadi).
 *
 * NOMI BIR MARTA. `role="img"` + `aria-label` nomni va ×N ni o'zi aytadi.
 */
export function MedalMark({
  code,
  size = 28,
  count = 1,
  seat = false,
  isNew = false,
}: {
  code: MedalCode
  size?: number
  count?: number
  /** Podium kartasining tokchasi: ×N chipi faqat shu yerda. */
  seat?: boolean
  /** Oxirgi yangilanishda paydo bo'lgan — bir marta 0,6 → 1 kattalashadi. */
  isNew?: boolean
}) {
  // Notanish kod (server bu nusxadan oldin deploy bo'lgan) — hech narsa chizilmaydi, ustun yiqilmaydi.
  if (!isKnownMedal(code)) return null
  const { body } = MEDAL_METAL[code]
  const label = count > 1 ? `${MEDALS[code].name} ×${formatNumber(count)}` : MEDALS[code].name
  return (
    <svg
      className={isNew ? 'medal-mark medal-mark--new' : 'medal-mark'}
      data-medal={code}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label={label}
    >
      <use href={`#m-${code}`} />
      {seat && count > 1 && <CountChip count={count} body={body} />}
    </svg>
  )
}

/** ×N — the board's own chip set into the ring's lower right. 32-box units. Mirrors chip() in docs/superpowers/specs/assets/2026-09-18-emal-medallar/lib.js. */
function CountChip({ count, body }: { count: number; body: Exclude<Metal, 'gilt'> }) {
  const n = String(Math.min(count, COUNT_CAP))
  const w = n.length === 1 ? 15.4 : 20.2
  const h = 10.4
  const x0 = 34.4 - w // right edge x = 34.4: the chip leaves the 32 box by 2.4u right and 2u below (3 px / 2.5 px at 40 px)
  const y0 = 23.6
  const g = 1 // the knock-out gap, in the card's colour
  const r = (v: number) => v.toFixed(2)
  return (
    <g className="medal-mark__n" data-metal={body}>
      <rect className="medal-mark__n-gap" x={r(x0 - g)} y={r(y0 - g)} width={r(w + 2 * g)} height={r(h + 2 * g)} rx={r(h / 2 + g)} />
      <rect className="medal-mark__n-pill" x={r(x0)} y={r(y0)} width={w} height={h} rx={r(h / 2)} />
      <text className="medal-mark__n-text" x={r(x0 + w / 2 - 0.15)} y={r(y0 + h / 2 + 3.05)}>
        <tspan className="medal-mark__n-x">×</tspan>
        {n}
      </text>
    </g>
  )
}
