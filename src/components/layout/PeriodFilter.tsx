'use client'

import { t } from '@/lib/messages'

/**
 * The global period control.
 *
 * A single source of truth for the reporting window, lifted to the page so
 * every card and chart on screen answers for the same dates. Presets only:
 * a custom range picker is a larger component and the API already supports
 * `preset=custom&from=&to=`, so it slots in here without touching anything
 * downstream.
 */

export const PERIOD_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'previous_month',
  'this_year',
] as const

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

export function PeriodFilter({
  value,
  onChange,
}: {
  value: PeriodPreset
  onChange: (preset: PeriodPreset) => void
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border p-0.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
      role="group"
      aria-label={t.period.label}
    >
      {PERIOD_PRESETS.map((preset) => {
        const active = preset === value
        return (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-pressed={active}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
            style={{
              background: active ? 'var(--ink-primary)' : 'transparent',
              color: active ? 'var(--surface)' : 'var(--ink-secondary)',
            }}
          >
            {t.period[preset]}
          </button>
        )
      })}
    </div>
  )
}
