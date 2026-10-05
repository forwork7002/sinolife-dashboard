'use client'

import { PRODUCT_FILTER_OPTIONS, PRODUCT_TONE } from '@/features/target/targetTheme'

import { type DashboardBrand, useDashboardFilters } from './useDashboardFilters'

/**
 * «Hammasi · Collagen · Zextra» — narrows the whole screen to one brand.
 *
 * The house segmented control, with each brand's identity colour as a dot
 * (`PRODUCT_TONE`), so the switch already speaks the colour the comparisons
 * and charts use. Born on «Target tahlili»; every main screen carries it
 * since 2026-10-05 («zextraga qancha, collagenga qancha»).
 */
export function BrandSwitch({
  value,
  onChange,
}: {
  value: DashboardBrand
  onChange: (next: DashboardBrand) => void
}) {
  return (
    <div
      role="group"
      aria-label="Brend"
      className="flex items-center gap-0.5 rounded-lg p-0.5"
      style={{ background: 'var(--grid)' }}
    >
      {PRODUCT_FILTER_OPTIONS.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className="focusable inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
            style={{
              background: active ? 'var(--surface-raised)' : 'transparent',
              boxShadow: active ? 'var(--shadow-card)' : 'none',
              color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            }}
          >
            {option.value !== 'all' && (
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: PRODUCT_TONE[option.value] }}
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
      onChange={(next) => update({ brand: next === 'all' ? undefined : next })}
    />
  )
}
