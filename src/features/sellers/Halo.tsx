/**
 * Rank tangasi — «ZARB» (spec §3). Zarb qilingan tanga SVG: metall halqa,
 * botiq maydon va yo'l-raqam (`#halo-1..3`, shrift yo'q); `small` — komanda
 * ranklari uchun soddaroq `#halo-sm-N`; `wreath` — P1 va sahnada tashqi dafna
 * (`#halo-laurel`, 84 birlik quti, tanga ostida).
 *
 * O'lchamlar: P1 66 (dafna bilan), P2/P3 56, sahna 84 (dafna), komanda 30.
 * 3 dan katta rank — TANGA YO'Q (hech narsa chizilmaydi).
 *
 * Metall — bezak: rank raqamning o'zida, va o'rindiq `aria-label` bilan o'rnini
 * aytadi, shuning uchun tanga `aria-hidden`.
 */
export type HaloMetal = 'gold' | 'silver' | 'bronze' | 'none'

export function metalOfRank(rank: number): HaloMetal {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'none'
}

export function Halo({
  rank,
  size,
  small = false,
  wreath = false,
}: {
  rank: number
  size: number
  /** Komanda ranklari — `#halo-sm-N`. */
  small?: boolean
  /** P1 va sahna — tashqi dafna. */
  wreath?: boolean
}) {
  if (rank !== 1 && rank !== 2 && rank !== 3) return null
  return (
    <span className="halo-box" style={{ width: size, height: size }}>
      <svg className="halo" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        {wreath && <use href="#halo-laurel" x="-10" y="-10" width="84" height="84" />}
        <use href={`#halo-${small ? 'sm-' : ''}${rank}`} />
      </svg>
    </span>
  )
}
