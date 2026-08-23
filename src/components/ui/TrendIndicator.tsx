import type { DeltaDto } from '@/lib/api'
import { formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Period-over-period change.
 *
 * Renders every case the domain layer can produce, and renders them
 * differently on purpose:
 *
 *   change      -> a signed percentage with an arrow
 *   unchanged   -> "no change", not "0%"
 *   no_baseline -> "new", because a percentage against zero is undefined
 *   no_data     -> an em dash
 *
 * The arrow glyph carries the direction alongside the colour, so the meaning
 * survives for a colourblind reader and in forced-colors mode.
 *
 * `inverted` is for metrics where up is bad. Nothing uses it yet; it exists so
 * that when a "lost deals" card appears, the fix is a prop rather than a
 * special case wired through the component.
 */
export function TrendIndicator({
  delta,
  inverted = false,
  className = '',
}: {
  delta: DeltaDto
  inverted?: boolean
  className?: string
}) {
  if (delta.kind === 'no_data') {
    return (
      <span className={`text-xs ${className}`} style={{ color: 'var(--ink-muted)' }}>
        {t.delta.no_data}
      </span>
    )
  }

  if (delta.kind === 'unchanged') {
    return (
      <span className={`text-xs ${className}`} style={{ color: 'var(--ink-muted)' }}>
        {t.delta.unchanged}
      </span>
    )
  }

  if (delta.kind === 'no_baseline') {
    return (
      <span
        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${className}`}
        style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
        title="Oldingi davrda maʼlumot boʻlmagan"
      >
        {t.delta.no_baseline}
      </span>
    )
  }

  const isGood = inverted ? delta.direction === 'down' : delta.direction === 'up'
  const color = isGood ? 'var(--delta-up)' : 'var(--delta-down)'
  const arrow = delta.direction === 'up' ? '↑' : '↓'

  return (
    <span
      className={`tabular inline-flex items-center gap-0.5 text-xs font-medium ${className}`}
      style={{ color }}
    >
      <span aria-hidden="true">{arrow}</span>
      {formatPercent(Math.abs(delta.percent))}
    </span>
  )
}
