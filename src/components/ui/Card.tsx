import type { CSSProperties, ReactNode } from 'react'

import { Tooltip } from '@/components/ui/Tooltip'
import type { KpiCardDto } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { TrendIndicator } from './TrendIndicator'

export function Card({
  children,
  className = '',
  as: Tag = 'section',
  style,
  'aria-busy': ariaBusy,
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
  /**
   * Escape hatch for a state the class system does not carry.
   *
   * Exactly one caller uses it: the confirmation queue fades its results card
   * while the rows are being replaced by another selection. Kept this narrow
   * on purpose — a card that takes arbitrary style is a card that stops being
   * one definition, which is the fault the comment below records.
   */
  style?: CSSProperties
  'aria-busy'?: boolean
}) {
  /**
   * One class, one definition — see `.card` in globals.css.
   *
   * This used to hand-roll the same thing inline and got two of the three
   * values wrong: `--surface` instead of `--surface-raised`, so in dark mode a
   * card was pixel-identical to the sidebar and to the page behind it, and
   * `rounded-xl` (12px) instead of the house radius. The 1px lit top edge was
   * missing entirely, which is most of what makes a card read as raised.
   */
  return (
    <Tag className={`card ${className}`} style={style} aria-busy={ariaBusy}>
      {children}
    </Tag>
  )
}

export function ChartCard({
  title,
  hint,
  action,
  children,
  className = '',
  fill = false,
}: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  /** Stretch the body to the card's height, for a card in an equal-height row. */
  fill?: boolean
}) {
  return (
    // `.reveal` rises the card as it scrolls into view — scroll-driven CSS,
    // no observers. A card already visible at load renders settled.
    <Card className={`reveal ${fill ? 'flex flex-col' : ''} ${className}`}>
      <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
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
      </header>
      <div className={`px-5 pb-5 ${fill ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
        {fill ? <div className="min-h-0 flex-1">{children}</div> : children}
      </div>
    </Card>
  )
}

/**
 * A single KPI tile.
 *
 * The value is a hero number in proportional figures; the comparison sits
 * beneath it rather than beside it, so a row of tiles scans down the values
 * without the deltas competing for the same line.
 *
 * A null value renders an em dash — never 0. The distinction is the whole point:
 * "no deals were won" and "the average deal was nothing" are different claims.
 */
export function KpiCard({ card, label }: { card: KpiCardDto; label: string }) {
  const display = () => {
    if (card.value === null) return NO_VALUE

    switch (card.unit) {
      case 'money':
        return card.money ? formatCompactUzs(card.money.amount) : NO_VALUE
      case 'percent':
        return formatPercent(card.value)
      case 'count':
        return formatNumber(card.value)
    }
  }

  const exact =
    card.unit === 'money' && card.money ? formatUzs(card.money.amount) : undefined

  /*
    One label voice for every KPI tile — 12.5px sentence case, medium,
    secondary ink. StatTile speaks the same; uppercase-with-tracking now
    lives only in table headers, where it earns its keep.

    The value is a 28px `.figure`: a step below StatTile's 30 on purpose,
    because a KpiCard always carries its delta pill and the two together
    already outweigh a bare tile.
  */
  const value = (
    <>
      {display()}
      {card.unit === 'money' && card.value !== null && (
        <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
          soʻm
        </span>
      )}
    </>
  )

  return (
    <Card className="px-4 py-3.5">
      <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      <div className="mt-1.5">
        {exact ? (
          /*
            The exact soʻm amount rides the Tooltip primitive, not a native
            `title`: it reaches touch and keyboard too. The figure is a tab
            stop — one or two per screen, and the full number is otherwise
            unreachable without a mouse.
          */
          <Tooltip content={<span className="tabular">{exact}</span>}>
            <span
              tabIndex={0}
              className="focusable figure block rounded-[var(--radius-panel-sm)] text-[28px] leading-none font-semibold"
              style={{ color: 'var(--ink-primary)' }}
            >
              {value}
            </span>
          </Tooltip>
        ) : (
          <span
            className="figure block text-[28px] leading-none font-semibold"
            style={{ color: 'var(--ink-primary)' }}
          >
            {value}
          </span>
        )}
      </div>
      <div className="mt-2">
        <TrendIndicator delta={card.delta} />
      </div>
    </Card>
  )
}
