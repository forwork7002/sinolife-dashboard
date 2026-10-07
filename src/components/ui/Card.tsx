import type { CSSProperties, ReactNode } from 'react'

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
