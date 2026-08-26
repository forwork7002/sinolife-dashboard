import type { ReactNode } from 'react'

import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'

/**
 * The headline tile.
 *
 * One number, large enough to read across a desk, with its label above and its
 * context below. The context slot takes a delta, a meter or a sparkline —
 * whichever actually explains the number — because a figure with no reference
 * point cannot be judged, and a row of bare numbers is a report nobody acts on.
 *
 * `tone` colours the value only for genuinely evaluative figures (a delivery
 * rate, a margin). Ordinary counts and amounts stay in primary ink: colouring
 * every number spends the reader's attention on the ones that do not need it.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  context,
  tone = 'neutral',
  accent,
}: {
  label: string
  value: number | null
  unit: 'money' | 'count' | 'percent' | 'hours' | 'raw'
  hint?: string
  context?: ReactNode
  tone?: 'neutral' | 'good' | 'warning' | 'critical'
  /** Optional leading colour chip, for tiles that belong to a named series. */
  accent?: string
}) {
  const toneColor =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'warning'
        ? 'var(--status-warning)'
        : tone === 'critical'
          ? 'var(--status-critical)'
          : 'var(--ink-primary)'

  return (
    <div className="card flex flex-col px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        {accent && (
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: accent }}
          />
        )}
        <p
          className="truncate text-[11px] font-medium tracking-wide uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          {label}
        </p>
      </div>

      <p
        className="figure mt-2 text-[26px] leading-none font-semibold"
        style={{ color: toneColor }}
        title={unit === 'money' && value !== null ? formatUzs(value) : undefined}
      >
        <StatValue value={value} unit={unit} />
      </p>

      {hint && (
        <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}

      {context && <div className="mt-2.5">{context}</div>}
    </div>
  )
}

/**
 * A value in its unit, or an em dash.
 *
 * Null renders as a dash and never as zero. The distinction carries real
 * weight here: "no orders were confirmed" and "confirmation is not recorded
 * for this operator" are different facts, and a zero would state the first
 * when the truth is the second.
 */
export function StatValue({
  value,
  unit,
}: {
  value: number | null
  unit: 'money' | 'count' | 'percent' | 'hours' | 'raw'
}) {
  if (value === null) return <>{NO_VALUE}</>

  switch (unit) {
    case 'money':
      return (
        <>
          {formatCompactUzs(value)}
          <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
            soʻm
          </span>
        </>
      )
    case 'percent':
      return <>{formatPercent(value)}</>
    case 'hours':
      return (
        <>
          {formatNumber(Math.round(value * 10) / 10)}
          <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
            soat
          </span>
        </>
      )
    case 'count':
      return <>{formatNumber(value)}</>
    case 'raw':
      return <>{value}</>
  }
}

/**
 * A proportion, drawn.
 *
 * The bar is the point: a delivery rate of 87% and one of 61% are hard to
 * separate as text in a long table and impossible to miss as two bars. The
 * numeric value stays beside it, so the reading never depends on estimating a
 * length, and the track keeps its full width whatever the value — a bar that
 * shrinks its own track cannot be compared to the row above it.
 */
export function Meter({
  value,
  tone = 'auto',
  label,
  width = 'w-full',
}: {
  /** Percentage, 0–100. */
  value: number | null
  /**
   * `auto` grades against the thresholds below; `neutral` states the magnitude
   * without judging it.
   *
   * There used to be an `accent` variant that painted the bar from --accent —
   * the page-identity colour. A bar's width encodes a value, so that made the
   * same proportion render orange on one screen and blue on another, and the
   * design contract exists precisely to stop that: colour follows the entity,
   * never the page it happens to be on. `neutral` is what those call sites
   * wanted — a magnitude drawn from the sequential ramp.
   */
  tone?: 'auto' | 'neutral'
  label?: string
  width?: string
}) {
  if (value === null) {
    return (
      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }

  /**
   * A negative proportion is a fact, not a zero.
   *
   * A product sold below cost has a negative margin. Clamping it into the bar
   * renders an empty track labelled "0.0%", which reads as "no margin" when
   * the truth is "we lost money on every unit". So the bar is dropped and the
   * number is stated in the critical colour instead — the one case where a
   * meter cannot represent its own value honestly.
   */
  if (value < 0) {
    return (
      <span
        className="tabular text-xs font-semibold"
        style={{ color: 'var(--status-critical)' }}
        title={label}
      >
        {formatPercent(value)}
      </span>
    )
  }

  const clamped = Math.min(100, value)

  /**
   * Thresholds are deliberately blunt: below 60 is a problem, below 85 is
   * worth a look, above that is fine. They exist so a scanning eye lands on
   * the bad rows, not to grade anyone precisely — the number does that.
   */
  const color =
    tone === 'neutral'
      ? 'var(--seq-450)'
      : clamped >= 85
        ? 'var(--status-good)'
        : clamped >= 60
          ? 'var(--status-warning)'
          : 'var(--status-critical)'

  return (
    <div className="flex items-center gap-2">
      <div
        className={`h-1.5 ${width} overflow-hidden rounded-full`}
        style={{ background: 'var(--grid)' }}
        role="img"
        aria-label={`${label ? `${label}: ` : ''}${formatPercent(clamped)}`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, background: color, transition: 'width 240ms ease-out' }}
        />
      </div>
      <span
        className="tabular shrink-0 text-xs font-medium"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {formatPercent(clamped)}
      </span>
    </div>
  )
}

/**
 * Standing in a ranking.
 *
 * The top three are marked, the rest are numbered. Rank is drawn with weight
 * and a ring rather than with the series palette — position is not a category,
 * and painting first place in "series 1" would collide with whatever series 1
 * already means on the same screen.
 */
export function RankBadge({ rank }: { rank: number }) {
  const medal = rank <= 3

  /**
   * Weight and a ring, never hue.
   *
   * The top three used to be filled from `--accent`, which is page identity —
   * so on the leaderboard, where no accent is set, they came out the same blue
   * as the revenue trend line and the share bars in the next column. A mark
   * that says "top three" was reading the token that says "which page you are
   * on", and wearing the colour of a series that means something else.
   *
   * Rank is an ordinal, and the numeral already states it exactly. All the
   * badge has to do is make the first three findable.
   */
  return (
    <span
      className="tabular inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]"
      style={{
        background: medal ? 'var(--grid)' : 'transparent',
        color: medal ? 'var(--ink-primary)' : 'var(--ink-secondary)',
        fontWeight: medal ? 700 : 500,
        boxShadow: medal ? 'inset 0 0 0 1px var(--border-strong)' : 'none',
      }}
      aria-label={`${rank}-oʻrin`}
    >
      {rank}
    </span>
  )
}

/**
 * A labelled state.
 *
 * Status carries an icon glyph as well as a colour, so the meaning survives
 * for a colourblind reader, in forced-colors mode, and in print.
 */
export function StatusChip({
  tone,
  children,
}: {
  tone: 'good' | 'warning' | 'critical' | 'neutral'
  children: ReactNode
}) {
  const map = {
    good: { color: 'var(--status-good)', glyph: '●' },
    warning: { color: 'var(--status-warning)', glyph: '▲' },
    critical: { color: 'var(--status-critical)', glyph: '■' },
    neutral: { color: 'var(--ink-muted)', glyph: '○' },
  } as const

  const { color, glyph } = map[tone]

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      <span aria-hidden="true">{glyph}</span>
      {children}
    </span>
  )
}

/** Section heading with the page accent, used inside a card stack. */
export function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
          {title}
        </h2>
        {hint && (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {hint}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}
