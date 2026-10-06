/**
 * Which brand a PRODUCT is — the brand switch's rule for a sale (the client,
 * 2026-10-06: «Mahsulot bo'yicha»). An order is the brand most of its money
 * was paid for: the deal's line items (`deal_item`), not the team that sold
 * it — a Collagen team selling Prox was Collagen money under the team rule.
 *
 * The catalogue names its products in Latin («Collagen Marine Sinolife»,
 * «Collagen Tabletka Bovine», «Zextra sure», «Zextra maz»); everything else
 * (Prox, the Tibomed line, Omega, D3+K2, Sedana …) is neither brand's.
 *
 * The patterns are read by SQL (`InsightsRepository.dealProductBrandSql`,
 * Postgres `~*`: case-insensitive, and Latin folds the same whatever the
 * database's ctype — so no Cyrillic here). Zextra is asked first, so a
 * bundle named for both reads Zextra.
 */

import type { TargetProduct } from '../types'

export const PRODUCT_BRAND_PATTERNS: readonly (readonly [TargetProduct, string])[] = [
  ['Zextra', 'zextra'],
  ['Collagen', 'collagen|kollagen'],
]

/**
 * What a deal's line items say about its brand, as `dealProductBrandSql`
 * answers it: the brand its paid lines mostly went to, `'-'` when that is
 * neither brand's products, null when the deal has no paid line at all (no
 * line items, or only gifts) — `saleBrand` then reads the selling team.
 */
export type DealProductBrand = TargetProduct | '-' | null
