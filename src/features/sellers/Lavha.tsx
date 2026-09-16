import { levelTitle } from '@/features/sellers/medalCatalog'

/**
 * Daraja lavhasi — pagon silueti, uch sinf, 1–3 xatam yulduz.
 *
 * Geometriya `medalDefs.ts` dagi belgilarda; bu yerda faqat QAYSI belgi,
 * QAYERGA. Koordinatalar plastina markazidan (36,7 ixcham; 132,1 seat) —
 * ustaning o'lchovi, ko'z bilan emas. Ranglar CSS'da (`.lavha[data-level]`),
 * ya'ni mavzu almashganda hech narsa qayta chizilmaydi.
 */
export type LavhaSize = 'row' | 'narvon' | 'ghost' | 'seat'

const DIMS: Readonly<Record<LavhaSize, readonly [number, number]>> = {
  row: [78, 26],
  narvon: [102, 34],
  ghost: [120, 40],
  seat: [280, 88],
}
/** Sinf ichidagi yulduz soni: 1–3 oddiy, 4–5 faxriy (1, 2). Legenda alohida. */
const STARS_OF: Readonly<Record<number, 1 | 2 | 3>> = { 1: 1, 2: 2, 3: 3, 4: 1, 5: 2 }
const COMPACT_X = { 1: 28.7, 2: 18.7, 3: 8.7 } as const
const COMPACT_W = { 1: 16, 2: 36, 3: 56 } as const
const SEAT_X = { 1: 118.1, 2: 100.6, 3: 83.1 } as const
const SEAT_W = { 1: 28, 2: 63, 3: 98 } as const
/** Seat'da yulduzlar 16 birlikdan 28 px ga — 4 birlik oraliq 7 px, qadam 35. */
const SEAT_STEP = 35

export function Lavha({
  level,
  legendaTier = 0,
  size,
  ghost = false,
  title,
  animate = false,
}: {
  level: number
  legendaTier?: number
  size: LavhaSize
  /** Keyingi lavhaning sharpasi — shtrix kontur, yulduzlari xira. */
  ghost?: boolean
  /** Seat yozuvi; berilmasa `levelTitle`. */
  title?: string | null
  /** Ko'tarilish marosimi: har yulduz alohida, tushish animatsiyasi bilan. */
  animate?: boolean
}) {
  const [w, h] = DIMS[size]
  const seat = size === 'seat'
  const apex = level === 6
  const stars = STARS_OF[level]
  const label = title === undefined ? levelTitle(level, legendaTier) : title
  const ariaLabel = level === 0 || label === null ? 'Hali darajasiz' : `${level}-daraja · ${label}`

  return (
    <svg
      className={`lavha lavha--${size}`}
      data-level={level}
      data-ghost={ghost ? '' : undefined}
      viewBox={seat ? '0 0 280 88' : '0 0 78 26'}
      width={w}
      height={h}
      role="img"
      aria-label={ariaLabel}
    >
      {seat ? (
        <>
          <use href="#lavha-plate-seat" className="lavha__plate" />
          {!ghost && level > 0 && (
            <>
              <use href="#lavha-hi-seat" className="lavha__hi" />
              <use href="#lavha-lo-seat" className="lavha__lo" />
            </>
          )}
          {apex && !ghost && <use href="#lavha-rim-seat" className="lavha__engrave" />}
          {apex && (
            <use
              href="#khatam"
              className={`lavha__star${animate ? ' lavha__star--drop' : ''}`}
              x={114.1}
              y={11}
              width={36}
              height={36}
            />
          )}
          {!apex && stars !== undefined && !animate && (
            <use
              href={`#lavha-stars-${stars}`}
              className="lavha__star"
              x={SEAT_X[stars]}
              y={15}
              width={SEAT_W[stars]}
              height={28}
            />
          )}
          {!apex && stars !== undefined && animate &&
            Array.from({ length: stars }, (_, i) => (
              <use
                key={i}
                href="#khatam"
                className="lavha__star lavha__star--drop"
                style={{ animationDelay: `${i * 80}ms` }}
                x={Math.round((SEAT_X[stars] + i * SEAT_STEP) * 10) / 10}
                y={15}
                width={28}
                height={28}
              />
            ))}
          {level > 0 && label !== null && (
            <text className="lavha__title" x={132.1} y={73} textAnchor="middle">
              {label.toUpperCase()}
            </text>
          )}
        </>
      ) : (
        <>
          <use href="#lavha-plate-3x1" className="lavha__plate" />
          {apex && !ghost && <use href="#lavha-rim-3x1" className="lavha__engrave" />}
          {apex && <use href="#khatam" className="lavha__star" x={28.7} y={5} width={16} height={16} />}
          {!apex && stars !== undefined && (
            <use
              href={`#lavha-stars-${stars}`}
              className="lavha__star"
              x={COMPACT_X[stars]}
              y={5}
              width={COMPACT_W[stars]}
              height={16}
            />
          )}
        </>
      )}
    </svg>
  )
}
