/**
 * Which brand a PRODUCT is — the brand switch's rule for a sale (the client,
 * 2026-10-06: «Mahsulot bo'yicha»). An order is the brand of the product it
 * was paid for: the deal's line items (`deal_item`), not the team that sold
 * it — a Collagen team selling Prox was Collagen money under the team rule.
 *
 * The catalogue names its products in Latin («Collagen Marine Sinolife»,
 * «Collagen Tabletka Bovine», «Zextra sure», «Zextra maz»); everything else
 * (Prox, the Tibomed line, Omega, D3+K2, Sedana …) is neither brand's.
 *
 * ONE PATTERN, TWO READERS: `productBrand` here, and the SQL the
 * repositories build from `PRODUCT_BRAND_PATTERNS` (`dealProductBrandSql`) —
 * Postgres `~*` on Latin is ctype-safe, and the patterns carry no Cyrillic.
 * Zextra is asked first, so a bundle named for both reads Zextra in both.
 */

import type { TargetProduct } from '../types'

export const PRODUCT_BRAND_PATTERNS: readonly (readonly [TargetProduct, string])[] = [
  ['Zextra', 'zextra'],
  ['Collagen', 'collagen|kollagen'],
]

export function productBrand(name: string | null | undefined): TargetProduct | null {
  if (!name) return null
  for (const [brand, pattern] of PRODUCT_BRAND_PATTERNS) {
    if (new RegExp(pattern, 'i').test(name)) return brand
  }
  return null
}

/**
 * What a deal's line items say about its brand, as `dealProductBrandSql`
 * answers it: the brand of the product carrying the most PAID money (a free
 * gift — Omega at 0 — decides nothing), `'-'` when that product is neither
 * brand's, null when the deal has no line items at all.
 */
export type DealProductBrand = TargetProduct | '-' | null
