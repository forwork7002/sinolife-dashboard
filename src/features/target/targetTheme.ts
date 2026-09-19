/**
 * «Target tahlili»'s shared vocabulary: what a product is called, which colour
 * is its identity, and how a dollar figure is printed.
 *
 * ONE COLOUR PER PRODUCT, EVERYWHERE ON THE SCREEN. Collagen is series slot 4,
 * Zextra slot 1 — identity colours, fixed by entity (docs/DESIGN.md: colour
 * follows the entity, never its rank). The switch, the comparison, the split
 * bars and every chip read these two, so filtering to one product never
 * repaints the other.
 */

import { NO_VALUE } from '@/lib/format'

import type { MetaProduct, TargetProductFilter } from './targetApi'

export const PRODUCT_LABEL: Readonly<Record<MetaProduct, string>> = {
  Collagen: 'Collagen',
  Zextra: 'Zextra',
  Boshqa: 'Boshqa',
}

export const PRODUCT_TONE: Readonly<Record<MetaProduct, string>> = {
  Collagen: 'var(--series-4)',
  Zextra: 'var(--series-1)',
  Boshqa: 'var(--axis)',
}

export const PRODUCT_FILTER_OPTIONS: readonly { value: TargetProductFilter; label: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'Collagen', label: 'Collagen' },
  { value: 'Zextra', label: 'Zextra' },
]

const usdCents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdWhole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/**
 * «12.23 $» below a thousand, «24 388 $» above — cents are the point of a
 * unit cost and noise on a period's spend. `exact` forces the cents.
 */
export function usd(value: number | null, exact = false): string {
  if (value === null || !Number.isFinite(value)) return NO_VALUE
  const text = exact || Math.abs(value) < 1000 ? usdCents.format(value) : usdWhole.format(value)
  return `${text.replace(/,/g, ' ')} $`
}

/** A cell of dollars with cents and no unit — the «Лид база» grid. */
export function usdCell(value: number): string {
  return usdCents.format(value).replace(/,/g, ' ')
}
