'use client'

import { useEffect, useState, type ReactNode } from 'react'

import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { DotGlyph, RingGlyph, SquareGlyph, TriangleGlyph } from '@/components/ui/Icons'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  NO_VALUE,
  formatCompactUzs,
  formatFullUzs,
  formatNumber,
  formatPercent,
  formatUzs,
} from '@/lib/format'

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
  money = 'compact',
  status = 'ready',
}: {
  label: string
  value: number | null
  unit: 'money' | 'count' | 'percent' | 'hours' | 'days' | 'raw'
  hint?: string
  context?: ReactNode
  tone?: 'neutral' | 'good' | 'warning' | 'critical'
  /**
   * How much of a soʻm figure the tile prints.
   *
   * Compact everywhere by default — a KPI band is read at a glance and
   * «340 mln» is read faster than ten digits. `full` is for the screens whose
   * numbers are reconciled against another screen rather than scanned: the
   * sellers board's FAKT 1 / FAKT 2 are compared against the client's own
   * Bitrix24 board and their Telegram channel, both of which print the sum
   * out in full. It changes three things together — the format, the size
   * (the digits have to fit a tile that also holds «7,900,000»), and the
   * tooltip, which has nothing left to reveal once the figure is complete.
   */
  money?: 'compact' | 'full'
  /** Optional leading colour chip, for tiles that belong to a named series. */
  accent?: string
  /**
   * Where the request stands.
   *
   * Without it, loading, failure and a genuine null all rendered the same em
   * dash — so a page whose API had just returned 500 read as "no data", a
   * calm and confident statement of something nobody knew. Three states, three
   * renderings.
   */
  status?: 'loading' | 'error' | 'ready'
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
        {/* One label voice across every KPI tile: 12.5px sentence case,
            medium, secondary ink. The uppercase-tracked micro-label was a
            second dialect for the same object — and uppercase now survives
            only in table headers. */}
        <p
          className="truncate text-[12.5px] font-medium"
          style={{ color: 'var(--ink-secondary)' }}
        >
          {label}
        </p>
      </div>

      {status === 'loading' ? (
        // role="status", because aria-label on a bare div names nothing.
        // Sized to the figure below at each breakpoint, so ready never reflows loading.
        <div
          className="skeleton mt-2 h-[26px] w-2/3 sm:h-[30px]"
          /* The full reading is smaller on a narrow tile, so the placeholder
             it reflows into has to shrink with it — same token, one source. */
          style={unit === 'money' && money === 'full' ? { height: 'var(--figure-sum-size)' } : undefined}
          role="status"
        >
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' ? (
        <p
          className="figure mt-2 text-[26px] sm:text-[30px] leading-none font-semibold"
          style={{ color: 'var(--status-critical)' }}
          // Decorative title — it only repeats the visible word, so it may
          // stay native. Data-carrying titles ride the Tooltip primitive.
          title="Maʼlumot olinmadi"
        >
          <span className="text-base font-medium">Olinmadi</span>
        </p>
      ) : unit === 'money' && value !== null && money === 'compact' ? (
        /*
          The exact soʻm amount rides the Tooltip primitive, not a native
          `title`: hover, focus AND touch. The figure is a tab stop — a
          handful per screen, and the full number is otherwise unreachable
          without a mouse.

          COMPACT ONLY. Under `money="full"` the tooltip would repeat the text
          directly under the cursor, and the tab stop would cost a keyboard
          reader one stop per tile to reveal nothing — so the full reading
          falls through to the plain figure below.
        */
        <div className="mt-2">
          <Tooltip content={<span className="tabular">{formatUzs(value)}</span>}>
            <span
              tabIndex={0}
              className="focusable figure block rounded-[var(--radius-panel-sm)] text-[26px] sm:text-[30px] leading-none font-semibold"
              style={{ color: toneColor }}
            >
              <StatValue value={value} unit={unit} />
            </span>
          </Tooltip>
        </div>
      ) : (
        <p
          className={`figure mt-2 leading-none font-semibold ${
            unit === 'money' && money === 'full' ? 'figure-sum' : 'text-[26px] sm:text-[30px]'
          }`}
          style={{ color: toneColor }}
        >
          <StatValue value={value} unit={unit} money={money} />
        </p>
      )}

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
  money = 'compact',
}: {
  value: number | null
  unit: 'money' | 'count' | 'percent' | 'hours' | 'days' | 'raw'
  money?: 'compact' | 'full'
}) {
  if (value === null) return <>{NO_VALUE}</>

  // Every figure counts up on first paint and glides when a live refresh
  // moves it — see AnimatedNumber. The unit suffix stays static: only the
  // number is data.
  switch (unit) {
    case 'money':
      return (
        <>
          <AnimatedNumber
            value={value}
            format={money === 'full' ? formatFullUzs : formatCompactUzs}
          />
          <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
            soʻm
          </span>
        </>
      )
    case 'percent':
      return <AnimatedNumber value={value} format={(v) => formatPercent(v)} />
    case 'hours':
    case 'days':
      return (
        <>
          <AnimatedNumber
            value={value}
            format={(v) => formatNumber(Math.round(v * 10) / 10)}
          />
          <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
            {unit === 'days' ? 'kun' : 'soat'}
          </span>
        </>
      )
    case 'count':
      return <AnimatedNumber value={value} format={(v) => formatNumber(Math.round(v))} />
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
/**
 * A rate, drawn as a ring.
 *
 * The system: TILES wear rings, table ROWS wear bars. A ring gives a headline
 * rate a shape the eye finds before it reads anything, and twenty of them in a
 * table would be noise — which is why Meter still exists and neither replaces
 * the other.
 *
 * The sweep is a conic gradient driven by a registered `@property`, so the
 * fill ANIMATES as pure CSS: the component mounts at 0% and sets the real
 * value a frame later, and the browser interpolates the sweep with no
 * JavaScript per frame. A live refresh that changes the value glides the same
 * way. See `.gauge` in globals.css.
 *
 * Colour comes from the same rules as Meter: `auto` grades against the
 * house thresholds, `neutral` states magnitude in the sequential hue. Never
 * the page accent — a mark that encodes a value may not wear page identity.
 */
type GaugeTone = 'auto' | 'neutral' | 'good' | 'warning' | 'critical'

export function RingGauge({
  value,
  size = 68,
  thickness = 7,
  tone = 'auto',
  label,
}: {
  value: number | null
  size?: number
  thickness?: number
  /**
   * `auto` grades against the house thresholds (85 / 60); `neutral` states
   * the magnitude in the sequential hue. The explicit statuses exist for the
   * pages that grade with their OWN thresholds — the margin tile that stays
   * neutral until cost coverage is credible, the inbound-call rate graded at
   * 80/50 — so the judgement is made where the domain knowledge lives and the
   * ring just wears it.
   */
  tone?: GaugeTone
  label?: string
}) {
  // Mount at zero, then set the real value: the transition on --gauge-sweep
  // turns that first update into the entrance sweep.
  const [sweep, setSweep] = useState(0)

  useEffect(() => {
    const target = value === null ? 0 : Math.max(0, Math.min(100, value))
    // A frame after mount, so the 0% initial value has actually painted and
    // there is something to transition FROM.
    const raf = requestAnimationFrame(() => setSweep(target))
    return () => cancelAnimationFrame(raf)
  }, [value])

  if (value === null) {
    return (
      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }

  const clamped = Math.max(0, Math.min(100, value))
  const color =
    tone === 'neutral'
      ? 'var(--seq-450)'
      : tone === 'good'
        ? 'var(--status-good)'
        : tone === 'warning'
          ? 'var(--status-warning)'
          : tone === 'critical'
            ? 'var(--status-critical)'
            : clamped >= 85
              ? 'var(--status-good)'
              : clamped >= 60
                ? 'var(--status-warning)'
                : 'var(--status-critical)'

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label ? `${label}: ` : ''}${formatPercent(value)}`}
    >
      <div
        className="gauge absolute inset-0"
        style={
          {
            '--gauge-sweep': `${sweep}%`,
            '--gauge-color': color,
            '--gauge-thickness': `${thickness}px`,
          } as React.CSSProperties
        }
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <span
          className="figure font-semibold"
          /*
            0.2, not 0.24: at the old ratio "92.8%" cleared the stroke by
            three pixels and read as squeezed into the ring rather than held
            by it. The exact value always travels in the sr-only text and the
            tile hint, so the inside of the ring only has to be LEGIBLE.
          */
          style={{ fontSize: size * 0.2, color: 'var(--ink-primary)' }}
        >
          <AnimatedNumber value={value} format={(v) => formatPercent(v, value >= 100 ? 0 : 1)} />
        </span>
      </div>
    </div>
  )
}

/**
 * A headline rate: ring on the left, meaning on the right.
 *
 * The composition StatTile cannot make — the percentage lives INSIDE the
 * ring, so the number and its proportion are one mark, and the space to the
 * right carries the label, the fraction it came from, and any judgement chip.
 */
export function GaugeTile({
  label,
  value,
  hint,
  tone = 'auto',
  status = 'ready',
  context,
}: {
  label: string
  value: number | null
  hint?: string
  tone?: GaugeTone
  status?: 'loading' | 'error' | 'ready'
  context?: ReactNode
}) {
  return (
    <div className="card flex flex-col px-4 py-3.5">
      {/* Same label voice as StatTile/KpiCard — one treatment for the whole
          KPI family. */}
      <p
        className="truncate text-[12.5px] font-medium"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {label}
      </p>

      <div className="mt-2 flex items-center gap-3.5">
        {status === 'loading' ? (
          <div className="skeleton h-[68px] w-[68px] rounded-full" role="status">
            <span className="sr-only">Yuklanmoqda</span>
          </div>
        ) : status === 'error' ? (
          <span
            className="text-base font-medium"
            style={{ color: 'var(--status-critical)' }}
            title="Maʼlumot olinmadi"
          >
            Olinmadi
          </span>
        ) : (
          <RingGauge value={value} tone={tone} label={label} />
        )}

        <div className="min-w-0 flex-1">
          {hint && (
            <p className="text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
              {hint}
            </p>
          )}
          {context && <div className="mt-1.5">{context}</div>}
        </div>
      </div>
    </div>
  )
}

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
        style={{ background: 'var(--track)' }}
        role="img"
        aria-label={`${label ? `${label}: ` : ''}${formatPercent(clamped)}`}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${clamped}%`,
            background: color,
            // The tokens, not a repeat of their values — a duration written
            // out here is one a change to the design system cannot reach.
            transition: 'width var(--duration-enter) var(--ease-out)',
          }}
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
 * Status carries a glyph as well as a colour, so the meaning survives for a
 * colourblind reader, in forced-colors mode, and in print. The glyphs are the
 * drawn set from Icons.tsx, not the ● ▲ ■ ○ characters — those shifted size
 * and baseline with the font, and ▲ rendered as an emoji on some platforms.
 * Dot / triangle / square keep DIFFERENT silhouettes per tone on purpose:
 * shape is the channel that remains when colour goes.
 */
export function StatusChip({
  tone,
  children,
}: {
  tone: 'good' | 'warning' | 'critical' | 'neutral'
  children: ReactNode
}) {
  const map = {
    good: { color: 'var(--status-good)', Glyph: DotGlyph },
    warning: { color: 'var(--status-warning)', Glyph: TriangleGlyph },
    critical: { color: 'var(--status-critical)', Glyph: SquareGlyph },
    neutral: { color: 'var(--ink-muted)', Glyph: RingGlyph },
  } as const

  const { color, Glyph } = map[tone]

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ background: `color-mix(in oklab, ${color} 12%, transparent)`, color }}
    >
      <Glyph size={10} className="shrink-0" />
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
