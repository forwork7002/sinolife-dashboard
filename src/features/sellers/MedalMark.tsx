import { MEDALS, MEDAL_METAL, isKnownMedal, isMonthMedal } from '@/features/sellers/medalCatalog'
import type { MedalCode } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** ×N plastinkasidagi eng katta son — ikki raqamdan ortig'i plastinkaga sig'maydi. */
const COUNT_CAP = 99

/**
 * Bitta medal — «ZARB» (klassik taxta spec §1.4). 32 birlik quti, tanasi BITTA
 * `<use href="#m-<code>">`: metall, planchet va belgi `medalDefs.ts` dagi
 * belgining ichida, instance hech narsa bo'yamaydi. Sahifada `MedalDefs`
 * bir marta o'rnatilgan bo'lishi SHART — usiz `<use>` hech narsaga ishora
 * qilmaydi.
 *
 * PODIUM KARTASIDA (`seat`) ikki qo'shimcha, ikkalasi ham SVG ICHIDA:
 * - Oy oilasi ≥ 40 px da dafna (`#m-laurel-<metal>`) tanadan OLDIN chiziladi;
 * - `count > 1` da ×N plastinkasi — tana metallining rim gradienti, botiq
 *   quduq va yo'l-raqamlar (`#nx`, `#n0..n9`; shrift yo'q), 99 da qisiladi.
 * Qatorda (`seat` yo'q) ikkalasi ham YO'Q — qator hech qachon sanoq bermaydi.
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
  /** Podium kartasining tokchasi: dafna (oy, ≥ 40 px) va ×N plastinkasi faqat shu yerda. */
  seat?: boolean
  /** Oxirgi yangilanishda paydo bo'lgan — bir marta 0,6 → 1 kattalashadi. */
  isNew?: boolean
}) {
  // Notanish kod (server bu nusxadan oldin deploy bo'lgan) — hech narsa chizilmaydi, ustun yiqilmaydi.
  if (!isKnownMedal(code)) return null
  const { body, dev } = MEDAL_METAL[code]
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
      {seat && size >= 40 && isMonthMedal(code) && <use href={`#m-laurel-${body}`} />}
      <use href={`#m-${code}`} />
      {seat && count > 1 && <CountPlate count={count} body={body} dev={dev} />}
    </svg>
  )
}

/** Mirrors `gen_final.py` `medal()` — plastinka geometriyasi aynan mockdagidek. */
function CountPlate({ count, body, dev }: { count: number; body: string; dev: string }) {
  const digits = String(Math.min(count, COUNT_CAP)).split('')
  const w = digits.length === 1 ? 15 : 19.8
  const x0 = 31.8 - w
  const glyphs = ['x', ...digits]
  const step = 4.9
  const scale = 0.54
  let gx = x0 + (w - glyphs.length * step) / 2 + step / 2
  const uses = glyphs.map((g, i) => {
    const x = gx
    gx += step
    return (
      <use
        key={i}
        href={`#n${g}`}
        transform={`translate(${x.toFixed(2)} 26.7) scale(${(g === 'x' ? scale * 0.78 : scale).toFixed(3)})`}
      />
    )
  })
  return (
    <>
      <rect
        className="medal-mark__plate-rim"
        x={x0.toFixed(2)}
        y="21.2"
        width={w}
        height="10.6"
        rx="2.6"
        fill={`url(#mg-${body}-rim)`}
      />
      <rect className="medal-mark__plate-well" x={(x0 + 1.1).toFixed(2)} y="22.3" width={(w - 2.2).toFixed(2)} height="8.4" rx="1.7" />
      <g className="medal-mark__count" data-dev={dev}>
        {uses}
      </g>
    </>
  )
}
