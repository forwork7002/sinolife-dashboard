import { describe, expect, it } from 'vitest'

import { PRODUCT_BRAND_PATTERNS, productBrand } from '@/server/domain/products/productBrand'
import { saleBrand } from '@/server/domain/rnp/rnpSheet'

describe('productBrand — the portal catalogue as read 2026-10-06', () => {
  it('reads the two brands\' products', () => {
    for (const name of ['Collagen Marine Sinolife', 'Collagen Tabletka Sinolife', 'Collagen Tabletka Marine new', 'Collagen Tabletka Bovine', 'Collagen Marmelad Sinolife', 'Sinolife collagen marine kakao']) {
      expect(productBrand(name)).toBe('Collagen')
    }
    expect(productBrand('Zextra sure')).toBe('Zextra')
    expect(productBrand('Zextra maz')).toBe('Zextra')
  })

  it('files every other product under neither brand', () => {
    for (const name of ['Prox', 'Shokolad Prox', 'Omega Tibomed', 'Omega Sinolife 500', 'Big Omega Sinolife 1000', 'D3+K2 Marmelad Sinolife', 'Sedana Sinolife', 'Inositol Sinolife', 'Vitex Tibomed', 'HLT', null]) {
      expect(productBrand(name)).toBeNull()
    }
  })

  it('carries no Cyrillic in the SQL patterns — Postgres ~* folds Latin case whatever the ctype', () => {
    for (const [, pattern] of PRODUCT_BRAND_PATTERNS) expect(pattern).toMatch(/^[a-z|]+$/)
  })
})

describe('saleBrand', () => {
  it('is the product\'s brand; «Brendsiz» for another product; the team only with no line item', () => {
    expect(saleBrand('Zextra', 'Sevinch')).toBe('Zextra')
    expect(saleBrand('-', 'Asliddin')).toBeNull()
    expect(saleBrand(null, 'Asliddin')).toBe('Zextra')
    expect(saleBrand(null, 'Malika')).toBe('Zextra')
    expect(saleBrand(null, 'Hayot')).toBeNull()
  })
})
