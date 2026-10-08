'use client'

import { SegmentedControl } from '@/components/ui/Controls'
import { PRODUCT_FILTER_OPTIONS, PRODUCT_TONE } from '@/features/target/targetTheme'

import { type DashboardBrand, useDashboardFilters } from './useDashboardFilters'

/**
 * Collagen or Zextra — the slices under which what carries no brand (inbound
 * calls, undistributed leads, HR · Kosmetika) is not shown: it is
 * «Brendsiz»'s, and «Hammasi»'s.
 */
export function isOneBrand(brand: string | undefined): brand is 'Collagen' | 'Zextra' {
  return brand === 'Collagen' || brand === 'Zextra'
}

/** What each slice of the switch is called on screen. */
export const BRAND_LABEL: Readonly<Record<DashboardBrand, string>> = {
  all: 'Hammasi',
  Collagen: 'Collagen',
  Zextra: 'Zextra',
  none: 'Brendsiz',
}

/**
 * The main screens' slices: «Brendsiz» after the two brands, so a reader can
 * add the three and land on «Hammasi» (the client, 2026-10-06).
 */
const DASHBOARD_BRAND_OPTIONS: readonly { value: DashboardBrand; label: string }[] = [
  ...PRODUCT_FILTER_OPTIONS,
  { value: 'none', label: BRAND_LABEL.none },
]

const TONE: Readonly<Record<Exclude<DashboardBrand, 'all'>, string>> = {
  Collagen: PRODUCT_TONE.Collagen,
  Zextra: PRODUCT_TONE.Zextra,
  none: PRODUCT_TONE.Boshqa,
}

/**
 * «Hammasi · Collagen · Zextra (· Brendsiz)» — narrows the whole screen to one slice.
 *
 * The house segmented control, with each brand's identity colour as a dot
 * (`PRODUCT_TONE`), so the switch already speaks the colour the comparisons
 * and charts use. Born on «Target tahlili» (which offers the two brands
 * only); every main screen carries it since 2026-10-05 («zextraga qancha,
 * collagenga qancha»), with «Brendsiz» since 2026-10-06.
 */
export function BrandSwitch<T extends DashboardBrand>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly { value: T; label: string }[]
}) {
  return (
    // The house segmented control itself — it was a copy of it that differed
    // only by the dot, and the two share a filter row on every main screen.
    <SegmentedControl<T>
      ariaLabel="Brend"
      value={value}
      onChange={onChange}
      options={options.map((option) => ({
        ...option,
        swatch: option.value === 'all' ? undefined : TONE[option.value as Exclude<DashboardBrand, 'all'>],
      }))}
    />
  )
}

/** The switch bound to the address (`?brand=`), for the screens that read it from there. */
export function DashboardBrandSwitch() {
  const { filters, update } = useDashboardFilters()
  return (
    <BrandSwitch
      value={filters.brand}
      options={DASHBOARD_BRAND_OPTIONS}
      onChange={(next) => update({ brand: next === 'all' ? undefined : next })}
    />
  )
}
