import type { ReactNode } from 'react'

import type { KpiCardDto } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { TrendIndicator } from './TrendIndicator'

export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
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
    <Tag className={`card ${className}`}>{children}</Tag>
  )
}

export function ChartCard({
  title,
  hint,
  action,
  children,
  className = '',
}: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
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
      <div className="px-5 pb-5">{children}</div>
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

  return (
    <Card className="px-4 py-3.5">
      <p className="truncate text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      <p
        className="mt-1.5 text-2xl leading-none font-semibold tracking-tight"
        style={{ color: 'var(--ink-primary)' }}
        title={exact}
      >
        {display()}
        {card.unit === 'money' && card.value !== null && (
          <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
            soʻm
          </span>
        )}
      </p>
      <div className="mt-2">
        <TrendIndicator delta={card.delta} />
      </div>
    </Card>
  )
}
