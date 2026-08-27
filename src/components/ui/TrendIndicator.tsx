import { ArrowDownGlyph, ArrowUpGlyph } from '@/components/ui/Icons'
import { Tooltip } from '@/components/ui/Tooltip'
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
 * The arrow is a drawn glyph from Icons.tsx, not the ↑/↓ characters — those
 * shifted weight and baseline with the font. It still carries the direction
 * alongside the colour, so the meaning survives for a colourblind reader and
 * in forced-colors mode.
 *
 * The exact figures behind a pill (the un-rounded percentage, the previous →
 * current pair) travel in the Tooltip primitive rather than a native `title`:
 * hover, touch and the tip's own styling included. The pills are NOT tab
 * stops — a table renders hundreds of them, and a keyboard user who had to
 * Tab through every delta to reach the next control would pay for a nicety
 * the visible text already states.
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
      <Tooltip
        className={className}
        content={
          <span className="tabular">
            Oldingi davr juda kichik: {formatNumber(delta.previous)} →{' '}
            {formatNumber(delta.current)}
          </span>
        }
      >
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-medium"
          style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
        >
          {t.delta.small_base}
        </span>
      </Tooltip>
    )
  }

  if (delta.kind === 'no_baseline') {
    return (
      <Tooltip className={className} content="Oldingi davrda maʼlumot boʻlmagan">
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-medium"
          style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
        >
          {t.delta.no_baseline}
        </span>
      </Tooltip>
    )
  }

  const isGood = inverted ? delta.direction === 'down' : delta.direction === 'up'
  const color = isGood ? 'var(--delta-up)' : 'var(--delta-down)'
  const Arrow = delta.direction === 'up' ? ArrowUpGlyph : ArrowDownGlyph

  /*
    A pill, not bare coloured text.

    The 12% tint of the delta's own colour gives the change a shape the eye
    can find in a row of tiles before reading anything — and the text keeps
    its full text-grade colour on top of it, so contrast is untouched. The
    arrow glyph still carries direction alongside the colour for colourblind
    readers and forced-colors mode.

    The tooltip names the window — "oldingi davrga nisbatan" — which is the
    comparison caption's job wherever a delta renders, and states the exact
    percentage even when the pill shows the ×N form.
  */
  return (
    <Tooltip
      className={className}
      content={
        <span className="tabular">
          {formatPercent(Math.abs(delta.percent))} oldingi davrga nisbatan
        </span>
      }
    >
      <span
        className="tabular inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold"
        style={{
          color,
          background: `color-mix(in oklab, ${color} 12%, transparent)`,
        }}
      >
        <Arrow size={11} className="shrink-0" />
        {formatChange(Math.abs(delta.percent))}
      </span>
    </Tooltip>
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
