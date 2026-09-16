import type { Metal } from '@/features/sellers/medalCatalog'

/**
 * Rank raqami metall halqada (spec §4): 1 — oltin, 2 — kumush, 3 — bronza,
 * qolgani xira halqa. Metall — bezak: rank raqamning o'zida, va o'rindiq
 * `aria-label` bilan o'rnini aytadi, shuning uchun halqa `aria-hidden`.
 * O'lchamlar CSS'da (`.halo--lg` 80/44, `.halo--md` 64/32; 1366 da 56/48).
 */
export type HaloMetal = Metal | 'none'

export function metalOfRank(rank: number): HaloMetal {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'none'
}

export function Halo({ rank, size }: { rank: number; size: 'lg' | 'md' }) {
  return (
    <span className={`halo halo--${size}`} data-metal={metalOfRank(rank)} aria-hidden="true">
      {rank}
    </span>
  )
}
