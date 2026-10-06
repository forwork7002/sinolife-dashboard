import { describe, expect, it } from 'vitest'

import { BRAND_FILTERS, brandMatches } from '@/server/domain/types'

describe('brandMatches — the brand switch', () => {
  it('keeps everything on «Hammasi», one brand on its own slice, the brandless on «Brendsiz»', () => {
    expect(brandMatches('all', null)).toBe(true)
    expect(brandMatches('Collagen', 'Collagen')).toBe(true)
    expect(brandMatches('Collagen', 'Zextra')).toBe(false)
    expect(brandMatches('Collagen', null)).toBe(false)
    expect(brandMatches('none', null)).toBe(true)
    expect(brandMatches('none', undefined)).toBe(true)
    expect(brandMatches('none', 'Zextra')).toBe(false)
  })

  it('partitions: every brand, and none, lands on exactly one of the three slices', () => {
    const slices = BRAND_FILTERS.filter((f) => f !== 'all')
    for (const brand of ['Collagen', 'Zextra', null] as const) {
      expect(slices.filter((f) => brandMatches(f, brand))).toHaveLength(1)
    }
  })
})
