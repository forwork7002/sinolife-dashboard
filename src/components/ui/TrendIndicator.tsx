import type { DeltaDto } from '@/lib/api'
import { formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Period-over-period change.
 *
 * Renders every case the domain layer can produce, and renders them
 * differently on purpose:
 *
 *   change      -> a signed percentage with an arrow, or a multiple past ×2
 *   unchanged   -> "no change", not "0%"
 *   no_baseline -> "no baseline", because a percentage against zero is undefined
 *   small_base  -> "small base" with the pair, because a ratio off one deal
 *                  is arithmetic rather than information
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

  if (delta.kind === 'small_base') {
    return (
      <span
        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${className}`}
        style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
        title={`Oldingi davr juda kichik: ${formatNumber(delta.previous)} → ${formatNumber(delta.current)}`}
      >
        {t.delta.small_base}
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
 * A change, at a size a person can read — and in a way a column can be scanned.
 *
 * The switch is at 100%, not 300%, and the reason is legibility rather than
 * arithmetic. With the old threshold a column could hold «292.7%» beside
 * «×5.1»: the first is the SMALLER growth and prints the bigger numeral, and
 * both wore the same arrow and colour. A reader ranking the column by eye got
 * it backwards.
 *
 * At 100% the two forms no longer overlap in meaning. Every «%» is a change
 * under a doubling; every «×» is at least a doubling. Whatever the digits, a
 * row with × outgrew a row with %.
 *
 * The exact percentage stays in the tooltip, because it is still the number
 * the calculation produced.
 */
function formatChange(percent: number): string {
  if (percent >= 100) {
    const multiple = 1 + percent / 100
    return `×${multiple >= 10 ? Math.round(multiple) : Math.round(multiple * 10) / 10}`
  }
  return formatPercent(percent)
}
