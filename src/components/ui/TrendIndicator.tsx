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
      title={`${formatPercent(Math.abs(delta.percent))} oldingi davrga nisbatan`}
    >
      <span aria-hidden="true">{arrow}</span>
      {formatChange(Math.abs(delta.percent))}
    </span>
  )
}

/**
 * A change, at a size a person can read.
 *
 * Past roughly threefold, a percentage stops informing: "+15 157.8%" takes a
 * moment of arithmetic to become "about 150 times", and the precision is
 * spurious anyway when the baseline was a handful of deals. So large changes
 * are stated as a multiple, which is how anyone would say it out loud.
 *
 * The exact percentage stays in the tooltip, because it is still the number
 * the calculation produced.
 */
function formatChange(percent: number): string {
  if (percent >= 300) {
    const multiple = 1 + percent / 100
    return `×${multiple >= 10 ? Math.round(multiple) : Math.round(multiple * 10) / 10}`
  }
  return formatPercent(percent)
}
