'use client'

import { PRODUCT_FILTER_OPTIONS, PRODUCT_TONE } from '@/features/target/targetTheme'

import { type DashboardBrand, useDashboardFilters } from './useDashboardFilters'

/**
 * Collagen or Zextra — the slices under which what carries no brand (Сарафан,
 * inbound calls, undistributed leads, HR · Kosmetika) is not shown: it is
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
    // SegmentedControl's glass well and chip, radius and 32px — the two sit in
    // one filter row on every main screen and must read as one control.
    <div
      role="group"
      aria-label="Brend"
      className="flex items-center gap-0.5 rounded-[var(--radius-panel-sm)] p-0.5"
      style={{ background: 'var(--glass-well)' }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            // The lit chip's shadow is a class so the focus ring can win it.
            className={`focusable inline-flex h-7 items-center gap-1.5 rounded-[calc(var(--radius-panel-sm)-2px)] px-3 text-xs font-medium whitespace-nowrap transition-colors ${active ? 'shadow-[var(--glass-highlight),var(--shadow-card)]' : ''}`}
            style={{
              background: active ? 'var(--glass-raised)' : 'transparent',
              color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            }}
          >
            {option.value !== 'all' && (
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: TONE[option.value as Exclude<DashboardBrand, 'all'>] }}
              />
            )}
            {option.label}
          </button>
        )
      })}
    </div>
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
